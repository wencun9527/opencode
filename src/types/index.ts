// ==================== 消息相关类型 ====================

/** 聊天消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 工具调用状态 */
export type ToolCallStatus = 'running' | 'completed' | 'error' | 'pending_approval';

/** 工具调用 */
export interface ToolCall {
  /** 工具调用唯一ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具调用参数 */
  arguments: Record<string, unknown>;
  /** 调用结果 */
  result?: unknown;
  /** 调用状态 */
  status: ToolCallStatus;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
}

/** 聊天消息 */
export interface Message {
  /** 消息唯一ID */
  id: string;
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 关联的工具调用列表 */
  toolCalls?: ToolCall[];
  /** 创建时间戳 */
  createdAt: number;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** AI 推理过程（reasoning） */
  reasoning?: string;
}

// ==================== 会话相关类型 ====================

/** 会话 */
export interface Session {
  /** 会话唯一ID */
  id: string;
  /** OpenCode 服务端会话ID */
  serverSessionId?: string;
  /** 会话标题 */
  title: string;
  /** 消息列表 */
  messages: Message[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 使用的模型 */
  model?: string;
  /** 使用的 Agent */
  agentName?: string;
}

// ==================== Agent 相关类型 ====================

/** Agent 状态 */
export type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'responding' | 'error' | 'awaiting_permission' | 'awaiting_question' | 'compacting' | 'shell_executing';

/** Agent 信息 */
export interface AgentInfo {
  /** Agent 名称 */
  name: string;
  /** Agent 状态 */
  status: AgentStatus;
  /** 当前正在执行的操作描述 */
  currentAction?: string;
  /** 当前模型 */
  model?: string;
  /** 已使用的 Token 数量 */
  tokenUsed?: number;
  /** Token 总量上限 */
  tokenTotal?: number;
}

// ==================== PVF 相关类型 ====================

/** PVF 连接状态 */
export type PvfConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** PVF 文件项 */
export interface PvfItem {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件大小（字节） */
  size: number;
  /** 修改时间 */
  modifiedAt?: number;
  /** 文件图标 Base64 */
  icon?: string;
}

/** PVF 编辑状态 */
export interface PvfEditState {
  /** 当前打开的文件路径 */
  currentFile: string | null;
  /** 文件内容（解析后的数据） */
  fileData: Record<string, unknown> | null;
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 最后保存时间 */
  lastSavedAt?: number;
}

/** PVF 封包信息 */
export interface PvfPackInfo {
  /** 封包文件路径 */
  filePath: string | null;
  /** PVFut 版本 */
  version: string | null;
}

// ==================== 主题相关类型 ====================

/** 主题模式 */
export type ThemeMode = 'light' | 'dark';

// ==================== SSE 相关类型 ====================

/** SSE 事件类型（扩展 — 对齐后端 V2 事件） */
export type SSEEventType =
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'tool_progress'
  | 'tool_input_started'
  | 'tool_input_delta'
  | 'tool_input_ended'
  | 'error'
  | 'done'
  | 'reasoning'
  | 'reasoning_started'
  | 'reasoning_ended'
  | 'text_started'
  | 'text_ended'
  | 'permission'
  | 'question'
  | 'session_error'
  | 'session_diff'
  | 'session_revert'
  | 'step_started'
  | 'step_ended'
  | 'step_failed'
  | 'agent_switched'
  | 'model_switched'
  | 'retried'
  | 'compaction_started'
  | 'compaction_delta'
  | 'compaction_ended'
  | 'shell_started'
  | 'shell_ended'
  | 'prompted'
  | 'prompt_admitted'
  | 'prompt_promoted'
  | 'context_updated'
  | 'synthetic'
  | 'session_moved';

/** SSE 事件数据 */
export interface SSEEvent {
  /** 事件类型 */
  type: SSEEventType;
  /** 事件数据 */
  data: unknown;
}

// ==================== Permission 相关类型 ====================

/** 权限请求 */
export interface PermissionRequest {
  /** 请求ID */
  id: string;
  /** 会话ID */
  sessionID?: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
  /** 权限描述 */
  description?: string;
}

// ==================== Question 相关类型 ====================

/** 问答请求 */
export interface QuestionRequest {
  /** 请求ID */
  id: string;
  /** 会话ID */
  sessionID: string;
  /** 问题内容 */
  question: string;
  /** 选项列表 */
  options?: string[];
  /** 是否多选 */
  multiSelect?: boolean;
}

// ==================== OpenCode Server 相关类型 ====================

/** OpenCode Server 状态 */
export interface ServerStatus {
  /** 是否已连接 */
  connected: boolean;
  /** 服务端口 */
  port: number | null;
  /** 服务URL */
  url: string | null;
}

/** 模型信息 */
export interface ModelInfo {
  /** 模型ID */
  id: string;
  /** 模型名称 */
  name: string;
  /** 提供商 */
  provider?: string;
}

// ==================== MCP 相关类型 ====================

/** MCP 服务器状态 */
export interface McpServerStatus {
  /** 服务器名称 */
  name: string;
  /** 连接状态 */
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** 可用工具列表 */
  tools?: McpToolInfo[];
  /** 描述 */
  description?: string;
  /** 错误信息 */
  error?: string;
}

/** MCP 工具信息 */
export interface McpToolInfo {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description?: string;
  /** 输入 Schema */
  inputSchema?: Record<string, unknown>;
}

// ==================== VCS 相关类型 ====================

/** VCS 信息 */
export interface VcsInfo {
  /** 当前分支 */
  branch: string;
  /** 远程仓库 */
  remote?: string;
  /** 是否有未提交变更 */
  dirty: boolean;
}

/** VCS 文件状态 */
export interface VcsFileStatus {
  /** 文件路径 */
  path: string;
  /** 变更状态 */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  /** 是否已暂存 */
  staged: boolean;
}

// ==================== 搜索相关类型 ====================

/** 文本搜索结果 */
export interface SearchResult {
  /** 文件路径 */
  file: string;
  /** 行号 */
  line: number;
  /** 列号 */
  column: number;
  /** 匹配文本 */
  text: string;
  /** 匹配长度 */
  matchLength: number;
}

/** 文件搜索结果 */
export interface FileSearchResult {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 类型 */
  type: 'file' | 'directory';
}

/** 符号搜索结果 */
export interface SymbolSearchResult {
  /** 符号名称 */
  name: string;
  /** 符号类型 */
  kind: string;
  /** 文件路径 */
  path: string;
  /** 行号 */
  line: number;
}

// ==================== 配置相关类型 ====================

/** 配置信息 */
export interface ConfigInfo {
  /** 配置键值 */
  [key: string]: unknown;
}

// ==================== 项目相关类型 ====================

/** 项目信息 */
export interface ProjectInfo {
  /** 项目ID */
  id: string;
  /** 项目名称 */
  name: string;
  /** 项目路径 */
  path: string;
  /** 项目图标 */
  icon?: string;
  /** 项目命令 */
  command?: string;
}

// ==================== 路径/LSP 相关类型 ====================

/** 路径信息 */
export interface PathInfo {
  /** 用户目录 */
  home: string;
  /** 状态目录 */
  state: string;
  /** 配置目录 */
  config: string;
  /** Worktree 目录 */
  worktree: string;
  /** 工作目录 */
  directory: string;
}

/** LSP 服务器状态 */
export interface LspStatus {
  /** 服务器名称 */
  name: string;
  /** 运行状态 */
  status: 'running' | 'stopped' | 'error';
  /** 语言ID */
  languageId: string;
}

// ==================== LST 相关类型 ====================

/** LST 文件条目 */
export interface LstFileEntry {
  /** 文件路径 */
  path: string;
  /** LST 名称 */
  lstName: string;
  /** 条目数量 */
  entryCount?: number;
}

// ==================== 物品相关类型 ====================

/** 物品信息 */
export interface ItemInfo {
  /** 物品代码 */
  itemCode: number;
  /** 物品名称 */
  itemName: string;
  /** 文件路径 */
  filePath: string;
  /** 额外属性 */
  extra?: Record<string, unknown>;
}
