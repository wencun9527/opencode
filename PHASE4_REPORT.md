# Phase 4 报告：Relay WebSocket 客户端 + MCP 工具桥接

**日期**：2026-06-10  
**状态**：✅ 完成

## 改动总览

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/services/relayClient.ts` | 新建 | WebSocket 客户端，连接云端 Relay，注册 21 个 PVFut 工具，中继 tool_call |
| `src/App.tsx` | 修改 | 导入 relayClient，OpenCode 连接后自动连接 Relay，卸载时断开 |
| `opencode.json` | 修改 | 新增 `pvfutility-relay` MCP 配置（type: "url", 指向 localhost:9100/mcp） |

## 架构设计

### 完整数据流

```
用户输入 → 前端 UI
    ↓
OpenCode API (1.12.207.131:4096) → DeepSeek AI
    ↓
AI 调用 MCP 工具
    ↓
Relay /mcp (1.12.207.131:9100) → 查找已注册工具
    ↓
Relay WS → 前端 relayClient → PVFut HTTP API (localhost:27000)
    ↓
tool_result 返回 → AI 继续生成回复
```

### relayClient 核心逻辑

1. **连接**：WebSocket 连接到 `ws://1.12.207.131:9100/ws`
2. **注册工具**：连接成功后发送 `register_tools` 消息，包含 21 个 PVFut 工具定义
3. **中继调用**：收到 `tool_call` 消息时，调用本地 PVFut HTTP API，将结果回传 Relay
4. **心跳**：每 30 秒发送 ping 保持连接
5. **重连**：断开后 5 秒自动重连，指数退避

### Vite 代理配置

`/opencode-api` → 代理到 `http://1.12.207.131:4096`，浏览器模式无需 Tauri 即可访问 OpenCode API。

## 验证结果

| 测试项 | 结果 |
|--------|------|
| `vite build` | ✅ 0 错误 |
| Vite 代理 → 远程 OpenCode | ✅ `healthy:true` |
| Relay WebSocket 连接 | ✅ `connected_clients: 1` |
| PVFut 工具注册 | ✅ `registered_tools: 23`（21 PVFut + 2 内置）|
| Relay API 可达 | ✅ `1.12.207.131:9100/health` |
| Lint 检查 | ✅ 0 错误 |

## 已注册的 PVFut 工具（21 个）

### 基础操作
- `get_version`, `get_pvf_pack_file_path`, `get_pvf_root_directory`

### 文件浏览与搜索
- `get_file_list`, `get_all_lst_file_list`, `search_pvf`, `file_exists`, `folder_exists`

### 文件内容读取
- `get_file_content`, `get_file_contents_batch`, `get_file_data_json`, `get_lst_file_info`, `get_string_table`

### 文件编辑
- `import_file`, `import_files_batch`, `delete_file`, `delete_files_batch`, `save_as_pvf`

### 物品信息
- `get_item_info`, `get_item_infos_batch`, `item_code_to_file_info`, `item_codes_to_file_infos_batch`, `get_file_icon`

## 下一步（Phase 5）

1. **云端 OpenCode MCP 配置** — 确保生产环境 opencode.json 中 pvfutility-relay 已启用
2. **Tauri 桌面应用测试** — `npm run tauri dev` 完整 AI 对话 + 工具调用验证
3. **生产加固** — TLS + 限流 + 密码轮换 + 认证增强
4. **UI 集成** — 工具调用状态展示、权限审批栏、推理过程展示
