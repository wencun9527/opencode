# Phase 5 报告：MCP Relay 集成 + UI 状态展示

**日期**：2026-06-10  
**状态**：✅ 完成

## 改动总览

| 文件 | 类型 | 说明 |
|------|------|------|
| `mcp-servers/pvfutility/index.ts` | 修改 | 添加 Relay 代理模式 — PVFut 不可用时自动 fallback 到 Relay MCP |
| `src/App.tsx` | 修改 | 启动时日志提示 MCP Relay fallback 配置 |
| `src/components/ChatPanel.tsx` | 修改 | AgentStateBar 添加 Relay 连接状态 Badge |
| `src/components/McpManager.tsx` | 修改 | 添加 Relay 状态卡片（连接状态、MCP 端点、手动连接按钮） |
| `opencode.json` | 修改 | 统一为单个 MCP 入口 `pvfutility`，带 `RELAY_MCP_URL` 环境变量 |
| `deploy/deploy-cloud.sh` | 新建 | 云端部署脚本，自动更新 opencode.json 并重启服务 |

## 核心改进：MCP Relay Fallback

### 问题
云端 OpenCode 运行在 1.12.207.131:4096，其 MCP 服务器 `pvfutility` 调用本地 PVFut API。但云端没有 PVFut 进程，导致 AI 无法调用 PVFut 工具。

### 解决方案
在 MCP 服务器中添加 **Relay 代理模式**：

```
工具调用请求
  ↓
callTool(name, args) — 尝试本地 PVFut
  ↓ 失败（PVFut 不可用）
callViaRelay(name, args) — 通过 Relay MCP StreamableHTTP 转发
  ↓
Relay WS → 前端 relayClient → PVFut (localhost:27000)
  ↓
tool_result 返回
```

### 配置方式
在 `opencode.json` 中设置 `RELAY_MCP_URL` 环境变量：

```json
{
  "mcp": {
    "pvfutility": {
      "type": "local",
      "command": ["bun", "run", "mcp-servers/pvfutility/index.ts"],
      "env": {
        "RELAY_MCP_URL": "http://localhost:9100/mcp"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

### Relay 代理实现
- **MCP StreamableHTTP 协议**：初始化 → `notifications/initialized` → `tools/call`
- **Session 管理**：维护 `mcp-session-id`，跨请求复用
- **自动切换**：首次 PVFut 失败后，永久切换到 Relay 模式

## UI 改进

### AgentStateBar — Relay Badge
在 PVF Badge 旁添加 Relay Badge，实时显示 WebSocket 连接状态：
- 🟣 已连接 → Relay WS 正常
- 🟡 未连接 → 尝试重连中

### McpManager — Relay 状态卡片
- 显示 Relay 连接状态（WebSocket）
- 显示 MCP 端点 URL
- 提供「连接 Relay」手动重连按钮

## 验证结果

| 测试项 | 结果 |
|--------|------|
| `vite build` | ✅ 0 错误 |
| Relay 连接 (1 client, 23 tools) | ✅ |
| OpenCode API 健康 | ✅ |
| Lint 检查 | ✅ 0 错误 |

## 下一步（需要手动操作）

### 必须操作：更新云端 OpenCode 配置

SSH 到 1.12.207.131 并执行：

```bash
# 方法 1：使用部署脚本
bash deploy/deploy-cloud.sh

# 方法 2：手动更新
# 编辑 /root/PVF-AI-Editor/opencode.json，确保 pvfutility MCP 带有：
#   "env": { "RELAY_MCP_URL": "http://localhost:9100/mcp" }
# 然后重启 OpenCode
```

### 验证端到端
1. 确保本地 PVFut 正在运行（localhost:27000）
2. 打开前端应用（localhost:1420）
3. 发送消息：「获取 PVF 版本号」
4. AI 应调用 `get_version` 工具，通过 Relay → 前端 → PVFut 返回结果

## 完整数据流（最终版）

```
用户输入 → 前端 UI
    ↓
OpenCode API (1.12.207.131:4096) → DeepSeek AI
    ↓
AI 调用工具 → MCP 服务器 (pvfutility)
    ↓
PVFut 可用? → 是 → 直接调用 (localhost:27000)
    ↓ 否
Relay MCP (localhost:9100/mcp)
    ↓
Relay WS → 前端 relayClient → PVFut (localhost:27000)
    ↓
tool_result → AI 继续生成
```
