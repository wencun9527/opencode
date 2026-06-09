# PVF AI Editor - 部署指南

## 服务器要求

- OS: Ubuntu 22.04+ / Debian 12+
- CPU: 2 核+
- RAM: 4GB+
- Disk: 20GB+
- Docker + Docker Compose 已安装

## 快速部署

### 1. 上传项目到服务器

```bash
# 在服务器上
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

生成 JWT_SECRET：
```bash
openssl rand -hex 32
```

### 3. 启动服务

```bash
docker compose --env-file .env.local up -d --build
```

### 4. 验证部署

```bash
# 健康检查
curl http://你的IP/health

# 注册测试用户
curl -X POST http://你的IP/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}'

# 登录
curl -X POST http://你的IP/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}'
```

### 5. 防火墙配置

```bash
# 开放 80 端口
sudo ufw allow 80/tcp
# 如需域名 HTTPS，也开放 443
# sudo ufw allow 443/tcp
```

## 服务架构

```
客户端 (Tauri) ──WS──→ Caddy:80 ──→ Relay:9100 ──→ PVFut (本地)
                                    │
                    OpenCode:8080 ←──┘ (MCP StreamableHTTP)
                                    │
                    PostgreSQL:5432 ←─┘ (用户/用量数据)
```

## 端点说明

| 端点 | 协议 | 说明 |
|------|------|------|
| `/mcp` | HTTP POST | MCP StreamableHTTP (OpenCode 连接) |
| `/ws` | WebSocket | 客户端工具桥连接 |
| `/auth/register` | HTTP POST | 用户注册 |
| `/auth/login` | HTTP POST | 用户登录 |
| `/auth/refresh` | HTTP POST | 刷新 token |
| `/auth/me` | HTTP GET | 获取用户信息 |
| `/admin/stats` | HTTP GET | 系统统计 |
| `/health` | HTTP GET | 健康检查 |

## 日常运维

### 查看日志
```bash
docker compose logs -f relay
docker compose logs -f opencode
docker compose logs -f postgres
```

### 重启服务
```bash
docker compose restart relay
```

### 数据库备份
```bash
docker compose exec postgres pg_dump -U pvf pvf_ai_editor > backup.sql
```

### 更新部署
```bash
git pull
docker compose up -d --build
```

## 域名配置（可选）

如果有域名，修改 `Caddyfile`：

```
your-domain.com {
    # ... 同样的路由配置
}
```

Caddy 会自动申请 Let's Encrypt SSL 证书。需要开放 443 端口。

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| Relay 无法连接数据库 | 检查 DATABASE_URL 和 postgres 健康状态 |
| OpenCode 启动失败 | 检查 DEEPSEEK_API_KEY 是否正确 |
| 客户端 WS 连不上 | 检查防火墙、Caddy 配置 |
| MCP 工具调用超时 | 检查客户端 PVFut 是否在运行 |
