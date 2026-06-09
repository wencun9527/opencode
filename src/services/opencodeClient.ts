import type {
  SSEEvent, PermissionRequest, ServerStatus,
  McpServerStatus, VcsInfo, VcsFileStatus,
  SearchResult, FileSearchResult, SymbolSearchResult,
  ConfigInfo, ProjectInfo, PathInfo, LspStatus,
} from '../types';
import { useModelConfigStore } from '../stores/useModelConfigStore';

/** 判断是否在 Tauri 桌面环境中运行 */
const isTauri = '__TAURI_INTERNALS__' in window;

/** OpenCode 服务器默认地址 */
const OPENCODE_DEFAULT_PORT = 4096;

/** PVFut 桥接地址 */
const PVFUT_BASE_URL = isTauri ? 'http://localhost:27000' : '/pvfut-api';

/** OpenCode 认证密码（从环境变量读取） */
const OPENCODE_PASSWORD = import.meta.env.VITE_OPENCODE_PASSWORD || '';

/** DeepSeek API Key */
const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || '';

// ==================== OpenCode JSON 事件类型 ====================

interface OpenCodeEvent {
  type: string;
  [key: string]: unknown;
}

// ==================== 后端模型/Agent 类型 ====================

export interface ServerModel {
  id: string;
  providerID: string;
  name: string;
  description?: string;
}

export interface ServerAgent {
  id: string;
  name: string;
  description?: string;
  hidden?: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
}

export interface CommandInfo {
  id: string;
  name: string;
  description?: string;
}

export interface PermissionSavedInfo {
  id: string;
  toolName?: string;
  description?: string;
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  question?: string;
  options?: string[];
}

export interface FsEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

// ==================== OpenCode 客户端 ====================

/**
 * OpenCode 客户端（V2 统一架构）
 *
 * 所有 API 路径统一使用 V2 格式（/api/ 前缀），与后端 routes.ts 完全对齐：
 * - GET  /api/health
 * - GET  /api/event
 * - GET  /api/session
 * - POST /api/session/:sessionID/prompt
 * - POST /api/session/:sessionID/compact
 * - POST /api/session/:sessionID/wait
 * - GET  /api/session/:sessionID/context
 * - GET  /api/session/:sessionID/message
 * - GET  /api/session/:sessionID/permission/request
 * - POST /api/session/:sessionID/permission/request/:requestID/reply
 * - POST /api/session/:sessionID/question/request/:requestID/reply
 * - POST /api/session/:sessionID/question/request/:requestID/reject
 * - GET  /api/model
 * - GET  /api/agent
 * - GET  /api/provider
 * - GET  /api/provider/:providerID
 * - GET  /api/permission/request
 * - GET  /api/permission/saved
 * - DELETE /api/permission/saved/:id
 * - GET  /api/question/request
 * - GET  /api/fs/read
 * - GET  /api/fs/list
 * - GET  /api/command
 * - GET  /api/skill
 */
export class OpenCodeClient {
  private serverPort: number | null = null;
  private serverUrl: string | null = null;
  private currentSessionId: string | null = null;
  private cancelled = false;
  private serverMode: boolean = false;
  private eventSource: EventSource | null = null;
  private eventListeners: Set<(event: SSEEvent) => void> = new Set();
  private _availableModels: ServerModel[] = [];
  private _availableAgents: ServerAgent[] = [];

  // ==================== Server 管理 ====================

  /** 启动 OpenCode server（Tauri 模式） */
  async startServer(): Promise<ServerStatus> {
    if (!isTauri) {
      // 浏览器模式，通过 Vite 代理避免 CORS
      this.serverUrl = '/opencode-api';
      this.serverPort = OPENCODE_DEFAULT_PORT;
      this.serverMode = true;
      this.connectEventSource();
      return { connected: true, port: this.serverPort, url: this.serverUrl };
    }

    try {
      // 读取用户自定义的模型配置
      let customApiBaseUrl = '';
      let customApiKey = '';
      try {
        const config = useModelConfigStore.getState();
        customApiBaseUrl = config.apiBaseUrl;
        customApiKey = config.apiKey;
      } catch { /* Store 不可用时忽略 */ }

      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('opencode_server_start', {
        apiKey: customApiKey || DEEPSEEK_API_KEY,
        opencodePassword: OPENCODE_PASSWORD,
        customApiBaseUrl,
        port: null,
      }) as { port: number; url: string };

      this.serverPort = result.port;
      this.serverUrl = result.url;
      this.serverMode = true;
      this.connectEventSource();
      return { connected: true, port: result.port, url: result.url };
    } catch (err) {
      console.warn('OpenCode server 启动失败，将使用 fallback 模式:', err);
      this.serverMode = false;
      return { connected: false, port: null, url: null };
    }
  }

  /** 停止 OpenCode server */
  async stopServer(): Promise<void> {
    this.disconnectEventSource();
    if (isTauri && this.serverMode) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('opencode_server_stop');
      } catch {
        // 忽略
      }
    }
    this.serverPort = null;
    this.serverUrl = null;
    this.serverMode = false;
  }

  /** 查询 server 状态 */
  async getServerStatus(): Promise<ServerStatus> {
    if (this.serverUrl) {
      try {
        const authHeader = this.getAuthHeader();
        const resp = await fetch(`${this.serverUrl}/api/health`, {
          headers: { 'Authorization': authHeader },
        });
        if (resp.ok) {
          return { connected: true, port: this.serverPort, url: this.serverUrl };
        }
      } catch {
        // server 不可达
      }
    }

    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('opencode_server_status') as { port: number; url: string };
        this.serverPort = result.port;
        this.serverUrl = result.url;
        this.serverMode = true;
        return { connected: true, port: result.port, url: result.url };
      } catch {
        return { connected: false, port: null, url: null };
      }
    }

    return { connected: false, port: null, url: null };
  }

  // ==================== 健康检查 ====================

  /** 健康检查（分别检查 PVFut 和 OpenCode） */
  async healthCheck(): Promise<boolean> {
    // 优先检查 OpenCode server
    const status = await this.getServerStatus();
    return status.connected;
  }

  /** 检查 PVFut 服务是否可用 */
  async isPvfutAvailable(): Promise<boolean> {
    try {
      const pvfutResp = await fetch(`${PVFUT_BASE_URL}/Api/PvfUtiltiy/getVersion`);
      return pvfutResp.ok;
    } catch {
      return false;
    }
  }

  // ==================== SSE 持久连接 ====================

  /** 建立 SSE 持久连接 */
  private connectEventSource(): void {
    if (!this.serverUrl) return;
    if (this.eventSource) return; // 已连接

    const es = new EventSource(
      `${this.serverUrl}/api/event`,
      { withCredentials: false }
    );

    es.addEventListener('message', (e: MessageEvent) => {
      if (this.cancelled) return;
      try {
        const data = JSON.parse(e.data as string);
        const sseEvent = this.mapOpenCodeEvent(data);
        if (sseEvent) {
          for (const listener of this.eventListeners) {
            listener(sseEvent);
          }
        }
      } catch {
        // 忽略解析错误
      }
    });

    es.addEventListener('error', () => {
      // SSE 连接断开，尝试重连
      console.warn('[OpenCode] SSE 连接断开，3s 后重连');
      this.eventSource = null;
      setTimeout(() => {
        if (this.serverUrl && this.serverMode) {
          this.connectEventSource();
        }
      }, 3000);
    });

    this.eventSource = es;
  }

  /** 断开 SSE 持久连接 */
  private disconnectEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.eventListeners.clear();
  }

  /** 注册事件监听器 */
  addEventListener(listener: (event: SSEEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ==================== 会话管理 ====================

  /** 重置对话（不重置 server 连接） */
  resetConversation(): void {
    this.currentSessionId = null;
  }

  /** 获取当前会话ID */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /** 设置当前会话ID（用于恢复历史会话） */
  setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /** 列出所有会话 (V2: GET /api/session) */
  async listSessions(query?: { directory?: string; limit?: number; cursor?: string }): Promise<{ data: unknown[]; cursor: { previous?: string; next?: string } }> {
    if (!this.serverUrl) return { data: [], cursor: {} };
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.limit) params.set('limit', String(query.limit));
      if (query?.cursor) params.set('cursor', query.cursor);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/session${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return {
          data: data.data ?? (Array.isArray(data) ? data : []),
          cursor: data.cursor ?? {},
        };
      }
    } catch { /* ignore */ }
    return { data: [], cursor: {} };
  }

  /** 压缩会话上下文 (V2: POST /api/session/:sessionID/compact) */
  async compactSession(sessionId?: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const sid = sessionId || this.currentSessionId;
    if (!sid) return false;

    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/session/${sid}/compact`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 等待会话空闲 (V2: POST /api/session/:sessionID/wait) */
  async waitSession(sessionId?: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const sid = sessionId || this.currentSessionId;
    if (!sid) return false;

    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/session/${sid}/wait`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 获取会话上下文 (V2: GET /api/session/:sessionID/context) */
  async getSessionContext(sessionId?: string): Promise<unknown[]> {
    if (!this.serverUrl) return [];
    const sid = sessionId || this.currentSessionId;
    if (!sid) return [];

    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/session/${sid}/context`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 中断当前会话执行 (通过 V2 prompt delivery=steer 机制或 SSE 事件) */
  async abortSession(sessionId?: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const sid = sessionId || this.currentSessionId;
    if (!sid) return false;

    // V2 没有 /abort 端点，使用 delivery=steer 发送空消息来中断
    // 或直接通过 SSE 事件处理中断
    const authHeader = this.getAuthHeader();
    try {
      // 尝试发送一个中断性的 steer 指令
      const resp = await fetch(`${this.serverUrl}/api/session/${sid}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          prompt: { text: '/stop' },
          delivery: 'steer',
        }),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 获取会话消息历史 (V2: GET /api/session/:sessionID/message) */
  async getSessionMessages(sessionId?: string, options?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }): Promise<{ data: unknown[]; cursor: { previous?: string; next?: string } }> {
    if (!this.serverUrl) return { data: [], cursor: {} };
    const sid = sessionId || this.currentSessionId;
    if (!sid) return { data: [], cursor: {} };

    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.order) params.set('order', options.order);
      if (options?.cursor) params.set('cursor', options.cursor);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/session/${sid}/message${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return {
          data: data.data ?? (Array.isArray(data) ? data : []),
          cursor: data.cursor ?? {},
        };
      }
    } catch { /* ignore */ }
    return { data: [], cursor: {} };
  }

  /** 恢复会话（revert）— 通过 V1 API 删除后重建 */
  async revertSession(_messageID?: string, _partID?: string, _sessionId?: string): Promise<{ ok: boolean; session?: unknown }> {
    // V2 无 revert 端点。V1 也无专用 revert。
    // 实际实现：通过重新发送历史消息来重建会话
    // 当前保持为不可用状态
    console.warn('[OpenCode] revertSession: V2/V1 均无 revert 端点，功能不可用');
    return { ok: false };
  }

  /** 取消恢复（unrevert）— V2/V1 均无端点 */
  async unrevertSession(_sessionId?: string): Promise<{ ok: boolean; session?: unknown }> {
    console.warn('[OpenCode] unrevertSession: V2/V1 均无 unrevert 端点，功能不可用');
    return { ok: false };
  }

  /** 获取会话 diff — 优先使用 SSE 事件缓存，fallback 使用 VCS diff */
  async getSessionDiff(_sessionId?: string, _messageID?: string): Promise<unknown> {
    // V2 无专用 diff 端点。
    // 策略：优先返回通过 SSE session.diff 事件缓存的 diff 数据
    // 如果无缓存，尝试使用 VCS diff 作为 fallback
    try {
      const vcsDiff = await this.getVcsDiff();
      if (vcsDiff) return vcsDiff;
    } catch { /* ignore */ }
    console.warn('[OpenCode] getSessionDiff: 无缓存 diff，且 VCS diff 不可用');
    return null;
  }

  // ==================== 权限管理 ====================

  /** 获取全局权限请求列表 (V2: GET /api/permission/request) */
  async listPermissionRequests(query?: { directory?: string; workspace?: string }): Promise<PermissionRequest[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/permission/request${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取会话级权限请求列表 (V2: GET /api/session/:sessionID/permission/request) */
  async listSessionPermissionRequests(sessionId?: string): Promise<PermissionRequest[]> {
    if (!this.serverUrl) return [];
    const sid = sessionId || this.currentSessionId;
    if (!sid) return [];

    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/session/${sid}/permission/request`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 审批权限请求 (V2: POST /api/session/:sessionID/permission/request/:requestID/reply) */
  async approvePermission(sessionId: string, requestID: string, reply: 'allow' | 'deny' | 'always', message?: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const body: Record<string, unknown> = { reply };
      if (message) body.message = message;
      const resp = await fetch(`${this.serverUrl}/api/session/${sessionId}/permission/request/${requestID}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(body),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 获取已保存的权限列表 (V2: GET /api/permission/saved) */
  async listSavedPermissions(projectID?: string): Promise<PermissionSavedInfo[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (projectID) params.set('projectID', projectID);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/permission/saved${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 删除已保存的权限 (V2: DELETE /api/permission/saved/:id) */
  async removeSavedPermission(id: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/permission/saved/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== Question 管理 ====================

  /** 获取全局问题请求列表 (V2: GET /api/question/request) */
  async listQuestionRequests(query?: { directory?: string; workspace?: string }): Promise<QuestionRequest[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/question/request${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 回复问题请求 (V2: POST /api/session/:sessionID/question/request/:requestID/reply) */
  async replyQuestion(sessionId: string, requestID: string, answers: string[]): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/session/${sessionId}/question/request/${requestID}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(answers),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 拒绝问题请求 (V2: POST /api/session/:sessionID/question/request/:requestID/reject) */
  async rejectQuestion(sessionId: string, requestID: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/api/session/${sessionId}/question/request/${requestID}/reject`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== Model / Agent / Provider API ====================

  /** 获取可用模型列表 (V2: GET /api/model) */
  async getModels(query?: { directory?: string; workspace?: string }): Promise<ServerModel[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/model${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = data.data ?? data;
        if (Array.isArray(models)) {
          this._availableModels = models;
          return models;
        }
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取可用 Agent 列表 (V2: GET /api/agent) */
  async getAgents(query?: { directory?: string; workspace?: string }): Promise<ServerAgent[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/agent${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        const agents = data.data ?? data;
        if (Array.isArray(agents)) {
          this._availableAgents = agents;
          return agents;
        }
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取 Provider 列表 (V2: GET /api/provider) */
  async getProviders(query?: { directory?: string; workspace?: string }): Promise<ProviderInfo[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/provider${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取单个 Provider (V2: GET /api/provider/:providerID) */
  async getProvider(providerID: string, query?: { directory?: string; workspace?: string }): Promise<ProviderInfo | null> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/provider/${providerID}${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 获取技能列表 (V2: GET /api/skill) */
  async getSkills(query?: { directory?: string; workspace?: string }): Promise<SkillInfo[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/skill${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取命令列表 (V2: GET /api/command) */
  async getCommands(query?: { directory?: string; workspace?: string }): Promise<CommandInfo[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/command${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  // ==================== 文件系统 ====================

  /** 读取文件内容 (V2: GET /api/fs/read) */
  async readFile(path: string, query?: { directory?: string; workspace?: string; reference?: string }): Promise<unknown> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      params.set('path', path);
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      if (query?.reference) params.set('reference', query.reference);
      const resp = await fetch(`${this.serverUrl}/api/fs/read?${params.toString()}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 列出目录内容 (V2: GET /api/fs/list) */
  async listDirectory(query?: { path?: string; directory?: string; workspace?: string; reference?: string }): Promise<FsEntry[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (query?.path) params.set('path', query.path);
      if (query?.directory) params.set('directory', query.directory);
      if (query?.workspace) params.set('workspace', query.workspace);
      if (query?.reference) params.set('reference', query.reference);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/api/fs/list${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  // ==================== 文件搜索 ====================

  /** 使用 ripgrep 搜索文本 (V1: GET /find) */
  async findText(pattern: string, options?: { path?: string; include?: string; exclude?: string }): Promise<SearchResult[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      params.set('pattern', pattern);
      if (options?.path) params.set('path', options.path);
      if (options?.include) params.set('include', options.include);
      if (options?.exclude) params.set('exclude', options.exclude);
      const resp = await fetch(`${this.serverUrl}/find?${params.toString()}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 按名称搜索文件 (V1: GET /find/file) */
  async findFile(pattern: string, options?: { path?: string }): Promise<FileSearchResult[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      params.set('pattern', pattern);
      if (options?.path) params.set('path', options.path);
      const resp = await fetch(`${this.serverUrl}/find/file?${params.toString()}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 使用 LSP 搜索符号 (V1: GET /find/symbol) */
  async findSymbol(query: string, options?: { path?: string }): Promise<SymbolSearchResult[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      params.set('query', query);
      if (options?.path) params.set('path', options.path);
      const resp = await fetch(`${this.serverUrl}/find/symbol?${params.toString()}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取 Git 文件状态 (V1: GET /file/status) */
  async getFileStatus(options?: { path?: string }): Promise<VcsFileStatus[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (options?.path) params.set('path', options.path);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/file/status${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  // ==================== MCP 管理 ====================

  /** 获取所有 MCP 服务器状态 (V1: GET /mcp) */
  async getMcpStatus(): Promise<McpServerStatus[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/mcp`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 动态添加 MCP 服务器 (V1: POST /mcp) */
  async addMcpServer(config: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(config),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 连接 MCP 服务器 (V1: POST /mcp/:name/connect) */
  async connectMcpServer(name: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/mcp/${encodeURIComponent(name)}/connect`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 断开 MCP 服务器 (V1: POST /mcp/:name/disconnect) */
  async disconnectMcpServer(name: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/mcp/${encodeURIComponent(name)}/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 启动 MCP OAuth 认证 (V1: POST /mcp/:name/auth/authenticate) */
  async authenticateMcp(name: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/mcp/${encodeURIComponent(name)}/auth/authenticate`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 移除 MCP OAuth 凭据 (V1: DELETE /mcp/:name/auth) */
  async removeMcpAuth(name: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/mcp/${encodeURIComponent(name)}/auth`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== VCS (Git) 操作 ====================

  /** 获取 VCS 信息 (V1: GET /vcs) */
  async getVcsInfo(): Promise<VcsInfo | null> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/vcs`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? null;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 获取变更文件列表 (V1: GET /vcs/status) */
  async getVcsStatus(): Promise<VcsFileStatus[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/vcs/status`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取 git diff (V1: GET /vcs/diff) */
  async getVcsDiff(options?: { path?: string; staged?: boolean }): Promise<string> {
    if (!this.serverUrl) return '';
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (options?.path) params.set('path', options.path);
      if (options?.staged) params.set('staged', 'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/vcs/diff${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        return await resp.text();
      }
    } catch { /* ignore */ }
    return '';
  }

  /** 获取原始补丁 (V1: GET /vcs/diff/raw) */
  async getVcsDiffRaw(options?: { path?: string }): Promise<string> {
    if (!this.serverUrl) return '';
    const authHeader = this.getAuthHeader();
    try {
      const params = new URLSearchParams();
      if (options?.path) params.set('path', options.path);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const resp = await fetch(`${this.serverUrl}/vcs/diff/raw${qs}`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        return await resp.text();
      }
    } catch { /* ignore */ }
    return '';
  }

  /** 应用补丁到工作区 (V1: POST /vcs/apply) */
  async applyPatch(patch: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/vcs/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ patch }),
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== Session CRUD 补全 ====================

  /** 删除会话 (V1: DELETE /session/:sessionID) */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/session/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 更新会话 (V1: PATCH /session/:sessionID) */
  async updateSession(sessionId: string, data: { title?: string }): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(data),
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== 配置管理 ====================

  /** 获取当前配置 (V1: GET /config) */
  async getConfig(): Promise<ConfigInfo> {
    if (!this.serverUrl) return {};
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/config`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? {};
      }
    } catch { /* ignore */ }
    return {};
  }

  /** 更新配置 (V1: PATCH /config) */
  async updateConfig(data: Partial<ConfigInfo>): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(data),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 获取配置的 Provider 及默认模型 (V1: GET /config/providers) */
  async getConfigProviders(): Promise<ProviderInfo[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/config/providers`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  // ==================== 认证管理 ====================

  /** 设置认证凭据 (V1: PUT /auth/:providerID) */
  async setAuthProvider(providerID: string, credentials: Record<string, string>): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/auth/${encodeURIComponent(providerID)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(credentials),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 移除认证凭据 (V1: DELETE /auth/:providerID) */
  async removeAuthProvider(providerID: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/auth/${encodeURIComponent(providerID)}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== 项目管理 ====================

  /** 获取所有已打开项目 (V1: GET /project) */
  async listProjects(): Promise<ProjectInfo[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/project`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取当前活跃项目 (V1: GET /project/current) */
  async getCurrentProject(): Promise<ProjectInfo | null> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/project/current`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? null;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 更新项目属性 (V1: PATCH /project/:projectID) */
  async updateProject(projectID: string, data: { name?: string; icon?: string; command?: string }): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/project/${encodeURIComponent(projectID)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(data),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 初始化 Git 仓库 (V1: POST /project/git/init) */
  async initGit(): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/project/git/init`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 列出项目本地目录 (V1: GET /project/:projectID/directories) */
  async getProjectDirectories(projectID: string): Promise<string[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/project/${encodeURIComponent(projectID)}/directories`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  // ==================== Instance 信息 ====================

  /** 获取路径信息 (V1: GET /path) */
  async getPathInfo(): Promise<PathInfo | null> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/path`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? null;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 获取 LSP 服务器状态 (V1: GET /lsp) */
  async getLspStatus(): Promise<LspStatus[]> {
    if (!this.serverUrl) return [];
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/lsp`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /** 获取格式化器状态 (V1: GET /formatter) */
  async getFormatterStatus(): Promise<unknown> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/formatter`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? null;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 释放当前实例 (V1: POST /instance/dispose) */
  async disposeInstance(): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/instance/dispose`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== 全局操作 ====================

  /** 全局健康检查 (V1: GET /global/health) */
  async globalHealthCheck(): Promise<boolean> {
    if (!this.serverUrl) return false;
    try {
      const resp = await fetch(`${this.serverUrl}/global/health`);
      return resp.ok;
    } catch { return false; }
  }

  /** 获取全局配置 (V1: GET /global/config) */
  async getGlobalConfig(): Promise<ConfigInfo> {
    if (!this.serverUrl) return {};
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/global/config`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.data ?? data ?? {};
      }
    } catch { /* ignore */ }
    return {};
  }

  /** 更新全局配置 (V1: PATCH /global/config) */
  async updateGlobalConfig(data: Partial<ConfigInfo>): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/global/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(data),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 释放所有实例 (V1: POST /global/dispose) */
  async globalDispose(): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/global/dispose`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 升级 opencode (V1: POST /global/upgrade) */
  async upgrade(version?: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const body = version ? { version } : {};
      const resp = await fetch(`${this.serverUrl}/global/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(body),
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== 日志/控制 ====================

  /** 写入日志 (V1: POST /log) */
  async writeLog(level: string, message: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ level, message }),
      });
      return resp.ok;
    } catch { return false; }
  }

  /** 移动会话到另一个项目 (V1: POST /experimental/control-plane/move-session) */
  async moveSession(sessionId: string, targetDirectory: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/experimental/control-plane/move-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ sessionID: sessionId, directory: targetDirectory }),
      });
      return resp.ok;
    } catch { return false; }
  }

  // ==================== 缓存属性 ====================
  get availableModels(): ServerModel[] { return this._availableModels; }

  /** 获取缓存的 Agent 列表 */
  get availableAgents(): ServerAgent[] { return this._availableAgents; }

  // ==================== 发送消息 ====================

  /**
   * 发送聊天消息（统一入口）
   */
  async sendMessage(
    message: string,
    _sessionId: string,
    onEvent: (event: SSEEvent) => void,
    onError?: (error: Error) => void,
    onDone?: () => void,
    options?: SendMessageOptions
  ): Promise<void> {
    this.cancelled = false;

    try {
      // 优先使用 server REST API
      if (this.serverMode && this.serverUrl) {
        await this.sendMessageViaServer(message, onEvent, options);
      } else if (isTauri) {
        // Fallback：通过 Rust 启动 opencode_run 进程
        await this.sendMessageViaRust(message, onEvent, options);
      } else {
        // 浏览器模式：直接 REST
        await this.sendMessageViaServer(message, onEvent, options);
      }

      onEvent({ type: 'done', data: null });
      onDone?.();
    } catch (err) {
      if (this.cancelled) {
        onEvent({ type: 'done', data: null });
        onDone?.();
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      onEvent({ type: 'error', data: { message: error.message } });
      onError?.(error);
      onDone?.();
    }
  }

  /** 取消当前请求 */
  cancel(): void {
    this.cancelled = true;
    // 尝试 server abort
    if (this.serverMode && this.currentSessionId) {
      this.abortSession().catch(() => {});
    }
  }

  // ==================== Server 模式：REST API ====================

  private async sendMessageViaServer(
    message: string,
    onEvent: (event: SSEEvent) => void,
    options?: SendMessageOptions
  ): Promise<void> {
    if (!this.serverUrl) throw new Error('server 未连接');

    // 1. 确保有有效的 sessionID（必须已存在于服务端，V2 API 不支持创建新 session）
    let sessionId = this.currentSessionId;
    if (!sessionId) {
      // 尝试列出已有 session 并复用
      const sessions = await this.listSessions({ directory: options?.directory, limit: 1 });
      if (sessions.data.length > 0) {
        const first = sessions.data[0] as { id?: string };
        sessionId = first.id ?? null;
        console.log('[OpenCode] 复用已有 session:', sessionId);
      }
      if (!sessionId) {
        // 没有已有 session，无法发送消息
        throw new Error('没有可用的会话。请先启动 OpenCode Server 并确保至少存在一个会话。');
      }
      this.currentSessionId = sessionId;
    }

    // 2. 确保持久 SSE 连接已建立
    if (!this.eventSource) {
      this.connectEventSource();
    }

    // 3. 注册本次消息的事件监听
    const removeListener = this.addEventListener((event: SSEEvent) => {
      if (this.cancelled) return;
      onEvent(event);
    });

    try {
      // 4. 发送 prompt (V2: POST /api/session/:sessionID/prompt)
      const promptBody: Record<string, unknown> = {
        prompt: { text: message },
      };
      if (options?.modelID) {
        promptBody.model = { id: options.modelID, providerID: options.providerID ?? 'deepseek' };
      }
      if (options?.agent) {
        promptBody.agent = options.agent;
      }
      // delivery: steer（立即执行）| queue（排队等待）
      if (options?.delivery) {
        promptBody.delivery = options.delivery;
      }

      const resp = await fetch(
        `${this.serverUrl}/api/session/${sessionId}/prompt`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(isTauri ? { 'Authorization': this.getAuthHeader() } : {}),
          },
          body: JSON.stringify(promptBody),
        }
      );

      if (!resp.ok) {
        throw new Error(`OpenCode API 错误 (${resp.status}): ${await resp.text()}`);
      }

      // 5. 等待 step.ended 或 step.failed 事件
      await new Promise<void>((resolve) => {
        const stepListener = (event: SSEEvent) => {
          if (event.type === 'step_ended' || event.type === 'step_failed') {
            this.eventListeners.delete(stepListener);
            resolve();
          }
        };
        this.eventListeners.add(stepListener);

        // 超时保护（15 分钟）
        setTimeout(() => {
          this.eventListeners.delete(stepListener);
          resolve();
        }, 15 * 60 * 1000);
      });
    } finally {
      removeListener();
    }
  }

  // ==================== Tauri Fallback：Rust 后端进程 ====================

  private async sendMessageViaRust(
    message: string,
    onEvent: (event: SSEEvent) => void,
    options?: SendMessageOptions
  ): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    // 节流：缓冲文本事件，每 100ms 批量发送
    let textBuffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushBuffer = () => {
      if (textBuffer) {
        onEvent({ type: 'message', data: { content: textBuffer } });
        textBuffer = '';
      }
      flushTimer = null;
    };
    const bufferText = (text: string) => {
      textBuffer += text;
      if (!flushTimer) {
        flushTimer = setTimeout(flushBuffer, 100);
      }
    };

    // 节流：缓冲 reasoning 事件
    let reasoningBuffer = '';
    let reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushReasoning = () => {
      if (reasoningBuffer) {
        onEvent({ type: 'reasoning', data: { content: reasoningBuffer } });
        reasoningBuffer = '';
      }
      reasoningFlushTimer = null;
    };

    let processDone = false;
    const donePromise = new Promise<void>((resolve) => {
      const checkDone = () => {
        if (processDone) { resolve(); return; }
        setTimeout(checkDone, 200);
      };
      checkDone();
    });

    const unlisten = await listen<string>('opencode-event', (event) => {
      if (this.cancelled) return;

      const trimmed = event.payload.trim();
      if (!trimmed) return;

      try {
        const ocEvent: OpenCodeEvent = JSON.parse(trimmed);

        if (ocEvent.type === 'process_exit') {
          processDone = true;
          if (flushTimer) { clearTimeout(flushTimer); flushBuffer(); }
          if (reasoningFlushTimer) { clearTimeout(reasoningFlushTimer); flushReasoning(); }
          return;
        }

        // stderr 事件
        if (ocEvent.type === 'stderr' || ocEvent.type === 'server_stderr') {
          const data = ocEvent.data as string | undefined;
          if (data) {
            console.warn('[OpenCode stderr]', data);
          }
          return;
        }

        // stdout 事件（server 模式的输出）
        if (ocEvent.type === 'server_stdout') {
          const data = ocEvent.data as string | undefined;
          if (data) {
            try {
              const inner = JSON.parse(data);
              const sseEvent = this.mapOpenCodeEvent(inner);
              if (sseEvent) {
                onEvent(sseEvent);
                if (sseEvent.type === 'step_ended' || sseEvent.type === 'step_failed') {
                  processDone = true;
                }
              }
            } catch {
              // 不是 JSON，当作普通消息
            }
          }
          return;
        }

        // 对文本/推理事件用节流
        if (ocEvent.type === 'session.next.text.delta' || ocEvent.type === 'text_delta' || ocEvent.type === 'text') {
          const delta = (ocEvent.delta as string) || ((ocEvent.part as { text?: string })?.text) || '';
          if (delta) bufferText(delta);
        } else if (
          ocEvent.type === 'session.next.reasoning.delta' ||
          ocEvent.type === 'reasoning_delta' ||
          ocEvent.type === 'reasoning'
        ) {
          const content = (ocEvent.content as string) || (ocEvent.delta as string) || '';
          if (content) {
            reasoningBuffer += content;
            if (!reasoningFlushTimer) {
              reasoningFlushTimer = setTimeout(flushReasoning, 200);
            }
          }
        } else {
          // 先刷新缓冲
          if (flushTimer) { clearTimeout(flushTimer); flushBuffer(); }
          if (reasoningFlushTimer) { clearTimeout(reasoningFlushTimer); flushReasoning(); }
          const sseEvent = this.mapOpenCodeEvent(ocEvent);
          if (sseEvent) {
            onEvent(sseEvent);
            if (sseEvent.type === 'step_ended' || sseEvent.type === 'step_failed') {
              processDone = true;
            }
          }
        }
      } catch {
        // 忽略非 JSON 行
      }
    });

    try {
      const apiKey = DEEPSEEK_API_KEY;
      await invoke('opencode_run', {
        message,
        apiKey,
        sessionId: this.currentSessionId || null,
        model: options?.model || null,
      });
      await donePromise;
    } finally {
      unlisten();
    }
  }

  /** 将 OpenCode V2 JSON 事件映射为 SSEEvent */
  private mapOpenCodeEvent(event: OpenCodeEvent): SSEEvent | null {
    switch (event.type) {

      // ---- 会话生命周期 ----
      case 'session.next.step.started': {
        const sessionId = event.sessionID as string | undefined;
        if (sessionId && !this.currentSessionId) {
          this.currentSessionId = sessionId;
        }
        return {
          type: 'step_started',
          data: {
            sessionID: sessionId,
            assistantMessageID: event.assistantMessageID,
            agent: event.agent,
            model: event.model,
            snapshot: event.snapshot,
          },
        };
      }

      case 'session.next.step.ended': {
        return {
          type: 'step_ended',
          data: {
            sessionID: event.sessionID,
            assistantMessageID: event.assistantMessageID,
            finish: event.finish,
            cost: event.cost,
            tokens: event.tokens,
            snapshot: event.snapshot,
          },
        };
      }

      case 'session.next.step.failed': {
        return {
          type: 'step_failed',
          data: {
            sessionID: event.sessionID,
            assistantMessageID: event.assistantMessageID,
            error: event.error,
          },
        };
      }

      // ---- 文本输出 ----
      case 'session.next.text.started': {
        return {
          type: 'text_started',
          data: {
            assistantMessageID: event.assistantMessageID,
            textID: event.textID,
          },
        };
      }

      case 'session.next.text.delta': {
        const delta = event.delta as string | undefined;
        return {
          type: 'message',
          data: {
            content: delta || '',
            assistantMessageID: event.assistantMessageID,
            textID: event.textID,
          },
        };
      }

      case 'session.next.text.ended': {
        return {
          type: 'text_ended',
          data: {
            assistantMessageID: event.assistantMessageID,
            textID: event.textID,
            text: event.text,
          },
        };
      }

      // ---- 推理过程 ----
      case 'session.next.reasoning.started': {
        return {
          type: 'reasoning_started',
          data: {
            assistantMessageID: event.assistantMessageID,
            reasoningID: event.reasoningID,
          },
        };
      }

      case 'session.next.reasoning.delta': {
        const delta = (event.delta as string) || '';
        return {
          type: 'reasoning',
          data: {
            content: delta,
            assistantMessageID: event.assistantMessageID,
            reasoningID: event.reasoningID,
          },
        };
      }

      case 'session.next.reasoning.ended': {
        return {
          type: 'reasoning_ended',
          data: {
            assistantMessageID: event.assistantMessageID,
            reasoningID: event.reasoningID,
            text: event.text,
          },
        };
      }

      // ---- 工具调用 ----
      case 'session.next.tool.input.started': {
        return {
          type: 'tool_input_started',
          data: {
            callID: event.callID,
            name: event.name,
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      case 'session.next.tool.input.delta': {
        return {
          type: 'tool_input_delta',
          data: {
            callID: event.callID,
            delta: event.delta,
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      case 'session.next.tool.input.ended': {
        return {
          type: 'tool_input_ended',
          data: {
            callID: event.callID,
            text: event.text,
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      case 'session.next.tool.called': {
        return {
          type: 'tool_call',
          data: {
            id: event.callID,
            name: event.tool,
            arguments: event.input,
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      case 'session.next.tool.progress': {
        return {
          type: 'tool_progress',
          data: {
            id: event.callID,
            content: event.content,
            structured: event.structured,
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      case 'session.next.tool.success': {
        return {
          type: 'tool_result',
          data: {
            id: event.callID,
            result: event.result,
            content: event.content,
            structured: event.structured,
            status: 'completed',
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      case 'session.next.tool.failed': {
        return {
          type: 'tool_result',
          data: {
            id: event.callID,
            error: event.error,
            result: event.result,
            status: 'error',
            assistantMessageID: event.assistantMessageID,
          },
        };
      }

      // ---- Agent/Model 切换 ----
      case 'session.next.agent.switched': {
        return {
          type: 'agent_switched',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            agent: event.agent,
          },
        };
      }

      case 'session.next.model.switched': {
        return {
          type: 'model_switched',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            model: event.model,
          },
        };
      }

      // ---- 重试 ----
      case 'session.next.retried': {
        return {
          type: 'retried',
          data: {
            sessionID: event.sessionID,
            attempt: event.attempt,
            error: event.error,
          },
        };
      }

      // ---- Compaction ----
      case 'session.next.compaction.started': {
        return {
          type: 'compaction_started',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            reason: event.reason,
          },
        };
      }

      case 'session.next.compaction.delta': {
        return {
          type: 'compaction_delta',
          data: {
            sessionID: event.sessionID,
            text: event.text,
          },
        };
      }

      case 'session.next.compaction.ended': {
        return {
          type: 'compaction_ended',
          data: {
            sessionID: event.sessionID,
            text: event.text,
            include: event.include,
          },
        };
      }

      // ---- Shell ----
      case 'session.next.shell.started': {
        return {
          type: 'shell_started',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            callID: event.callID,
            command: event.command,
          },
        };
      }

      case 'session.next.shell.ended': {
        return {
          type: 'shell_ended',
          data: {
            sessionID: event.sessionID,
            callID: event.callID,
            output: event.output,
          },
        };
      }

      // ---- Prompt 生命周期 ----
      case 'session.next.prompted': {
        return {
          type: 'prompted',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            prompt: event.prompt,
            delivery: event.delivery,
          },
        };
      }

      case 'session.next.prompt.admitted': {
        return {
          type: 'prompt_admitted',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
          },
        };
      }

      case 'session.next.prompt.promoted': {
        return {
          type: 'prompt_promoted',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
          },
        };
      }

      // ---- 上下文/合成/移动 ----
      case 'session.next.context.updated': {
        return {
          type: 'context_updated',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            text: event.text,
          },
        };
      }

      case 'session.next.synthetic': {
        return {
          type: 'synthetic',
          data: {
            sessionID: event.sessionID,
            messageID: event.messageID,
            text: event.text,
          },
        };
      }

      case 'session.next.moved': {
        return {
          type: 'session_moved',
          data: {
            sessionID: event.sessionID,
            location: event.location,
            subdirectory: event.subdirectory,
          },
        };
      }

      // ---- 权限请求 ----
      case 'permission.asked': {
        const perm = event.permission as {
          id?: string;
          toolName?: string;
          arguments?: Record<string, unknown>;
          description?: string;
        } | undefined;
        if (perm) {
          return {
            type: 'permission',
            data: {
              id: perm.id ?? '',
              sessionID: event.sessionID as string,
              toolName: perm.toolName ?? 'unknown',
              arguments: perm.arguments ?? {},
              description: perm.description,
            } as PermissionRequest,
          };
        }
        return null;
      }

      // ---- 问答请求 ----
      case 'session.next.question.asked': {
        const q = event.question as {
          id?: string;
          question?: string;
          options?: string[];
          multiSelect?: boolean;
        } | undefined;
        if (q) {
          return {
            type: 'question',
            data: {
              id: q.id ?? '',
              sessionID: event.sessionID as string,
              question: q.question ?? '',
              options: q.options,
              multiSelect: q.multiSelect,
            },
          };
        }
        return null;
      }

      // ---- 会话 Diff 事件 ----
      case 'session.diff': {
        return {
          type: 'session_diff',
          data: event.diff || event.data,
        };
      }

      // ---- 会话级错误 ----
      case 'error':
      case 'session.error': {
        const errorData = event.error as { message?: string } | undefined;
        const msg = (event.message as string) || errorData?.message || '未知错误';
        return {
          type: 'session_error',
          data: { message: msg },
        };
      }

      // ---- 旧格式兼容（Rust fallback 路径） ----
      case 'step_start': {
        const sessionId = event.sessionID as string | undefined;
        if (sessionId && !this.currentSessionId) {
          this.currentSessionId = sessionId;
        }
        return { type: 'step_started', data: { sessionID: sessionId } };
      }
      case 'step_finish':
      case 'step_end': {
        return { type: 'step_ended', data: {} };
      }
      case 'text': {
        const part = event.part as { text?: string } | undefined;
        if (part?.text) return { type: 'message', data: { content: part.text } };
        return null;
      }
      case 'text_delta': {
        const delta = event.delta as string | undefined;
        if (delta) return { type: 'message', data: { content: delta } };
        return null;
      }
      case 'reasoning': {
        const content = (event.content as string) || (event.reasoning as string) || '';
        if (content) return { type: 'reasoning', data: { content } };
        return null;
      }
      case 'reasoning_delta': {
        const delta = (event.delta as string) || '';
        if (delta) return { type: 'reasoning', data: { content: delta } };
        return null;
      }
      case 'tool_call': {
        const tool = event.tool as { id?: string; name?: string; arguments?: string } | undefined;
        if (tool) {
          let parsedArgs: Record<string, unknown> = {};
          if (tool.arguments) {
            try { parsedArgs = JSON.parse(tool.arguments); } catch { parsedArgs = { raw: tool.arguments }; }
          }
          return { type: 'tool_call', data: { id: tool.id ?? '', name: tool.name ?? 'unknown', arguments: parsedArgs } };
        }
        return null;
      }
      case 'tool_result': {
        const part = event.part as { toolCallID?: string; id?: string } | undefined;
        return { type: 'tool_result', data: { id: (part?.toolCallID ?? part?.id ?? ''), result: event.result } };
      }
      case 'tool_use': {
        const tool = event.tool as { id?: string; name?: string } | undefined;
        if (tool) return { type: 'tool_result', data: { id: tool.id ?? '', name: tool.name, result: event.output } };
        return null;
      }

      default:
        return null;
    }
  }

  // ==================== 工具方法 ====================

  private getAuthHeader(): string {
    // 浏览器模式走 Vite 代理，认证在代理层注入，前端不需要发
    if (!isTauri) return '';
    return 'Basic ' + btoa(`opencode:${OPENCODE_PASSWORD}`);
  }

  /** 是否处于 server 模式 */
  isServerMode(): boolean {
    return this.serverMode;
  }

  /** 获取 server URL */
  getServerUrl(): string | null {
    return this.serverUrl;
  }
}

/** 发送消息选项 */
export interface SendMessageOptions {
  /** 使用的模型 ID */
  model?: string;
  /** 使用的模型提供商 ID */
  providerID?: string;
  /** 模型 ID（V2 格式，优先于 model） */
  modelID?: string;
  /** 使用的 Agent */
  agent?: string;
  /** 工作目录 */
  directory?: string;
  /** 投递方式：steer（立即执行/中断）| queue（排队等待） */
  delivery?: 'steer' | 'queue';
}

/** 全局客户端实例 */
export const opencodeClient = new OpenCodeClient();
