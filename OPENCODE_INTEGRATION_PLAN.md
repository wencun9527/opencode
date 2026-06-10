# OpenCode 后端功能前端接入计划

> 生成时间：2026-06-09  
> 目标：将 OpenCode 后端所有可通过 V2 REST API 访问的功能完整接入前端，补齐缺失的 UI 和交互逻辑

---

## 现状总览

### 已接入（有 UI + 有逻辑）
| 功能 | 前端组件 | 状态 |
|------|---------|------|
| 聊天发消息 | ChatPanel → `sendPrompt()` | ✅ 完成 |
| 消息流式展示 | ChatPanel SSE handler | ✅ 完成 |
| 推理过程展示 | ChatPanel reasoning 渲染 | ✅ 完成 |
| Agent 状态展示 | AgentStateBar | ✅ 完成 |
| 模型选择 | ModelSelector → `listModels()` | ✅ 完成 |
| Agent 选择 | ModelSelector → `listAgents()` | ✅ 完成 |
| 权限审批 | ChatPanel → `approvePermission()` | ✅ 完成 |
| 工具调用展示 | ToolCallCard | ✅ 完成 |
| 会话列表 | Sidebar | ✅ 完成 |
| 会话创建/切换/删除 | Sidebar + useChatStore | ✅ 完成 |
| MCP 状态 | McpPanel（但使用 `/api/mcp/status` 旧路径） | ⚠️ 需修复 |
| SSE 事件流 | opencodeClient `connectEventSource()` | ✅ 完成 |

### 未接入（有 API 方法，无 UI/逻辑）
| 功能 | API 方法 | 优先级 |
|------|---------|--------|
| Question 问答交互 | `replyQuestion()` / `rejectQuestion()` | 🔴 P0 |
| MCP 状态面板修复 | McpPanel 路径不对 | 🔴 P0 |
| 权限请求列表 | `listPermissionRequests()` / `listSessionPermissionRequests()` | 🟡 P1 |
| 已保存权限管理 | `listSavedPermissions()` / `removeSavedPermission()` | 🟡 P1 |
| Provider 列表/详情 | `getProviders()` / `getProvider()` | 🟡 P1 |
| Skill 浏览 | `getSkills()` | 🟡 P1 |
| Slash Command | `getCommands()` | 🟡 P1 |
| Session 上下文查看 | `getSessionContext()` | 🟢 P2 |
| Session 压缩 | `compactSession()` | 🟢 P2 |
| 文件浏览器 | `readFile()` / `listDirectory()` | 🟢 P2 |
| SSE 新事件处理 | question/compaction/shell 等事件 | 🔴 P0 |

---

## 阶段一：P0 — 核心交互打通（Question + MCP + SSE 补全）

> 不完成这些，AI 提问会卡死，MCP 状态不可见，SSE 事件丢失

### 1.1 Question 问答交互系统

**问题**：后端 `question` 工具会向用户提问，前端无接收和回复机制，AI 会话会卡住等待。

**需要新增**：

#### 1.1.1 类型扩展 (`types/index.ts`)
```typescript
/** 问答请求 */
export interface QuestionRequest {
  id: string;
  sessionID: string;
  question: string;
  options?: string[];
  multiSelect?: boolean;
}

/** 问答请求存储 */
// 在 ChatState 中添加：
pendingQuestions: QuestionRequest[];
addQuestionRequest: (q: QuestionRequest) => void;
removeQuestionRequest: (id: string) => void;
```

#### 1.1.2 Store 扩展 (`stores/useChatStore.ts`)
- 新增 `pendingQuestions: QuestionRequest[]`
- 新增 `addQuestionRequest()` / `removeQuestionRequest()`

#### 1.1.3 SSE 事件处理 (`services/opencodeClient.ts`)
- 处理 `question` 类型 SSE 事件 → 触发 `addQuestionRequest()`

#### 1.1.4 新组件 `components/QuestionDialog.tsx`
- 模态弹窗，显示 AI 的问题
- 支持单选/多选选项
- 支持自由文本回答
- "提交"按钮 → `opencodeClient.replyQuestion()`
- "跳过"按钮 → `opencodeClient.rejectQuestion()`

#### 1.1.5 ChatPanel 集成
- 当 `pendingQuestions.length > 0` 时显示 QuestionDialog

---

### 1.2 MCP 状态面板修复

**问题**：`McpPanel.tsx` 调用 `/api/mcp/status`，但后端 V2 无此端点。

**需要修复**：

#### 1.2.1 McpPanel.tsx 改造
- 移除对 `/api/mcp/status` 的直接 fetch
- 改用 SSE 事件获取 MCP 状态（后端 MCP 状态通过 SSE 推送）
- 或使用 `getCommands()` + `getSkills()` 间接推断 MCP 工具可用性
- 添加 fallback：当 server 不可用时显示 PVFut 本地工具列表

---

### 1.3 SSE 事件补全

**问题**：`opencodeClient.ts` 的 SSE handler 只处理了部分事件类型，很多 V2 事件被忽略。

**需要处理的缺失事件**：

| 事件 | 处理逻辑 | 前端效果 |
|------|---------|---------|
| `question` | 解析问题数据，调用 `addQuestionRequest()` | 弹出问答弹窗 |
| `compaction_started` | 设置 Agent 状态为特殊 "compressing" | 状态栏显示压缩中 |
| `compaction_delta` | 追加压缩进度文本 | 显示压缩进度 |
| `compaction_ended` | 恢复 Agent 状态 | 状态恢复正常 |
| `shell_started` | 在 ToolCallCard 中显示 Shell 命令开始 | 工具卡片更新 |
| `shell_ended` | 在 ToolCallCard 中显示 Shell 命令结束 | 工具卡片更新 |
| `step_started` | 记录步骤开始 | 可选：步骤指示器 |
| `step_ended` | 记录步骤结束 | 可选 |
| `step_failed` | 记录步骤失败，显示错误 | 错误提示 |
| `agent_switched` | 更新当前 Agent 名称和 ID | Agent 选择器更新 |
| `model_switched` | 更新当前模型名称 | 模型选择器更新 |
| `prompt_admitted` | 确认输入已被接受 | 可选：输入确认动画 |
| `prompt_promoted` | 输入被提升到活跃处理 | 可选 |
| `retried` | AI 自动重试 | 可选：重试提示 |
| `context_updated` | 上下文已更新 | 可选：触发 context 刷新 |
| `session_moved` | 会话已移动 | 刷新会话列表 |

**修改位置**：`opencodeClient.ts` 的 `handleSSEEvent()` 方法

---

## 阶段二：P1 — 管理与配置面板

> 完善权限管理、Provider 配置、Skill/Command 浏览

### 2.1 权限管理面板

#### 2.1.1 新组件 `components/PermissionManager.tsx`
- **已保存权限列表**：调用 `listSavedPermissions()`，显示所有永久保存的权限规则
- **删除权限**：点击删除按钮 → `removeSavedPermission(id)`
- **待审权限列表**：调用 `listSessionPermissionRequests()`，显示当前会话的待审请求
- **批量审批**：一键全部允许/拒绝

#### 2.1.2 集成位置
- ChatPanel 设置面板中新增 "权限管理" 标签页
- 或 Sidebar 底部新增权限图标入口

---

### 2.2 Provider 配置面板

#### 2.2.1 新组件 `components/ProviderPanel.tsx`
- **Provider 列表**：调用 `getProviders()`，显示所有可用 Provider
- **Provider 详情**：点击 Provider → `getProvider(id)`，显示模型列表、配置状态
- **启用/禁用**：显示 Provider 当前 enabled 状态

#### 2.2.2 集成位置
- ModelConfigPanel 中新增 "Provider" 标签页
- 或 ModelSelector 下拉中新增 "管理 Provider" 入口

---

### 2.3 Skill 浏览面板

#### 2.3.1 新组件 `components/SkillPanel.tsx`
- **Skill 列表**：调用 `getSkills()`，显示所有可用技能
- **Skill 详情**：展开显示技能描述、权限要求
- **Skill 加载**：在聊天输入中使用 `/skill` 命令触发

#### 2.3.2 集成位置
- Sidebar 底部新增 "Skills" 入口
- 或聊天输入框上方新增技能快捷栏

---

### 2.4 Slash Command 系统

#### 2.4.1 新组件 `components/CommandPalette.tsx`
- **Command 列表**：调用 `getCommands()`，获取可用斜杠命令
- **命令输入**：输入框输入 `/` 时弹出命令列表
- **命令执行**：选中命令后作为 prompt 发送给 AI

#### 2.4.2 交互逻辑
- 在 ChatPanel 输入框中监听 `/` 前缀
- 弹出命令选择下拉列表
- 选中后填充到输入框或直接发送

---

### 2.5 SSE 事件 → Agent 状态映射完善

#### 2.5.1 扩展 AgentStatus
```typescript
export type AgentStatus = 
  | 'idle' | 'thinking' | 'tool_calling' | 'responding' 
  | 'error' | 'awaiting_permission' | 'awaiting_question'
  | 'compacting' | 'shell_executing';
```

#### 2.5.2 STATE_MAP 扩展
新增 `awaiting_question`、`compacting`、`shell_executing` 状态的显示映射

---

## 阶段三：P2 — 高级功能与体验优化

> 上下文查看、会话压缩、文件浏览器等

### 3.1 Session 上下文查看

#### 3.1.1 新组件 `components/ContextPanel.tsx`
- 调用 `getSessionContext(sessionId)` 获取当前会话上下文
- 显示：系统提示、工具列表、文件上下文、token 用量
- 支持刷新

#### 3.1.2 集成位置
- ChatPanel 顶部工具栏新增 "上下文" 按钮
- 点击展开侧面板

---

### 3.2 Session 压缩

#### 3.2.1 UI 入口
- ChatPanel 工具栏新增 "压缩" 按钮
- 点击 → `compactSession(sessionId)` → 显示压缩进度
- 压缩完成自动刷新上下文

---

### 3.3 文件浏览器

#### 3.3.1 新组件 `components/FileExplorer.tsx`
- **目录浏览**：`listDirectory(path)` 列出文件和子目录
- **文件查看**：`readFile(path)` 读取文件内容
- **面包屑导航**：显示当前路径，支持点击跳转
- **集成 PVF 浏览**：与 PvfEditor 联动

#### 3.3.2 集成位置
- 可替换或增强右侧面板的 PvfEditor
- 或作为 PvfEditor 的新标签页

---

### 3.4 Token 用量实时统计

#### 3.4.1 从 SSE 事件提取 token 数据
- 监听 `step_ended` 事件中的 token 使用信息
- 累计到 AgentInfo.tokenUsed
- 在 AgentStateBar 中显示实时 token 进度条

---

### 3.5 会话 Diff 查看器增强

#### 3.5.1 新组件 `components/DiffViewer.tsx`
- 接收 `session_diff` SSE 事件数据
- 使用 react-diff-view 或类似库渲染文件变更 diff
- 支持展开/折叠、语法高亮

---

## 实施检查清单

### 阶段一（P0）
- [ ] 1.1 Question 问答交互系统
  - [ ] types/index.ts 新增 QuestionRequest 类型
  - [ ] useChatStore 新增 pendingQuestions 状态和方法
  - [ ] opencodeClient SSE 处理 question 事件
  - [ ] 新建 QuestionDialog.tsx 组件
  - [ ] ChatPanel 集成 QuestionDialog
- [ ] 1.2 MCP 状态面板修复
  - [ ] McpPanel.tsx 移除旧 API 调用
  - [ ] 改用 SSE 或间接方式获取 MCP 状态
- [ ] 1.3 SSE 事件补全
  - [ ] opencodeClient.ts handleSSEEvent 补全所有事件处理
  - [ ] AgentStatus 扩展
  - [ ] STATE_MAP 扩展

### 阶段二（P1）
- [ ] 2.1 权限管理面板
  - [ ] 新建 PermissionManager.tsx
  - [ ] 集成到设置面板
- [ ] 2.2 Provider 配置面板
  - [ ] 新建 ProviderPanel.tsx
  - [ ] 集成到 ModelConfigPanel
- [ ] 2.3 Skill 浏览面板
  - [ ] 新建 SkillPanel.tsx
  - [ ] 集成到 Sidebar 或 ChatPanel
- [ ] 2.4 Slash Command 系统
  - [ ] 新建 CommandPalette.tsx
  - [ ] ChatPanel 输入框 `/` 前缀检测
  - [ ] 命令列表下拉
- [ ] 2.5 Agent 状态映射完善

### 阶段三（P2）
- [ ] 3.1 Session 上下文查看
  - [ ] 新建 ContextPanel.tsx
  - [ ] 集成到 ChatPanel
- [ ] 3.2 Session 压缩
  - [ ] ChatPanel 工具栏新增压缩按钮
- [ ] 3.3 文件浏览器
  - [ ] 新建 FileExplorer.tsx
  - [ ] 集成到右侧面板
- [ ] 3.4 Token 用量实时统计
- [ ] 3.5 Diff 查看器增强

---

## 文件变更总览

| 文件 | 阶段 | 变更类型 |
|------|------|---------|
| `types/index.ts` | P0 | 新增 QuestionRequest 类型，扩展 AgentStatus |
| `stores/useChatStore.ts` | P0 | 新增 pendingQuestions 状态和方法 |
| `services/opencodeClient.ts` | P0 | SSE 事件处理补全 |
| `components/QuestionDialog.tsx` | P0 | **新建** |
| `components/McpPanel.tsx` | P0 | 修复 API 路径 |
| `components/ChatPanel.tsx` | P0+P1 | 集成 QuestionDialog、CommandPalette 等 |
| `components/PermissionManager.tsx` | P1 | **新建** |
| `components/ProviderPanel.tsx` | P1 | **新建** |
| `components/SkillPanel.tsx` | P1 | **新建** |
| `components/CommandPalette.tsx` | P1 | **新建** |
| `components/ContextPanel.tsx` | P2 | **新建** |
| `components/FileExplorer.tsx` | P2 | **新建** |
| `components/DiffViewer.tsx` | P2 | **新建** |
| `App.tsx` | P1+P2 | 可能需要调整布局 |

---

## 设计原则

1. **渐进增强**：每个阶段独立可用，不依赖后续阶段
2. **Server-First**：优先使用 server API，fallback 到本地状态
3. **事件驱动**：所有实时更新通过 SSE 事件驱动，避免轮询
4. **一致设计**：新组件遵循现有 CSS 变量和组件风格
5. **最小侵入**：优先修改现有组件，新建组件保持轻量
