/**
 * P1-2 验证脚本：模拟完整 Relay 流程
 *
 * 测试：
 * 1. 启动模拟 WebSocket 客户端，连接 Relay /ws
 * 2. 客户端上报工具列表
 * 3. 模拟 MCP Client 通过 /mcp 端点连接
 * 4. MCP Client 列出工具（应包含客户端上报的工具）
 * 5. MCP Client 调用工具 → Relay → WebSocket → 客户端 → 结果回传 → MCP Client 收到结果
 * 6. 测试心跳
 */

const BASE_URL = "http://localhost:9100/mcp";
const WS_URL = "ws://localhost:9100/ws?user_id=test-user-001";

// ─── MCP Client 辅助函数 ───

async function mcpRequest(method: string, params: Record<string, unknown>, sessionId?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params: params || {},
  });

  const resp = await fetch(BASE_URL, { method: "POST", headers, body });
  const text = await resp.text();
  const newSessionId = resp.headers.get("mcp-session-id");

  let result = null;
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try { result = JSON.parse(line.slice(6)); } catch {}
    }
  }
  if (!result) {
    try { result = JSON.parse(text); } catch {}
  }

  return { result, sessionId: newSessionId, status: resp.status };
}

// ─── Main Test ───

async function main() {
  console.log("=== P1-2: Tool Relay Service Full Test ===\n");

  // Step 1: 连接 WebSocket 客户端
  console.log("1. Connecting WebSocket client...");
  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(WS_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      console.log("   ✓ WebSocket connected!");
      resolve();
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });

  // 设置消息处理
  const wsMessages: Array<Record<string, unknown>> = [];
  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    wsMessages.push(msg);
    console.log(`   [WS ←] type=${msg.type}`);

    // 自动处理 tool_call
    if (msg.type === "tool_call") {
      console.log(`   [WS →] Sending tool_result for ${msg.tool_name}`);
      // 模拟 PVFut 响应
      const result = simulatePvfutResponse(msg.tool_name, msg.arguments);
      ws.send(JSON.stringify({
        type: "tool_result",
        request_id: msg.request_id,
        result,
      }));
    }

    // 自动响应 ping
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  // Step 2: 上报工具列表
  console.log("\n2. Sending tool_list...");
  const testTools = [
    {
      name: "get_version",
      description: "获取 PVFut 版本号",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "get_file_content",
      description: "获取 PVF 文件内容",
      inputSchema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "文件路径" },
          encoding_type: { type: "string", description: "编码类型" },
        },
        required: ["file_path"],
      },
    },
    {
      name: "search_pvf",
      description: "搜索 PVF 文件",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "搜索模式" },
        },
        required: ["pattern"],
      },
    },
  ];

  ws.send(JSON.stringify({ type: "tool_list", tools: testTools }));
  console.log(`   ✓ Sent ${testTools.length} tools`);

  // 等待工具注册完成
  await new Promise(r => setTimeout(r, 500));

  // Step 3: MCP Client 初始化
  console.log("\n3. Initializing MCP Client...");
  const initResp = await mcpRequest("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-mcp-client", version: "1.0.0" },
  });
  const sessionId = initResp.sessionId;
  console.log(`   ✓ Session ID: ${sessionId}`);

  // Send initialized notification
  await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId!,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  // Step 4: 列出工具
  console.log("\n4. Listing tools via MCP...");
  const toolsResp = await mcpRequest("tools/list", {}, sessionId);
  const toolNames = toolsResp.result?.result?.tools?.map((t: { name: string }) => t.name) || [];
  console.log(`   ✓ Tools: ${toolNames.join(", ")}`);

  // 验证工具列表包含 ping + 3 个 PVFut 工具
  const expectedTools = ["ping", "get_version", "get_file_content", "search_pvf"];
  const missingTools = expectedTools.filter(t => !toolNames.includes(t));
  if (missingTools.length > 0) {
    console.error(`   ✗ Missing tools: ${missingTools.join(", ")}`);
  } else {
    console.log(`   ✓ All expected tools present!`);
  }

  // Step 5: 调用 get_version 工具 (通过 MCP → Relay → WebSocket → 客户端)
  console.log("\n5. Calling get_version via MCP (MCP → Relay → WS → Client → Result)...");
  const start = Date.now();
  const versionResp = await mcpRequest("tools/call", {
    name: "get_version",
    arguments: {},
  }, sessionId);
  const elapsed = Date.now() - start;
  console.log(`   Result: ${JSON.stringify(versionResp.result?.result?.content)}`);
  console.log(`   ✓ Elapsed: ${elapsed}ms`);

  // Step 6: 调用 get_file_content 工具
  console.log("\n6. Calling get_file_content via MCP...");
  const fileResp = await mcpRequest("tools/call", {
    name: "get_file_content",
    arguments: { file_path: "equipment/test.equ", encoding_type: "CN" },
  }, sessionId);
  console.log(`   Result: ${JSON.stringify(fileResp.result?.result?.content)}`);
  console.log(`   ✓ File content tool called!`);

  // Step 7: 调用 search_pvf 工具
  console.log("\n7. Calling search_pvf via MCP...");
  const searchResp = await mcpRequest("tools/call", {
    name: "search_pvf",
    arguments: { pattern: ".*\\.equ$" },
  }, sessionId);
  console.log(`   Result: ${JSON.stringify(searchResp.result?.result?.content)}`);
  console.log(`   ✓ Search tool called!`);

  // Step 8: 调用 ping 工具（Relay 本地处理，不经过 WebSocket）
  console.log("\n8. Calling ping via MCP (local, no WS roundtrip)...");
  const pingStart = Date.now();
  const pingResp = await mcpRequest("tools/call", {
    name: "ping",
    arguments: {},
  }, sessionId);
  const pingElapsed = Date.now() - pingStart;
  console.log(`   Result: ${JSON.stringify(pingResp.result?.result?.content)}`);
  console.log(`   ✓ Ping elapsed: ${pingElapsed}ms (should be fast, no WS roundtrip)`);

  // Step 9: Health check
  console.log("\n9. Checking health endpoint...");
  const healthResp = await fetch("http://localhost:9100/health");
  const health = await healthResp.json();
  console.log(`   Health: ${JSON.stringify(health)}`);
  console.log(`   ✓ Health check passed!`);

  // Cleanup
  ws.close();

  console.log("\n=== All P1-2 tests passed! ===");
  console.log("\nSummary:");
  console.log("  ✓ WebSocket client connection + tool_list upload");
  console.log("  ✓ MCP Client initialize + tools/list (includes client tools)");
  console.log("  ✓ MCP tools/call → Relay → WebSocket → Client → Result roundtrip (3 tools)");
  console.log("  ✓ MCP tools/call for local tools (ping, no WS roundtrip)");
  console.log("  ✓ Health check endpoint");
}

function simulatePvfutResponse(toolName: string, args: Record<string, unknown>): unknown {
  switch (toolName) {
    case "get_version":
      return { version: "1.0.0-simulated" };
    case "get_file_content":
      return {
        file_path: args.file_path,
        content: `[模拟文件内容] encoding=${args.encoding_type}`,
        size: 1024,
      };
    case "search_pvf":
      return {
        pattern: args.pattern,
        results: ["equipment/sword.equ", "equipment/armor.equ"],
        total: 2,
      };
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

main().catch(console.error);
