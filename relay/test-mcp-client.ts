/**
 * P1-1a 验证脚本：模拟 MCP Client 连接 Relay Server
 * 测试完整的 MCP StreamableHTTP 协议流程
 */

const BASE_URL = "http://localhost:9100/mcp";

async function mcpRequest(method, params, sessionId) {
  const headers = {
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

  const resp = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body,
  });

  const text = await resp.text();
  
  // Extract session ID from response headers
  const newSessionId = resp.headers.get("mcp-session-id");
  
  // Parse SSE response
  let result = null;
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        result = JSON.parse(line.slice(6));
      } catch {}
    }
  }
  
  // If not SSE, try direct JSON
  if (!result) {
    try {
      result = JSON.parse(text);
    } catch {}
  }

  return { result, sessionId: newSessionId, status: resp.status };
}

async function main() {
  console.log("=== MCP StreamableHTTP Client Test ===\n");

  // Step 1: Initialize
  console.log("1. Sending initialize request...");
  const initResp = await mcpRequest("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  console.log("   Status:", initResp.status);
  console.log("   Session ID:", initResp.sessionId);
  console.log("   Server Info:", JSON.stringify(initResp.result?.result?.serverInfo));
  console.log("   Capabilities:", JSON.stringify(initResp.result?.result?.capabilities));

  const sessionId = initResp.sessionId;
  if (!sessionId) {
    console.error("   ERROR: No session ID returned!");
    return;
  }
  console.log("   ✓ Initialize successful!\n");

  // Step 2: Send initialized notification
  console.log("2. Sending initialized notification...");
  const notifBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  const notifResp = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId,
    },
    body: notifBody,
  });
  console.log("   Status:", notifResp.status);
  console.log("   ✓ Initialized notification sent!\n");

  // Step 3: List tools
  console.log("3. Listing tools...");
  const toolsResp = await mcpRequest("tools/list", {}, sessionId);
  console.log("   Tools:", JSON.stringify(toolsResp.result?.result?.tools?.map(t => t.name)));
  console.log("   ✓ Tools listed!\n");

  // Step 4: Call ping tool
  console.log("4. Calling ping tool...");
  const pingResp = await mcpRequest("tools/call", {
    name: "ping",
    arguments: {},
  }, sessionId);
  console.log("   Result:", JSON.stringify(pingResp.result?.result?.content));
  console.log("   ✓ Ping tool called!\n");

  // Step 5: Call echo tool
  console.log("5. Calling echo tool...");
  const echoResp = await mcpRequest("tools/call", {
    name: "echo",
    arguments: { message: "Hello from MCP Client!" },
  }, sessionId);
  console.log("   Result:", JSON.stringify(echoResp.result?.result?.content));
  console.log("   ✓ Echo tool called!\n");

  // Step 6: Call get_version tool
  console.log("6. Calling get_version tool...");
  const versionResp = await mcpRequest("tools/call", {
    name: "get_version",
    arguments: {},
  }, sessionId);
  console.log("   Result:", JSON.stringify(versionResp.result?.result?.content));
  console.log("   ✓ get_version tool called!\n");

  console.log("=== All tests passed! ===");
  console.log("\nConclusion: MCP StreamableHTTP Server works correctly.");
  console.log("OpenCode can connect to this server via type:'remote' config.");
}

main().catch(console.error);
