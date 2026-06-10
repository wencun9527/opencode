# Phase 3 验证报告：客户端对接远程 OpenCode

> 日期: 2026-06-10  
> 范围: Phase 3 前端连接远程 OpenCode Server  
> 审查人: AI Agent  
> 最终状态: ✅ 代码改造完成 + 外网 API 验证通过

---

## 一、改造策略

**核心原则：前端 UI 逻辑不动，只改连接层。**

| 改造前 | 改造后 |
|--------|--------|
| Tauri 模式：调用 Rust `opencode_server_start` 启动本地 OpenCode | Tauri 模式：直接 fetch 远程 `http://1.12.207.131:4096` |
| 浏览器模式：Vite 代理 → `localhost:4096` | 浏览器模式：Vite 代理 → `1.12.207.131:4096` |
| SSE 连接用 `EventSource`（不支持 Auth header） | 远程模式用 `fetch + ReadableStream`（支持 Basic Auth） |
| 本地 sidecar 进程管理 | 远程优先 + 本地 sidecar 作为 fallback |
| 密码：`Z3t_mmnNLGqggucWHYTW_RvW9wpqWymfrIwLNoedLhU` | 密码：`opencode2026`（云端 OpenCode 密码） |

---

## 二、改动文件清单

### 1. `src/services/opencodeClient.ts`

| 行号 | 改动 | 说明 |
|------|------|------|
| 16 | 新增 `REMOTE_OPENCODE_URL` 常量 | 默认 `http://1.12.207.131:4096`，可通过 `VITE_OPENCODE_REMOTE_URL` 环境变量覆盖 |
| 19 | `OPENCODE_PASSWORD` 默认值改为 `opencode2026` | 匹配云端服务器密码 |
| 130-168 | 重写 `startServer()` | Tauri 模式先尝试远程连接，失败后 fallback 到本地 sidecar |
| 258-340 | 重写 `connectEventSource()` | 支持认证 header 的 fetch-based SSE 实现 |
| 341-398 | 新增 `connectFetchSSE()` | 用 `fetch + ReadableStream` 替代 `EventSource`，支持 `Authorization` header |
| 1497 | `sendMessageViaServer` prompt 请求 | 统一添加 `Authorization` header（不再仅 Tauri 模式发送） |
| 2168 | `getAuthHeader()` | 浏览器模式且 serverUrl 以 `/` 开头时才省略认证（Vite 代理注入） |

### 2. `vite.config.ts`

| 改动 | 说明 |
|------|------|
| 新增 `OPENCODE_REMOTE_URL` 变量 | 从 `.env` 读取，默认 `http://1.12.207.131:4096` |
| `/opencode-api` 代理目标改为 `OPENCODE_REMOTE_URL` | 浏览器模式通过 Vite 代理访问远程服务器 |

### 3. `.env`

| 改动 | 说明 |
|------|------|
| `VITE_OPENCODE_PASSWORD=opencode2026` | 云端 OpenCode 密码 |
| `VITE_OPENCODE_REMOTE_URL=http://1.12.207.131:4096` | 远程服务器地址 |

### 4. `src/stores/useAuthStore.ts`

| 改动 | 说明 |
|------|------|
| `serverUrl` 默认值改为 `http://1.12.207.131:9100` | 连接远程 Relay（JWT 鉴权） |

---

## 三、验证结果

### 3.1 编译验证

```
✓ 2246 modules transformed
✓ built in 3.76s
```

**0 个 TypeScript 错误，0 个 Lint 错误。**

### 3.2 外网 API 验证

| 测试 | 结果 | 详情 |
|------|------|------|
| `GET /api/health` | ✅ | `{"healthy":true}` |
| `GET /api/model` | ✅ | 4 个 DeepSeek 模型可用（v4-flash, v4-pro, reasoner, chat） |
| Basic Auth | ✅ | `opencode:opencode2026` 认证通过 |

### 3.3 前端连接逻辑验证

| 路径 | 模式 | 连接目标 | 认证方式 |
|------|------|---------|---------|
| Tauri 桌面 | 远程优先 | `http://1.12.207.131:4096` | Basic Auth（`opencode:opencode2026`） |
| Tauri 桌面 | Fallback | 本地 sidecar 进程 | 同上 |
| 浏览器 | Vite 代理 | `/opencode-api` → 远程 | 代理层注入 Auth |
| SSE 连接 | 远程 | fetch + ReadableStream | 支持 Auth header |
| SSE 连接 | 本地/代理 | 原生 EventSource | 无需 Auth |

---

## 四、架构全景

```
┌─────────────────┐    HTTP/SSE (Basic Auth)    ┌─────────────────────────────┐
│  Tauri Client   │ ──────────────────────────→ │  远程 OpenCode Server       │
│  (Windows)      │                              │  1.12.207.131:4096         │
│                 │    fetch + ReadableStream     │  └→ DeepSeek API (4 models)│
│  opencodeClient │                              │  └→ MCP → Relay MCP 端点   │
└─────────────────┘                              └──────────────┬──────────────┘
                                                                │
┌─────────────────┐    Browser via Vite proxy    │
│  浏览器模式     │ ──────────────────────────→ │  /opencode-api 代理       │
│  (开发/部署)    │    (代理注入 Auth)           │  → 1.12.207.131:4096      │
└─────────────────┘                              └──────────────┬──────────────┘
                                                                │
                                          ┌─────────────────────┘
                                          │ StreamableHTTP (内部)
                                          ▼
                                ┌─────────────────────────────┐
                                │  Tool Relay                 │
                                │  1.12.207.131:9100         │
                                │  └→ JWT 鉴权               │
                                │  └→ WebSocket → PVFut 客户端│
                                └──────────────┬──────────────┘
                                              │
                                    ┌─────────┘
                                    │ WebSocket
                                    ▼
                          ┌─────────────────────┐
                          │  PVFut 客户端       │
                          │  (localhost:27000)  │
                          │  └→ PVF 数据操作    │
                          └─────────────────────┘
```

---

## 五、遗留问题 & 下一步

### 已解决
- [x] SSE 连接不支持 Auth header → 用 fetch-based SSE 替代
- [x] 浏览器模式代理 → 改为指向远程服务器
- [x] Tauri 模式本地 sidecar → 远程优先 + 本地 fallback

### 待解决

| 编号 | 问题 | 优先级 | 说明 |
|------|------|--------|------|
| P3-1 | 实际 Tauri 桌面应用运行验证 | P0 | 需 `npm run tauri dev` 启动测试 |
| P3-2 | WS 客户端连接 Relay | P0 | PVFut 工具调用链路需 WS 客户端中继 |
| P3-3 | Caddy/Nginx 反向代理 + TLS | P1 | 当前 HTTP 明文传输，生产环境需 TLS |
| P3-4 | OpenCode `directory` 参数 | P1 | 远程服务器的 working directory 是 `/home/ubuntu/pvf-ai-editor`，无 PVF 数据 |
| P3-5 | 多用户隔离 | P2 | 当前所有人共享同一个 OpenCode 实例 |
| P3-6 | SSE EventSource 重连 | P2 | fetch-based SSE 断线重连需测试 |

### Phase 4 下一步方向

1. **Tauri 应用完整验证** — `npm run tauri dev` 启动桌面应用，测试：
   - 远程 OpenCode 连接
   - 聊天对话发送/接收
   - MCP 工具调用（需要 WS 客户端连接 Relay）
   - PVFut 本地桥接

2. **WS 客户端中继** — 在本地启动一个 WS 客户端连接 Relay，将 AI 的 MCP 工具调用转发到本地 PVFut

3. **生产加固** — TLS + 限流 + 多用户隔离
