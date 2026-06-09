/**
 * P1-2: Tool Relay Service — MCP StreamableHTTP Server + WebSocket Bridge
 *
 * 双协议端点:
 *   1. MCP StreamableHTTP: POST /mcp  (OpenCode 连接)
 *   2. WebSocket:           WS /ws    (客户端连接)
 *
 * 工具调用桥:
 *   OpenCode → MCP tools/call → Relay → WebSocket tool_call → Client → PVFut → tool_result → Relay → MCP response → OpenCode
 *
 * 工具列表同步:
 *   客户端连上 WebSocket 后发送 tool_list 消息，Relay 动态注册工具到 MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

// ─── 配置 ───

const PORT = parseInt(process.env.RELAY_PORT || "9100");
const TOOL_CALL_TIMEOUT_MS = parseInt(process.env.TOOL_CALL_TIMEOUT || "60000");
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

// ─── 类型 ───

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ClientConnection {
  ws: WebSocket;
  userId: string;
  connectedAt: number;
  tools: ToolDefinition[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// WebSocket 消息类型
interface WsToolCall {
  type: "tool_call";
  request_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

interface WsToolResult {
  type: "tool_result";
  request_id: string;
  result: unknown;
  error?: string;
}

interface WsToolList {
  type: "tool_list";
  tools: ToolDefinition[];
}

interface WsPong {
  type: "pong";
}

type WsClientMessage = WsToolResult | WsToolList | WsPong;
type WsServerMessage = WsToolCall | { type: "ping" };

// ─── 全局状态 ───

const state = {
  /** userId → ClientConnection */
  connections: new Map<string, ClientConnection>(),

  /** requestId → PendingCall */
  pendingCalls: new Map<string, PendingCall>(),

  /** userId → last active timestamp */
  lastActive: new Map<string, number>(),

  /** 所有已注册的工具（跨所有客户端合并） */
  allTools: new Map<string, ToolDefinition>(),
};

// ─── MCP Server ───

const mcpServer = new McpServer(
  { name: "pvf-tool-relay", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

// 注册一个始终可用的 ping 工具
mcpServer.tool("ping", "测试工具连通性", {}, async () => {
  return {
    content: [{ type: "text" as const, text: "pong from pvf-tool-relay" }],
  };
});

/**
 * 动态注册工具到 MCP Server
 * 当客户端连上并上报工具列表后调用
 */
function registerToolToMcp(tool: ToolDefinition): void {
  if (state.allTools.has(tool.name)) return;

  state.allTools.set(tool.name, tool);

  // 构建 Zod schema 从 inputSchema
  const schema: Record<string, z.ZodTypeAny> = {};
  if (tool.inputSchema?.properties) {
    const required = (tool.inputSchema.required as string[]) || [];
    for (const [key, prop] of Object.entries(tool.inputSchema.properties as Record<string, unknown>)) {
      const p = prop as { type?: string; description?: string };
      let zodType: z.ZodTypeAny;
      switch (p.type) {
        case "number":
        case "integer":
          zodType = z.number();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        default:
          zodType = z.string();
      }
      if (p.description) zodType = zodType.describe(p.description);
      if (!required.includes(key)) zodType = zodType.optional();
      schema[key] = zodType;
    }
  }

  try {
    mcpServer.tool(
      tool.name,
      tool.description || "",
      Object.keys(schema).length > 0 ? schema : {},
      async (args: Record<string, unknown>) => {
        return await handleToolCall(tool.name, args);
      }
    );
    console.log(`[mcp] Registered tool: ${tool.name}`);
  } catch (e) {
    // Tool may already be registered
    console.warn(`[mcp] Failed to register tool ${tool.name}:`, (e as Error).message);
  }
}

/**
 * 处理工具调用 — 通过 WebSocket 转发给客户端
 */
async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  // ping 直接返回
  if (toolName === "ping") {
    return { content: [{ type: "text", text: "pong from pvf-tool-relay" }] };
  }

  // 查找有此工具的客户端
  let targetClient: ClientConnection | null = null;
  for (const client of state.connections.values()) {
    if (client.tools.some(t => t.name === toolName)) {
      targetClient = client;
      break;
    }
  }

  if (!targetClient) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `No client available for tool: ${toolName}` }) }],
    };
  }

  // 创建 pending call
  const requestId = `${targetClient.userId}:${randomUUID()}`;
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pendingCalls.delete(requestId);
      reject(new Error(`Tool call timed out: ${toolName} (${TOOL_CALL_TIMEOUT_MS}ms)`));
    }, TOOL_CALL_TIMEOUT_MS);

    state.pendingCalls.set(requestId, {
      resolve: (result: unknown) => {
        clearTimeout(timeout);
        state.pendingCalls.delete(requestId);
        const text = typeof result === "string" ? result : JSON.stringify(result);
        resolve({ content: [{ type: "text", text }] });
      },
      reject: (error: Error) => {
        clearTimeout(timeout);
        state.pendingCalls.delete(requestId);
        resolve({
          content: [{ type: "text", text: JSON.stringify({ error: error.message }) }],
        });
      },
      timeout,
    });

    // 通过 WebSocket 发送 tool_call 给客户端
    const msg: WsServerMessage = {
      type: "tool_call",
      request_id: requestId,
      tool_name: toolName,
      arguments: args,
    };

    if (targetClient!.ws.readyState === WebSocket.OPEN) {
      targetClient!.ws.send(JSON.stringify(msg));
      console.log(`[relay] → tool_call: ${toolName} (request_id: ${requestId})`);
    } else {
      clearTimeout(timeout);
      state.pendingCalls.delete(requestId);
      reject(new Error(`Client WebSocket not open for tool: ${toolName}`));
    }
  });
}

// ─── MCP StreamableHTTP Transport ───

const mcpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

await mcpServer.connect(mcpTransport);

// ─── HTTP Server ───

const httpServer = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // MCP StreamableHTTP endpoint
  if (req.url?.startsWith("/mcp")) {
    try {
      await mcpTransport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] Error handling request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal Server Error");
      }
    }
    return;
  }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "pvf-tool-relay",
      version: "0.2.0",
      connected_clients: state.connections.size,
      registered_tools: state.allTools.size,
      pending_calls: state.pendingCalls.size,
    }));
    return;
  }

  res.writeHead(404).end("Not Found");
});

// ─── WebSocket Server ───

const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP → WebSocket for /ws path
httpServer.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  // 从 query params 或 headers 提取 userId
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const userId = url.searchParams.get("user_id") || `user-${randomUUID().slice(0, 8)}`;

  console.log(`[ws] Client connected: ${userId} (from ${req.socket.remoteAddress})`);

  const client: ClientConnection = {
    ws,
    userId,
    connectedAt: Date.now(),
    tools: [],
  };

  state.connections.set(userId, client);
  state.lastActive.set(userId, Date.now());

  // 发送欢迎消息
  ws.send(JSON.stringify({ type: "connected", user_id: userId }));

  ws.on("message", (data: Buffer) => {
    let parsed: WsClientMessage;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      console.warn(`[ws] Invalid JSON from ${userId}`);
      return;
    }

    state.lastActive.set(userId, Date.now());

    switch (parsed.type) {
      case "tool_list": {
        console.log(`[ws] Received tool_list from ${userId}: ${parsed.tools.length} tools`);
        client.tools = parsed.tools;
        // 注册所有工具到 MCP
        for (const tool of parsed.tools) {
          registerToolToMcp(tool);
        }
        break;
      }

      case "tool_result": {
        const pending = state.pendingCalls.get(parsed.request_id);
        if (pending) {
          if (parsed.error) {
            pending.reject(new Error(parsed.error));
          } else {
            pending.resolve(parsed.result);
          }
        } else {
          console.warn(`[ws] Received tool_result for unknown request: ${parsed.request_id}`);
        }
        console.log(`[relay] ← tool_result: ${parsed.request_id} (error: ${!!parsed.error})`);
        break;
      }

      case "pong": {
        // 心跳响应，lastActive 已更新
        break;
      }

      default:
        console.warn(`[ws] Unknown message type from ${userId}:`, (parsed as Record<string, unknown>).type);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[ws] Client disconnected: ${userId} (code: ${code})`);
    cleanupDisconnectedUser(userId);
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error for ${userId}:`, err.message);
    cleanupDisconnectedUser(userId);
  });
});

// ─── 断线清理 ───

function cleanupDisconnectedUser(userId: string): void {
  state.connections.delete(userId);
  state.lastActive.delete(userId);

  // 取消该用户所有 pending calls
  for (const [requestId, pending] of state.pendingCalls.entries()) {
    if (requestId.startsWith(`${userId}:`)) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Client disconnected"));
      state.pendingCalls.delete(requestId);
    }
  }
}

// ─── 心跳检测 ───

setInterval(() => {
  const now = Date.now();

  for (const [userId, lastTime] of state.lastActive.entries()) {
    if (now - lastTime > HEARTBEAT_TIMEOUT_MS) {
      console.warn(`[relay] Heartbeat timeout for ${userId}`);
      const client = state.connections.get(userId);
      if (client) {
        client.ws.terminate();
        cleanupDisconnectedUser(userId);
      }
    }
  }

  // 向所有客户端发送 ping
  for (const [userId, client] of state.connections.entries()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: "ping" }));
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// ─── 启动 ───

httpServer.listen(PORT, () => {
  console.log(`[pvf-tool-relay] v0.2.0 starting...`);
  console.log(`[pvf-tool-relay] MCP StreamableHTTP: http://localhost:${PORT}/mcp`);
  console.log(`[pvf-tool-relay] WebSocket:          ws://localhost:${PORT}/ws?user_id=<id>`);
  console.log(`[pvf-tool-relay] Health check:       http://localhost:${PORT}/health`);
  console.log(`[pvf-tool-relay] Tool call timeout:   ${TOOL_CALL_TIMEOUT_MS}ms`);
  console.log(`[pvf-tool-relay] Heartbeat timeout:   ${HEARTBEAT_TIMEOUT_MS}ms`);
});
