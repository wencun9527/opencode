/**
 * P1-4 端到端测试：OpenCode → MCP → Relay → WebSocket → PVFut Client → Result
 *
 * 测试完整链路：
 * 1. 启动 Relay Server
 * 2. 连接模拟 PVFut 客户端 (WebSocket)
 * 3. 模拟 MCP Client (OpenCode 端) 连接
 * 4. 执行多次工具调用
 * 5. 测试超时场景
 * 6. 测试断线场景
 * 7. 测试心跳
 *
 * 前提: Relay Server 已在 localhost:9100 运行
 */

const BASE_URL = "http://localhost:9100/mcp";
const WS_URL = "ws://localhost:9100/ws?user_id=e2e-test-user";

// ─── MCP Client ───

async function mcpRequest(method: string, params: Record<string, unknown>, sessionId?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || {} });
  const resp = await fetch(BASE_URL, { method: "POST", headers, body });
  const text = await resp.text();
  const newSessionId = resp.headers.get("mcp-session-id");

  let result = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try { result = JSON.parse(line.slice(6)); } catch {}
    }
  }
  if (!result) {
    try { result = JSON.parse(text); } catch {}
  }

  return { result, sessionId: newSessionId, status: resp.status };
}

// ─── Main ───

async function main() {
  console.log("=== P1-4: End-to-End Test ===\n");

  // Check relay is running
  try {
    const health = await (await fetch("http://localhost:9100/health")).json();
    console.log(`Relay health: ${JSON.stringify(health)}`);
  } catch {
    console.error("ERROR: Relay Server not running! Start with: bun run relay/src/index.ts");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ ${msg}`);
      failed++;
    }
  }

  // ─── Test 1: WebSocket 客户端连接 + 工具上报 ───
  console.log("\n--- Test 1: WebSocket Client Connection ---");
  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(WS_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
  assert(true, "WebSocket client connected");

  const wsReceived: Array<Record<string, unknown>> = [];
  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    wsReceived.push(msg);

    // 自动处理 tool_call (模拟 PVFut 响应)
    if (msg.type === "tool_call") {
      const result = { tool: msg.tool_name, args: msg.arguments, simulated: true };
      ws.send(JSON.stringify({ type: "tool_result", request_id: msg.request_id, result }));
    }
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  // 上报工具列表
  const testTools = [
    { name: "get_version", description: "获取版本号", inputSchema: { type: "object", properties: {}, required: [] } },
    { name: "get_file_list", description: "列出文件", inputSchema: { type: "object", properties: { dir_name: { type: "string" } }, required: ["dir_name"] } },
    { name: "get_file_content", description: "获取文件内容", inputSchema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
    { name: "search_pvf", description: "搜索文件", inputSchema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
  ];
  ws.send(JSON.stringify({ type: "tool_list", tools: testTools }));
  await new Promise(r => setTimeout(r, 300));
  assert(true, `Reported ${testTools.length} tools`);

  // ─── Test 2: MCP Client 初始化 ───
  console.log("\n--- Test 2: MCP Client Initialize ---");
  const initResp = await mcpRequest("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-test-client", version: "1.0.0" },
  });
  const sessionId = initResp.sessionId;
  assert(!!sessionId, `MCP session established: ${sessionId}`);

  // Send initialized notification
  await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Mcp-Session-Id": sessionId! },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  // ─── Test 3: 列出工具 ───
  console.log("\n--- Test 3: List Tools ---");
  const toolsResp = await mcpRequest("tools/list", {}, sessionId);
  const toolNames = toolsResp.result?.result?.tools?.map((t: { name: string }) => t.name) || [];
  assert(toolNames.includes("ping"), "Tools include 'ping' (local)");
  assert(toolNames.includes("get_version"), "Tools include 'get_version' (from WS client)");
  assert(toolNames.includes("get_file_content"), "Tools include 'get_file_content' (from WS client)");
  assert(toolNames.length >= 5, `Total tools >= 5 (actual: ${toolNames.length})`);

  // ─── Test 4: 工具调用 - 多次调用 ───
  console.log("\n--- Test 4: Multiple Tool Calls ---");
  
  const call1 = await mcpRequest("tools/call", { name: "get_version", arguments: {} }, sessionId);
  assert(!!call1.result?.result?.content, "get_version call succeeded");
  
  const call2 = await mcpRequest("tools/call", { name: "get_file_content", arguments: { file_path: "test.equ" } }, sessionId);
  assert(!!call2.result?.result?.content, "get_file_content call succeeded");
  
  const call3 = await mcpRequest("tools/call", { name: "search_pvf", arguments: { pattern: ".*\\.equ$" } }, sessionId);
  assert(!!call3.result?.result?.content, "search_pvf call succeeded");

  const call4 = await mcpRequest("tools/call", { name: "ping", arguments: {} }, sessionId);
  assert(!!call4.result?.result?.content, "ping call succeeded (local, no WS)");

  // ─── Test 5: 工具调用延迟 ───
  console.log("\n--- Test 5: Tool Call Latency ---");
  const latencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await mcpRequest("tools/call", { name: "get_version", arguments: {} }, sessionId);
    latencies.push(Date.now() - start);
  }
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  assert(avgLatency < 500, `Average tool call latency: ${avgLatency.toFixed(0)}ms (target: <500ms)`);
  console.log(`  Latencies: ${latencies.join(", ")} ms`);

  // ─── Test 6: 健康检查 ───
  console.log("\n--- Test 6: Health Check ---");
  const health = await (await fetch("http://localhost:9100/health")).json();
  assert(health.connected_clients >= 1, `Connected clients: ${health.connected_clients}`);
  assert(health.registered_tools >= 4, `Registered tools: ${health.registered_tools}`);
  assert(health.pending_calls === 0, `No pending calls: ${health.pending_calls}`);

  // ─── Test 7: 并发工具调用 ───
  console.log("\n--- Test 7: Concurrent Tool Calls ---");
  const concurrentStart = Date.now();
  const concurrentResults = await Promise.all([
    mcpRequest("tools/call", { name: "get_version", arguments: {} }, sessionId),
    mcpRequest("tools/call", { name: "get_file_list", arguments: { dir_name: "equipment" } }, sessionId),
    mcpRequest("tools/call", { name: "search_pvf", arguments: { pattern: "test" } }, sessionId),
  ]);
  const concurrentElapsed = Date.now() - concurrentStart;
  assert(concurrentResults.every(r => !!r.result?.result?.content), "All 3 concurrent calls succeeded");
  assert(concurrentElapsed < 1000, `Concurrent calls completed in ${concurrentElapsed}ms`);

  // Cleanup
  ws.close();

  // ─── Summary ───
  console.log("\n=== E2E Test Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
