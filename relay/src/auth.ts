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

  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    console.log("[auth] Database connected");

    // 自动创建表结构（IF NOT EXISTS 保证幂等）
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS daily_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        input_tokens BIGINT NOT NULL DEFAULT 0,
        output_tokens BIGINT NOT NULL DEFAULT 0,
        reasoning_tokens BIGINT NOT NULL DEFAULT 0
      );

      -- 确保 UNIQUE 约束存在（幂等）
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'daily_usage_user_id_date_key'
        ) THEN
          ALTER TABLE daily_usage ADD CONSTRAINT daily_usage_user_id_date_key UNIQUE (user_id, date);
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_session_id TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        title TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);
    console.log("[auth] Database schema initialized");
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

// ─── Password Hashing (scrypt) ───

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = randomUUID().slice(0, 16);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `$pvf2$${salt}$${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  // 兼容旧格式 $pvf$ 和新格式 $pvf2$
  if (parts[1] === "pvf2" && parts.length === 4) {
    const salt = parts[2];
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
      key,
      256
    );
    const hashHex = Array.from(new Uint8Array(derivedBits))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex === parts[3];
  }
  // 旧格式兼容（SHA-256 + salt）
  if (parts[1] === "pvf" && parts.length === 4) {
    const salt = parts[2];
    const encoder = new TextEncoder();
    const salted = password + salt;
    const saltedHash = await crypto.subtle.digest("SHA-256", encoder.encode(salted));
    const hashHex = Array.from(new Uint8Array(saltedHash))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex === parts[3];
  }
  return false;
}

// ─── Refresh Token Hashing (HMAC-SHA256, deterministic) ───

const RT_HMAC_SECRET = process.env.RT_HMAC_SECRET || JWT_SECRET + "-refresh-token-hmac";

async function hashRefreshToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(RT_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
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

// ─── 限流 ───

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimiter(req: http.IncomingMessage, limitPerMinute: number = 60): boolean {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  entry.count++;
  if (entry.count > limitPerMinute) {
    return false; // 限流
  }
  return true;
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

export async function incrementUsage(
  userId: string,
  tokens?: { input?: number; output?: number; reasoning?: number }
): Promise<void> {
  if (!pool) return;

  await getPool().query(
    `INSERT INTO daily_usage (user_id, date, tool_calls, input_tokens, output_tokens, reasoning_tokens)
     VALUES ($1, CURRENT_DATE, 1, $2, $3, $4)
     ON CONFLICT (user_id, date)
     DO UPDATE SET
       tool_calls = daily_usage.tool_calls + 1,
       input_tokens = daily_usage.input_tokens + $2,
       output_tokens = daily_usage.output_tokens + $3,
       reasoning_tokens = daily_usage.reasoning_tokens + $4`,
    [userId, tokens?.input || 0, tokens?.output || 0, tokens?.reasoning || 0]
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
        const refreshToken = generateRefreshToken();
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user, access_token: token, refresh_token: refreshToken, token_type: "Bearer" }));
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
        const refreshToken = generateRefreshToken();
        const rtHash = await hashRefreshToken(refreshToken);
        await getPool().query(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
          [user.id, rtHash]
        );
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user, access_token: token, refresh_token: refreshToken, token_type: "Bearer" }));
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

      // Store refresh token hash (HMAC, deterministic)
      const rtHash = await hashRefreshToken(refreshToken);
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

      // Find refresh token (HMAC, deterministic — same input always produces same hash)
      const rtHash = await hashRefreshToken(refresh_token);
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
      const newRtHash = await hashRefreshToken(newRefreshToken);
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

    // GET /auth/quota — 查询当前用户用量和配额
    if (path === "/auth/quota" && req.method === "GET") {
      const payload = verifyAuth(req);
      if (!payload) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return true;
      }

      const quota = await checkQuota(payload.userId);

      // 获取今日详细用量
      let todayUsage = { tool_calls: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
      if (pool) {
        const result = await getPool().query(
          `SELECT tool_calls, input_tokens, output_tokens, reasoning_tokens FROM daily_usage WHERE user_id = $1 AND date = CURRENT_DATE`,
          [payload.userId]
        );
        if (result.rows.length > 0) {
          todayUsage = result.rows[0];
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        plan: payload.plan,
        usage: todayUsage.tool_calls,
        limit: quota.limit,
        remaining: Math.max(0, quota.limit - todayUsage.tool_calls),
        today: todayUsage,
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

  // 验证认证
  const payload = verifyAuth(req);
  if (!payload) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return true;
  }

  // 验证管理员角色（仅 admin 或 enterprise 可访问）
  if (payload.plan !== "admin" && payload.plan !== "enterprise") {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden — admin access required" }));
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
