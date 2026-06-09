import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message, Session, AgentInfo, AgentStatus, ToolCall, PermissionRequest, QuestionRequest } from '../types';

/** 生成唯一ID */
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** 聊天状态管理 */
interface ChatState {
  /** 会话列表 */
  sessions: Session[];
  /** 当前活跃会话ID */
  currentSessionId: string | null;
  /** Agent 信息 */
  agent: AgentInfo;
  /** 是否正在发送消息 */
  isSending: boolean;
  /** 待审批的权限请求 */
  pendingPermissions: PermissionRequest[];
  /** 待回答的问答请求 */
  pendingQuestions: QuestionRequest[];
  /** 当前推理内容 */
  currentReasoning: string;
  /** 上一次会话 diff */
  lastDiff: unknown;

  // ===== 操作方法 =====
  /** 创建新会话 */
  createSession: (title?: string, serverSessionId?: string) => string;
  /** 切换当前会话 */
  switchSession: (sessionId: string) => void;
  /** 删除会话 */
  deleteSession: (sessionId: string) => void;
  /** 添加用户消息 */
  addUserMessage: (content: string) => string;
  /** 添加助手消息（流式） */
  addAssistantMessage: () => string;
  /** 追加流式内容到当前助手消息 */
  appendStreamContent: (messageId: string, chunk: string) => void;
  /** 追加推理内容到当前助手消息 */
  appendReasoningContent: (messageId: string, chunk: string) => void;
  /** 结束流式输出 */
  finishStreaming: (messageId: string) => void;
  /** 更新工具调用 */
  updateToolCall: (messageId: string, toolCall: ToolCall) => void;
  /** 设置 Agent 状态 */
  setAgentStatus: (status: AgentStatus, action?: string) => void;
  /** 设置发送状态 */
  setSending: (sending: boolean) => void;
  /** 获取当前会话 */
  getCurrentSession: () => Session | undefined;
  /** 添加权限请求 */
  addPermissionRequest: (request: PermissionRequest) => void;
  /** 移除权限请求 */
  removePermissionRequest: (id: string) => void;
  /** 添加问答请求 */
  addQuestionRequest: (q: QuestionRequest) => void;
  /** 移除问答请求 */
  removeQuestionRequest: (id: string) => void;
  /** 设置当前推理内容 */
  setCurrentReasoning: (reasoning: string) => void;
  /** 追加当前推理内容 */
  appendCurrentReasoning: (chunk: string) => void;
  /** 清空当前推理内容 */
  clearCurrentReasoning: () => void;
  /** 设置上一次 diff */
  setLastDiff: (diff: unknown) => void;
  /** 设置会话的 serverSessionId */
  setServerSessionId: (sessionId: string, serverSessionId: string) => void;
  /** 更新会话标题 */
  updateSessionTitle: (sessionId: string, title: string) => void;
  /** 设置会话模型 */
  setSessionModel: (sessionId: string, model: string) => void;
  /** 设置会话 Agent */
  setSessionAgent: (sessionId: string, agent: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      agent: {
        name: 'PVF Assistant',
        status: 'idle',
      },
      isSending: false,
      pendingPermissions: [],
      pendingQuestions: [],
      currentReasoning: '',
      lastDiff: null,

      createSession: (title?: string, serverSessionId?: string) => {
        const id = generateId();
        const now = Date.now();
        const session: Session = {
          id,
          serverSessionId,
          title: title ?? `新会话 ${get().sessions.length + 1}`,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: id,
        }));
        return id;
      },

      switchSession: (sessionId: string) => {
        set({ currentSessionId: sessionId });
      },

      deleteSession: (sessionId: string) => {
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== sessionId);
          const currentSessionId =
            state.currentSessionId === sessionId
              ? (sessions[0]?.id ?? null)
              : state.currentSessionId;
          return { sessions, currentSessionId };
        });
      },

      addUserMessage: (content: string) => {
        const state = get();
        let sessionId = state.currentSessionId;
        if (!sessionId) {
          sessionId = get().createSession(content.slice(0, 20));
        }
        const messageId = generateId();
        const message: Message = {
          id: messageId,
          role: 'user',
          content,
          createdAt: Date.now(),
        };
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() }
              : s
          ),
        }));
        return messageId;
      },

      addAssistantMessage: () => {
        const state = get();
        const sessionId = state.currentSessionId;
        if (!sessionId) return '';
        const messageId = generateId();
        const message: Message = {
          id: messageId,
          role: 'assistant',
          content: '',
          toolCalls: [],
          createdAt: Date.now(),
          isStreaming: true,
          reasoning: '',
        };
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() }
              : s
          ),
        }));
        return messageId;
      },

      appendStreamContent: (messageId: string, chunk: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === messageId ? { ...m, content: m.content + chunk } : m
            ),
          })),
        }));
      },

      appendReasoningContent: (messageId: string, chunk: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === messageId ? { ...m, reasoning: (m.reasoning || '') + chunk } : m
            ),
          })),
        }));
      },

      finishStreaming: (messageId: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === messageId ? { ...m, isStreaming: false } : m
            ),
          })),
        }));
      },

      updateToolCall: (messageId: string, toolCall: ToolCall) => {
        set((state) => ({
          sessions: state.sessions.map((s) => ({
            ...s,
            messages: s.messages.map((m) => {
              if (m.id !== messageId) return m;
              const existing = m.toolCalls ?? [];
              const idx = existing.findIndex((tc) => tc.id === toolCall.id);
              const updated =
                idx >= 0
                  ? [...existing.slice(0, idx), toolCall, ...existing.slice(idx + 1)]
                  : [...existing, toolCall];
              return { ...m, toolCalls: updated };
            }),
          })),
        }));
      },

      setAgentStatus: (status: AgentStatus, action?: string) => {
        set((state) => ({
          agent: { ...state.agent, status, currentAction: action },
        }));
      },

      setSending: (sending: boolean) => {
        set({ isSending: sending });
      },

      getCurrentSession: () => {
        const state = get();
        return state.sessions.find((s) => s.id === state.currentSessionId);
      },

      addPermissionRequest: (request: PermissionRequest) => {
        set((state) => ({
          pendingPermissions: [...state.pendingPermissions, request],
        }));
      },

      removePermissionRequest: (id: string) => {
        set((state) => ({
          pendingPermissions: state.pendingPermissions.filter((p) => p.id !== id),
        }));
      },

      addQuestionRequest: (q: QuestionRequest) => {
        set((state) => ({
          pendingQuestions: [...state.pendingQuestions, q],
        }));
      },

      removeQuestionRequest: (id: string) => {
        set((state) => ({
          pendingQuestions: state.pendingQuestions.filter((q) => q.id !== id),
        }));
      },

      setCurrentReasoning: (reasoning: string) => {
        set({ currentReasoning: reasoning });
      },

      appendCurrentReasoning: (chunk: string) => {
        set((state) => ({ currentReasoning: state.currentReasoning + chunk }));
      },

      clearCurrentReasoning: () => {
        set({ currentReasoning: '' });
      },

      setLastDiff: (diff: unknown) => {
        set({ lastDiff: diff });
      },

      setServerSessionId: (sessionId: string, serverSessionId: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, serverSessionId } : s
          ),
        }));
      },

      updateSessionTitle: (sessionId: string, title: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s
          ),
        }));
      },

      setSessionModel: (sessionId: string, model: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, model } : s
          ),
        }));
      },

      setSessionAgent: (sessionId: string, agent: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, agentName: agent } : s
          ),
        }));
      },
    }),
    {
      name: 'pvf-chat-storage',
      // 持久化配置：排除运行时状态
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages.map((m) => ({
            ...m,
            isStreaming: false,
          })),
        })),
        currentSessionId: state.currentSessionId,
      }),
    }
  )
);
