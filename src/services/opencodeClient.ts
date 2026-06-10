import type {
  SSEEvent, PermissionRequest, ServerStatus,
  McpServerStatus, VcsInfo, VcsFileStatus,
  SearchResult, FileSearchResult, SymbolSearchResult,
  ConfigInfo, ProjectInfo, PathInfo, LspStatus,
} from '../types';
import { useModelConfigStore } from '../stores/useModelConfigStore';

/** OpenCode 服务器默认端口 */
const OPENCODE_DEFAULT_PORT = 4096;

/** PVFut 桥接地址（统一走 Vite 代理） */
const PVFUT_BASE_URL = '/pvfut-api';

/** OpenCode 认证密码（从环境变量读取） */
const OPENCODE_PASSWORD = import.meta.env.VITE_OPENCODE_PASSWORD || 'opencode2026';

/** DeepSeek API Key — 已移除，Key 仅存服务器环境变量 */

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
 * OpenCode V2 Server REST API（不带 /api/ 前缀）：
 * - GET  /health
 * - GET  /session               列出会话
 * - POST /session               创建新会话
 * - GET  /session/:id           获取会话
 * - DELETE /session/:id         删除会话
 * - PATCH /session/:id          更新会话
 * - POST /session/:id/message   发送消息（同步等待）
 * - POST /session/:id/abort     中止会话
 * - POST /session/:id/revert    回滚
 * - POST /session/:id/unrevert  撤销回滚
 * - GET  /session/:id/diff      获取 diff
 * - GET  /session/:id/message   列出消息
 * - GET  /mcp                   MCP 状态
 * - GET  /model                 模型列表
 * - GET  /agent                 Agent 列表
 * - GET  /provider              Provider 列表
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

  /** 连接 OpenCode server（统一走 Vite 代理或远程 URL） */
  async startServer(): Promise<ServerStatus> {
    // 浏览器模式，通过 Vite 代理避免 CORS
    this.serverUrl = '/opencode-api';
    this.serverPort = OPENCODE_DEFAULT_PORT;
    this.serverMode = true;
    this.connectEventSource();
    return { connected: true, port: this.serverPort, url: this.serverUrl };
  }

  /** 停止 OpenCode server */
  async stopServer(): Promise<void> {
    this.disconnectEventSource();
    this.serverPort = null;
    this.serverUrl = null;
    this.serverMode = false;
  }

  /** 查询 server 状态 */
  async getServerStatus(): Promise<ServerStatus> {
    if (this.serverUrl) {
      try {
        const authHeader = this.getAuthHeader();
        const resp = await fetch(`${this.serverUrl}/health`, {
          headers: { 'Authorization': authHeader },
        });
        if (resp.ok) {
          return { connected: true, port: this.serverPort, url: this.serverUrl };
        }
      } catch {
        // server 不可达
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

  /** 建立 SSE 持久连接（支持认证 header） */
  private connectEventSource(): void {
    if (!this.serverUrl) return;
    if (this.eventSource) return; // 已连接

    const sseUrl = `${this.serverUrl}/event`;
    const authHeader = this.getAuthHeader();

    // 浏览器模式（走 Vite 代理，无需 auth header）或本地 server → 用原生 EventSource
    if (!authHeader || this.serverUrl.startsWith('/')) {
      const es = new EventSource(sseUrl, { withCredentials: false });
      this.setupEventSourceHandlers(es);
      this.eventSource = es;
      return;
    }

    // 远程模式（需要认证 header）→ 用 fetch-based SSE
    this.connectFetchSSE(sseUrl, authHeader);
  }

  /** 设置 EventSource 事件处理 */
  private setupEventSourceHandlers(es: EventSource): void {
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
      console.warn('[OpenCode] SSE 连接断开，3s 后重连');
      this.eventSource = null;
      setTimeout(() => {
        if (this.serverUrl && this.serverMode) {
          this.connectEventSource();
        }
      }, 3000);
    });
  }

  /** 用 fetch 实现 SSE 连接（支持自定义 Authorization header） */
  private async connectFetchSSE(url: string, authHeader: string): Promise<void> {
    try {
      const resp = await fetch(url, {
        headers: { 'Authorization': authHeader, 'Accept': 'text/event-stream' },
      });
      if (!resp.ok || !resp.body) {
        console.warn(`[OpenCode] SSE 连接失败 (${resp.status})，3s 后重连`);
        setTimeout(() => {
          if (this.serverUrl && this.serverMode) {
            this.connectEventSource();
          }
        }, 3000);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 创建一个虚拟 EventSource 对象用于 close 控制
      let aborted = false;
      const fakeEs = { close: () => { aborted = true; reader.cancel(); } };
      this.eventSource = fakeEs as unknown as EventSource;

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              const sseEvent = this.mapOpenCodeEvent(data);
              if (sseEvent && !this.cancelled) {
                for (const listener of this.eventListeners) {
                  listener(sseEvent);
                }
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      if (!aborted) {
        console.warn('[OpenCode] SSE 连接断开，3s 后重连');
        this.eventSource = null;
        setTimeout(() => {
          if (this.serverUrl && this.serverMode) {
            this.connectEventSource();
          }
        }, 3000);
      }
    } catch {
      console.warn('[OpenCode] SSE fetch 连接异常，3s 后重连');
      this.eventSource = null;
      setTimeout(() => {
        if (this.serverUrl && this.serverMode) {
          this.connectEventSource();
        }
      }, 3000);
    }
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
      const resp = await fetch(`${this.serverUrl}/session${qs}`, {
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

  /** 创建新会话 — OpenCode V2：POST /session，服务端返回含 ses_ 前缀 ID 的 Session 对象 */
  async createSession(directory?: string): Promise<string | null> {
    if (!this.serverUrl) return null;
    const authHeader = this.getAuthHeader();
    try {
      const body: Record<string, string> = {};
      if (directory) body.directory = directory;
      const resp = await fetch(`${this.serverUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          const sessionId = data?.id || null;
          if (sessionId) {
            console.log('[OpenCode] 新 session 已创建:', sessionId);
            return sessionId;
          }
        }
      }
      const errText = await resp.text().catch(() => '');
      if (resp.status === 500 || resp.status === 502 || resp.status === 503) {
        console.error('[OpenCode] 远程服务器不可达或内部错误 (' + resp.status + ')，请确认 OpenCode 服务正在运行');
      } else {
        console.warn('[OpenCode] 创建 session 失败:', resp.status, errText);
      }
    } catch (err) {
      console.warn('[OpenCode] 创建 session 失败:', err);
    }
    return null;
  }

  /** 压缩会话上下文 (V2: POST /api/session/:sessionID/compact) */
  async compactSession(sessionId?: string): Promise<boolean> {
    if (!this.serverUrl) return false;
    const sid = sessionId || this.currentSessionId;
    if (!sid) return false;

    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/session/${sid}/compact`, {
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
      const resp = await fetch(`${this.serverUrl}/session/${sid}/wait`, {
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
      const resp = await fetch(`${this.serverUrl}/session/${sid}/context`, {
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

    // V2: POST /session/:id/abort
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/session/${sid}/abort`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
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
      const resp = await fetch(`${this.serverUrl}/session/${sid}/message${qs}`, {
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

  /** 恢复会话（revert）— V2: POST /session/:id/revert */
  async revertSession(messageID?: string, _partID?: string, sessionId?: string): Promise<{ ok: boolean; session?: unknown }> {
    if (!this.serverUrl) return { ok: false };
    const sid = sessionId || this.currentSessionId;
    if (!sid) return { ok: false };
    const authHeader = this.getAuthHeader();
    try {
      const body: Record<string, string> = {};
      if (messageID) body.messageID = messageID;
      const resp = await fetch(`${this.serverUrl}/session/${sid}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        return { ok: true, session: data };
      }
    } catch { /* ignore */ }
    return { ok: false };
  }

  /** 取消恢复（unrevert）— V2: POST /session/:id/unrevert */
  async unrevertSession(sessionId?: string): Promise<{ ok: boolean; session?: unknown }> {
    if (!this.serverUrl) return { ok: false };
    const sid = sessionId || this.currentSessionId;
    if (!sid) return { ok: false };
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/session/${sid}/unrevert`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return { ok: true, session: data };
      }
    } catch { /* ignore */ }
    return { ok: false };
  }

  /** 获取会话 diff — V2: GET /session/:id/diff */
  async getSessionDiff(sessionId?: string, _messageID?: string): Promise<unknown> {
    if (!this.serverUrl) return null;
    const sid = sessionId || this.currentSessionId;
    if (!sid) return null;
    const authHeader = this.getAuthHeader();
    try {
      const resp = await fetch(`${this.serverUrl}/session/${sid}/diff`, {
        headers: { 'Authorization': authHeader },
      });
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
    } catch { /* ignore */ }
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
      const resp = await fetch(`${this.serverUrl}/permission/request${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/session/${sid}/permissions`, {
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
      const resp = await fetch(`${this.serverUrl}/session/${sessionId}/permissions/${requestID}`, {
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
      const resp = await fetch(`${this.serverUrl}/permission/saved${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/permission/saved/${id}`, {
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
      const resp = await fetch(`${this.serverUrl}/question/request${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/session/${sessionId}/question/${requestID}/reply`, {
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
      const resp = await fetch(`${this.serverUrl}/session/${sessionId}/question/${requestID}/reject`, {
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
      const resp = await fetch(`${this.serverUrl}/model${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/agent${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/provider${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/provider/${providerID}${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/skill${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/command${qs}`, {
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
      const resp = await fetch(`${this.serverUrl}/fs/read?${params.toString()}`, {
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
      const resp = await fetch(`${this.serverUrl}/fs/list${qs}`, {
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
      // 统一使用 server REST API
      await this.sendMessageViaServer(message, onEvent, options);

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

    // 1. 确保有有效的 sessionID（必须通过 POST /session 创建，服务端返回 ses_ 前缀 ID）
    let sessionId = this.currentSessionId;
    if (!sessionId) {
      // 始终创建新 session，不复用旧 session（旧 session 可能绑定了错误的模型）
      console.log('[OpenCode] 创建新 session...');
      sessionId = await this.createSession(options?.directory);
      if (sessionId) {
        this.currentSessionId = sessionId;
        console.log('[OpenCode] 新 session 已创建:', sessionId);
      }
    }
    if (!sessionId) {
      throw new Error('无法连接 OpenCode 服务器，请确认远程服务是否正在运行');
    }

    // 2. 构建请求体 — V2: POST /session/:id/message
    const messageBody: Record<string, unknown> = {
      parts: [{ type: 'text', text: message }],
    };
    // 注意：API 的 model 字段格式不稳定，服务器已通过 opencode.json 配置默认模型
    // 不在消息体中发送 model，让服务器使用配置的默认模型
    if (options?.agent) {
      messageBody.agent = options.agent;
    }

    // 3. 发送消息（同步等待 AI 回复）
    onEvent({ type: 'step_started', data: { sessionID: sessionId } });
    onEvent({ type: 'reasoning_started', data: {} });

    const resp = await fetch(
      `${this.serverUrl}/session/${sessionId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader(),
        },
        body: JSON.stringify(messageBody),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      // Session 不存在或已失效（服务器重启后旧 session 丢失），自动创建新 session 重试
      if ((resp.status === 404 || resp.status === 500) && this.currentSessionId === sessionId) {
        console.warn('[OpenCode] Session 可能已失效，创建新 session 重试...', resp.status, errText);
        this.currentSessionId = null;
        const newSessionId = await this.createSession(options?.directory);
        if (newSessionId) {
          this.currentSessionId = newSessionId;
          const retryResp = await fetch(
            `${this.serverUrl}/session/${newSessionId}/message`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': this.getAuthHeader(),
              },
              body: JSON.stringify(messageBody),
            }
          );
          if (!retryResp.ok) {
            const retryErrText = await retryResp.text().catch(() => '');
            throw new Error(`OpenCode API 错误 (${retryResp.status}): ${retryErrText}`);
          }
          // 用 retryResp 继续处理
          const result = await retryResp.json();
          return this.handleMessageResponse(result, newSessionId, onEvent);
        }
      }
      throw new Error(`OpenCode API 错误 (${resp.status}): ${errText}`);
    }

    // 4. 解析同步响应 — { info, parts }
    const result = await resp.json();
    this.handleMessageResponse(result, sessionId, onEvent);
  }

  /** 处理消息响应，提取文本和工具调用 */
  private handleMessageResponse(
    result: { info?: Record<string, unknown>; parts?: unknown[] },
    sessionId: string,
    onEvent: (event: SSEEvent) => void,
  ): void {
    const info = result?.info as Record<string, unknown> | undefined;
    const parts = result?.parts ?? [];

    // 更新 token 统计
    if (info?.tokens) {
      const total = (info.tokens.input || 0) + (info.tokens.output || 0) + (info.tokens.reasoning || 0);
      onEvent({
        type: 'step_ended',
        data: {
          sessionID: sessionId,
          cost: info.cost,
          tokens: info.tokens,
          finish: info.finish,
        },
      });
    }

    // 5. 从 parts 中提取文本和工具调用
    for (const part of parts) {
      if (part.type === 'text' && part.text) {
        onEvent({
          type: 'message',
          data: {
            content: part.text,
            modelId: info?.modelID,
          },
        });
      } else if (part.type === 'tool-invocation') {
        const toolInv = part.toolInvocation;
        if (toolInv) {
          onEvent({
            type: 'tool_call',
            data: {
              id: toolInv.toolCallId || toolInv.callID || '',
              name: toolInv.toolName || toolInv.name || 'unknown',
              arguments: toolInv.args || toolInv.arguments || {},
            },
          });
          if (toolInv.state === 'result' || toolInv.state === 'completed') {
            onEvent({
              type: 'tool_result',
              data: {
                id: toolInv.toolCallId || toolInv.callID || '',
                result: toolInv.result,
                status: 'completed',
              },
            });
          }
        }
      } else if (part.type === 'step-start') {
        // 可嵌套的 step 信息
      } else if (part.type === 'reasoning' && part.text) {
        onEvent({
          type: 'reasoning',
          data: { content: part.text },
        });
      }
    }
  }

  /** 将 OpenCode V2 JSON 事件映射为 SSEEvent */
  private mapOpenCodeEvent(event: OpenCodeEvent): SSEEvent | null {
    switch (event.type) {

      // ---- 会话生命周期 ----
      case 'session.next.step.started': {
        const sessionId = event.sessionID as string | undefined;
        if (sessionId) {
          // 始终用服务端返回的真实 sessionID 更新本地
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
    // 走 Vite 代理时，认证在代理层注入，前端不需要发
    if (this.serverUrl?.startsWith('/')) return '';

    // 优先使用 JWT Bearer token
    try {
      const stored = localStorage.getItem('pvf-auth-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        const accessToken = parsed?.state?.accessToken;
        if (accessToken) {
          return `Bearer ${accessToken}`;
        }
      }
    } catch { /* 解析失败 fallback */ }

    // Fallback: Basic Auth
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
