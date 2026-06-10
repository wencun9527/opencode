# PVF AI Editor — 分阶段修复计划

> 创建时间: 2026-06-10  
> 基于: DOC-CODE-COMPARISON-REPORT.md 深度比对分析  
> 服务器实测: 1.12.207.131 (SSH ubuntu@, 密钥认证)

---

## 修复阶段总览

| Phase | 目标 | 预计改动文件 | 优先级 |
|-------|------|-------------|--------|
| Phase 1 | P0 关键 Bug 修复 | 6 文件 | 🔴 立即 |
| Phase 2 | P1 体验 Bug 修复 | 5 文件 | 🟡 短期 |
| Phase 3 | opencodeClient 精简 + 配置清理 | 8+ 文件 | 🟠 中期 |
| Phase 4 | 服务器部署完善 | 服务器端 | 🔵 部署 |
| Phase 5 | 商用功能完善 | 多文件 | ⚪ 远期 |

---

## Phase 1: P0 关键 Bug 修复

> 目标：修复 5 个阻塞核心功能的 Bug，使应用基本可用

### 1.1 统一端口 (B5)

**问题**: 客户端写 4097，服务器实际监听 4096  
**方案**: 客户端统一改为 4096（服务器已有 systemd 配置，不动服务器）

**改动文件**:
- `src/services/opencodeClient.ts:13` — `OPENCODE_DEFAULT_PORT = 4097` → `4096`
- `src/services/opencodeClient.ts:16` — `REMOTE_OPENCODE_URL` 中的 `:4097` → `:4096`
- `src/services/opencodeClient.ts:143` — `this.serverPort = 4097` → `4096`
- `src/services/opencodeClient.ts:146` — `port: 4097` → `4096`
- `vite.config.ts:13` — `OPENCODE_REMOTE_URL` 中的 `:4097` → `:4096`

### 1.2 移除客户端 API Key (B4)

**问题**: `VITE_DEEPSEEK_API_KEY` 编译进前端 JS，违反安全要求  
**方案**: 删除前端所有 DEEPSEEK_API_KEY 引用

**改动文件**:
- `src/services/opencodeClient.ts:25` — 删除 `DEEPSEEK_API_KEY` 常量
- `src/services/opencodeClient.ts:164` — `customApiKey || DEEPSEEK_API_KEY` → 只用 `customApiKey`
- `src/services/opencodeClient.ts:1866` — `const apiKey = DEEPSEEK_API_KEY` → 删除/改用 `useModelConfigStore`
- `vite.config.ts:10` — 删除 `DEEPSEEK_API_KEY` 变量
- `vite.config.ts:59-72` — 删除 `/deepseek-api` 代理配置

### 1.3 集成认证流程 (B1)

**问题**: `LoginPanel` 已实现但 `App.tsx` 不渲染，JWT 认证形同虚设  
**方案**: App 检查 `isAuthenticated`，未登录渲染 LoginPanel

**改动文件**:
- `src/App.tsx` — 导入 `useAuthStore`，条件渲染 `LoginPanel`
- `src/services/opencodeClient.ts:2364-2368` — `getAuthHeader()` 改为用 JWT Bearer（当前用 Basic Auth）

### 1.4 修复 refresh token 哈希 (B2)

**问题**: `hashPassword()` 用随机盐，同一 token 每次哈希不同，数据库查找永远失败  
**方案**: refresh token 改用确定性哈希（HMAC-SHA256）

**改动文件**:
- `relay/src/auth.ts:77-89` — `hashPassword` 改为 `hashRefreshToken`，用 HMAC-SHA256
- `relay/src/auth.ts:298` — 登录时用 `hashRefreshToken`
- `relay/src/auth.ts:325` — 刷新时用 `hashRefreshToken`

### 1.5 添加数据库 Schema (B3)

**问题**: 引用 4 张表但无建表 SQL，新部署必崩  
**方案**: 在 `initDb()` 中自动创建表

**改动文件**:
- `relay/src/auth.ts:31-52` — `initDb()` 增加 CREATE TABLE IF NOT EXISTS

---

## Phase 2: P1 体验 Bug 修复

> 目标：修复 4 个影响用户体验的中等 Bug

### 2.1 Relay 重连加指数退避 (B10)

**问题**: 每 5 秒无限重连，无退避无上限  
**方案**: 实现指数退避 + 最大重试次数

**改动文件**:
- `src/services/relayClient.ts:15-16` — 增加退避参数
- `src/services/relayClient.ts:463-469` — `scheduleReconnect()` 改为指数退避

### 2.2 save_as_pvf 双重编码修复 (B7)

**问题**: `encodeURIComponent` + `apiGet` 内部再编码  
**方案**: 移除外层 `encodeURIComponent`

**改动文件**:
- `mcp-servers/pvfutility/index.ts` — 找到 `save_as_pvf` 处理逻辑

### 2.3 Admin API 角色检查 (B11)

**问题**: 任何登录用户可访问 `/admin/stats`  
**方案**: 检查 `payload.plan === 'admin'` 或 `payload.plan === 'enterprise'`

**改动文件**:
- `relay/src/auth.ts:413-427` — `handleAdminRequest` 增加角色检查

### 2.4 密码哈希升级 (B12)

**问题**: SHA-256 + 盐值，容易被暴力破解  
**方案**: 升级为 bcrypt（Node.js 环境）或使用 crypto.scryptSync

**改动文件**:
- `relay/src/auth.ts:77-102` — `hashPassword` / `verifyPassword` 改用 scrypt

---

## Phase 3: opencodeClient 精简 + 配置清理

> 目标：精简 69KB 客户端代码，清理废弃配置

### 3.1 删除 isTauri 双路径

**改动**:
- `opencodeClient.ts` — 删除 `isTauri` 判断，统一走远程 REST API
- 删除 `sendMessageViaRust()` 整个方法（~130 行）
- 删除 `startServer()` 中 Tauri sidecar 启动逻辑
- 删除 `stopServer()` 中 Tauri invoke 调用

### 3.2 删除本地环境变量

**改动**:
- 删除 `VITE_DEEPSEEK_API_KEY`
- 删除 `VITE_OPENCODE_PASSWORD`
- 新增 `VITE_CLOUD_SERVER_URL`（替代硬编码 IP）

### 3.3 清理 Vite 配置

**改动**:
- 删除 `/deepseek-api` 代理
- 删除 `DEEPSEEK_API_KEY` / `OPENCODE_PASSWORD` 变量
- `/opencode-api` 代理 target 改用环境变量

### 3.4 清理 Tauri 配置

**改动**:
- `tauri.conf.json` — 删除 `externalBin`（opencode sidecar）
- `src-tauri/src/lib.rs` — 删除 `find_bun()`、`build_path_with_bun()`、`parse_port_from_output()`
- `src-tauri/src/build.rs` — 删除 opencode 编译逻辑

### 3.5 清理 submodule 和 mcp-servers

**改动**:
- 删除 `.gitmodules` 中 opencode submodule 引用
- 删除 `opencode/` 和 `opencode-bin/` 目录
- 删除或标记 `mcp-servers/` 为可选（云端已走 Relay）

---

## Phase 4: 服务器部署完善

> 目标：Caddy + TLS + Docker，生产级部署

### 4.1 安装 Caddy

**在服务器执行**:
```bash
sudo apt install -y caddy
```

### 4.2 配置 Caddy 反向代理

**Caddyfile**:
```
pvf.example.com {
    reverse_proxy /opencode-api/* localhost:4096
    reverse_proxy /ws localhost:9100
    reverse_proxy /* localhost:9100
}
```

### 4.3 Docker Compose 部署

**改动**:
- `deploy/docker-compose.yml` — 完善服务编排
- `deploy/Caddyfile` — 更新域名和代理规则

### 4.4 安装 Redis（可选）

---

## Phase 5: 商用功能完善

> 目标：按 Token 计费、会话持久化、安全加固

### 5.1 按 Token 计费系统

- OpenCode fork 增加 Token 用量 Hook
- `daily_usage` 增加 `input_tokens`/`output_tokens`/`reasoning_tokens` 列
- 前端增加用量/余额展示

### 5.2 会话持久化到 PostgreSQL

- 实现 `PostgresSessionStore`
- 环境变量切换 File/Postgres

### 5.3 安全加固

- HMAC 签名验证工具调用
- 限流中间件
- 密码哈希升级

---

## 进度记录

| Phase | 开始时间 | 完成时间 | 状态 | 备注 |
|-------|---------|---------|------|------|
| Phase 1 | 2026-06-10 | 2026-06-10 | ✅ 完成 | 5 个 P0 Bug 全部修复 |
| Phase 2 | 2026-06-10 | 2026-06-10 | ✅ 完成 | 4 个 P1 Bug 全部修复 |
| Phase 3 | 2026-06-10 | 2026-06-10 | ✅ 完成 | opencodeClient -200行, lib.rs 409→30行 |
| Phase 4 | 2026-06-10 | 2026-06-10 | ✅ 完成 | Caddy SPA + Docker 前端 + 环境变量 + 文档 |
| Phase 5 | 2026-06-10 | 2026-06-10 | ✅ 完成 | 限流 + Token计费 + quota API + UsagePanel |
