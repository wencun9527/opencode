# PVF AI Editor 商用架构设计与实施文档

> 版本: 2.0  
> 日期: 2026-06-10  
> 状态: Phase 0 已完成，Phase 1 进行中  
> 变更记录: v2.0 — 基于 OpenCode 原生支持远程 MCP (StreamableHTTP/SSE Transport) 的发现，大幅简化架构，移除 RelayTransport 自定义改动

---

## 目录

1. [项目目标](#1-项目目标)
2. [当前架构分析](#2-当前架构分析)
3. [目标商用架构](#3-目标商用架构)
4. [组件改造详细设计](#4-组件改造详细设计)
5. [数据流与协议设计](#5-数据流与协议设计)
6. [安全模型](#6-安全模型)
7. [计费系统设计](#7-计费系统设计)
8. [服务器部署架构](#8-服务器部署架构)
9. [实施路线图](#9-实施路线图)
10. [风险评估与应对](#10-风险评估与应对)

---

## 1. 项目目标

### 1.1 商业目标

将 PVF AI Editor 从"本地工具"转化为"商用 SaaS + 桌面客户端"产品：

- AI 推理能力云端化，API Key 不暴露给客户端
- 按使用量或订阅制收费
- 支持多用户并发，会话持久化
- 客户端免费分发，服务按量计费

### 1.2 核心约束

| 约束 | 原因 |
|------|------|
| PVF 数据必须在本地 | 游戏封包文件体积大（数 GB），且涉及用户隐私，不可上传 |
| AI 推理必须在云端 | API Key 保护 + 计费需求 |
| OpenCode 必须可自定义 | Agent 行为需针对 PVF 编辑场景深度优化 |
| 客户端需离线基础功能 | PVFut 本地编辑不依赖网络 |

### 1.3 成功标准

- DeepSeek API Key 在客户端任何位置不可见
- 工具调用端到端延迟 < 2 秒（不含 AI 推理时间）
- 单服务器支持 100 并发用户
- Phase 1 验证通过后才开始后续投入

---

## 2. 当前架构分析

### 2.1 架构全景

```
当前架构（全本地）：

┌─────────────────── Tauri 客户端 ───────────────────┐
│                                                     │
│  前端 (React)                                       │
│  ├── opencodeClient.ts ──→ localhost:动态端口        │
│  └── pvfBridge.ts ──→ localhost:27000              │
│                                                     │
│  Rust 后端 (lib.rs)                                 │
│  ├── 启动 OpenCode sidecar 进程                      │
│  ├── 注入 DEEPSEEK_API_KEY 环境变量 ← 安全漏洞！    │
│  └── 从 stdout 解析端口号                            │
│                                                     │
│  OpenCode Server (sidecar)                          │
│  ├── AI 推理 → DeepSeek API (Key 来自环境变量)       │
│  ├── MCP Client → StdioTransport → spawn 子进程     │
│  └── 会话存储 → 本地文件系统                         │
│                                                     │
│  MCP Server: pvfutility (Bun 进程)                  │
│  └── StdioServerTransport → HTTP → PVFut :27000    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 2.2 关键问题清单

| # | 问题 | 位置 | 商用影响 |
|---|------|------|---------|
| P1 | DeepSeek API Key 通过环境变量注入本地进程 | `lib.rs:118-119` | Key 可被用户提取，无法收费 |
| P2 | MCP 使用 StdioTransport，仅限本机进程间通信 | `mcp-servers/pvfutility/index.ts:433` | 无法跨越网络 |
| P3 | OpenCode 会话存储在本地文件系统 | OpenCode 内部 | 无法多端同步、无法统计用量 |
| P4 | 无用户鉴权 | 全局 | 无法区分用户、无法计费 |
| P5 | opencodeClient.ts 69KB 单文件，双路径逻辑 | `src/services/opencodeClient.ts` | 维护困难，商用改造代价大 |
| P6 | Vite 代理注入 API Key | `vite.config.ts:38-58` | 仅开发模式有效，生产模式 Key 暴露 |
| P7 | OpenCode 是上游 submodule，修改会被覆盖 | `opencode/` (git submodule) | 无法持久化自定义修改 |
| P8 | opencode-bin/ 为空，fallback 到 Bun 运行源码 | `opencode-bin/` | 启动可靠性依赖 Bun 安装 |

---

## 3. 目标商用架构

### 3.1 架构全景

```
┌─────────────────── 你的云服务器 ────────────────────────────────┐
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  API Gateway (Caddy)                                       │ │
│  │  ├── TLS 终止 (自动 HTTPS)                                  │ │
│  │  ├── 限流 / WAF                                             │ │
│  │  ├── /api/*  → OpenCode :4096                              │ │
│  │  └── /mcp/*  → Tool Relay :9100 (MCP StreamableHTTP)       │ │
│  └──────────┬──────────────────────────┬──────────────────────┘ │
│             │                          │                        │
│  ┌──────────▼───────────┐  ┌───────────▼──────────────────────┐│
│  │  OpenCode Server      │  │  Tool Relay Service               ││
│  │  (你的 Fork)          │  │  (MCP StreamableHTTP Server)      ││
│  │  :4096                │  │  :9100                             ││
│  │                       │  │                                    ││
│  │  ├── AI 推理           │  │  ├── MCP StreamableHTTP 端点      ││
│  │  │   → DeepSeek API   │  │  │   /mcp (OpenCode 直连)        ││
│  │  │   (Key 仅服务器持有) │  │  ├── WebSocket Server             ││
│  │  ├── 会话管理          │  │  │   /ws (客户端连接)             ││
│  │  │   → PostgreSQL     │  │  ├── JWT 验证                     ││
│  │  ├── MCP Client       │──│──→ 工具调用 → WebSocket → 客户端  ││
│  │  │   type:"remote"    │  │  ←── 工具结果 ← WebSocket ← 客户端││
│  │  │   url: /mcp        │  │  ├── 心跳 / 断线检测              ││
│  │  ├── 权限审批          │  │  └── 请求超时处理                 ││
│  │  └── /api/* REST+SSE  │  │                                    ││
│  │                       │  │                                    ││
│  │  opencode.json:       │  │                                    ││
│  │  "pvfutility": {      │  │                                    ││
│  │    "type":"remote",   │  │                                    ││
│  │    "url":"http://     │  │                                    ││
│  │     localhost:9100/mcp"│  │                                    ││
│  │  }                    │  │                                    ││
│  └──────────┬────────────┘  └────────────────────────────────────┘│
│             │                                                    │
│  ┌──────────▼─────────────────────────────────────────────────┐ │
│  │  数据层                                                     │ │
│  │  ├── PostgreSQL: 用户 / 会话 / 用量                         │ │
│  │  └── Redis: 在线状态 / WebSocket 路由 / 限流计数器          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

        │ HTTPS (REST/SSE)                   │ WSS (WebSocket)
        │ AI 响应流                           │ 工具调用桥
        │                                    │
┌───────▼────────────────────────────────────▼──────────────────────┐
│                       Tauri 客户端                                  │
│                                                                    │
│  ┌──────────────────────┐  ┌─────────────────────────────────────┐│
│  │  前端 (React)         │  │  Rust 后端 (lib.rs)                  ││
│  │                      │  │                                     ││
│  │  ├── SSE 接收 AI 响应 │  │  ├── WebSocket 客户端                ││
│  │  │  云端 /api/event   │  │  │   连 Tool Relay /ws             ││
│  │  ├── REST 发送消息    │  │  │   接收工具调用请求                ││
│  │  │  云端 /api/*       │  │  │                                   ││
│  │  ├── REST 管理 PVFut  │  │  ├── 工具执行器                     ││
│  │  │  localhost:27000   │  │  │   解析工具调用 → HTTP 请求         ││
│  │  ├── JWT 鉴权         │  │  │   → PVFut API → 结果回传          ││
│  │  └── 登录/注册界面    │  │  │                                   ││
│  │                      │  │  ├── PVFut HTTP 客户端               ││
│  └──────────────────────┘  │  │   localhost:27000                  ││
│                            │  └── 连接状态管理                     ││
│                            └─────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
```

**v2.0 关键变更**：OpenCode 原生支持 `type:"remote"` MCP 配置，使用 MCP SDK 标准的 StreamableHTTP/SSE Transport。
因此**无需在 OpenCode fork 中自定义 RelayTransport**，Tool Relay 只需实现标准 MCP Server 协议即可。
OpenCode 通过 `opencode.json` 配置 `"type":"remote"` + `"url"` 直连 Tool Relay 的 `/mcp` 端点。

### 3.2 核心设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| AI 引擎位置 | 云端 | Key 保护 + 计费 |
| MCP Transport | OpenCode 原生 Remote MCP (StreamableHTTP) | **无需改 OpenCode 源码**，原生支持 type:"remote" |
| Tool Relay = MCP Server | 是，实现标准 MCP StreamableHTTP 协议 | OpenCode 通过 `type:"remote"` + `url` 直连 Relay |
| 客户端工具执行器 | Rust 实现 | 安全性、一体化、消除 Bun 依赖 |
| 会话存储 | PostgreSQL | 持久化、可查询、可统计 |
| 用户鉴权 | JWT + Refresh Token | 无状态、可扩展 |
| OpenCode 代码管理 | Fork + submodule 指向自己 | 自由修改 + 追踪上游 |

---

## 4. 组件改造详细设计

### 4.1 OpenCode Fork

#### 4.1.1 Fork 管理

```
上游: github.com/sst/opencode
  │
  └→ fork: github.com/{your-org}/opencode
       │
       ├── main (跟踪上游，定期 merge)
       └── commercial (商用分支，基于 main)
            ├── feat/relay-transport
            ├── feat/session-postgres
            └── feat/usage-tracking
```

**操作步骤**：
1. 在 GitHub Fork `sst/opencode`
2. 添加 upstream remote：`git remote add upstream https://github.com/sst/opencode.git`
3. 定期同步：`git fetch upstream && git merge upstream/main`
4. 修改项目 submodule 指向：
   ```bash
   git submodule set-url opencode https://github.com/{your-org}/opencode.git
   ```

#### 4.1.2 改动管理规范

**原则**：所有商用改动必须与上游代码物理隔离，merge 时一眼分辨哪些是你的、哪些是上游的。

**规范**：

1. **文件级隔离**：新增文件放独立目录，不修改上游现有文件的结构

```
packages/opencode/src/
├── mcp/                    ← 上游原生支持 type:"remote"，无需修改
├── session/
│   ├── file-store.ts       ← 上游原有，不动
│   └── postgres-store.ts   ← [COMMERCIAL] 新增文件
└── commercial/              ← [COMMERCIAL] 独立目录
    ├── index.ts             ← 商用功能入口（注册 postgres store、用量上报）
    ├── usage-reporter.ts    ← 用量上报
    └── types.ts             ← 商用专用类型定义
```

2. **代码标记**：所有改动点必须用统一注释标记

```typescript
// [COMMERCIAL-START: postgres-session] — 原因：商用需要会话持久化到数据库
// ... 你的代码 ...
// [COMMERCIAL-END: postgres-session]

// 或对于单行插入：
import { PostgresSessionStore } from "./postgres-store"; // [COMMERCIAL: postgres-session]
```

3. **最小侵入修改**：修改上游现有文件时，只允许以下模式：

```typescript
// ✅ 允许：在 switch/case 中新增分支
function createSessionStore(config) {
  switch (config.store) {
    case "file":
      return new FileSessionStore();          // 上游代码
    case "postgres":                          // [COMMERCIAL-START: postgres-session]
      return new PostgresSessionStore(config); // [COMMERCIAL-END: postgres-session]
    default:
      throw new Error(`Unknown store: ${config.store}`);
  }
}

// ✅ 允许：在 import 区追加
import { FileSessionStore } from "./file-store";       // 上游代码
import { PostgresSessionStore } from "./postgres-store"; // [COMMERCIAL: postgres-session]

// ❌ 禁止：修改上游函数的签名或核心逻辑
// ❌ 禁止：在上游文件中间插入大段代码（>20行）
// ❌ 禁止：重命名上游的变量/函数/类型
```

4. **改动清单文件**：在 fork 根目录维护 `COMMERCIAL_CHANGES.md`

```markdown
# Commercial Changes Log

## 改动清单

| 改动ID | 文件 | 类型 | 描述 | 日期 |
|--------|------|------|------|------|
| CC-001 | src/session/postgres-store.ts | 新增 | PostgreSQL 会话存储 | 2026-06-xx |
| CC-002 | src/session/index.ts | 修改 | store 工厂新增 postgres 分支 | 2026-06-xx |
| CC-003 | src/commercial/usage-reporter.ts | 新增 | 用量上报 Hook | 2026-06-xx |
| CC-004 | opencode.json | 配置 | MCP pvfutility 改为 type:"remote" | 2026-06-xx |

~~CC-001 (RelayTransport) 和 CC-002 (MCP Client 修改) 已删除~~ — OpenCode 原生支持 `type:"remote"` MCP，无需自定义 Transport。

## 上游 Merge 检查清单

每次 merge upstream/main 后，逐项检查：

- [ ] CC-001: postgres-store.ts 不受影响（独立文件）
- [ ] CC-002: session/index.ts 的工厂分支仍然存在
- [ ] CC-003: usage-reporter.ts 不受影响（独立文件）
- [ ] CC-004: opencode.json 配置正常（项目级配置，不受上游影响）
```

5. **Git 提交规范**：商用改动 commit message 统一前缀

```
[COMMERCIAL] feat: add PostgresSessionStore
[COMMERCIAL] feat: add usage reporter hook
[COMMERCIAL] fix: postgres session store connection handling
[COMMERCIAL] refactor: extract commercial code to src/commercial/
```

**merge 上游时的操作流程**：

```
1. git fetch upstream
2. git checkout main
3. git merge upstream/main
4. 逐项检查 COMMERCIAL_CHANGES.md 中的改动点
5. 运行测试
6. 如果冲突：冲突文件必有 [COMMERCIAL] 标记，定位快
7. git checkout commercial
8. git merge main (把上游更新合入商用分支)
9. 全量测试
```

#### 4.1.3 MCP Remote 配置（零代码改动）

**重大发现**：OpenCode 原生支持 `type:"remote"` MCP 服务器配置，使用 MCP SDK 标准的 StreamableHTTP/SSE Transport。

**源码证据**：
- `packages/core/src/v1/config/mcp.ts` — `ConfigMCPV1.Remote` 类型定义，含 `url`, `headers`, `oauth`, `timeout` 字段
- `packages/opencode/src/mcp/index.ts:341-356` — `connectRemote()` 函数，自动尝试 StreamableHTTP → SSE 降级
- MCP SDK `@modelcontextprotocol/sdk` — 标准 Transport 接口，StreamableHTTPClientTransport / SSEClientTransport 实现

**这意味着**：Tool Relay Service 只需实现标准 MCP StreamableHTTP Server 协议，OpenCode 通过配置直连，**零代码改动**。

**opencode.json 配置**（商用版）：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pvfutility": {
      "type": "remote",
      "url": "http://localhost:9100/mcp",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:RELAY_API_KEY}"
      },
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

**对比原方案**：
| | 原方案 (v1.0) | 新方案 (v2.0) |
|---|---|---|
| OpenCode 改动 | 新增 RelayTransport + 改 MCP Client | **零改动**，仅改配置文件 |
| 上游 merge 冲突 | 每次可能冲突 MCP 层 | **不会冲突**（没改源码） |
| Tool Relay 协议 | 自定义 HTTP API | **MCP 标准协议**（StreamableHTTP） |
| 开发量 | Transport 层 ~300 行 + Client 改造 | **仅 opencode.json 配置** |

#### 4.1.4 会话持久化改造

**当前**：OpenCode 会话存储在本地文件系统（`~/.opencode/sessions/`）。

**目标**：会话存储到 PostgreSQL，通过配置切换。

```typescript
// 新增 SessionStore 接口
interface SessionStore {
  create(userId: string): Promise<Session>;
  get(sessionId: string): Promise<Session | null>;
  list(userId: string, options?: ListOptions): Promise<Session[]>;
  appendMessage(sessionId: string, message: Message): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

// 两个实现
class FileSessionStore implements SessionStore { /* 当前逻辑 */ }
class PostgresSessionStore implements SessionStore { /* 新增 */ }
```

通过环境变量 `SESSION_STORE=postgres` + `DATABASE_URL=...` 切换。

#### 4.1.5 用量统计 Hook

在 OpenCode 的 AI 响应处理链路中，拦截 DeepSeek 返回的 `usage` 字段：

```typescript
// packages/opencode/src/provider/ 附近的响应处理
function handleAIResponse(response: AIResponse, session: Session) {
  // 原有逻辑：处理 content、tool_calls 等
  
  // 新增：上报用量
  if (response.usage) {
    reportUsage({
      userId: session.userId,
      sessionId: session.id,
      model: response.model,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      timestamp: Date.now(),
    });
  }
}

// 用量上报：写入 PostgreSQL 或发到独立统计服务
async function reportUsage(data: UsageData): Promise<void> {
  await fetch('http://localhost:9100/usage', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
```

---

### 4.2 Tool Relay Service

#### 4.2.1 职责

Tool Relay 是云端 OpenCode 和客户端之间的桥梁：

1. 实现 MCP StreamableHTTP Server 协议（OpenCode 通过 `type:"remote"` 直连）
2. 管理客户端 WebSocket 连接（user_id → connection 映射）
3. 接收 OpenCode 的 MCP 工具调用请求（标准 JSON-RPC），转发给对应客户端
4. 接收客户端的工具执行结果，以标准 MCP JSON-RPC Response 返回给 OpenCode
5. 心跳检测、超时处理、断线清理

#### 4.2.2 双协议端点设计

**MCP StreamableHTTP 端（OpenCode 连接）**：

Relay 实现 MCP SDK 标准的 StreamableHTTP Server 协议。OpenCode 作为 MCP Client，通过 HTTP POST 发送 JSON-RPC 请求，通过 SSE 接收 JSON-RPC 响应和通知。

```
POST /mcp                          ← MCP StreamableHTTP 端点
Content-Type: application/json
Authorization: Bearer <relay-api-key>

MCP JSON-RPC 请求（标准协议）:
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_file_content",
    "arguments": { "file_path": "equipment/xxx.equ", "encoding_type": "CN" }
  }
}

MCP JSON-RPC 响应（标准协议，通过 SSE 或 HTTP Response 返回）:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "..." }]
  }
}
```

**MCP 工具声明（tools/list）**：

Relay 启动时从客户端同步的工具列表，响应 `tools/list` 请求：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "get_file_content", "description": "...", "inputSchema": {...} },
      { "name": "search_pvf", "description": "...", "inputSchema": {...} },
      ...
    ]
  }
}
```

**WebSocket 端（客户端连接）**：

```
WS /ws/connect?token=JWT

客户端 → 服务端消息:
{
  "type": "tool_result",
  "request_id": "uuid-xxx",
  "result": { ... },      // PVFut API 返回值
  "error": null            // 或错误信息
}

{
  "type": "tool_list",
  "tools": [...]           // 客户端启动时上报支持的工具列表
}

服务端 → 客户端消息:
{
  "type": "tool_call",
  "request_id": "uuid-xxx",
  "tool_name": "get_file_content",
  "arguments": { "file_path": "equipment/xxx.equ", "encoding_type": "CN" }
}

心跳:
服务端 → 客户端: { "type": "ping" }
客户端 → 服务端: { "type": "pong" }
```

**管理 API**：

```
GET /admin/status
Authorization: Bearer <admin-key>
Response: {
  "online_users": 42,
  "pending_calls": 3,
  "connections": { "user-123": "connected" }
}

POST /admin/usage
Authorization: Bearer <admin-key>
Body: {
  "user_id": "user-123",
  "session_id": "sess-xxx",
  "model": "deepseek-chat",
  "prompt_tokens": 1234,
  "completion_tokens": 567,
  "timestamp": 1718000000000
}
```

#### 4.2.3 技术选型

推荐 **TypeScript (Hono/Fastify + ws + @modelcontextprotocol/sdk)**：
- MCP SDK 原生 TypeScript，StreamableHTTP Server 实现开箱即用
- 与 OpenCode 生态一致，可直接复用 SDK 的 Server 实现
- 开发速度快，Phase 1 验证首选
- 缺点：长连接内存效率不如 Rust，扩展阶段可考虑重写

备选 **Rust (tokio + axum + tokio-tungstenite)**：
- 性能高，适合大规模部署
- 但 MCP StreamableHTTP Server 协议需要手动实现（Rust MCP SDK 不成熟）
- 建议先用 TS 验证，验证通过后再考虑 Rust 重写

#### 4.2.4 核心数据结构

```typescript
import { WebSocket } from "ws";

interface RelayState {
  /** user_id → WebSocket 连接 */
  connections: Map<string, WebSocket>;
  
  /** request_id → 等待结果的 Promise resolve 函数 */
  pendingCalls: Map<string, {
    resolve: (result: ToolResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>;
  
  /** 用户最后活跃时间（心跳更新） */
  lastActive: Map<string, number>;
  
  /** 用户当前可用的工具列表 */
  toolLists: Map<string, ToolDefinition[]>;
}

interface WebSocketConnection {
  ws: WebSocket;
  connectedAt: number;
  userId: string;
}

interface ToolResult {
  request_id: string;
  result: unknown;
  error?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
```

#### 4.2.5 工具调用流程

```
1. OpenCode 决定调用工具 get_file_content
   │
2. OpenCode MCP Client (StreamableHTTP Transport) → POST /mcp
   │  MCP JSON-RPC: { method: "tools/call", params: { name: "get_file_content", arguments: {...} } }
   │
3. Relay 收到 MCP 请求
   │  ├── 解析 JSON-RPC，提取 tool_name + arguments
   │  ├── 查找 user_id 对应的 WebSocket 连接
   │  ├── 创建 pending promise，存入 pending_calls Map
   │  ├── 通过 WebSocket 发送 tool_call 消息给客户端
   │  └── await promise resolve（最长等 timeout）
   │
4. 客户端 Rust 收到 WebSocket 消息
   │  ├── 解析 tool_name + arguments
   │  ├── 调用 PVFut API (localhost:27000)
   │  └── 通过 WebSocket 回传 tool_result
   │
5. Relay 收到客户端 tool_result
   │  ├── 从 pending_calls 取出对应 promise 的 resolve
   │  └── resolve(result) → 唤醒第 3 步的 await
   │
6. Relay 构造 MCP JSON-RPC Response
   │  └── { jsonrpc: "2.0", id: <原id>, result: { content: [...] } }
   │  通过 SSE 或 HTTP Response 返回给 OpenCode
   │
7. OpenCode 继续推理
```

#### 4.2.6 超时与错误处理

```typescript
// 工具调用超时（默认 60 秒）
const TOOL_CALL_TIMEOUT_MS = 60_000;

// 心跳超时（90 秒无 pong 则断开）
const HEARTBEAT_TIMEOUT_MS = 90_000;

// 断线清理
function cleanupDisconnectedUser(userId: string, state: RelayState): void {
  state.connections.delete(userId);
  state.lastActive.delete(userId);
  state.toolLists.delete(userId);
  
  // 取消该用户所有 pending calls
  for (const [requestId, pending] of state.pendingCalls.entries()) {
    if (requestId.startsWith(userId)) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Client disconnected"));
      state.pendingCalls.delete(requestId);
    }
  }
}

// 工具调用超时处理
function setupCallTimeout(requestId: string, state: RelayState): NodeJS.Timeout {
  return setTimeout(() => {
    const pending = state.pendingCalls.get(requestId);
    if (pending) {
      pending.reject(new Error("Tool call timed out"));
      state.pendingCalls.delete(requestId);
    }
  }, TOOL_CALL_TIMEOUT_MS);
}

// 心跳检测定时器
function startHeartbeatChecker(state: RelayState): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    for (const [userId, lastTime] of state.lastActive.entries()) {
      if (now - lastTime > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[relay] Heartbeat timeout for user ${userId}, cleaning up`);
        cleanupDisconnectedUser(userId, state);
      }
    }
  }, 30_000);
}

// 客户端重连后，检查是否有残留的 pending calls 需要重发
```

---

### 4.3 Tauri Rust 后端改造

#### 4.3.1 删除的代码

| 文件/代码 | 原因 |
|-----------|------|
| `opencode_server_start` 命令 | 不再启动本地 OpenCode |
| `opencode_server_stop` 命令 | 同上 |
| `opencode_server_status` 命令 | 同上 |
| `opencode_run` 命令 | 同上 |
| `static SERVER_STATE` | 同上 |
| `find_bun()` | 不再需要 Bun |
| `build_path_with_bun()` | 同上 |
| `parse_port_from_output()` | 同上 |
| `get_project_root()` | 简化，仅用于配置路径 |

**lib.rs 从 ~409 行 → ~200 行**

#### 4.3.2 新增的命令

```rust
use tauri::Emitter;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::connect_async;
use futures_util::{SinkExt, StreamExt};

// ─── 数据类型 ───

#[derive(Serialize, Deserialize)]
struct AuthToken {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

#[derive(Serialize, Deserialize)]
struct RelayStatus {
    connected: bool,
    server_url: String,
    latency_ms: Option<u64>,
    last_heartbeat: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct ToolCallRequest {
    request_id: String,
    tool_name: String,
    arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct ToolCallResult {
    request_id: String,
    result: serde_json::Value,
    error: Option<String>,
}

// ─── 全局状态 ───

struct AppState {
    ws_sender: Mutex<Option<WebSocketSender>>,
    relay_url: String,
    auth_token: Mutex<Option<AuthToken>>,
}

// ─── Tauri 命令 ───

/// 用户登录
#[tauri::command]
async fn login(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
) -> Result<AuthToken, String> {
    // POST https://api.yourdomain.com/auth/login
    // 返回 JWT
}

/// 连接 Tool Relay
#[tauri::command]
async fn connect_relay(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // 1. 从 state 获取 auth_token
    // 2. WebSocket 连接 wss://api.yourdomain.com/ws/connect?token=JWT
    // 3. 启动消息接收循环
    //    - 收到 tool_call → 执行 → 回传 tool_result
    //    - 收到 ping → 回传 pong
}

/// 断开 Relay
#[tauri::command]
async fn disconnect_relay(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // 关闭 WebSocket 连接
}

/// 查询 Relay 连接状态
#[tauri::command]
async fn get_relay_status(
    state: tauri::State<'_, AppState>,
) -> Result<RelayStatus, String> {
    // 返回连接状态、延迟、最后心跳
}
```

#### 4.3.3 工具执行器

将当前 `mcp-servers/pvfutility/index.ts` 中的 22 个工具调用逻辑用 Rust 重写：

```rust
const PVFUT_BASE_URL: &str = "http://localhost:27000";

/// 执行工具调用
async fn execute_tool(call: ToolCallRequest) -> ToolCallResult {
    let result = match call.tool_name.as_str() {
        "get_version" => api_get("/Api/PvfUtiltiy/getVersion").await,
        "get_file_list" => {
            api_get("/Api/PvfUtiltiy/GetFileList", &[
                ("dirName", call.arguments["dir_name"].as_str()),
                ("returnType", call.arguments["return_type"].as_str()),
                ("fileType", call.arguments["file_type"].as_str()),
            ]).await
        },
        "get_file_content" => {
            api_get("/Api/PvfUtiltiy/GetFileContent", &[
                ("filePath", call.arguments["file_path"].as_str()),
                ("encodingType", call.arguments["encoding_type"].as_str()),
            ]).await
        },
        "search_pvf" => {
            api_post("/Api/PvfUtiltiy/SearchPvf", &call.arguments).await
        },
        "import_file" => {
            api_post_text("/Api/PvfUtiltiy/ImportFile", &[
                ("filePath", call.arguments["file_path"].as_str()),
            ], call.arguments["file_content"].as_str().unwrap_or("")).await
        },
        "save_as_pvf" => {
            let path = call.arguments["file_path"].as_str().unwrap_or("");
            let encoded = urlencoding::encode(path);
            api_get(&format!("/Api/PvfUtiltiy/SaveAsPvfFile?filePath={}", encoded)).await
        },
        // ... 其余 16 个工具
        _ => Err(format!("未知工具: {}", call.tool_name)),
    };

    match result {
        Ok(data) => ToolCallResult {
            request_id: call.request_id,
            result: data,
            error: None,
        },
        Err(e) => ToolCallResult {
            request_id: call.request_id,
            result: serde_json::Value::Null,
            error: Some(e),
        },
    }
}

/// PVFut GET 请求
async fn api_get(endpoint: &str, params: &[(&str, Option<&str>)]) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let mut url = format!("{}{}", PVFUT_BASE_URL, endpoint);
    // 拼接 query params（过滤 None 值）
    // ...
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// PVFut POST 请求 (JSON body)
async fn api_post(endpoint: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", PVFUT_BASE_URL, endpoint);
    let resp = client.post(&url)
        .json(body)
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// PVFut POST 请求 (text/plain body)
async fn api_post_text(endpoint: &str, params: &[(&str, Option<&str>)], text: &str) -> Result<serde_json::Value, String> {
    // 同 apiGet 拼接 params，body 用 text/plain
    // ...
}
```

#### 4.3.4 WebSocket 消息循环

```rust
/// 启动 WebSocket 消息接收循环
async fn start_ws_loop(
    app: tauri::AppHandle,
    ws_stream: WebSocketStream,
) {
    let (mut write, mut read) = ws_stream.split();

    // 心跳任务
    let heartbeat_write = write.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let ping = serde_json::json!({ "type": "ping" });
            if heartbeat_write.send(Message::Text(ping.to_string())).await.is_err() {
                break;
            }
        }
    });

    // 消息接收循环
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let parsed: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                match parsed["type"].as_str() {
                    Some("tool_call") => {
                        // 解析工具调用请求
                        let call: ToolCallRequest = serde_json::from_value(parsed).unwrap();
                        
                        // 执行工具
                        let result = execute_tool(call).await;
                        
                        // 回传结果
                        let result_json = serde_json::to_string(&result).unwrap();
                        write.send(Message::Text(result_json)).await.unwrap();
                        
                        // 通知前端（可选，用于 UI 展示工具调用状态）
                        app.emit("tool-call-event", &text).unwrap();
                    }
                    Some("pong") => {
                        // 心跳响应，更新状态
                    }
                    _ => {}
                }
            }
            Ok(Message::Close(_)) => break,
            Err(_) => break,
        }
    }

    // 连接断开，通知前端
    app.emit("relay-disconnected", "WebSocket disconnected").unwrap();
}
```

#### 4.3.5 Cargo.toml 新增依赖

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-http = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
futures-util = "0.3"
reqwest = { version = "0.12", features = ["json"] }
urlencoding = "2"
```

---

### 4.4 前端改造

#### 4.4.1 opencodeClient.ts 精简

**删除的逻辑**：

```typescript
// 删除: 本地 OpenCode server 管理
// - startServer()
// - stopServer()
// - getServerStatus()
// - opencode_server_start Tauri invoke

// 删除: 双路径判断
// - const isTauri = '__TAURI_INTERNALS__' in window;
// - PVFUT_BASE_URL 分支
// - if (!isTauri) { ... } 分支

// 删除: 本地 API Key
// - const OPENCODE_PASSWORD
// - const DEEPSEEK_API_KEY

// 删除: sidecar 端口检测
// - serverPort 动态获取逻辑
```

**保留并改造的逻辑**：

```typescript
// 保留: SSE 事件流 (URL 改为云端)
private connectEventSource(): void {
    const es = new EventSource(
        `${CLOUD_SERVER_URL}/api/event`,
        { withCredentials: false }
    );
    // 监听逻辑不变
}

// 保留: 会话管理 (URL 改为云端)
async sendMessage(content: string): Promise<void> {
    await fetch(`${CLOUD_SERVER_URL}/api/session/${sessionId}/prompt`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    });
}

// 改造: 认证方式
private getAuthHeader(): string {
    // 从 Basic Auth → Bearer JWT
    const token = useAuthStore.getState().accessToken;
    return `Bearer ${token}`;
}
```

**新增**：

```typescript
// 新增: 云端服务器配置
const CLOUD_SERVER_URL = import.meta.env.VITE_CLOUD_SERVER_URL || 'https://api.yourdomain.com';

// 新增: 认证状态管理 (新 store)
// stores/useAuthStore.ts
interface AuthState {
    accessToken: string | null;
    refreshToken: string | null;
    isLoggedIn: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    refreshAuth: () => Promise<void>;
}
```

#### 4.4.2 预估文件变化

| 文件 | 变化 | 预估大小 |
|------|------|---------|
| `opencodeClient.ts` | 大幅精简 | 69KB → ~30KB |
| `pvfBridge.ts` | 不变 | 9.6KB |
| 新增 `useAuthStore.ts` | 新增 | ~3KB |
| 新增 `LoginPanel.tsx` | 新增 | ~5KB |
| `ChatPanel.tsx` | 小改（auth 相关） | 48.9KB → ~50KB |

#### 4.4.3 环境变量变更

```bash
# .env 删除
# VITE_DEEPSEEK_API_KEY=...        ← 删除
# VITE_OPENCODE_PASSWORD=...       ← 删除

# .env 新增
VITE_CLOUD_SERVER_URL=https://api.yourdomain.com
VITE_PVFUT_BASE_URL=http://localhost:27000
```

---

### 4.5 配置文件变更

#### 4.5.1 vite.config.ts

```typescript
// 删除的代理:
// - /opencode-api (前端直连云端)
// - /deepseek-api (Key 在服务器)

// 保留的代理:
// - /pvfut-api (PVFut 仍在本地)

export default defineConfig(async ({ mode }) => {
  return {
    plugins: [tailwindcss(), react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: { ignored: ["**/src-tauri/**"] },
      proxy: {
        '/pvfut-api': {
          target: 'http://localhost:27000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/pvfut-api/, ''),
        },
      },
    },
  };
});
```

#### 4.5.2 tauri.conf.json

```json
{
  // 删除:
  // "externalBin": ["opencode-bin/opencode"],  ← 删除
  
  // 保留:
  // "resources": ["opencode.json", "mcp-servers/**", "AGENTS.md"]
  //   → 改为: ["AGENTS.md"]  (opencode.json 和 mcp-servers 不再打包到客户端)
  
  // capabilities 权限:
  // 删除: localhost:4096 相关权限
  // 新增: wss://api.yourdomain.com WebSocket 权限
}
```

#### 4.5.3 capabilities/default.json

```json
{
  "permissions": [
    "http:default",
    "http:allow-fetch",
    "shell:allow-execute"
  ],
  "remote_domains": {
    "allow": [
      "https://api.yourdomain.com",
      "wss://api.yourdomain.com",
      "http://localhost:27000"
    ]
  }
}
```

---

### 4.6 删除的文件/目录

| 路径 | 原因 |
|------|------|
| `opencode/` (submodule) | OpenCode 在服务器，客户端不需要源码 |
| `opencode-bin/` | 同上 |
| `mcp-servers/` | 工具执行逻辑在 Rust 后端 |
| `build.rs` 编译逻辑 | 不再编译 OpenCode |
| `.env` 中的 API Key | 客户端不持有 |
| `aurora-agent-sim.html` | 调试用，不进发布版 |
| `test-debug.html` | 同上 |
| `opencode.json` | 配置文件在服务器，不在客户端 |
| `.opencode/` | 同上 |
| `前端备份.zip` / `dist.zip` / `src.zip` | 临时文件 |

---

## 5. 数据流与协议设计

### 5.1 完整请求生命周期

```
用户输入 "查看 equipment 目录下的装备文件"
    │
    ▼
[1] 前端 ChatPanel
    │ POST /api/session/{sid}/prompt
    │ Authorization: Bearer <JWT>
    │ Body: { content: "查看 equipment 目录下的装备文件" }
    │
    ▼
[2] 云端 OpenCode Server
    │ DeepSeek API 调用 (Key 从服务器环境变量读取)
    │ AI 决定调用工具: get_file_list
    │
    ▼
[3] OpenCode MCP Client → RelayTransport
    │ POST /relay/pvfutility/call
    │ Body: { user_id, request_id, tool_name: "get_file_list", 
    │         arguments: { dir_name: "equipment" } }
    │
    ▼
[4] Tool Relay Service
    │ 查找 user_id → WebSocket 连接
    │ 发送: { type: "tool_call", request_id, tool_name, arguments }
    │ await oneshot receiver...
    │
    ▼
[5] 客户端 Rust 后端 (WebSocket 收到)
    │ 解析 tool_call
    │ HTTP GET http://localhost:27000/Api/PvfUtiltiy/GetFileList?dirName=equipment
    │ 收到 PVFut 响应
    │ WebSocket 发送: { type: "tool_result", request_id, result: {...} }
    │
    ▼
[6] Tool Relay Service
    │ oneshot sender.send(result)
    │
    ▼
[7] RelayTransport → OpenCode MCP Client
    │ 工具结果返回给 AI
    │ AI 继续推理，生成自然语言响应
    │
    ▼
[8] SSE 事件流
    │ event: message
    │ data: { type: "assistant", content: "equipment 目录下有以下装备文件：..." }
    │
    ▼
[9] 前端渲染
    ChatPanel 显示 AI 响应
```

### 5.2 延迟分析

| 阶段 | 预估延迟 | 说明 |
|------|---------|------|
| 前端 → 云端 REST | 50-200ms | 取决于用户到服务器距离 |
| DeepSeek 推理 | 1-10s | 首 token 延迟 ~1s，完整响应视长度 |
| 工具调用 Relay → 客户端 → PVFut → 回传 | 200-500ms | WebSocket + 本地 HTTP |
| SSE 流式传输 | 50-100ms/token | 推理流实时推送 |

**关键路径**：单次工具调用增加 ~500ms 网络开销（相比本地的 ~50ms）。对用户体验影响可控，因为 AI 推理本身耗时更长。

### 5.3 WebSocket 协议

```
消息格式: JSON

服务端 → 客户端:
┌──────────────────────────────────────────────┐
│ tool_call: 工具调用请求                        │
│ { type, request_id, tool_name, arguments }    │
│                                               │
│ ping: 心跳                                    │
│ { type: "ping" }                              │
└──────────────────────────────────────────────┘

客户端 → 服务端:
┌──────────────────────────────────────────────┐
│ tool_result: 工具执行结果                      │
│ { type, request_id, result, error? }          │
│                                               │
│ pong: 心跳响应                                │
│ { type: "pong" }                              │
└──────────────────────────────────────────────┘

连接参数:
WS /ws/connect?token=JWT
Origin: tauri://localhost
```

---

## 6. 安全模型

### 6.1 威胁模型与对策

| # | 威胁 | 影响 | 对策 | 优先级 |
|---|------|------|------|--------|
| S1 | DeepSeek API Key 泄露 | 经济损失 | Key 仅存服务器环境变量，客户端不可见 | P0 |
| S2 | JWT Token 盗用 | 越权使用 | 短有效期(15min) + Refresh Token 轮换 | P0 |
| S3 | 工具调用伪造 | 数据篡改 | request_id 一致性校验 + HMAC 签名 | P1 |
| S4 | 中间人攻击 | 数据泄露 | 全链路 HTTPS/WSS | P0 |
| S5 | PVF 数据在传输中被截获 | 隐私泄露 | 工具结果可选端到端加密 | P2 |
| S6 | 客户端逆向 | 绕过鉴权 | Rust 编译 + 代码混淆 + 许可证校验 | P1 |
| S7 | 暴力破解 | 账户接管 | 登录限流 + 验证码 | P1 |
| S8 | 会话劫持 | 越权 | 会话绑定 user_id + IP 校验 | P2 |

### 6.2 JWT 设计

```typescript
// Access Token (短期)
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "plan": "pro",           // 订阅等级
  "iat": 1718000000,
  "exp": 1718000900        // 15 分钟
}

// Refresh Token (长期)
{
  "sub": "user-uuid",
  "type": "refresh",
  "iat": 1718000000,
  "exp": 1718608000        // 7 天
}
```

### 6.3 工具调用安全

```rust
/// 验证工具调用请求的合法性
fn validate_tool_call(call: &ToolCallRequest, user_id: &str) -> Result<(), String> {
    // 1. request_id 格式校验 (UUID v4)
    // 2. tool_name 白名单校验 (只允许已注册的 22 个工具)
    // 3. arguments 基本校验 (文件路径不能包含 .. 防止路径遍历)
    // 4. 危险操作确认 (delete_file, save_as_pvf 需要前端二次确认)
    
    let dangerous_tools = ["delete_file", "delete_files_batch", "import_file", "import_files_batch", "save_as_pvf"];
    if dangerous_tools.contains(&call.tool_name.as_str()) {
        // 触发前端权限审批弹窗
        return Err("DANGEROUS_OPERATION_REQUIRES_CONFIRMATION".into());
    }
    Ok(())
}
```

---

## 7. 计费系统设计

### 7.1 方案选择

**起步方案：按 Token 用量计费**

理由：
- 实现最简：拦截 DeepSeek 返回的 usage 字段即可
- 与成本对齐：DeepSeek 按 Token 收费，你加价转售
- 用户感知公平：用多少付多少

### 7.2 定价模型

```
DeepSeek V4 Pro 成本 (参考):
- Input:  ¥0.002 / 1K tokens
- Output: ¥0.008 / 1K tokens

建议售价 (2.5-3x 加价率):
- Input:  ¥0.005 / 1K tokens
- Output: ¥0.02  / 1K tokens

典型对话成本估算:
- 单次问答 (~2K input + 1K output): ¥0.03
- 含工具调用的复杂问答 (~5K input + 2K output): ¥0.09
- 每日活跃用户平均 20 次对话: ¥1.5/天/用户
```

### 7.3 数据库表设计

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    plan VARCHAR(50) DEFAULT 'free',     -- free / pro / team
    balance DECIMAL(10, 4) DEFAULT 0,     -- 预付余额
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用量表 (按天聚合)
CREATE TABLE daily_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    date DATE NOT NULL,
    prompt_tokens BIGINT DEFAULT 0,
    completion_tokens BIGINT DEFAULT 0,
    total_cost DECIMAL(10, 6) DEFAULT 0,
    tool_calls_count INT DEFAULT 0,
    UNIQUE(user_id, date)
);

-- 充值/消费流水
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    type VARCHAR(20) NOT NULL,           -- topup / consume
    amount DECIMAL(10, 4) NOT NULL,
    balance_after DECIMAL(10, 4) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会话表
CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    title VARCHAR(255),
    messages JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.4 用量统计流程

```
DeepSeek 响应
    │
    ▼
OpenCode 用量 Hook
    │ reportUsage({ user_id, model, prompt_tokens, completion_tokens })
    │
    ▼
Tool Relay /usage API
    │
    ▼
PostgreSQL daily_usage 表 UPSERT
    │ INSERT ON CONFLICT (user_id, date) DO UPDATE
    │   SET prompt_tokens = prompt_tokens + NEW.prompt_tokens,
    │       completion_tokens = completion_tokens + NEW.completion_tokens,
    │       total_cost = total_cost + NEW.total_cost
    │
    ▼
余额检查 (每次消费前)
    │ SELECT balance FROM users WHERE id = user_id
    │ IF balance < threshold THEN 拒绝请求
```

---

## 8. 服务器部署架构

### 8.1 起步阶段（单机）

```yaml
# docker-compose.yml
version: '3.8'

services:
  caddy:
    image: caddy:2
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - opencode
      - relay

  opencode:
    build:
      context: ./opencode-fork
      dockerfile: Dockerfile
    environment:
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - SESSION_STORE=postgres
      - DATABASE_URL=postgresql://opencode:xxx@postgres:5432/opencode
      - RELAY_INTERNAL_SECRET=${RELAY_INTERNAL_SECRET}
    depends_on:
      - postgres
      - redis

  relay:
    build:
      context: ./tool-relay
      dockerfile: Dockerfile
    environment:
      - DATABASE_URL=postgresql://opencode:xxx@postgres:5432/opencode
      - REDIS_URL=redis://redis:6379
      - RELAY_INTERNAL_SECRET=${RELAY_INTERNAL_SECRET}
      - JWT_SECRET=${JWT_SECRET}
    ports:
      - "9100:9100"
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: opencode
      POSTGRES_USER: opencode
      POSTGRES_PASSWORD: xxx
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

volumes:
  pg_data:
  redis_data:
  caddy_data:
  caddy_config:
```

```text
# Caddyfile
api.yourdomain.com {
    # REST/SSE → OpenCode
    handle /api/* {
        reverse_proxy opencode:4096
    }
    
    # WebSocket → Tool Relay
    handle /ws/* {
        reverse_proxy relay:9100
    }
    
    # MCP StreamableHTTP → Tool Relay (OpenCode 连接)
    handle /mcp/* {
        reverse_proxy relay:9100
    }
    
    # 用量/管理 API → Relay
    handle /admin/* {
        reverse_proxy relay:9100
    }
    
    # 认证 API → Relay
    handle /auth/* {
        reverse_proxy relay:9100
    }
}
```

### 8.2 服务器规格

| 阶段 | 规格 | 预估并发 | 月成本 |
|------|------|---------|--------|
| 起步 | 4C8G (云服务器) | 50 用户 | ¥200-400 |
| 增长 | 8C16G + RDS | 200 用户 | ¥800-1500 |
| 规模 | K8s 集群 + RDS + Redis Cluster | 1000+ 用户 | ¥5000+ |

### 8.3 扩展策略

```
OpenCode: 无状态 → 水平扩展 (N 实例 + Load Balancer)
Tool Relay: 有状态 (WebSocket) → 两种策略:
  策略 A: Sticky Session (同一用户始终路由到同一 Relay 实例)
  策略 B: Redis Pub/Sub (任意 Relay 接收，发布到 Redis，持有连接的实例消费)
  推荐: 起步用策略 A，规模大后切换策略 B
PostgreSQL: 读写分离 + 连接池 (PgBouncer)
Redis: Sentinel 哨兵模式起步，Cluster 模式扩展
```

---

## 9. 实施路线图

### Phase 0: Fork OpenCode

**目标**：建立 OpenCode fork，跑通编译和集成

**时长**：1 天

**任务清单**：
- [ ] P0-1: 在 GitHub Fork `sst/opencode`
- [ ] P0-2: 添加 upstream remote
- [ ] P0-3: 创建 `commercial` 分支
- [ ] P0-4: 修改项目 submodule 指向 fork
- [ ] P0-5: 本地编译 OpenCode 二进制
- [ ] P0-6: 验证 Tauri 启动 fork 编译的 OpenCode
- [ ] P0-7: 验证 MCP pvfutility 工具调用正常

**交付物**：基于 fork 的 OpenCode 可正常运行，MCP 工具调用端到端通过

**验证标准**：
- `opencode serve` 启动成功
- 前端能连接并通过 AI 对话调用 PVFut 工具

---

### Phase 1: 本地验证 WebSocket MCP

**目标**：在不部署服务器的前提下，验证 WebSocket MCP Transport 的端到端可行性

**时长**：1-2 周

**任务清单**：
- [ ] P1-1: 验证 OpenCode 原生 Remote MCP 连接
  - [ ] P1-1a: 编写最小 MCP StreamableHTTP Server（TypeScript，使用 @modelcontextprotocol/sdk）
  - [ ] P1-1b: 配置 opencode.json `"pvfutility": {"type":"remote", "url":"http://localhost:9100/mcp"}`
  - [ ] P1-1c: 验证 OpenCode 能连上、能列出工具、能调用工具
- [ ] P1-2: 实现 Tool Relay Service（MCP Server + WebSocket Bridge）
  - [ ] P1-2a: MCP StreamableHTTP 端点：/mcp（OpenCode 连接）
  - [ ] P1-2b: WebSocket 端点：/ws/connect（客户端连接）
  - [ ] P1-2c: 工具调用桥：MCP request → WebSocket → 客户端 → 结果回传 → MCP response
  - [ ] P1-2d: 工具列表同步：客户端启动时上报工具列表，Relay 响应 tools/list
  - [ ] P1-2e: 超时处理 (60s) + 心跳检测
- [ ] P1-3: 实现最小 Tauri WebSocket 客户端 (Rust)
  - [ ] P1-3a: WebSocket 连接 Relay /ws/connect
  - [ ] P1-3b: 启动时上报 PVFut 工具列表
  - [ ] P1-3c: 接收 tool_call → 调 PVFut API → 回传 tool_result
  - [ ] P1-3d: 心跳
- [ ] P1-4: 端到端测试
  - [ ] P1-4a: OpenCode + Relay + Client 都在本机运行
  - [ ] P1-4b: 用户提问 → AI 推理 → MCP tools/call → Relay → WebSocket → 客户端 PVFut → 结果回传 → AI 继续推理
  - [ ] P1-4c: 测试多轮对话 + 多次工具调用
  - [ ] P1-4d: 测试超时场景
  - [ ] P1-4e: 测试断线重连

**交付物**：端到端跑通的 demo

**验证标准**：
- 通过 WebSocket 调用工具的成功率 = 通过 stdio 调用的成功率
- 工具调用延迟增量 < 500ms（相比 stdio）
- 断线重连后工具调用恢复正常

**决策门**：如果 Phase 1 验证失败，需要评估替代方案（客户端轮询 / SSH 隧道 / 放弃云端化）

---

### Phase 2: 服务器部署

**目标**：将 OpenCode + Relay 部署到云端，客户端连远程

**时长**：1 周

**任务清单**：
- [ ] P2-1: 服务器环境搭建
  - [ ] P2-1a: 购买云服务器 + 域名 + SSL 证书
  - [ ] P2-1b: Docker + Docker Compose 安装
  - [ ] P2-1c: Caddy 反向代理配置
- [ ] P2-2: OpenCode Docker 化
  - [ ] P2-2a: 编写 Dockerfile (Bun 运行或编译后 Node 运行)
  - [ ] P2-2b: 环境变量注入 (DEEPSEEK_API_KEY 等)
  - [ ] P2-2c: 健康检查脚本
- [ ] P2-3: Tool Relay Docker 化
  - [ ] P2-3a: 编写 Dockerfile
  - [ ] P2-3b: 与 OpenCode 的内部通信配置
- [ ] P2-4: PostgreSQL 部署
  - [ ] P2-4a: Schema 初始化 (users, daily_usage, transactions, sessions)
  - [ ] P2-4b: 连接池配置
- [ ] P2-5: 客户端连接测试
  - [ ] P2-5a: 前端 opencodeClient.ts 连云端 REST
  - [ ] P2-5b: Rust 后端 WebSocket 连云端 Relay
  - [ ] P2-5c: 完整流程验证
- [ ] P2-6: JWT 鉴权实现
  - [ ] P2-6a: Relay 中实现 /auth/login, /auth/refresh
  - [ ] P2-6b: JWT 验证中间件
  - [ ] P2-6c: 客户端登录界面

**交付物**：云端可用的 alpha 版

**验证标准**：
- 客户端从外网连接服务器，AI 对话 + 工具调用正常
- JWT 鉴权生效，未登录用户无法使用
- DeepSeek API Key 在客户端不可见

---

### Phase 3: 客户端改造

**目标**：将客户端从"本地 OpenCode"改造为"云端客户端"

**时长**：1-2 周

**任务清单**：
- [ ] P3-1: 重写 lib.rs
  - [ ] P3-1a: 删除 sidecar 启动逻辑 (opencode_server_start/stop/status/run)
  - [ ] P3-1b: 删除 Bun 查找逻辑 (find_bun 等)
  - [ ] P3-1c: 实现 WebSocket 客户端 (tokio-tungstenite)
  - [ ] P3-1d: 实现工具执行器 (22 个 PVFut API 调用)
  - [ ] P3-1e: 实现心跳和断线重连
  - [ ] P3-1f: 实现 JWT 管理 (login/refresh)
- [ ] P3-2: 精简 opencodeClient.ts
  - [ ] P3-2a: 删除本地 server 管理逻辑
  - [ ] P3-2b: 删除 isTauri 双路径
  - [ ] P3-2c: 统一使用云端 URL
  - [ ] P3-2d: Basic Auth → Bearer JWT
  - [ ] P3-2e: 保留 SSE/会话/权限逻辑
- [ ] P3-3: 新增前端组件
  - [ ] P3-3a: useAuthStore (登录态管理)
  - [ ] P3-3b: LoginPanel (登录/注册界面)
  - [ ] P3-3c: 连接状态指示器
- [ ] P3-4: 清理配置
  - [ ] P3-4a: 精简 vite.config.ts (删除 opencode-api/deepseek-api 代理)
  - [ ] P3-4b: 更新 tauri.conf.json (删除 externalBin，更新 resources)
  - [ ] P3-4c: 更新 capabilities/default.json
  - [ ] P3-4d: 更新 .env (删除 API Key，新增 CLOUD_SERVER_URL)
- [ ] P3-5: 删除废弃文件
  - [ ] P3-5a: 删除 opencode/ submodule
  - [ ] P3-5b: 删除 opencode-bin/
  - [ ] P3-5c: 删除 mcp-servers/
  - [ ] P3-5d: 删除临时文件 (备份 zip, debug html)
  - [ ] P3-5e: 精简 build.rs

**交付物**：商用客户端 beta

**验证标准**：
- 客户端不包含任何 API Key
- 不包含 OpenCode 二进制或源码
- 不包含 Bun 依赖
- AI 对话 + 工具调用正常
- 登录/鉴权正常
- PVFut 离线编辑功能不受影响

---

### Phase 4: 商用完善

**目标**：补齐商业化必需的功能

**时长**：持续迭代

**任务清单**：
- [ ] P4-1: 计费系统
  - [ ] P4-1a: 用量统计 Hook 集成到 OpenCode fork
  - [ ] P4-1b: daily_usage 聚合逻辑
  - [ ] P4-1c: 余额检查中间件
  - [ ] P4-1d: 充值接口 (对接支付)
  - [ ] P4-1e: 用量查询 API (供前端展示)
- [ ] P4-2: OpenCode 会话持久化
  - [ ] P4-2a: 实现 PostgresSessionStore
  - [ ] P4-2b: 环境变量切换 File/Postgres
  - [ ] P4-2c: 会话列表 API 适配
- [ ] P4-3: 客户端用户体验
  - [ ] P4-3a: 用量面板 (今日 token 消耗、费用)
  - [ ] P4-3b: 连接状态实时展示
  - [ ] P4-3c: 断线提示和自动重连
  - [ ] P4-3d: 工具调用状态展示 (执行中/完成/失败)
- [ ] P4-4: 监控与运维
  - [ ] P4-4a: OpenCode 健康检查
  - [ ] P4-4b: Relay 在线用户监控
  - [ ] P4-4c: 异常告警 (工具调用超时率 > 5%)
  - [ ] P4-4d: 日志聚合 (结构化日志 → ELK / Loki)
- [ ] P4-5: 客户端分发
  - [ ] P4-5a: Tauri 自动更新 (updater plugin)
  - [ ] P4-5b: 安装包签名 (Windows code signing)
  - [ ] P4-5c: 许可证协议 (EULA)
- [ ] P4-6: 端到端加密 (可选，P2 优先级)
  - [ ] P4-6a: 工具结果在客户端加密
  - [ ] P4-6b: 密文透传服务器
  - [ ] P4-6c: AI 无法看到工具结果的明文

**交付物**：可售卖的 v1.0

---

## 10. 风险评估与应对

### 10.1 技术风险

| # | 风险 | 概率 | 影响 | 应对 |
|---|------|------|------|------|
| R1 | OpenCode MCP Transport 抽象不够，无法干净地插入 RelayTransport | 中 | 高 | Phase 1 先读源码确认接口，再动手实现。如果抽象不够，就改抽象层 |
| R2 | WebSocket 工具调用延迟过高 | 低 | 中 | 本地测试时 benchmark；如果 > 1s，考虑客户端轮询替代 |
| R3 | OpenCode 上游更新导致 merge 冲突 | 高 | 低 | commercial 分支改动集中在 MCP transport 层，冲突范围可控；定期 merge 上游 |
| R4 | DeepSeek API 不稳定 | 中 | 高 | 支持多 Provider（OpenAI/Claude 备选），在 OpenCode 配置中切换 |
| R5 | 多用户并发时 Relay 单点瓶颈 | 低 | 中 | 起步单机够用；扩展时加 Redis Pub/Sub 跨实例路由 |

### 10.2 商业风险

| # | 风险 | 概率 | 影响 | 应对 |
|---|------|------|------|------|
| B1 | PVFut (localhost:27000) 是外部工具，你无法控制 | 高 | 中 | 客户端做好降级处理：PVFut 不可用时只禁用工具调用，AI 对话不受影响 |
| B2 | 目标用户群体小（PVF 格式特定游戏） | 高 | 高 | 先验证付费意愿；考虑扩展到其他游戏封包格式 |
| B3 | 客户端被破解绕过鉴权 | 中 | 中 | 关键逻辑在 Rust 层；服务端校验为主，不信任客户端 |
| B4 | DeepSeek 调价 | 中 | 中 | 计费模型实时同步成本；预留多 Provider 切换能力 |

### 10.3 关键决策记录

| 决策 | 日期 | 理由 |
|------|------|------|
| Tool Relay 独立进程而非嵌入 OpenCode | 2026-06-10 | 少侵入 fork；独立扩缩容；故障隔离 |
| Rust 重写工具执行器而非保留 TS MCP Server | 2026-06-10 | 消除 Bun 依赖；安全性；进程一体化 |
| 按 Token 计费起步而非订阅制 | 2026-06-10 | 实现最简；与成本对齐 |
| Caddy 而非 Nginx | 2026-06-10 | 自动 HTTPS；配置简单；适合小团队 |

---

## 附录

### A. 术语表

| 术语 | 含义 |
|------|------|
| PVF | Pak Virtual File，游戏资源封包格式 |
| OpenCode | sst/opencode，开源 AI 编码助手，提供 REST API + MCP |
| MCP | Model Context Protocol，AI 工具调用协议 |
| Relay | Tool Relay Service，工具调用中继服务 |
| PVFut | pvfUtility，本地 PVF 编辑工具，提供 HTTP API |
| Sidecar | Tauri 的 externalBin 机制，随主进程启动的子进程 |
| SSE | Server-Sent Events，服务器推送事件流 |

### B. 参考文档

- [OpenCode GitHub](https://github.com/sst/opencode)
- [MCP Specification](https://modelcontextprotocol.io/)
- [Tauri v2 Documentation](https://v2.tauri.app/)
- [DeepSeek API Pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)

### C. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-06-10 | 初始版本 |
