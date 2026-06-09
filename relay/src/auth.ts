/**
 * P2-6: JWT Auth Module for Tool Relay
 *
 * 端点:
 *   POST /auth/register  — 注册
 *   POST /auth/login     — 登录（返回 access_token + refresh_token）
 *   POST /auth/refresh   — 刷新 access_token
 *   GET  /auth/me        — 获取当前用户信息
 *
 * 中间件:
 *   - verifyAuth: 验证 Bearer JWT token
 *   - WebSocket 连接也需携带 token
 */

import jwt from "jsonwebtoken";
import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";

// ─── 配置 ───

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_in_production";
const ACCESS_TOKEN_EXPIRY = "1h";
const REFRESH_TOKEN_EXPIRY = "30d";
const DAILY_FREE_LIMIT = 50;

// ─── 数据库 ───

let pool: pg.Pool | null = null;

export async function initDb(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[auth] DATABASE_URL not set, running in dev mode (no persistence)");
    return;
  }

  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    console.log("[auth] Database connected");
  } finally {
    client.release();
  }
}

function getPool(): pg.Pool {
  if (!pool) throw new Error("Database not initialized");
  return pool;
}

// ─── Types ───

interface JwtPayload {
  userId: string;
  email: string;
  plan: string;
}

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
  createdAt: string;
}

// ─── Password Hashing (Bun built-in) ───

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // 添加盐值
  const salt = randomUUID().slice(0, 16);
  const salted = password + salt;
  const saltedHash = await crypto.subtle.digest("SHA-256", encoder.encode(salted));
  const hashHex = Array.from(new Uint8Array(saltedHash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `$pvf$${salt}$${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[1] !== "pvf") return false;
  const salt = parts[2];
  const encoder = new TextEncoder();
  const salted = password + salt;
  const saltedHash = await crypto.subtle.digest("SHA-256", encoder.encode(salted));
  const hashHex = Array.from(new Uint8Array(saltedHash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex === parts[3];
}

// ─── JWT ───

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(): string {
  return randomUUID() + randomUUID();
}

export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ─── 中间件 ───

export function verifyAuth(req: http.IncomingMessage): JwtPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  return verifyAccessToken(token);
}

// ─── 用量检查 ───

export async function checkQuota(userId: string): Promise<{ allowed: boolean; usage: number; limit: number }> {
  if (!pool) {
    // Dev mode: no limits
    return { allowed: true, usage: 0, limit: Infinity };
  }

  const result = await getPool().query(
    `SELECT tool_calls, plan FROM daily_usage du
     JOIN users u ON u.id = du.user_id
     WHERE du.user_id = $1 AND du.date = CURRENT_DATE`,
    [userId]
  );

  if (result.rows.length === 0) {
    // No usage today
    return { allowed: true, usage: 0, limit: DAILY_FREE_LIMIT };
  }

  const { tool_calls, plan } = result.rows[0];
  const limit = plan === "pro" ? 1000 : plan === "enterprise" ? 999999 : DAILY_FREE_LIMIT;
  return { allowed: tool_calls < limit, usage: tool_calls, limit };
}

export async function incrementUsage(userId: string): Promise<void> {
  if (!pool) return;

  await getPool().query(
    `INSERT INTO daily_usage (user_id, date, tool_calls)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, date)
     DO UPDATE SET tool_calls = daily_usage.tool_calls + 1`,
    [userId]
  );
}

// ─── API 处理器 ───

export async function handleAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string
): Promise<boolean> {
  if (!path.startsWith("/auth/")) return false;

  const body = await readBody(req);

  try {
    // POST /auth/register
    if (path === "/auth/register" && req.method === "POST") {
      const { email, password, displayName } = JSON.parse(body);
      if (!email || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "email and password required" }));
        return true;
      }
      if (password.length < 6) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "password must be at least 6 characters" }));
        return true;
      }

      const passwordHash = await hashPassword(password);

      if (!pool) {
        // Dev mode
        const user: AuthUser = {
          id: randomUUID(),
          email,
          displayName: displayName || null,
          plan: "free",
          createdAt: new Date().toISOString(),
        };
        const token = generateAccessToken({ userId: user.id, email: user.email, plan: user.plan });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user, access_token: token, token_type: "Bearer" }));
        return true;
      }

      try {
        const result = await getPool().query(
          `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, plan, created_at`,
          [email, passwordHash, displayName || null]
        );
        const row = result.rows[0];
        const user: AuthUser = {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          plan: row.plan,
          createdAt: row.created_at,
        };
        const token = generateAccessToken({ userId: user.id, email: user.email, plan: user.plan });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user, access_token: token, token_type: "Bearer" }));
      } catch (e: any) {
        if (e.code === "23505") {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "email already registered" }));
        } else {
          throw e;
        }
      }
      return true;
    }

    // POST /auth/login
    if (path === "/auth/login" && req.method === "POST") {
      const { email, password } = JSON.parse(body);
      if (!email || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "email and password required" }));
        return true;
      }

      if (!pool) {
        // Dev mode: accept any login
        const user: AuthUser = {
          id: randomUUID(),
          email,
          displayName: email.split("@")[0],
          plan: "free",
          createdAt: new Date().toISOString(),
        };
        const token = generateAccessToken({ userId: user.id, email: user.email, plan: user.plan });
        const refreshToken = generateRefreshToken();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user, access_token: token, refresh_token: refreshToken, token_type: "Bearer" }));
        return true;
      }

      const result = await getPool().query(
        `SELECT id, email, password_hash, display_name, plan, created_at FROM users WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid credentials" }));
        return true;
      }

      const row = result.rows[0];
      const valid = await verifyPassword(password, row.password_hash);
      if (!valid) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid credentials" }));
        return true;
      }

      // Update last login
      await getPool().query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [row.id]);

      const user: AuthUser = {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        plan: row.plan,
        createdAt: row.created_at,
      };

      const token = generateAccessToken({ userId: user.id, email: user.email, plan: user.plan });
      const refreshToken = generateRefreshToken();

      // Store refresh token hash
      const rtHash = await hashPassword(refreshToken);
      await getPool().query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [user.id, rtHash]
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user, access_token: token, refresh_token: refreshToken, token_type: "Bearer" }));
      return true;
    }

    // POST /auth/refresh
    if (path === "/auth/refresh" && req.method === "POST") {
      const { refresh_token } = JSON.parse(body);
      if (!refresh_token) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "refresh_token required" }));
        return true;
      }

      if (!pool) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not available in dev mode" }));
        return true;
      }

      // Find refresh token
      const rtHash = await hashPassword(refresh_token);
      const rtResult = await getPool().query(
        `SELECT rt.user_id, u.email, u.plan FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND rt.revoked_at IS NULL`,
        [rtHash]
      );

      if (rtResult.rows.length === 0) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid or expired refresh token" }));
        return true;
      }

      const { user_id, email, plan } = rtResult.rows[0];

      // Revoke old refresh token
      await getPool().query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [rtHash]);

      // Issue new tokens
      const newAccessToken = generateAccessToken({ userId: user_id, email, plan });
      const newRefreshToken = generateRefreshToken();
      const newRtHash = await hashPassword(newRefreshToken);
      await getPool().query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [user_id, newRtHash]
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: newAccessToken, refresh_token: newRefreshToken, token_type: "Bearer" }));
      return true;
    }

    // GET /auth/me
    if (path === "/auth/me" && req.method === "GET") {
      const payload = verifyAuth(req);
      if (!payload) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return true;
      }

      if (!pool) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ userId: payload.userId, email: payload.email, plan: payload.plan }));
        return true;
      }

      const result = await getPool().query(
        `SELECT id, email, display_name, plan, created_at FROM users WHERE id = $1`,
        [payload.userId]
      );

      if (result.rows.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "user not found" }));
        return true;
      }

      const row = result.rows[0];
      const quota = await checkQuota(payload.userId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        plan: row.plan,
        createdAt: row.created_at,
        usage: quota,
      }));
      return true;
    }

    // Unknown auth route
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return true;

  } catch (e) {
    console.error("[auth] Error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal server error" }));
    return true;
  }
}

// ─── Admin API ───

export async function handleAdminRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string
): Promise<boolean> {
  if (!path.startsWith("/admin/")) return false;

  // 验证管理员权限
  const payload = verifyAuth(req);
  if (!payload) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return true;
  }

  // GET /admin/stats — 系统统计
  if (path === "/admin/stats" && req.method === "GET") {
    if (!pool) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ mode: "dev", message: "no database" }));
      return true;
    }

    const [users, todayUsage, sessions] = await Promise.all([
      getPool().query("SELECT COUNT(*) as count FROM users"),
      getPool().query("SELECT SUM(tool_calls) as total_calls, COUNT(DISTINCT user_id) as active_users FROM daily_usage WHERE date = CURRENT_DATE"),
      getPool().query("SELECT COUNT(*) as count FROM sessions WHERE ended_at IS NULL"),
    ]);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      totalUsers: parseInt(users.rows[0].count),
      today: {
        toolCalls: parseInt(todayUsage.rows[0].total_calls || "0"),
        activeUsers: parseInt(todayUsage.rows[0].active_users || "0"),
      },
      activeSessions: parseInt(sessions.rows[0].count),
    }));
    return true;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
  return true;
}

// ─── 辅助 ───

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
