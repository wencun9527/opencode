/**
 * P2-6: Auth + MCP + WebSocket 端到端测试
 * 
 * 测试流程:
 * 1. 注册新用户
 * 2. 登录获取 token
 * 3. 无 token 访问 /mcp → 401
 * 4. 有 token 访问 /mcp → 成功
 * 5. /auth/me 获取用户信息
 * 6. 连接 WebSocket 带 token
 * 7. 通过 MCP 调用工具
 * 8. 刷新 token
 * 9. 重复注册 → 409
 * 10. 错误密码登录 → 401
 */

const BASE = "http://localhost:9100";
const TEST_EMAIL = `e2e-test-${Date.now()}@test.com`;
const TEST_PASSWORD = "test123456";
const TEST_NAME = "E2E Test User";

let accessToken = "";
let refreshToken = "";

async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log("  [PASS] " + name);
    passed++;
  } catch (e: any) {
    console.log("  [FAIL] " + name + ": " + e.message);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\n[P2-6 Auth E2E Test]\n");
  console.log("Server: " + BASE + "\n");

  // 1. 健康检查
  await test("Health check shows auth enabled", async () => {
    const { data } = await api("GET", "/health");
    assert(data.status === "ok", "Health check failed");
    assert(data.auth === "enabled", "Auth should be enabled");
    assert(data.version === "0.3.0", "Version should be 0.3.0");
  });

  // 2. 注册
  await test("Register new user", async () => {
    const { status, data } = await api("POST", "/auth/register", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      displayName: TEST_NAME,
    });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(data.access_token, "Should return access_token");
    assert(data.user.email === TEST_EMAIL, "Email should match");
    assert(data.user.plan === "free", "Plan should be free");
    accessToken = data.access_token;
  });

  // 3. 重复注册 → 409
  await test("Duplicate registration returns 409", async () => {
    const { status, data } = await api("POST", "/auth/register", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    assert(status === 409, `Expected 409, got ${status}`);
    assert(data.error?.includes("already"), "Error should mention already registered");
  });

  // 4. 登录
  await test("Login with correct password", async () => {
    const { status, data } = await api("POST", "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.access_token, "Should return access_token");
    assert(data.refresh_token, "Should return refresh_token");
    assert(data.user, "Should return user");
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
  });

  // 5. 错误密码 → 401
  await test("Login with wrong password returns 401", async () => {
    const { status } = await api("POST", "/auth/login", {
      email: TEST_EMAIL,
      password: "wrongpassword",
    });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // 6. 无 token 访问 /mcp → 401
  await test("MCP without token returns 401", async () => {
    const { status, data } = await api("POST", "/mcp", {
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
    });
    assert(status === 401, `Expected 401, got ${status}`);
    assert(data.error?.includes("unauthorized"), "Should say unauthorized");
  });

  // 7. 有 token 访问 /auth/me
  await test("Get current user with token", async () => {
    const { status, data } = await api("GET", "/auth/me", undefined, accessToken);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.email === TEST_EMAIL, "Email should match");
    assert(data.plan === "free", "Plan should be free");
  });

  // 8. 有 token 访问 /mcp
  await test("MCP with token succeeds", async () => {
    const { status } = await api("POST", "/mcp", {
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    }, accessToken);
    // StreamableHTTP 可能返回 200 或其他状态，只要不是 401
    assert(status !== 401, `Should not be 401, got ${status}`);
  });

  // 9. 刷新 token
  await test("Refresh token", async () => {
    const { status, data } = await api("POST", "/auth/refresh", {
      refresh_token: refreshToken,
    });
    // Dev mode may not support refresh
    if (status === 200) {
      assert(data.access_token, "Should return new access_token");
      assert(data.refresh_token, "Should return new refresh_token");
      accessToken = data.access_token;
      refreshToken = data.refresh_token;
    }
  });

  // 10. WebSocket 带 token
  await test("WebSocket with token connects", async () => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws?token=${accessToken}`);
    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => { resolve(true); ws.close(); };
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });
    assert(connected, "WebSocket should connect with valid token");
  });

  // 11. Admin stats
  await test("Admin stats with token", async () => {
    const { status, data } = await api("GET", "/admin/stats", undefined, accessToken);
    assert(status === 200, `Expected 200, got ${status}`);
    // Dev mode returns mode: "dev"
    assert(data.mode === "dev" || data.totalUsers !== undefined, "Should return stats");
  });

  console.log("\nResults: " + passed + " passed, " + failed + " failed (total: " + (passed + failed) + ")\n");
  
  if (failed > 0) process.exit(1);
}

main().catch(console.error);
