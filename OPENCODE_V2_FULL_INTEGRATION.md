# OpenCode V2 后端全功能前端接入计划

> 生成时间：2026-06-09  
> 目标：将 OpenCode 后端 **所有** V1+V2 REST API 端点完整接入前端，补齐缺失的 API 方法、类型定义和 UI 组件

---

## 一、后端 API 全景与前端覆盖对照

### 图例
- ✅ = 前端已有 API 方法 + 有 UI
- ⚠️ = 前端已有 API 方法，无/不完整 UI
- ❌ = 前端无 API 方法、无 UI
- 🔴 = 高优先级 | 🟡 = 中优先级 | 🟢 = 低优先级

---

### 1. V2 API（`/api/*` 前缀）— 前端主要使用

| 端点 | 方法 | 前端方法 | UI | 状态 |
|------|------|---------|-----|------|
| `/api/health` | GET | `healthCheck()` | App 启动 | ✅ |
| `/api/event` | GET (SSE) | `connectEventSource()` | ChatPanel | ✅ |
| `/api/session` | GET | `listSessions()` | Sidebar | ✅ |
| `/api/session/:id/prompt` | POST | `sendMessage()` | ChatPanel | ✅ |
| `/api/session/:id/compact` | POST | `compactSession()` | ChatPanel 按钮 | ✅ |
| `/api/session/:id/wait` | POST | `waitSession()` | — | ⚠️ |
| `/api/session/:id/context` | GET | `getSessionContext()` | ContextPanel | ✅ |
| `/api/session/:id/message` | GET | `getSessionMessages()` | — | ⚠️ |
| `/api/session/:id/permission/request` | GET | `listSessionPermissionRequests()` | PermissionManager | ✅ |
| `/api/session/:id/permission/request/:rid/reply` | POST | `approvePermission()` | ChatPanel | ✅ |
| `/api/session/:id/question/request/:rid/reply` | POST | `replyQuestion()` | QuestionDialog | ✅ |
| `/api/session/:id/question/request/:rid/reject` | POST | `rejectQuestion()` | QuestionDialog | ✅ |
| `/api/model` | GET | `getModels()` | ModelSelector | ✅ |
| `/api/agent` | GET | `getAgents()` | ModelSelector | ✅ |
| `/api/provider` | GET | `getProviders()` | ProviderPanel | ✅ |
| `/api/provider/:id` | GET | `getProvider()` | ProviderPanel | ✅ |
| `/api/permission/request` | GET | `listPermissionRequests()` | PermissionManager | ✅ |
| `/api/permission/saved` | GET | `listSavedPermissions()` | PermissionManager | ✅ |
| `/api/permission/saved/:id` | DELETE | `removeSavedPermission()` | PermissionManager | ✅ |
| `/api/question/request` | GET | `listQuestionRequests()` | — | ⚠️ |
| `/api/fs/read` | GET | `readFile()` | FileExplorer | ✅ |
| `/api/fs/list` | GET | `listDirectory()` | FileExplorer | ✅ |
| `/api/command` | GET | `getCommands()` | CommandPalette | ✅ |
| `/api/skill` | GET | `getSkills()` | SkillPanel | ✅ |

### 2. V1 Instance API（`/` 前缀，无 `/api`）— 前端完全未接入

#### 2.1 Config 配置 🔴

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/config` | GET | 获取当前配置 | ❌ |
| `/config` | PATCH | 更新配置 | ❌ |
| `/config/providers` | GET | 获取配置的 Provider 及默认模型 | ❌ |

#### 2.2 MCP 服务器管理 🔴

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/mcp` | GET | 获取所有 MCP 服务器状态 | ❌ |
| `/mcp` | POST | 动态添加 MCP 服务器 | ❌ |
| `/mcp/:name/connect` | POST | 连接 MCP 服务器 | ❌ |
| `/mcp/:name/disconnect` | POST | 断开 MCP 服务器 | ❌ |
| `/mcp/:name/auth` | POST | 启动 OAuth 认证 | ❌ |
| `/mcp/:name/auth/callback` | POST | OAuth 认证回调 | ❌ |
| `/mcp/:name/auth/authenticate` | POST | 启动 OAuth 并等待 | ❌ |
| `/mcp/:name/auth` | DELETE | 移除 OAuth 凭据 | ❌ |

#### 2.3 文件搜索 🔴

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/find` | GET | 使用 ripgrep 搜索文本 | ❌ |
| `/find/file` | GET | 按名称搜索文件 | ❌ |
| `/find/symbol` | GET | 使用 LSP 搜索符号 | ❌ |
| `/file/status` | GET | 获取 Git 文件状态 | ❌ |

#### 2.4 VCS (Git) 操作 🔴

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/vcs` | GET | 获取 VCS 信息（分支等） | ❌ |
| `/vcs/status` | GET | 获取变更文件列表 | ❌ |
| `/vcs/diff` | GET | 获取 git diff | ❌ |
| `/vcs/diff/raw` | GET | 获取原始补丁 | ❌ |
| `/vcs/apply` | POST | 应用补丁到工作区 | ❌ |

#### 2.5 项目管理 🟡

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/project` | GET | 获取所有已打开项目 | ❌ |
| `/project/current` | GET | 获取当前活跃项目 | ❌ |
| `/project/git/init` | POST | 初始化 Git 仓库 | ❌ |
| `/project/:id` | PATCH | 更新项目属性 | ❌ |
| `/project/:id/directories` | GET | 列出项目本地目录 | ❌ |

#### 2.6 认证管理 🟡

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/auth/:providerID` | PUT | 设置认证凭据 | ❌ |
| `/auth/:providerID` | DELETE | 移除认证凭据 | ❌ |

#### 2.7 Instance 信息 🟢

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/path` | GET | 获取路径信息 | ❌ |
| `/lsp` | GET | 获取 LSP 服务器状态 | ❌ |
| `/formatter` | GET | 获取格式化器状态 | ❌ |
| `/instance/dispose` | POST | 释放当前实例 | ❌ |

#### 2.8 全局操作 🟢

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/global/health` | GET | 全局健康检查 | ❌ |
| `/global/event` | GET (SSE) | 全局 SSE 事件流 | ❌ |
| `/global/config` | GET | 获取全局配置 | ❌ |
| `/global/config` | PATCH | 更新全局配置 | ❌ |
| `/global/dispose` | POST | 释放所有实例 | ❌ |
| `/global/upgrade` | POST | 升级 opencode | ❌ |

#### 2.9 控制面板 🟢

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/log` | POST | 写入日志 | ❌ |
| `/experimental/control-plane/move-session` | POST | 移动会话 | ❌ |
| `/experimental/project/:id/copy` | POST | 创建项目副本 | ❌ |
| `/experimental/project/:id/copy` | DELETE | 删除项目副本 | ❌ |

#### 2.10 Session 删除/更新 🔴

| 端点 | 方法 | 功能 | 状态 |
|------|------|------|------|
| `/session/:sessionID` | DELETE | 删除会话 | ❌ |
| `/session/:sessionID` | PATCH | 更新会话 | ❌ |

---

## 二、分阶段实施计划

### 阶段一：P1 — 核心功能（MCP 管理 + 文件搜索 + VCS + Session CRUD）

> 这些功能直接影响 AI 编码体验：MCP 是工具扩展、搜索是信息获取、VCS 是代码管理、Session CRUD 是基本操作

#### 1.1 类型扩展 (`types/index.ts`)

```typescript
/** MCP 服务器状态 */
export interface McpServerStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  tools?: McpToolInfo[];
  description?: string;
  error?: string;
}

/** MCP 工具信息 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** VCS 信息 */
export interface VcsInfo {
  branch: string;
  remote?: string;
  dirty: boolean;
}

/** VCS 文件状态 */
export interface VcsFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

/** 搜索结果 */
export interface SearchResult {
  file: string;
  line: number;
  column: number;
  text: string;
  matchLength: number;
}

/** 文件搜索结果 */
export interface FileSearchResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

/** 符号搜索结果 */
export interface SymbolSearchResult {
  name: string;
  kind: string;
  path: string;
  line: number;
}

/** 配置信息 */
export interface ConfigInfo {
  [key: string]: unknown;
}

/** 项目信息 */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  icon?: string;
  command?: string;
}

/** 路径信息 */
export interface PathInfo {
  home: string;
  state: string;
  config: string;
  worktree: string;
  directory: string;
}

/** LSP 服务器状态 */
export interface LspStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  languageId: string;
}
```

#### 1.2 API 方法扩展 (`services/opencodeClient.ts`)

新增以下方法：

```typescript
// MCP 管理
getMcpStatus(): Promise<McpServerStatus[]>
addMcpServer(config: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<boolean>
connectMcpServer(name: string): Promise<boolean>
disconnectMcpServer(name: string): Promise<boolean>

// 文件搜索
findText(pattern: string, options?: { path?: string; include?: string; exclude?: string }): Promise<SearchResult[]>
findFile(pattern: string, options?: { path?: string }): Promise<FileSearchResult[]>
findSymbol(query: string, options?: { path?: string }): Promise<SymbolSearchResult[]>
getFileStatus(options?: { path?: string }): Promise<VcsFileStatus[]>

// VCS
getVcsInfo(): Promise<VcsInfo | null>
getVcsStatus(): Promise<VcsFileStatus[]>
getVcsDiff(options?: { path?: string; staged?: boolean }): Promise<string>
getVcsDiffRaw(options?: { path?: string }): Promise<string>
applyPatch(patch: string): Promise<boolean>

// Session CRUD
deleteSession(sessionId: string): Promise<boolean>
updateSession(sessionId: string, data: { title?: string }): Promise<boolean>
```

#### 1.3 新增 UI 组件

| 组件 | 功能 |
|------|------|
| `McpManager.tsx` | MCP 服务器管理面板（状态列表、连接/断开、添加新服务器） |
| `SearchPanel.tsx` | 全局搜索面板（文本搜索、文件搜索、符号搜索 Tab 切换） |
| `VcsPanel.tsx` | VCS/Git 状态面板（分支、变更文件列表、diff 查看、apply 补丁） |

#### 1.4 修改现有组件

| 文件 | 修改 |
|------|------|
| `McpPanel.tsx` | 升级为完整 MCP 管理（替代当前只读面板） |
| `Sidebar.tsx` | 会话列表增加删除按钮，调用 `deleteSession()` |
| `ChatPanel.tsx` | 集成 SearchPanel 快捷入口 |

---

### 阶段二：P2 — 管理配置（全局配置 + 认证 + 项目 + LSP/格式化）

#### 2.1 API 方法扩展

```typescript
// 配置
getConfig(): Promise<ConfigInfo>
updateConfig(data: Partial<ConfigInfo>): Promise<boolean>
getConfigProviders(): Promise<ProviderInfo[]>

// 认证
setAuthProvider(providerID: string, credentials: Record<string, string>): Promise<boolean>
removeAuthProvider(providerID: string): Promise<boolean>

// 项目
listProjects(): Promise<ProjectInfo[]>
getCurrentProject(): Promise<ProjectInfo | null>
updateProject(projectID: string, data: { name?: string; icon?: string; command?: string }): Promise<boolean>
initGit(): Promise<boolean>
getProjectDirectories(projectID: string): Promise<string[]>

// LSP / 格式化
getLspStatus(): Promise<LspStatus[]>
getFormatterStatus(): Promise<unknown>

// 路径
getPathInfo(): Promise<PathInfo | null>
```

#### 2.2 新增 UI 组件

| 组件 | 功能 |
|------|------|
| `SettingsPanel.tsx` | 全局设置面板（配置编辑、Provider 认证管理） |
| `ProjectPanel.tsx` | 项目管理面板（项目列表、属性编辑、Git 初始化） |
| `LspPanel.tsx` | LSP 状态面板（语言服务器状态、格式化器状态） |

#### 2.3 修改现有组件

| 文件 | 修改 |
|------|------|
| `ProviderPanel.tsx` | 增加"设置认证"按钮 |
| `Sidebar.tsx` | 底部增加"设置"入口 |

---

### 阶段三：P3 — 实验性/低频功能 + 空实现修复

#### 3.1 API 方法扩展

```typescript
// 全局
globalHealthCheck(): Promise<boolean>
getGlobalConfig(): Promise<ConfigInfo>
updateGlobalConfig(data: Partial<ConfigInfo>): Promise<boolean>
globalDispose(): Promise<boolean>
upgrade(version?: string): Promise<boolean>

// 日志
writeLog(level: string, message: string): Promise<boolean>

// 会话移动
moveSession(sessionId: string, targetDirectory: string): Promise<boolean>

// 项目复制
copyProject(projectID: string): Promise<boolean>

// 实例释放
disposeInstance(): Promise<boolean>
```

#### 3.2 修复空实现方法

| 方法 | 当前状态 | 修复方案 |
|------|---------|---------|
| `revertSession()` | 空实现 | V2 无端点 → 改用 Session 删除重建 + 消息回放 |
| `unrevertSession()` | 空实现 | V2 无端点 → 标记不可用，UI 隐藏按钮 |
| `getSessionDiff()` | 空实现 | 改用 SSE `session.diff` 事件缓存 diff 数据 |

#### 3.3 新增 UI

| 组件 | 功能 |
|------|------|
| `AboutPanel.tsx` | 关于面板（版本信息、升级按钮、全局健康检查） |

---

## 三、文件变更总览

| 文件 | 阶段 | 变更类型 |
|------|------|---------|
| `types/index.ts` | P1 | 新增 McpServerStatus, VcsInfo, SearchResult 等 12 个类型 |
| `services/opencodeClient.ts` | P1+P2+P3 | 新增 ~25 个 API 方法 |
| `components/McpManager.tsx` | P1 | **新建** — MCP 服务器管理面板 |
| `components/SearchPanel.tsx` | P1 | **新建** — 全局搜索面板 |
| `components/VcsPanel.tsx` | P1 | **新建** — VCS/Git 状态面板 |
| `components/McpPanel.tsx` | P1 | 重写 — 升级为完整 MCP 管理 |
| `components/Sidebar.tsx` | P1 | 修改 — 会话删除按钮 |
| `components/ChatPanel.tsx` | P1+P2 | 修改 — 集成搜索入口、设置入口 |
| `components/SettingsPanel.tsx` | P2 | **新建** — 全局设置面板 |
| `components/ProjectPanel.tsx` | P2 | **新建** — 项目管理面板 |
| `components/LspPanel.tsx` | P2 | **新建** — LSP 状态面板 |
| `components/ProviderPanel.tsx` | P2 | 修改 — 增加认证按钮 |
| `components/AboutPanel.tsx` | P3 | **新建** — 关于面板 |
| `stores/useChatStore.ts` | P1 | 修改 — 新增 VCS/diff 相关状态 |

---

## 四、实施检查清单

### 阶段一（P1）
- [ ] 1.1 types/index.ts 新增 12 个类型
- [ ] 1.2 opencodeClient.ts 新增 MCP/搜索/VCS/Session CRUD 方法
- [ ] 1.3 新建 McpManager.tsx
- [ ] 1.4 新建 SearchPanel.tsx
- [ ] 1.5 新建 VcsPanel.tsx
- [ ] 1.6 重写 McpPanel.tsx
- [ ] 1.7 修改 Sidebar.tsx（会话删除）
- [ ] 1.8 修改 ChatPanel.tsx（搜索入口）

### 阶段二（P2）
- [ ] 2.1 opencodeClient.ts 新增配置/认证/项目/LSP 方法
- [ ] 2.2 新建 SettingsPanel.tsx
- [ ] 2.3 新建 ProjectPanel.tsx
- [ ] 2.4 新建 LspPanel.tsx
- [ ] 2.5 修改 ProviderPanel.tsx（认证按钮）
- [ ] 2.6 修改 Sidebar.tsx（设置入口）

### 阶段三（P3）
- [ ] 3.1 opencodeClient.ts 新增全局/日志/移动方法
- [ ] 3.2 修复 revertSession/unrevertSession/getSessionDiff
- [ ] 3.3 新建 AboutPanel.tsx
- [ ] 3.4 构建验证

---

## 五、设计原则

1. **V2 优先**：`/api/*` 端点优先使用，V1 Instance API（`/` 前缀）作为补充
2. **API 统一**：所有方法封装在 `opencodeClient.ts`，组件不直接调用 fetch
3. **类型安全**：每个 API 响应都有对应的 TypeScript 类型
4. **渐进增强**：每个阶段独立可用，不依赖后续阶段
5. **事件驱动**：实时更新通过 SSE 事件驱动，避免轮询
6. **一致设计**：新组件遵循现有 CSS 变量和组件风格
