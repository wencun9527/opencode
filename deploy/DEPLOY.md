# PVF AI Editor - 部署指南

## 服务器要求

- OS: Ubuntu 22.04+ / Debian 12+
- CPU: 2 核+
- RAM: 4GB+
- Disk: 20GB+
- Docker + Docker Compose 已安装

## 架构

```
浏览器/Tauri ──HTTP──→ Caddy:80
                        ├── /          → 前端 SPA (静态文件)
                        ├── /auth/*    → Relay:9100 (认证)
                        ├── /admin/*   → Relay:9100 (管理)
                        ├── /mcp/*     → Relay:9100 (MCP)
                        ├── /ws/*      → Relay:9100 (WebSocket)
                        ├── /api/*     → OpenCode:8080 (AI API)
                        └── /sse/*     → OpenCode:8080 (SSE)
                        
                        Relay:9100 ──→ PostgreSQL:5432 (用户/用量)
                        Relay:9100 ──WS──→ 前端客户端 ──→ PVFut (本地)
```

## 快速部署

### 1. 一键服务器初始化

```bash
# 在服务器上运行
curl -fsSL https://raw.githubusercontent.com/wencun9527/opencode/main/deploy/setup-server.sh | bash
```

或手动：

```bash
git clone https://github.com/wencun9527/opencode.git /opt/pvf-ai-editor
cd /opt/pvf-ai-editor
```

### 2. 配置环境变量

```bash
cd deploy
cp .env.example .env.local
```

编辑 `.env.local`：

```env
# 必须修改
DB_PASSWORD=你的强密码
JWT_SECRET=你的64字符随机密钥
DEEPSEEK_API_KEY=sk-your-deepseek-key

# 服务器IP
SERVER_IP=你的服务器IP
```

生成强密钥：
```bash
openssl rand -hex 32  # 生成 64 字符 JWT_SECRET
openssl rand -hex 16  # 生成 DB_PASSWORD
```

### 3. 构建并启动服务

```bash
docker compose --env-file .env.local up -d --build
```

### 4. 验证部署

```bash
# 检查所有服务状态
docker compose ps

# 健康检查
curl http://你的IP/health

# 注册测试用户
curl -X POST http://你的IP/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}'

# 登录获取 token
curl -X POST http://你的IP/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}'
```

### 5. 防火墙配置

```bash
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
# 域名 HTTPS:
# sudo ufw allow 443/tcp
```

## 端点说明

| 端点 | 协议 | 说明 |
|------|------|------|
| `/` | HTTP | 前端 SPA |
| `/auth/register` | HTTP POST | 用户注册 |
| `/auth/login` | HTTP POST | 用户登录 |
| `/auth/refresh` | HTTP POST | 刷新 token |
| `/auth/me` | HTTP GET | 获取用户信息 |
| `/admin/stats` | HTTP GET | 系统统计（需 admin） |
| `/mcp/*` | HTTP POST | MCP StreamableHTTP |
| `/ws` | WebSocket | 客户端工具桥连接 |
| `/api/*` | HTTP | OpenCode AI API |
| `/sse/*` | HTTP SSE | OpenCode 事件流 |
| `/health` | HTTP GET | 健康检查 |

## 环境变量

### 服务端（.env.local）

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_PASSWORD` | ✅ | `pvf_secret_2026` | PostgreSQL 密码 |
| `JWT_SECRET` | ✅ | `change_me_in_production` | JWT 签名密钥 |
| `DEEPSEEK_API_KEY` | ✅ | — | DeepSeek API Key |
| `REQUIRE_AUTH` | ❌ | `true` | 是否启用认证 |
| `SERVER_IP` | ❌ | — | 服务器 IP（日志用） |

### 前端构建参数（Docker ARG）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_RELAY_WS_URL` | `ws://localhost/ws` | WebSocket 地址 |
| `VITE_OPENCODE_REMOTE_URL` | `http://localhost/api` | OpenCode API 地址 |

## 日常运维

### 查看日志
```bash
docker compose logs -f relay
docker compose logs -f caddy
docker compose logs -f postgres
```

### 重启服务
```bash
docker compose restart relay
```

### 数据库备份
```bash
docker compose exec postgres pg_dump -U pvf pvf_ai_editor > backup_$(date +%Y%m%d).sql
```

### 数据库恢复
```bash
cat backup_20260610.sql | docker compose exec -T postgres psql -U pvf pvf_ai_editor
```

### 更新部署
```bash
cd /opt/pvf-ai-editor
git pull
docker compose --env-file .env.local up -d --build
```

### 清理旧镜像
```bash
docker image prune -f
```

## 域名 + HTTPS 配置

1. 修改 `Caddyfile`，将 `:80` 替换为你的域名：
```
pvf.your-domain.com {
    # ... 同样的路由配置
}
```

2. 开放 443 端口：
```bash
sudo ufw allow 443/tcp
```

3. 重启 Caddy：
```bash
docker compose restart caddy
```

Caddy 会自动申请 Let's Encrypt SSL 证书。

## 最小部署（无 Docker）

如果服务器资源有限，可以只运行 Relay + PostgreSQL：

```bash
cd deploy
docker compose -f docker-compose.minimal.yml up -d --build
```

然后手动安装 Caddy：
```bash
sudo apt install -y caddy
sudo cp Caddyfile /etc/caddy/Caddyfile
# 修改 Caddyfile 中的 upstream 地址
sudo systemctl restart caddy
```

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| Relay 无法连接数据库 | 检查 `DATABASE_URL` 和 postgres 健康状态：`docker compose ps` |
| 前端白屏 | 检查 Caddy 日志：`docker compose logs caddy`，确认前端 volume 有文件 |
| 注册/登录 404 | 检查 Caddy 是否正确代理 `/auth/*` 到 Relay |
| WebSocket 连不上 | 检查 Caddy `/ws/*` 代理，防火墙是否放行 |
| MCP 工具调用超时 | 检查客户端 PVFut 是否在运行，Relay WS 连接是否正常 |
| 502 Bad Gateway | 上游服务未启动，检查 `docker compose ps` |
