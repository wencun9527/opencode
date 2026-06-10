# Phase 4 修复记录 — 服务器部署完善

> 完成时间: 2026-06-10  
> 修复范围: 部署配置文件、Caddy、Docker、前端代理、环境变量

---

## 4.1 Caddyfile 完善路由 + 前端 SPA

**问题**: Caddyfile 缺少前端静态文件托管，所有非 API 路径返回 404

**修复**: 
- 添加 `root * /srv/frontend` + `try_files {path} /index.html` + `file_server`
- 整理路由优先级：auth → admin → health → mcp → ws → api → sse → SPA fallback
- 支持域名模式（替换 `:80` 为域名即可自动 TLS）

**文件**: `deploy/Caddyfile`

---

## 4.2 docker-compose.yml 增加 Frontend 构建服务

**问题**: 完整部署缺少前端构建，Caddy 无法托管静态文件

**修复**:
- 新增 `frontend` 构建服务（多阶段 Docker 构建 → 输出到共享 volume）
- Caddy 挂载 `frontend_dist` volume 到 `/srv/frontend`
- 移除 OpenCode 独立 Docker 容器（OpenCode 由 systemd 独立运行，更灵活）
- 添加 `REQUIRE_AUTH` 环境变量

**文件**: 
- `deploy/docker-compose.yml` — 重写
- `deploy/frontend/Dockerfile` — 新建

---

## 4.3 vite.config.ts 增加 Relay 代理

**问题**: 浏览器模式开发时，前端无法直接访问 Relay 认证 API（CORS）

**修复**:
- 新增 `/auth` → Relay 代理
- 新增 `/admin` → Relay 代理  
- 新增 `/health` → Relay 代理
- 代理目标使用 `env.VITE_RELAY_URL` 环境变量

**文件**: `vite.config.ts`

---

## 4.4 消除前端硬编码 IP

**问题**: `relayClient.ts` 和 `useAuthStore.ts` 硬编码 `1.12.207.131`

**修复**:
- `relayClient.ts` — `RELAY_WS_URL` 已有 `VITE_RELAY_WS_URL` 环境变量（添加注释说明）
- `useAuthStore.ts` — `serverUrl` 默认值改为 `import.meta.env.VITE_RELAY_URL` 优先
- `opencodeClient.ts` — 错误提示移除硬编码 IP
- `vite.config.ts` — 代理 fallback IP 保留（仅开发用）

**文件**:
- `src/services/relayClient.ts`
- `src/stores/useAuthStore.ts`
- `src/services/opencodeClient.ts`

---

## 4.5 更新部署脚本和文档

**修复**:
- `deploy/DEPLOY.md` — 完整重写：架构图、环境变量表、域名 HTTPS 指南、故障排查
- `deploy/setup-server.sh` — 自动检测公网 IP、集成 docker compose 构建启动、添加服务验证
- `deploy/deploy-cloud.sh` — 改用 MCP `type: "url"` 连接 Relay（不再用 `local` + command）
- `deploy/.env.example` — 添加 `REQUIRE_AUTH` 和前端构建参数
- `deploy/docker-compose.minimal.yml` — 使用环境变量占位符，不再硬编码密码

**文件**:
- `deploy/DEPLOY.md`
- `deploy/setup-server.sh`
- `deploy/deploy-cloud.sh`
- `deploy/.env.example`
- `deploy/docker-compose.minimal.yml`

---

## 改动汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `deploy/Caddyfile` | 重写 | 路由优化 + SPA fallback |
| `deploy/frontend/Dockerfile` | 新建 | 前端多阶段构建 |
| `deploy/docker-compose.yml` | 重写 | 添加 frontend 服务 |
| `deploy/docker-compose.minimal.yml` | 重写 | 环境变量化 |
| `deploy/DEPLOY.md` | 重写 | 完整部署文档 |
| `deploy/setup-server.sh` | 重写 | 一键初始化+构建+验证 |
| `deploy/deploy-cloud.sh` | 重写 | MCP url 类型 |
| `deploy/.env.example` | 更新 | 添加新变量 |
| `vite.config.ts` | 更新 | 增加 Relay 代理 |
| `src/stores/useAuthStore.ts` | 更新 | 环境变量优先 |
| `src/services/opencodeClient.ts` | 更新 | 移除硬编码 IP |
