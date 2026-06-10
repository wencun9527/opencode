# PVF AI Editor — 文档 vs 代码 深度比对报告

> 生成时间: 2026-06-10 08:30  
> 服务器实测: 1.12.207.131 (SSH 已连接)  
> 文档来源: `C:\Users\Administrator\Desktop\PVF Ai_项目文档\`

---

## 一、项目整体进度

| Phase | 文档规划 | 代码实际 | 完成度 |
|-------|---------|---------|--------|
| Phase 0: Fork OpenCode | ✅ 完成 | ✅ 完成 | 95% |
| Phase 1: 本地验证 MCP | ✅ 完成 | ✅ 完成 | 100% |
| Phase 2: 服务器部署 | ✅ 完成 | ⚠️ 部分完成 | 70% |
| Phase 3: 客户端改造 | ✅ 完成 | ⚠️ 部分完成 | 45% |
| Phase 4: 商用完善 | 📋 规划中 | ❌ 基本未动 | 5% |

---

## 二、文档规划但代码未完成的功能模块

### M1. Rust 后端改造（Phase 3 核心任务）— 完成度 0%

**文档要求**（COMMERCIAL_ARCHITECTURE.md §4.3）：
- 删除 `opencode_server_start/stop/status/run` 等 sidecar 启动逻辑
- 删除 `find_bun()`、`build_path_with_bun()`、`parse_port_from_output()`
- 新增 WebSocket 客户端（tokio-tungstenite）
- 新增 22 个 PVFut API 工具执行器（Rust 重写）
- 新增 JWT 管理（login/refresh）
- `lib.rs` 从 ~409 行精简到 ~200 行

**代码实际**（`src-tauri/src/lib.rs`）：
- ❌ 全部 sidecar 启动逻辑仍完整保留（`ServerState`、`find_bun()`、`build_path_with_bun()` 等）
- ❌ 无 WebSocket 客户端代码
- ❌ 无 Rust 工具执行器
- ❌ 无 JWT 管理代码
- ❌ lib.rs 仍为旧版 ~409 行结构

### M2. opencodeClient.ts 精简（Phase 3 核心任务）— 完成度 10%

**文档要求**（§4.4.1）：
- 删除本地 OpenCode server 管理逻辑（`startServer`/`stopServer`/`getServerStatus`）
- 删除 `isTauri` 双路径判断
- 删除本地 API Key（`DEEPSEEK_API_KEY`、`OPENCODE_PASSWORD`）
- Basic Auth → Bearer JWT
- 文件从 69KB 精简到 ~30KB

**代码实际**（`src/services/opencodeClient.ts`）：
- ⚠️ 仅加了远程 URL 常量，其余未动
- ❌ `isTauri` 双路径仍存在（第 10 行）
- ❌ `DEEPSEEK_API_KEY` 仍存在（第 25 行）
- ❌ `startServer()` 仍存在，包含 Tauri invoke + sidecar fallback
- ❌ 文件仍约 69KB，几乎未精简

### M3. 认证流程集成 — 完成度 20%

**文档要求**（§4.4.1, §3.1）：
- `useAuthStore` 管理 JWT access/refresh token
- `LoginPanel` 登录/注册界面
- 未登录用户重定向到登录页
- 所有 API 请求携带 Bearer JWT

**代码实际**：
- ✅ `useAuthStore` 已实现（JWT 管理、注册、登录、刷新）
- ✅ `LoginPanel` 已实现（登录/注册表单）
- ❌ **App.tsx 不渲染 LoginPanel**，认证流程完全断裂
- ❌ 无路由守卫，无法跳转到登录页
- ❌ `opencodeClient` 仍用 Basic Auth，未切换到 JWT Bearer

### M4. 配置清理（Phase 3）— 完成度 5%

**文档要求**（§4.5, §4.6）：
- 删除 `VITE_DEEPSEEK_API_KEY` 和 `VITE_OPENCODE_PASSWORD` 环境变量
- 新增 `VITE_CLOUD_SERVER_URL`
- 删除 `opencode/` submodule、`opencode-bin/`、`mcp-servers/`
- 精简 `vite.config.ts`（删除 opencode-api/deepseek-api 代理）
- 更新 `tauri.conf.json`（删除 externalBin）
- 删除 `build.rs` 编译逻辑

**代码实际**：
- ❌ `VITE_DEEPSEEK_API_KEY` 仍在 `opencodeClient.ts:25` 和 `vite.config.ts:10`
- ❌ `opencode/` submodule 仍存在（`.gitmodules` 文件存在）
- ❌ `mcp-servers/` 仍存在
- ❌ `vite.config.ts` 仍保留 `/deepseek-api` 代理（第 59-72 行）
- ❌ `tauri.conf.json` 未更新

### M5. 计费系统（Phase 4）— 完成度 10%

**文档要求**（§7）：
- 用量统计 Hook 集成到 OpenCode fork
- `daily_usage` 聚合逻辑
- 余额检查中间件
- 充值接口
- 用量查询 API

**代码实际**（`relay/src/auth.ts`）：
- ⚠️ 有基础的 `checkQuota` + `incrementUsage`（按次数计费）
- ⚠️ 有 free/pro/enterprise 三档限额
- ❌ 无 Token 用量统计（文档要求按 Token 计费，实际按调用次数）
- ❌ 无充值接口
- ❌ 无用量查询 API 供前端展示
- ❌ 无 `daily_usage` 表的 Schema

### M6. 会话持久化（Phase 4）— 完成度 0%

**文档要求**（§4.1.4）：
- 实现 `PostgresSessionStore`
- 环境变量切换 File/Postgres
- 会话列表 API 适配

**代码实际**：
- ❌ 无任何 PostgresSessionStore 代码
- ❌ OpenCode 会话仍存储在本地文件系统

### M7. 安全模型（Phase 4）— 完成度 10%

**文档要求**（§6）：
- API Key 仅存服务器环境变量（S1）
- JWT 短有效期 + Refresh Token 轮换（S2）
- 工具调用 HMAC 签名（S3）
- 全链路 HTTPS/WSS（S4）
- 限流 + WAF（S7）
- Caddy 反向代理 + TLS

**代码实际**：
- ⚠️ API Key 在服务器 systemd service 中设置 ✅
- ⚠️ JWT 已实现但 **refresh token 有严重 Bug**（见 Bug 列表）
- ❌ 无 HMAC 签名
- ❌ 无 TLS/HTTPS（HTTP 明文传输）
- ❌ 无 Caddy（服务器未安装）
- ❌ 无限流/WAF

### M8. 服务器部署完善 — 完成度 50%

**文档要求**（§8）：
- Docker Compose 完整部署（Caddy + OpenCode + Relay + PostgreSQL + Redis）
- Caddy 反向代理 + 自动 HTTPS
- Redis 在线状态 / WebSocket 路由

**服务器实际状态**（SSH 实测 2026-06-10）：
- ✅ OpenCode systemd 服务运行（端口 4096）
- ✅ Relay systemd 服务运行（端口 9100）
- ✅ PostgreSQL 运行（localhost:5432）
- ❌ 无 Docker 部署（直接 systemd）
- ❌ 无 Caddy
- ❌ 无 Redis
- ❌ 无 TLS/HTTPS

---

## 三、已确认的 Bug 列表

### 🔴 P0 严重（阻塞核心功能）

| # | Bug | 文件 | 表现 |
|---|-----|------|------|
| B1 | **认证流程断裂** | `App.tsx` | `LoginPanel` 组件存在但从未被渲染，App 不检查 `isAuthenticated`，JWT 认证体系形同虚设 |
| B2 | **Refresh Token 哈希不可逆查** | `relay/src/auth.ts` | `hashPassword` 使用随机盐，每次对同一 refresh_token 生成不同哈希，数据库查找永远失败。生产环境下 refresh token 功能完全不可用 |
| B3 | **数据库无 Schema 初始化** | `relay/src/auth.ts` | 引用了 `users`/`daily_usage`/`refresh_tokens`/`sessions` 4 张表但无建表 SQL，新部署时所有 SQL 查询失败 |
| B4 | **DEEPSEEK_API_KEY 客户端暴露** | `opencodeClient.ts:25` | `VITE_DEEPSEEK_API_KEY` 编译进前端 JS，违反文档安全要求（S1: Key 仅存服务器） |
| B5 | **端口不一致** | `opencodeClient.ts:13` / 服务器 | 客户端硬编码 `4097`，服务器实际监听 `4096`（systemd service 配置）。Vite 代理也写 `4097`。连接必然失败 |

### 🟡 P1 中等（影响用户体验）

| # | Bug | 文件 | 表现 |
|---|-----|------|------|
| B6 | **Relay session 不自动恢复** | `mcp-servers/pvfutility/index.ts` | Relay 服务器重启后 `relaySessionId` 失效，后续所有 `callViaRelay` 调用失败 |
| B7 | **save_as_pvf URL 双重编码** | `mcp-servers/pvfutility/index.ts` | `encodeURIComponent` + `apiGet` 内部再编码，导致中文路径损坏 |
| B8 | **handleSaveAs 使用原生 prompt()** | `PvfEditor.tsx` | 与整体自定义 UI 风格不一致，且在某些环境下被浏览器拦截 |
| B9 | **toggleTreeNode 异步竞态** | `PvfEditor.tsx` | 快速连续点击展开节点，异步加载回调可能导致数据错乱 |
| B10 | **Relay 重连无退避** | `relayClient.ts` + `App.tsx` | 服务器不可达时每 5 秒无限重连，无指数退避，无最大重试次数，消耗资源 |
| B11 | **Admin API 无角色检查** | `relay/src/auth.ts` | `/admin/stats` 只验证 JWT 有效，不检查用户角色，任何登录用户可访问管理端点 |
| B12 | **密码哈希不安全** | `relay/src/auth.ts` | 使用 SHA-256 + 盐值而非 bcrypt/argon2，容易被暴力破解 |

### 🟢 P2 轻微（影响局部功能）

| # | Bug | 文件 | 表现 |
|---|-----|------|------|
| B13 | **DiffHunk/DiffLine 死代码** | `DiffViewer.tsx` | 定义了接口和解析逻辑但完全未使用，属未完成占位代码 |
| B14 | **工具计数不一致** | `McpManager.tsx` | 卡片写"21 个"但 `PVFUT_TOOLS` 实际有 22 个（+`folder_exists`），`pvfutility/index.ts` 定义了 23 个 |
| B15 | **LoginPanel 样式不一致** | `LoginPanel.tsx` | 使用 Tailwind CSS 类，项目其他组件使用 CSS 变量，暗色模式下可能显示异常 |
| B16 | **附件/引用按钮无功能** | `ChatPanel.tsx` | `Paperclip` 和 `AtSign` 图标按钮无 onClick 处理 |
| B17 | **LST 详情截断 5000 字符** | `PvfEditor.tsx` | 硬截断可能截在 JSON 中间，导致显示异常 |
| B18 | **handlePermissionApproval 依赖陈旧** | `ChatPanel.tsx` | `useCallback` 依赖 `pendingPermissions`，审批并发时可能丢失状态 |

---

## 四、文档与代码不一致项

| # | 文档描述 | 代码/服务器实际 | 类型 |
|---|---------|---------------|------|
| D1 | OpenCode 端口 4096 | 客户端写 4097 | 端口不一致 |
| D2 | 按Token计费 | 实际按调用次数计费 | 计费模型不一致 |
| D3 | Caddy 反向代理 + TLS | 无 Caddy，HTTP 明文 | 安全模型不一致 |
| D4 | Redis 缓存 | 无 Redis | 部署架构不一致 |
| D5 | Docker Compose 部署 | systemd 直接运行 | 部署方式不一致 |
| D6 | Rust 工具执行器 | 前端 TS relayClient 执行 | 客户端架构不一致 |
| D7 | Basic Auth → Bearer JWT | 仍用 Basic Auth | 认证方式不一致 |
| D8 | 22 个 PVFut 工具 | 实际 23 个（多 folder_exists） | 工具数量不一致 |
| D9 | opencodeClient 精简到 30KB | 仍为 69KB | 代码规模不一致 |
| D10 | 删除 opencode submodule | submodule 仍存在 | 配置清理未完成 |

---

## 五、优先修复建议

### 立即修复（P0 阻塞）

1. **统一端口**：客户端 4097 → 4096，或服务器 4096 → 4097
2. **移除客户端 API Key**：删除 `opencodeClient.ts` 中的 `VITE_DEEPSEEK_API_KEY` fallback
3. **集成 LoginPanel 到 App**：添加路由守卫，未登录时渲染 LoginPanel
4. **修复 refresh token 哈希**：改用确定性哈希（HMAC-SHA256）或直接存储 token 明文
5. **添加数据库 Schema 初始化脚本**

### 短期修复（P1 体验）

6. 安装 Caddy + TLS
7. 修复 Relay session 自动恢复
8. 修复 save_as_pvf 双重编码
9. Relay 重连加指数退避
10. Admin API 加角色检查

### 中期规划（Phase 4 商用）

11. Rust 后端改造（WebSocket 客户端 + 工具执行器）
12. opencodeClient.ts 精简
13. 按 Token 计费系统
14. 会话持久化到 PostgreSQL
15. Docker Compose 部署
