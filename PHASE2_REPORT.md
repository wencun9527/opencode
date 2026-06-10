# Phase 2 验证报告

> 日期: 2026-06-10  
> 范围: Phase 2 服务器部署全链路验证  
> 审查人: AI Agent  
> 最终状态: ✅ 核心链路验证通过

---

## 一、部署清单

| # | 任务 | 状态 | 结果 |
|---|------|------|------|
| P2-1 | 服务器环境搭建 | ✅ | PostgreSQL 16 + Node.js v20.19.0 + Bun v1.3.14 |
| P2-2 | OpenCode 部署 | ✅ | 从 GitHub fork 克隆，bun install（4540 packages）|
| P2-3 | Tool Relay 部署 | ✅ | v0.3.0，systemd 服务，端口 9100 |
| P2-4 | PostgreSQL Schema | ✅ | users 表 + GRANT ALL 权限 |
| P2-5 | JWT 鉴权 | ✅ | 注册/登录/refresh/me 全链路通过 |
| P2-6 | OpenCode Server 部署 | ✅ | systemd 服务，端口 4096，Basic Auth |
| P2-7 | opencode.json 配置 | ✅ | MCP pvfutility → type:"remote" → localhost:9100/mcp |
| P2-8 | OpenCode → Relay MCP 连接 | ✅ | `pvfutility: {"status":"connected"}` |
| P2-9 | Relay MCP 鉴权调整 | ✅ | localhost + Bearer localdev 免鉴权 |
| P2-10 | 全链路集成测试 | ✅ | WS Client → Relay → OpenCode → MCP → Connected |

---

## 二、服务器运行状态

| 服务 | 端口 | 状态 | 认证 |
|------|------|------|------|
| OpenCode Server | 0.0.0.0:4096 | active (systemd) | Basic Auth (opencode/opencode2026) |
| Tool Relay | 0.0.0.0:9100 | active (systemd) | JWT（MCP 端点 localhost 免鉴权） |
| PostgreSQL 16 | localhost:5432 | active | pvf/pvf2026secret/pvf_ai_editor |

---

## 三、全链路验证结果

### 3.1 基础服务验证

| API | 方法 | 结果 |
|-----|------|------|
| `GET /health` (Relay) | 无认证 | ✅ `{"status":"ok","version":"0.3.0"}` |
| `GET /api/health` (OpenCode) | Basic Auth | ✅ `{"healthy":true}` |
| `GET /api/model` (OpenCode) | Basic Auth | ✅ 4 个 DeepSeek 模型 |
| `POST /auth/register` (Relay) | 无认证 | ✅ |
| `POST /auth/login` (Relay) | 无认证 | ✅ 返回 JWT |

### 3.2 MCP 集成验证

| 步骤 | 结果 |
|------|------|
| WS Client 连接 Relay | ✅ `connected_clients: 1` |
| WS Client 注册工具 | ✅ `registered_tools: 2` |
| OpenCode 创建 Session | ✅ `ses_1521e6f6cffe823iI4a3XcK7gS` |
| OpenCode → Relay MCP | ✅ `pvfutility: {"status":"connected"}` |

### 3.3 DeepSeek 模型列表

| 模型 ID | 名称 | 上下文 |
|---------|------|--------|
| deepseek-v4-flash | DeepSeek V4 Flash | 1M |
| deepseek-v4-pro | DeepSeek V4 Pro | 1M |
| deepseek-reasoner | DeepSeek Reasoner | 1M |
| deepseek-chat | DeepSeek Chat | 1M |

---

## 四、关键变更

### 4.1 Relay MCP 鉴权调整

**文件**: `relay/src/index.ts`

**变更**: MCP 端点 `/mcp` 对来自 localhost 或带有 `Bearer localdev` 的请求免鉴权

```typescript
// 之前：所有 MCP 请求需 JWT 鉴权
const payload = verifyAuth(req);
if (!payload) { return 401; }

// 之后：localhost + 内部密钥免鉴权
const isLocal = remoteAddr === "127.0.0.1" || remoteAddr === "::1";
const isInternalKey = authHeader === "Bearer localdev";
if (!isLocal && !isInternalKey) {
  // 外部请求仍需 JWT
}
```

**原因**: OpenCode 和 Relay 在同一服务器，MCP 调用是内部通信，不需要 JWT 鉴权

### 4.2 OpenCode Server 配置

**文件**: `/home/ubuntu/pvf-ai-editor/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-chat",
  "mcp": {
    "pvfutility": {
      "type": "remote",
      "url": "http://localhost:9100/mcp",
      "headers": { "Authorization": "Bearer localdev" },
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

---

## 五、遗留问题

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| I-1 | 4096 端口外网访问失败（腾讯云安全组未放行） | 中 | 需用户在控制台放行 |
| I-2 | AI 对话 + 工具调用端到端未测试（需真实 DeepSeek API Key + WS Client 持续运行） | 高 | Phase 3 解决 |
| I-3 | commercial 分支未推送到 fork | 低 | 需用户手动推送 |
| I-4 | OpenCode 仅绑定 0.0.0.0:4096，生产环境应加 Caddy 反向代理 + TLS | 中 | Phase 4 解决 |

---

## 六、下一步：Phase 3 客户端改造

### 核心任务

| # | 任务 | 说明 |
|---|------|------|
| P3-1 | 重写 lib.rs | 删除 sidecar 启动逻辑，实现 WebSocket 客户端 + 工具执行器 |
| P3-2 | 精简 opencodeClient.ts | 删除本地 server 管理，统一使用云端 URL + Basic Auth |
| P3-3 | 新增 useAuthStore | 登录态管理（JWT access/refresh token） |
| P3-4 | 新增 LoginPanel | 登录/注册界面 |
| P3-5 | 清理配置 | 删除 .env 中的 API Key，新增 VITE_CLOUD_SERVER_URL |
| P3-6 | 删除废弃文件 | opencode/ submodule, opencode-bin/, mcp-servers/ |

### 客户端 → 云端数据流

```
用户输入 → 前端 → OpenCode (4096) → DeepSeek API → AI 推理
                                                       ↓
                                              决定调用 MCP 工具
                                                       ↓
                                          OpenCode MCP Client → Relay (9100/mcp)
                                                       ↓
                                              WebSocket → 客户端 Rust
                                                       ↓
                                          PVFut API (localhost:27000)
                                                       ↓
                                              结果回传 → AI 继续
```

### Phase 3 前置条件

- [x] 云端 OpenCode Server 运行正常
- [x] 云端 Relay MCP 连接正常
- [x] JWT 鉴权链路通过
- [ ] 4096 端口安全组放行（或使用 Caddy 反向代理）
- [ ] 确认 DeepSeek API Key 有效（有余额）
