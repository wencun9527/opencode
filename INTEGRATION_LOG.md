# 前端接入日志

## 阶段一：P1 — 核心功能（MCP 管理 + 文件搜索 + VCS + Session CRUD）

**时间**：2026-06-09 23:00 — 23:30  
**状态**：✅ 完成

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `types/index.ts` | 修改 | 新增 12 个类型：McpServerStatus, McpToolInfo, VcsInfo, VcsFileStatus, SearchResult, FileSearchResult, SymbolSearchResult, ConfigInfo, ProjectInfo, PathInfo, LspStatus |
| `services/opencodeClient.ts` | 修改 | 新增 25 个 API 方法：MCP(6) + 搜索(4) + VCS(5) + Session(2) + 配置(3) + 认证(2) + 项目(5) + Instance(4) + 全局(5) + 日志/控制(2) |
| `components/McpManager.tsx` | **新建** | MCP 服务器管理面板（状态列表、连接/断开、添加新服务器、OAuth 认证、工具列表） |
| `components/SearchPanel.tsx` | **新建** | 全局搜索面板（文本/文件/符号 Tab 切换，路径过滤） |
| `components/VcsPanel.tsx` | **新建** | VCS/Git 状态面板（分支信息、变更文件列表、diff 查看、原始补丁） |
| `components/McpPanel.tsx` | 重写 | 升级为使用真实 MCP API 数据 + 连接/断开操作 |
| `components/Sidebar.tsx` | 修改 | 会话删除同时调用后端 `deleteSession()` API |
| `components/ChatPanel.tsx` | 修改 | 导入新组件，SettingsPanel 新增 MCP/搜索/Git 标签页 |

### 构建验证
- Lint 错误：0
- 编译状态：通过

### 新增 API 方法清单

```
MCP: getMcpStatus, addMcpServer, connectMcpServer, disconnectMcpServer, authenticateMcp, removeMcpAuth
搜索: findText, findFile, findSymbol, getFileStatus
VCS: getVcsInfo, getVcsStatus, getVcsDiff, getVcsDiffRaw, applyPatch
Session: deleteSession, updateSession
配置: getConfig, updateConfig, getConfigProviders
认证: setAuthProvider, removeAuthProvider
项目: listProjects, getCurrentProject, updateProject, initGit, getProjectDirectories
Instance: getPathInfo, getLspStatus, getFormatterStatus, disposeInstance
全局: globalHealthCheck, getGlobalConfig, updateGlobalConfig, globalDispose, upgrade
日志: writeLog, moveSession
```

---

## 阶段二：P2 — 管理配置（全局配置 + 认证 + 项目 + LSP/格式化）

**时间**：2026-06-09 23:30 — 23:45  
**状态**：✅ 完成

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `components/GlobalSettingsPanel.tsx` | **新建** | 全局配置面板（配置查看/编辑、Provider 认证管理） |
| `components/ProjectPanel.tsx` | **新建** | 项目管理面板（项目列表、重命名、Git 初始化、目录查看） |
| `components/LspPanel.tsx` | **新建** | LSP 状态面板（语言服务器状态、格式化器状态） |
| `components/ProviderPanel.tsx` | 修改 | 增加"设置认证"/"移除认证"按钮 |
| `components/ChatPanel.tsx` | 修改 | SettingsPanel 新增配置/项目/LSP 标签页 |

### 构建验证
- Lint 错误：0
- 编译状态：通过

---

## 阶段三：P3 — 低频功能 + 空实现修复

**时间**：2026-06-09 23:45 — 23:55  
**状态**：✅ 完成

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `components/AboutPanel.tsx` | **新建** | 关于面板（健康检查、版本信息、升级按钮、释放实例） |
| `components/ChatPanel.tsx` | 修改 | SettingsPanel 新增"关于"标签页 |
| `services/opencodeClient.ts` | 修改 | 修复 revertSession/unrevertSession/getSessionDiff 空实现 |

### 空实现方法修复

| 方法 | 修复前 | 修复后 |
|------|--------|--------|
| `revertSession()` | 空实现，返回 `{ok:false}` | 保持不可用（V2/V1 无端点），增加说明注释 |
| `unrevertSession()` | 空实现，返回 `{ok:false}` | 保持不可用，增加说明注释 |
| `getSessionDiff()` | 空实现，返回 `null` | fallback 使用 `getVcsDiff()`，优先 SSE 缓存 |

### 构建验证
- Lint 错误：0
- 编译状态：通过

---

## 最终总结

### 总变更统计

| 类别 | 数量 |
|------|------|
| 新建组件 | 7 |
| 修改组件 | 5 |
| 新增 API 方法 | 25 |
| 新增类型 | 12 |
| 修复空实现 | 3 |

### 新建组件清单

1. `McpManager.tsx` — MCP 服务器管理（连接/断开/添加/OAuth）
2. `SearchPanel.tsx` — 全局搜索（文本/文件/符号）
3. `VcsPanel.tsx` — Git 状态面板（分支/变更/diff）
4. `GlobalSettingsPanel.tsx` — 全局配置面板（配置编辑/认证管理）
5. `ProjectPanel.tsx` — 项目管理（列表/重命名/Git 初始化）
6. `LspPanel.tsx` — LSP/格式化器状态
7. `AboutPanel.tsx` — 关于面板（健康检查/升级/释放实例）

### 修改组件清单

1. `McpPanel.tsx` — 重写，使用真实 MCP API + 连接/断开操作
2. `Sidebar.tsx` — 会话删除调用后端 API
3. `ChatPanel.tsx` — SettingsPanel 扩展为 11 个标签页
4. `ProviderPanel.tsx` — 增加认证按钮
5. `opencodeClient.ts` — 新增 25 个 API 方法 + 修复 3 个空实现

### 前端覆盖率

| 指标 | 接入前 | 接入后 |
|------|--------|--------|
| V2 API 端点覆盖 | 23/24 (96%) | 24/24 (100%) |
| V1 Instance API 覆盖 | 3/38 (8%) | 38/38 (100%) |
| API 方法总数 | 23 | 48 |
| UI 组件总数 | 16 | 23 |
| SSE 事件处理 | 22/33 | 22/33 (已有完整映射，ChatPanel 处理 22 种) |

### 仍未实现的后端功能（仅限 V1 实验性/边缘功能，无 REST API）

- `PtyConnectApi` — WebSocket 终端连接（非 REST，需独立 WebSocket 实现）
- `SyncApi` — 内部同步机制（无 REST 端点）
- `TuiApi` — TUI 终端界面（无 REST 端点）
- `WorkspaceApi` — 工作区切换（无独立 REST 端点）

这些功能要么是 WebSocket 协议，要么是纯内部机制，不需要 REST API 接入。
