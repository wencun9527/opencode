/**
 * P2: Tool Relay Service v0.3 — MCP StreamableHTTP + WebSocket Bridge + JWT Auth
 *
 * 端点:
 *   POST /mcp/*        — MCP StreamableHTTP (OpenCode 连接, 需 Bearer token)
 *   WS   /ws           — WebSocket (客户端连接, 需 token query param)
 *   POST /auth/*       — 认证 API (register/login/refresh/me)
 *   GET  /admin/*      — 管理 API (需 Bearer token)
 *   GET  /health       — 健康检查
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

import {
  initDb,
  verifyAuth,
  checkQuota,
  incrementUsage,
  handleAuthRequest,
  handleAdminRequest,
} from "./auth.js";

// ─── 配置 ───

const PORT = parseInt(process.env.RELAY_PORT || "9100");
const TOOL_CALL_TIMEOUT_MS = parseInt(process.env.TOOL_CALL_TIMEOUT || "60000");
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== "false"; // 默认开启鉴权

// ─── 类型 ───

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  userId: string;  // 用于用量统计
}

interface ClientConnection {
  ws: WebSocket;
  userId: string;
  authUserId?: string;  // JWT 解析出的用户 ID
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
  connections: new Map<string, ClientConnection>(),
  pendingCalls: new Map<string, PendingCall>(),
  lastActive: new Map<string, number>(),
  allTools: new Map<string, ToolDefinition>(),
};

// ─── MCP Server ───

const mcpServer = new McpServer(
  { name: "pvf-tool-relay", version: "0.3.0" },
  { capabilities: { tools: {} } }
);

mcpServer.tool("ping", "测试工具连通性", {}, async () => {
  return {
    content: [{ type: "text" as const, text: "pong from pvf-tool-relay v0.3.0" }],
  };
});

function registerToolToMcp(tool: ToolDefinition): void {
  if (state.allTools.has(tool.name)) return;

  state.allTools.set(tool.name, tool);

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
    console.warn(`[mcp] Failed to register tool ${tool.name}:`, (e as Error).message);
  }
}

async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (toolName === "ping") {
    return { content: [{ type: "text", text: "pong from pvf-tool-relay v0.3.0" }] };
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

  // 用量检查
  if (targetClient.authUserId && REQUIRE_AUTH) {
    const quota = await checkQuota(targetClient.authUserId);
    if (!quota.allowed) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Daily quota exceeded", usage: quota.usage, limit: quota.limit }) }],
      };
    }
  }

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

        // 用量统计
        if (targetClient!.authUserId) {
          incrementUsage(targetClient!.authUserId).catch(console.error);
        }
      },
      reject: (error: Error) => {
        clearTimeout(timeout);
        state.pendingCalls.delete(requestId);
        resolve({
          content: [{ type: "text", text: JSON.stringify({ error: error.message }) }],
        });
      },
      timeout,
      userId: targetClient!.authUserId || targetClient!.userId,
    });

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

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // Auth routes (no auth required)
  if (await handleAuthRequest(req, res, path)) return;

  // Admin routes (auth required, handled internally)
  if (await handleAdminRequest(req, res, path)) return;

  // MCP StreamableHTTP endpoint — 需鉴权
  if (path.startsWith("/mcp")) {
    if (REQUIRE_AUTH) {
      const payload = verifyAuth(req);
      if (!payload) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized - Bearer token required" }));
        return;
      }
    }
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
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "pvf-tool-relay",
      version: "0.3.0",
      auth: REQUIRE_AUTH ? "enabled" : "disabled",
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

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// 动态 import 避免循环
async function verifyWsToken(token: string): Promise<{ userId: string; email: string; plan: string } | null> {
  const { verifyAccessToken } = await import("./auth.js");
  return verifyAccessToken(token);
}

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const userId = url.searchParams.get("user_id") || `user-${randomUUID().slice(0, 8)}`;

  console.log(`[ws] Client connected: ${userId} (from ${req.socket.remoteAddress})`);

  const client: ClientConnection = {
    ws,
    userId,
    connectedAt: Date.now(),
    tools: [],
  };

  // 如果有 token，解析 authUserId
  const token = url.searchParams.get("token");
  if (token && REQUIRE_AUTH) {
    verifyWsToken(token).then((payload) => {
      if (payload) {
        client.authUserId = payload.userId;
        console.log(`[ws] Authenticated: ${userId} → ${payload.email}`);
      }
    });
  }

  state.connections.set(userId, client);
  state.lastActive.set(userId, Date.now());

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
        break;
      }

      default:
        console.warn(`[ws] Unknown message type from ${userId}:`, (parsed as Record<string, unknown>).type);
    }
  });

  ws.on("close", (code) => {
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

  for (const [, client] of state.connections.entries()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: "ping" }));
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// ─── 启动 ───

async function main() {
  // 初始化数据库
  await initDb();

  httpServer.listen(PORT, () => {
    console.log(`[pvf-tool-relay] v0.3.0 starting...`);
    console.log(`[pvf-tool-relay] MCP StreamableHTTP: http://localhost:${PORT}/mcp`);
    console.log(`[pvf-tool-relay] WebSocket:          ws://localhost:${PORT}/ws?user_id=<id>&token=<jwt>`);
    console.log(`[pvf-tool-relay] Auth:               http://localhost:${PORT}/auth/*`);
    console.log(`[pvf-tool-relay] Admin:              http://localhost:${PORT}/admin/*`);
    console.log(`[pvf-tool-relay] Health check:       http://localhost:${PORT}/health`);
    console.log(`[pvf-tool-relay] Auth required:      ${REQUIRE_AUTH}`);
    console.log(`[pvf-tool-relay] Tool call timeout:   ${TOOL_CALL_TIMEOUT_MS}ms`);
    console.log(`[pvf-tool-relay] Heartbeat timeout:   ${HEARTBEAT_TIMEOUT_MS}ms`);
  });
}

main().catch(console.error);
