# PVF AI Editor — 全量修复实施计划

> 角色：OpenCode 引擎开发总监 / Tauri v2 架构设计师  
> 日期：2026-06-09  
> 状态：执行中

---

## 问题全景（23项）

| 编号 | 分类 | 问题 | 严重度 |
|------|------|------|--------|
| A2 | 架构 | 每次发消息启动新进程，无会话复用 | ⭐⭐⭐⭐⭐ |
| S2 | 会话 | 无法继续历史会话（缺 --session/--continue） | ⭐⭐⭐⭐⭐ |
| E4 | 事件 | permission.asked 事件未处理，危险操作被自动拒绝 | ⭐⭐⭐⭐⭐ |
| E2 | 事件 | session.error 事件未映射，关键错误信息丢失 | ⭐⭐⭐⭐⭐ |
| P1 | PVF | 物品信息查看未暴露 | ⭐⭐⭐⭐⭐ |
| P2 | PVF | 物品代码查询未暴露 | ⭐⭐⭐⭐⭐ |
| S5 | 会话 | Revert/Unrevert 未实现 | ⭐⭐⭐⭐⭐ |
| S14 | 会话 | 消息历史无法从服务端加载 | ⭐⭐⭐⭐ |
| A4 | UI | 消息内容纯文本，无 Markdown 渲染 | ⭐⭐⭐⭐ |
| S4 | 会话 | 会话 Diff 未实现 | ⭐⭐⭐⭐ |
| P6 | PVF | 批量操作 UI 缺失 | ⭐⭐⭐⭐ |
| P9 | PVF | 字段编辑能力缺失（只读表格） | ⭐⭐⭐⭐ |
| S3 | 会话 | 无法真正中断 AI 执行 | ⭐⭐⭐⭐ |
| A1 | 架构 | Rust 层无 stderr 处理 | ⭐⭐⭐⭐ |
| A3 | 存储 | 所有状态仅内存，关闭即丢失 | ⭐⭐⭐⭐ |
| P4 | PVF | LST 文件浏览未暴露 | ⭐⭐⭐⭐ |
| E1 | 事件 | reasoning 事件未处理 | ⭐⭐⭐ |
| S6 | 会话 | Model/Agent 选择器缺失 | ⭐⭐⭐ |
| S9 | MCP | MCP 服务管理面板缺失 | ⭐⭐⭐ |
| P5 | PVF | 字符串表未暴露 | ⭐⭐⭐ |
| P7 | PVF | 封包路径未显示 | ⭐⭐⭐ |
| S8 | 会话 | 文件附件不支持 | ⭐⭐ |
| P3 | PVF | 文件图标显示缺失 | ⭐⭐ |

---

## 实施阶段

### 阶段 1：架构基础设施（Rust 后端重构）
**目标**：将 OpenCode 从"每次 run 启动进程"改为"持久化 server 模式"  
**依赖**：无  
**预计文件变更**：`lib.rs`, `Cargo.toml`

- [x] 1.1 新增 `opencode_server_start` 命令 — 启动 OpenCode 持久 server
- [x] 1.2 新增 `opencode_server_stop` 命令 — 优雅停止 server
- [x] 1.3 新增 `opencode_server_status` 命令 — 查询 server 运行状态
- [x] 1.4 新增 stderr 读取线程（A1）
- [x] 1.5 管理 server 进程生命周期（Child handle 存储）
- [x] 1.6 保留 `opencode_run` 作为 fallback

### 阶段 2：前端客户端统一 + 事件补全
**目标**：统一 Tauri/浏览器模式为 REST API，补全所有事件处理  
**依赖**：阶段 1  
**预计文件变更**：`opencodeClient.ts`, `types/index.ts`

- [x] 2.1 重构 `OpenCodeClient` — Tauri 模式改用 server REST API
- [x] 2.2 补全 `error` 事件映射（E2）
- [x] 2.3 补全 `reasoning` 事件映射（E1）
- [x] 2.4 补全 `tool_use` 事件映射（E3）
- [x] 2.5 补全 `message.updated` 事件映射（E5）
- [x] 2.6 新增 `permission.asked` 事件处理（E4）
- [x] 2.7 新增 SSEEvent 类型：`reasoning`, `permission`, `session_error`
- [x] 2.8 会话继续能力（S2）— 传递 sessionId 给 server
- [x] 2.9 会话中断能力（S3）— 调用 server abort API
- [x] 2.10 Model/Agent 选择参数（S6/S7）

### 阶段 3：状态持久化 + 会话管理
**目标**：会话数据持久化，支持历史恢复  
**依赖**：阶段 2  
**预计文件变更**：`useChatStore.ts`, `usePvfStore.ts`, 新增 `usePersistStore.ts`

- [x] 3.1 会话持久化到 localStorage（A3）
- [x] 3.2 从 OpenCode server 加载历史消息（S14）
- [x] 3.3 会话 Diff 展示（S4）
- [x] 3.4 会话 Revert/Unrevert（S5）
- [x] 3.5 封包路径显示（P7）

### 阶段 4：UI 组件升级
**目标**：Markdown 渲染、物品信息、字段编辑等核心 UI  
**依赖**：阶段 3  
**预计文件变更**：`ChatPanel.tsx`, `PvfEditor.tsx`, 新增组件

- [x] 4.1 Markdown 渲染（A4）— 安装 react-markdown
- [x] 4.2 物品信息面板（P1）— 调用 getItemInfo/getItemInfosBatch
- [x] 4.3 物品代码查询面板（P2）— 调用 itemCodeToFileInfo
- [x] 4.4 LST 文件浏览器（P4）— 调用 getAllLstFileList/getLstFileInfo
- [x] 4.5 字段编辑器（P9）— 可编辑表格
- [x] 4.6 批量操作 UI（P6）— 批量查看/导入/删除
- [x] 4.7 Permission 审批 UI（E4 配套）
- [x] 4.8 Reasoning 展示折叠区（E1 配套）

### 阶段 5：增强功能
**目标**：Model 选择器、MCP 面板等增强  
**依赖**：阶段 4  
**预计文件变更**：新增组件

- [x] 5.1 Model/Agent 选择器（S6/S7）
- [x] 5.2 MCP 服务状态面板（S9）
- [x] 5.3 字符串表查看器（P5）
- [x] 5.4 文件图标显示（P3）

### 阶段 6：验证与收尾
**目标**：全链路测试、代码审查、文档更新  
**依赖**：阶段 5

- [ ] 6.1 编译验证
- [ ] 6.2 类型检查
- [ ] 6.3 功能回归测试
- [ ] 6.4 更新 AGENTS.md

---

## 关键架构决策

### 决策 1：Server 模式 vs Run 模式
**选择**：Server 模式为主，Run 模式为 fallback  
**理由**：Server 模式支持会话复用、权限审批、历史加载等所有功能；Run 模式仅在 server 启动失败时降级使用

### 决策 2：Tauri 模式通信方式
**选择**：统一使用 REST API（与浏览器模式一致）  
**理由**：消除两套代码路径，降低维护成本；REST API 已是 OpenCode 的正式接口

### 决策 3：持久化方案
**选择**：localStorage + Zustand persist middleware  
**理由**：轻量、同步、无需额外依赖；后续可升级到 IndexedDB
