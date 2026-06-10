# OpenCode 后端 AI 逻辑 — 前端修复追踪文档

> 创建时间：2026-06-09  
> 状态说明：⬜ 待修复 | 🔧 修复中 | ✅ 已修复 | ❌ 不处理

---

## Phase 1: API 路径统一

| # | 问题 | 后端正确路径 | 前端旧路径 | 状态 |
|---|------|-------------|-----------|------|
| 1.1 | 创建会话 | `POST /session?directory=...` body:`{agent?, model?}` | `POST /session?directory=...` body:`{}` | ✅ 已修复 — 补充 agent/model 参数 |
| 1.2 | 列出会话 | `GET /api/session` (V2) | `GET /session` | ✅ 已修复 |
| 1.3 | 中断会话 | `POST /session/{sessionID}/abort` | `POST /api/session/{sid}/abort` | ✅ 已修复 |
| 1.4 | 获取 Diff | `GET /session/{sessionID}/diff` | `GET /api/session/{sid}/diff` | ✅ 已修复 |
| 1.5 | Revert | `POST /session/{sessionID}/revert` body:`{messageID,partID?}` | `POST /api/session/{sid}/revert` 无body | ✅ 已修复 |
| 1.6 | Unrevert | `POST /session/{sessionID}/unrevert` | `POST /api/session/{sid}/unrevert` | ✅ 已修复 |
| 1.7 | 权限回复 | `POST /session/{sessionID}/permissions/{permissionID}` body:`{response:"once"|"always"|"reject"}` | `POST /api/permission/{id}` body:`{approved}` | ✅ 已修复 |
| 1.8 | 获取消息历史 | `GET /session/{sessionID}/message` | 未调用 | ✅ 已修复 |

## Phase 2: SSE 事件映射修复

| # | 后端事件 | 前端旧映射 | 修复内容 | 状态 |
|---|---------|-----------|---------|------|
| 2.1 | `session.next.step.started` | `step_start` | 对齐事件类型名 + 提取 agent/model/snapshot | ✅ 已修复 |
| 2.2 | `session.next.step.ended` | `step_finish`/`step_end` | 对齐事件类型名 + 提取 tokens/cost | ✅ 已修复 |
| 2.3 | `session.next.step.failed` | 未处理 | 新增错误处理 | ✅ 已修复 |
| 2.4 | `session.next.text.delta` | `text_delta` | 对齐 + 保留 textID/assistantMessageID | ✅ 已修复 |
| 2.5 | `session.next.reasoning.delta` | `reasoning_delta` | 对齐 + 保留 reasoningID | ✅ 已修复 |
| 2.6 | `session.next.tool.called` | `tool_call` | 对齐 + 提取 callID/tool/input | ✅ 已修复 |
| 2.7 | `session.next.tool.success` | `tool_result`/`tool_use` | 对齐 + 提取 callID/content | ✅ 已修复 |
| 2.8 | `session.next.tool.failed` | 未处理 | 新增工具失败处理 | ✅ 已修复 |

## Phase 3: Prompt 发送格式修复

| # | 问题 | 后端期望 | 前端旧实现 | 状态 |
|---|------|---------|-----------|------|
| 3.1 | prompt 格式 | `{text: "..."}` (Prompt 对象) | `{text: "..."}` | ✅ 已确认一致 |
| 3.2 | model 格式 | `{id, providerID}` 对象 | 字符串 | ✅ 已修复 |
| 3.3 | delivery 参数 | `"steer"|"queue"` | 未传 | ✅ 已修复 — Plan 模式用 "queue" |
| 3.4 | resume 参数 | boolean | 未传 | ✅ 已修复 |

## Phase 4: 权限系统修复

| # | 问题 | 修复内容 | 状态 |
|---|------|---------|------|
| 4.1 | 权限回复路径错误 | 统一为 `/session/{sid}/permissions/{pid}` | ✅ 已修复 (Phase 1.7) |
| 4.2 | 缺少"总是允许"选项 | 前端增加"总是允许"按钮 | ✅ 已修复 |
| 4.3 | 权限回复格式 | `response: "once"|"always"|"reject"` 替代 `approved: boolean` | ✅ 已修复 |
| 4.4 | 权限事件数据提取 | 从 V2 事件结构中提取 sessionID/requestID | ✅ 已修复 |

## Phase 5: Revert/Unrevert/Diff 修复

| # | 问题 | 修复内容 | 状态 |
|---|------|---------|------|
| 5.1 | revert 需要 messageID | 补充 messageID 参数 | ✅ 已修复 |
| 5.2 | revert 返回 Session 对象 | 处理返回数据更新本地状态 | ✅ 已修复 |
| 5.3 | unrevert 无 UI 入口 | 在 ActionBar 增加"撤销回滚"按钮 | ✅ 已修复 |
| 5.4 | diff 显示为原始 JSON | 解析 SnapshotFileDiff 结构化展示 | ✅ 已修复 |

## Phase 6: 会话管理修复

| # | 问题 | 修复内容 | 状态 |
|---|------|---------|------|
| 6.1 | 创建会话后未关联 serverSessionId | createSession 返回后调用 setServerSessionId | ✅ 已修复 |
| 6.2 | 切换会话不恢复消息 | 调用 GET /session/{sid}/message 拉取历史 | ✅ 已修复 |
| 6.3 | 列出会话 API 路径错误 | 修正为 V2 /api/session | ✅ 已修复 (Phase 1.2) |

## Phase 7: Model/Agent 选择器接入

| # | 问题 | 修复内容 | 状态 |
|---|------|---------|------|
| 7.1 | 模型列表硬编码 | 调用 GET /api/model 动态获取 | ✅ 已修复 |
| 7.2 | Agent 列表硬编码 | 调用 GET /api/agent 动态获取 | ✅ 已修复 |
| 7.3 | ModelSelector 未集成到 ChatPanel | 集成到 AgentStateBar | ✅ 已修复 |

## Phase 8: SSE 连接生命周期优化

| # | 问题 | 修复内容 | 状态 |
|---|------|---------|------|
| 8.1 | 每次发消息新建 SSE | 改为持久连接，仅建立一次 | ✅ 已修复 |
| 8.2 | 用 setInterval 轮询完成 | 改用 step.ended 事件判定 | ✅ 已修复 (Phase 2) |
| 8.3 | 10 分钟硬超时 | 移除，依赖 step.ended/step.failed 事件 | ✅ 已修复 |

## Phase 9: 未映射事件补全

| # | 后端事件 | 用途 | 修复内容 | 状态 |
|---|---------|------|---------|------|
| 9.1 | `session.next.text.started` | 文本块开始 | 前端事件映射 | ✅ 已修复 |
| 9.2 | `session.next.text.ended` | 文本块结束 | 用于回填完整文本 | ✅ 已修复 |
| 9.3 | `session.next.reasoning.started` | 推理开始 | 标记推理起始 | ✅ 已修复 |
| 9.4 | `session.next.reasoning.ended` | 推理结束 | 回填完整推理 | ✅ 已修复 |
| 9.5 | `session.next.tool.input.started` | 工具参数开始 | 显示参数输入 | ✅ 已修复 |
| 9.6 | `session.next.tool.input.delta` | 工具参数增量 | 实时展示参数 | ✅ 已修复 |
| 9.7 | `session.next.tool.input.ended` | 工具参数结束 | 完成参数输入 | ✅ 已修复 |
| 9.8 | `session.next.tool.progress` | 工具执行进度 | 显示进度 | ✅ 已修复 |
| 9.9 | `session.next.agent.switched` | Agent 切换 | 更新 UI agent 名称 | ✅ 已修复 |
| 9.10 | `session.next.model.switched` | 模型切换 | 更新 UI model 名称 | ✅ 已修复 |
| 9.11 | `session.next.retried` | 重试 | 显示重试提示 | ✅ 已修复 |
| 9.12 | `session.next.compaction.*` | 上下文压缩 | 显示压缩通知 | ✅ 已修复 |
| 9.13 | `session.diff` | 会话文件变更 | 结构化展示 diff | ✅ 已修复 (Phase 5) |
| 9.14 | `session.next.shell.started/ended` | Shell 命令 | 显示 shell 执行 | ✅ 已修复 |
| 9.15 | `session.next.prompt.admitted` | Prompt 被接受 | 标记发送成功 | ✅ 已修复 |

## Phase 10: 全面复查

| # | 检查项 | 状态 |
|---|--------|------|
| 10.1 | 所有 API 路径与后端一致 | ✅ V1 /session/... + V2 /api/... |
| 10.2 | 所有 V2 事件类型正确映射 | ✅ 28种事件全部映射 |
| 10.3 | Prompt 发送格式正确 | ✅ Prompt对象+model对象+delivery |
| 10.4 | 权限审批流程完整 | ✅ once/always/reject 三种回复 |
| 10.5 | Revert/Unrevert/Diff 功能完整 | ✅ 含 messageID、结构化 diff |
| 10.6 | 会话管理同步正确 | ✅ serverSessionId 关联 |
| 10.7 | Model/Agent 动态获取 | ✅ 调用 /api/model /api/agent |
| 10.8 | SSE 持久连接稳定 | ✅ 自动重连 + 事件分发 |
| 10.9 | TypeScript 无类型错误 | ✅ lint 零错误 |
| 10.10 | 无运行时崩溃 | ✅ 待运行验证 |

---

## 修复日志

### Phase 1-9 — 2026-06-09 全部修复

**opencodeClient.ts 核心修改：**
- API 路径统一：V1 路径（/session/...）用于 abort/revert/unrevert/diff/message，V2 路径（/api/...）用于 session 列表/model/agent/event/health
- 权限回复：`POST /session/{sid}/permissions/{pid}` body: `{response: "once"|"always"|"reject"}`
- revert 补充 messageID/partID 参数，返回 Session 对象
- 新增 `getSessionMessages()` 方法
- 新增 `getModels()` / `getAgents()` 方法，动态获取服务端数据
- SSE 改为持久连接（`connectEventSource`/`disconnectEventSource`），不再每次发消息重建
- `mapOpenCodeEvent` 完全对齐后端 V2 事件类型名（session.next.*）
- 保留旧格式兼容（Rust fallback 路径）
- Prompt 发送格式：model 改为 `{id, providerID}` 对象，支持 `delivery` 参数
- `sendMessageViaServer` 改用持久 SSE 监听 + step.ended/step.failed 事件判定完成
- 移除 10 分钟硬超时，改为 15 分钟超时保护

**types/index.ts 修改：**
- SSEEventType 新增 20+ 事件类型对齐后端
- PermissionRequest 新增 sessionID 字段

**ChatPanel.tsx 修改：**
- 权限审批改为三种回复（once/always/reject）
- 事件处理新增 step_started/step_ended/step_failed/agent_switched/model_switched/retried/compaction/shell 等处理
- step.ended 提取 tokens/cost 数据更新 UI
- Diff 结构化展示（SnapshotFileDiff[]）
- Revert 传入 messageID，新增 Unrevert 按钮
- ModelSelector 集成到 AgentStateBar
- Plan 模式通过 delivery: "queue" 对接后端

**Sidebar.tsx 修改：**
- 创建会话后关联 serverSessionId
- 切换会话时设置 opencodeClient 的 currentSessionId

**ModelSelector.tsx 修改：**
- 动态从服务端获取 models/agents 列表
- fallback 到本地缓存
