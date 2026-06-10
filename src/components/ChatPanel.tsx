import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, Square, GitCompare, Undo2,
  ChevronDown, ChevronRight, Brain, Shield, ShieldAlert,
  Paperclip, AtSign, ListChecks, CheckCircle2, Eye, Zap,
  PanelRightOpen, PanelRightClose, Wifi, WifiOff, Sun, Moon,
  Lightbulb,
} from 'lucide-react';
import { useChatStore } from '../stores/useChatStore';
import { useThemeStore } from '../stores/useThemeStore';
import { usePvfStore } from '../stores/usePvfStore';
import { useModelConfigStore } from '../stores/useModelConfigStore';
import { opencodeClient } from '../services/opencodeClient';
import { relayClient } from '../services/relayClient';
import { ToolCallCard } from './ToolCallCard';
import { ModelSelector } from './ModelSelector';
import { QuestionDialog } from './QuestionDialog';
import { PermissionManager } from './PermissionManager';
import { ProviderPanel } from './ProviderPanel';
import { SkillPanel } from './SkillPanel';
import { CommandPalette } from './CommandPalette';
import { ContextPanel } from './ContextPanel';
import { DiffViewer } from './DiffViewer';
import { McpManager } from './McpManager';
import { SearchPanel } from './SearchPanel';
import { VcsPanel } from './VcsPanel';
import { SettingsPanel as GlobalSettingsPanel } from './GlobalSettingsPanel';
import { ProjectPanel } from './ProjectPanel';
import { LspPanel } from './LspPanel';
import { AboutPanel } from './AboutPanel';
import type { Message, SSEEvent, ToolCall, PermissionRequest } from '../types';

// ═══════════════════════════════════════════════════════════════════
// Agent Stage + State definitions
// ═══════════════════════════════════════════════════════════════════

const AGENT_STAGES = [
  { key: 'thinking', label: '感知', Icon: Eye, color: 'var(--green)' },
  { key: 'tool_calling', label: '规划', Icon: Brain, color: 'var(--green)' },
  { key: 'awaiting_permission', label: '执行', Icon: Zap, color: 'var(--amber)' },
];

const STATE_MAP: Record<string, { text: string; color: string; dotColor: string; pillBg: string }> = {
  idle:                { text: '就绪',   color: 'rgb(var(--t3))',        dotColor: 'rgb(var(--t3))',        pillBg: 'rgb(var(--b3) / .6)' },
  thinking:            { text: '感知中', color: 'rgb(var(--cyan))',      dotColor: 'rgb(var(--cyan))',      pillBg: 'rgb(var(--cyan) / .1)' },
  tool_calling:        { text: '规划中', color: 'rgb(var(--purple))',    dotColor: 'rgb(var(--purple))',    pillBg: 'rgb(var(--purple) / .1)' },
  awaiting_permission: { text: '执行中', color: 'rgb(var(--amber))',     dotColor: 'rgb(var(--amber))',     pillBg: 'rgb(var(--amber) / .1)' },
  awaiting_question:   { text: '提问中', color: 'rgb(var(--purple))',    dotColor: 'rgb(var(--purple))',    pillBg: 'rgb(var(--purple) / .1)' },
  responding:          { text: '生成中', color: 'rgb(var(--blue))',      dotColor: 'rgb(var(--blue))',      pillBg: 'rgb(var(--blue) / .1)' },
  compacting:          { text: '压缩中', color: 'rgb(var(--cyan))',      dotColor: 'rgb(var(--cyan))',      pillBg: 'rgb(var(--cyan) / .1)' },
  shell_executing:     { text: '执行中', color: 'rgb(var(--amber))',     dotColor: 'rgb(var(--amber))',     pillBg: 'rgb(var(--amber) / .1)' },
  error:               { text: '出错',   color: 'rgb(var(--rose))',      dotColor: 'rgb(var(--rose))',      pillBg: 'rgb(var(--rose) / .1)' },
};

function isStageCompleted(currentStatus: string, stageKey: string): boolean {
  const order = ['idle', 'thinking', 'tool_calling', 'awaiting_permission', 'responding'];
  const ci = order.indexOf(currentStatus);
  const si = order.indexOf(stageKey);
  return ci > si && ci >= 0;
}

// ═══════════════════════════════════════════════════════════════════
// StateBar
// ═══════════════════════════════════════════════════════════════════

interface AgentStateBarProps {
  rightOpen: boolean;
  onToggleRight: () => void;
}

function AgentStateBar({ rightOpen, onToggleRight }: AgentStateBarProps) {
  const { agent, sessions, currentSessionId } = useChatStore();
  const { connectionStatus } = usePvfStore();
  const { themeMode, setTheme } = useThemeStore();
  const isLight = themeMode === 'light';
  const toggleTheme = () => { setTheme(isLight ? 'dark' : 'light'); };

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const stateInfo = STATE_MAP[agent.status] || STATE_MAP.idle;

  // Relay 连接状态
  const [relayConnected, setRelayConnected] = useState(relayClient.isConnected());
  useEffect(() => {
    return relayClient.onStatusChange((connected) => setRelayConnected(connected));
  }, []);

  const tokenUsed = agent.tokenUsed ?? 0;
  const tokenTotal = agent.tokenTotal ?? 128000;
  const tokenPct = Math.min(100, (tokenUsed / tokenTotal) * 100);
  const tokenLabel = tokenUsed >= 1000 ? `${(tokenUsed / 1000).toFixed(1)}k` : `${tokenUsed}`;
  const tokenTotalLabel = tokenTotal >= 1000 ? `${(tokenTotal / 1000).toFixed(0)}k` : `${tokenTotal}`;

  return (
    <div className="sbar">
      {/* Status Pill */}
      <div className="pill" style={{ background: stateInfo.pillBg }}>
        <span className="dot" style={{ background: stateInfo.dotColor }} />
        <span style={{ color: stateInfo.color }}>{stateInfo.text}</span>
      </div>

      {/* Model/Agent Selector */}
      <ModelSelector
        currentModel={currentSession?.model}
        currentAgent={currentSession?.agentName}
        onModelChange={(model) => {
          if (currentSessionId) useChatStore.getState().setSessionModel(currentSessionId, model);
        }}
        onAgentChange={(agentName) => {
          if (currentSessionId) {
            useChatStore.getState().setSessionAgent(currentSessionId, agentName);
          }
        }}
        disabled={useChatStore.getState().isSending}
      />

      {/* Stage Pipeline */}
      <div className="stg">
        {AGENT_STAGES.map((stage, i) => {
          const isActive = agent.status === stage.key;
          const isDone = isStageCompleted(agent.status, stage.key);
          return (
            <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div className={`stg-i ${isActive ? 'on' : ''}`} style={{ opacity: isActive ? 1 : isDone ? 0.5 : 0.5 }}>
                <stage.Icon size={12} style={{ stroke: isActive ? stage.color : isDone ? 'rgb(var(--green))' : 'rgb(var(--t3))' }} />
                <span style={{ color: isActive ? stage.color : isDone ? 'rgb(var(--green))' : 'rgb(var(--t3))', fontSize: 10 }}>{stage.label}</span>
              </div>
              {i < AGENT_STAGES.length - 1 && (
                <div className="stg-c" style={{ background: isDone ? 'rgb(var(--green) / .5)' : 'rgb(var(--bd2))' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Token Progress */}
      <div className="tok">
        <div className="tok-t">
          <div className="tok-f" style={{ width: `${tokenPct}%`, background: 'rgb(var(--blue))' }} />
        </div>
        <span style={{ fontSize: 10, color: 'rgb(var(--t3))' }}>{tokenLabel}/{tokenTotalLabel}</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* PVF Badge */}
      <div className="badge" style={{ background: connectionStatus === 'connected' ? 'rgb(var(--green) / .1)' : 'rgb(var(--rose) / .1)', color: connectionStatus === 'connected' ? 'rgb(var(--green))' : 'rgb(var(--rose))' }}>
        {connectionStatus === 'connected' ? <Wifi size={10} /> : <WifiOff size={10} />}
        PVF
      </div>

      {/* Relay Badge */}
      <div className="badge" style={{ background: relayConnected ? 'rgb(var(--purple) / .1)' : 'rgb(var(--amber) / .1)', color: relayConnected ? 'rgb(var(--purple))' : 'rgb(var(--amber))' }}>
        {relayConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
        Relay
      </div>

      {/* Theme Toggle */}
      <button className="sbtn" onClick={toggleTheme} title={isLight ? '深色模式' : '浅色模式'}>
        {isLight ? <Moon size={13} /> : <Sun size={13} />}
      </button>

      {/* Right Panel Toggle */}
      <button className="sbtn" onClick={onToggleRight} title="右侧面板">
        {rightOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ThinkingFold
// ═══════════════════════════════════════════════════════════════════

function ThinkingFold({ content, elapsed, isStreaming }: { content: string; elapsed?: number; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="thk">
      <button className="thk-t" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--purple) / .6)" strokeWidth="2"><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11.5 7.3 11.8a1 1 0 0 0 1.4 0C13 21.5 20 15.4 20 10a8 8 0 0 0-8-8z" /></svg>
        {isStreaming ? (
          <span style={{ color: 'rgb(var(--cyan))' }}>思考中</span>
        ) : (
          <span>已思考</span>
        )}
        {elapsed && <span style={{ fontSize: 10, color: 'rgb(var(--t3))', marginLeft: 3 }}>{(elapsed / 1000).toFixed(1)}s</span>}
      </button>
      {expanded && (
        <div className="thk-c">{content}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MessageBubble
// ═══════════════════════════════════════════════════════════════════

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const isUser = message.role === 'user';
  return (
    <div className={`mr ${isUser ? 'u' : 'a'}`} style={isUser ? undefined : { animation: 'fadeUp .25s ease-out' }}>
      <div className={`mb ${isUser ? 'ub' : 'ab'}`}>
        {/* Assistant Header */}
        {!isUser && (
          <div className="mh">
            <div className="av">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /></svg>
            </div>
            <span className="nm">PVF 助手</span>
            <span className="tm">
              {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        {/* Thinking */}
        {message.reasoning && (
          <ThinkingFold content={message.reasoning} isStreaming={message.isStreaming && isStreaming} />
        )}

        {/* Content */}
        {message.content && (
          <div className="mc">
            <MarkdownContent content={message.content} isStreaming={message.isStreaming && isStreaming} />
          </div>
        )}

        {/* Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div style={{ padding: '2px 0 4px' }}>
            {message.toolCalls.map((tc) => <ToolCallCard key={tc.id} toolCall={tc} />)}
          </div>
        )}

        {/* User Timestamp */}
        {isUser && (
          <div className="utime">
            {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Markdown Rendering
// ═══════════════════════════════════════════════════════════════════

function MarkdownContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const processedContent = useMemo(() => {
    if (!isStreaming) return content;
    return closeUnclosedCodeBlocks(content);
  }, [content, isStreaming]);

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';
            const codeStr = String(children).replace(/\n$/, '');
            if (lang || codeStr.includes('\n')) {
              return (
                <div className="cb">
                  <div className="cb-h">
                    <span className="lg">{lang || 'text'}</span>
                    <button className="cp" onClick={() => navigator.clipboard.writeText(codeStr)}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg> 复制
                    </button>
                  </div>
                  <pre><code>{codeStr}</code></pre>
                </div>
              );
            }
            return <code {...props}>{children}</code>;
          },
          p({ children }) { return <p style={{ marginBottom: 6 }}>{children}</p>; },
          strong({ children }) { return <strong>{children}</strong>; },
          a({ href, children }) { return <a href={href} style={{ color: 'rgb(var(--blue))' }} target="_blank" rel="noreferrer">{children}</a>; },
          blockquote({ children }) { return <blockquote style={{ borderLeft: '2px solid rgb(var(--purple) / .4)', paddingLeft: 12, margin: '6px 0', color: 'rgb(var(--t3))', fontStyle: 'italic' }}>{children}</blockquote>; },
        }}
      >
        {processedContent}
      </ReactMarkdown>
      {isStreaming && <span className="stream" />}
    </div>
  );
}

function closeUnclosedCodeBlocks(text: string): string {
  const matches = text.match(/```/g);
  if (!matches) return text;
  if (matches.length % 2 !== 0) return text + '\n```';
  return text;
}

// ═══════════════════════════════════════════════════════════════════
// ChatCanvas
// ═══════════════════════════════════════════════════════════════════

function ChatCanvas() {
  const { sessions, currentSessionId, isSending, currentReasoning, pendingPermissions, pendingQuestions, removePermissionRequest, setAgentStatus } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const messages = currentSession?.messages ?? [];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, currentReasoning]);

  const handlePermissionApproval = useCallback(async (permId: string, response: 'once' | 'always' | 'reject') => {
    const perm = pendingPermissions.find(p => p.id === permId);
    const sessionId = perm?.sessionID || opencodeClient.getCurrentSessionId() || '';
    // V2 API 使用 allow/deny/always 替代 once/always/reject
    const reply = response === 'reject' ? 'deny' as const : response === 'once' ? 'allow' as const : response;
    await opencodeClient.approvePermission(sessionId, permId, reply);
    removePermissionRequest(permId);
    if (response === 'reject') setAgentStatus('idle');
  }, [pendingPermissions, removePermissionRequest, setAgentStatus]);

  if (messages.length === 0 && pendingPermissions.length === 0 && !currentReasoning) return <EmptyState />;

  return (
    <div className="chat" style={{ height: '100%', overflowY: 'auto', scrollBehavior: 'smooth' }}>
      {/* Current Reasoning */}
      {currentReasoning && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px', margin: '4px 8px', borderRadius: 8, background: 'rgb(var(--blue) / .1)', border: '1px solid rgb(var(--blue) / .2)' }}>
          <Lightbulb size={13} style={{ color: 'rgb(var(--blue))', marginTop: 2, flexShrink: 0 }} />
          <p style={{ fontSize: 11, color: 'rgb(var(--t2))', whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto', flex: 1, lineHeight: 1.6 }}>{currentReasoning.slice(-500)}</p>
        </div>
      )}

      {/* Permission Requests */}
      {pendingPermissions.map((perm) => (
        <div key={perm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', margin: '4px 8px', borderRadius: 8, background: 'rgb(var(--amber) / .1)', border: '1px solid rgb(var(--amber) / .2)', animation: 'fadeUp .25s ease-out' }}>
          <ShieldAlert size={13} style={{ color: 'rgb(var(--amber))', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgb(var(--t1))', flex: 1 }}>
            AI 请求执行 <strong>{perm.toolName}</strong>
            {perm.description && <span style={{ color: 'rgb(var(--t3))' }}> — {perm.description}</span>}
          </span>
          <button onClick={() => handlePermissionApproval(perm.id, 'once')} style={{ padding: '4px 10px', borderRadius: 7, fontSize: 10, fontWeight: 500, background: 'rgb(var(--blue) / .1)', color: 'rgb(var(--blue))', border: 0, cursor: 'pointer' }}>允许</button>
          <button onClick={() => handlePermissionApproval(perm.id, 'always')} style={{ padding: '4px 10px', borderRadius: 7, fontSize: 10, fontWeight: 500, background: 'rgb(var(--green) / .1)', color: 'rgb(var(--green))', border: 0, cursor: 'pointer' }}>总是允许</button>
          <button onClick={() => handlePermissionApproval(perm.id, 'reject')} style={{ padding: '4px 10px', borderRadius: 7, fontSize: 10, fontWeight: 500, background: 'rgb(var(--rose) / .1)', color: 'rgb(var(--rose))', border: 0, cursor: 'pointer' }}>拒绝</button>
        </div>
      ))}

      {/* Question Requests */}
      {pendingQuestions.map((q) => (
        <QuestionDialog key={q.id} question={q} />
      ))}

      {/* Messages */}
      {messages.map((msg) => <MessageBubble key={msg.id} message={msg} isStreaming={isSending} />)}

      {/* Streaming Dots */}
      {isSending && (
        <div className="dots">
          <span style={{ animationDelay: '0ms' }} />
          <span style={{ animationDelay: '150ms' }} />
          <span style={{ animationDelay: '300ms' }} />
        </div>
      )}

      {/* Ready Indicator */}
      {!isSending && messages.length > 0 && (
        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, animation: 'fadeUp .2s ease-out' }}>
          <CheckCircle2 size={11} style={{ color: 'rgb(var(--green) / .6)' }} />
          <span style={{ fontSize: 10, color: 'rgb(var(--t3) / .6)' }}>已就绪</span>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EmptyState
// ═══════════════════════════════════════════════════════════════════

function EmptyState() {
  const suggestions = [
    { icon: '🔧', text: '帮我修改装备 12345 的物理攻击为 200' },
    { icon: '📊', text: '批量修改所有装备的物理攻击 +10%' },
    { icon: '🔍', text: '查看技能树结构' },
    { icon: '📝', text: '帮我写一个 .nut 怪物AI脚本' },
  ];

  return (
    <div className="empty" style={{ animation: 'fadeUp .3s ease-out' }}>
      <div className="hero">🤖</div>
      <h2>PVF Suite AI</h2>
      <p>修改装备 · 编辑技能树 · 分析数据 · 生成脚本</p>
      <div className="sugs">
        {suggestions.map((s, i) => (
          <button key={i} className="sug">
            <span style={{ fontSize: 16, flexShrink: 0 }}>{s.icon}</span>
            <span>{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// InputBar
// ═══════════════════════════════════════════════════════════════════

const MIN_HEIGHT = 72;
const MAX_HEIGHT = 320;

function InputBar() {
  const { isSending, setSending, setAgentStatus, clearCurrentReasoning,
    addUserMessage, addAssistantMessage, appendStreamContent, appendReasoningContent,
    finishStreaming, updateToolCall, addPermissionRequest, addQuestionRequest, appendCurrentReasoning,
    setLastDiff, sessions, currentSessionId, agent,
  } = useChatStore();

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(MIN_HEIGHT);
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  /** 记录最后一次 assistant 消息 ID，用于关联 tool call */
  const lastAssistantMsgIdRef = useRef<string>('');
  /** 记录最后一次 step 开始的时间，用于计算耗时 */
  const stepStartTimeRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const incardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const tokenUsed = agent.tokenUsed ?? 0;
  const tokenTotal = agent.tokenTotal ?? 128000;
  const tokenLabel = tokenUsed >= 1000 ? `${(tokenUsed / 1000).toFixed(1)}k` : `${tokenUsed}`;

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      const newH = Math.max(MIN_HEIGHT, Math.min(ta.scrollHeight, MAX_HEIGHT));
      ta.style.height = newH + 'px';
      setInputHeight(newH);
    }
  }, [text]);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: inputHeight };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const newH = Math.max(MIN_HEIGHT, Math.min(dragRef.current.startH + delta, MAX_HEIGHT));
      setInputHeight(newH);
      if (textareaRef.current) textareaRef.current.style.height = newH + 'px';
    };
    const onUp = () => {
      dragRef.current = null;
      target.removeEventListener('pointermove', onMove as EventListener);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [inputHeight]);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || isSending) return;
    setText('');
    setSending(true);
    addUserMessage(content);
    setAgentStatus('thinking', '正在思考...');
    clearCurrentReasoning();
    const assistantMsgId = addAssistantMessage();
    lastAssistantMsgIdRef.current = assistantMsgId;
    stepStartTimeRef.current = Date.now();
    const sessionId = currentSessionId ?? 'default';
    await opencodeClient.sendMessage(
      content, sessionId,
      (event: SSEEvent) => {
        switch (event.type) {
          // ---- Step lifecycle ----
          case 'step_started': {
            stepStartTimeRef.current = Date.now();
            const d = event.data as { agent?: string; model?: { id?: string; providerID?: string } };
            if (d?.model?.id) useChatStore.getState().setSessionModel(sessionId, d.model.id);
            setAgentStatus('thinking', '正在思考...');
            break;
          }
          case 'step_ended': {
            const d = event.data as { cost?: number; tokens?: { input: number; output: number; reasoning: number } };
            if (d?.tokens) {
              const total = d.tokens.input + d.tokens.output + d.tokens.reasoning;
              useChatStore.getState().setAgentStatus('idle');
              // 更新 token 统计
              const agent = useChatStore.getState().agent;
              agent.tokenUsed = total;
              agent.tokenTotal = 128000;
            }
            break;
          }
          case 'step_failed': {
            const d = event.data as { error?: { message?: string } };
            if (d?.error?.message) appendStreamContent(assistantMsgId, `\n\n❌ 步骤失败: ${d.error.message}`);
            break;
          }

          // ---- Text ----
          case 'message': {
            const d = event.data as { content?: string; meta?: { agentName?: string; modelId?: string }; modelId?: string };
            if (d?.meta?.modelId || d?.modelId) useChatStore.getState().setSessionModel(sessionId, d?.meta?.modelId || d?.modelId || '');
            if (d?.content) { appendStreamContent(assistantMsgId, d.content); setAgentStatus('responding', '正在回复...'); }
            break;
          }
          case 'text_ended': {
            // 后端发来完整文本，可用于回填（当前保留增量拼接结果）
            break;
          }

          // ---- Reasoning ----
          case 'reasoning': {
            const d = event.data as { content?: string };
            if (d?.content) { appendCurrentReasoning(d.content); appendReasoningContent(assistantMsgId, d.content); setAgentStatus('thinking', '推理中...'); }
            break;
          }
          case 'reasoning_ended': {
            // 推理完成，不额外处理
            break;
          }

          // ---- Tool calls ----
          case 'tool_call': {
            const d = event.data as { id?: string; name?: string; arguments?: Record<string, unknown> };
            if (d?.id) { const tc: ToolCall = { id: d.id, name: d.name ?? 'unknown', arguments: d.arguments ?? {}, status: 'running', startTime: Date.now() }; updateToolCall(assistantMsgId, tc); setAgentStatus('tool_calling', `调用工具: ${tc.name}`); }
            break;
          }
          case 'tool_result': {
            const d = event.data as { id?: string; result?: unknown; error?: { message?: string }; name?: string; status?: string };
            if (d?.id) { updateToolCall(assistantMsgId, { id: d.id, name: d.name ?? '', arguments: {}, result: d.result, status: (d.error || d.status === 'error') ? 'error' : 'completed', startTime: Date.now(), endTime: Date.now() }); }
            break;
          }
          case 'tool_progress': {
            // 工具执行进度 — 可在 tool call card 中显示
            const d = event.data as { id?: string; content?: unknown[] };
            if (d?.id) { updateToolCall(assistantMsgId, { id: d.id, name: '', arguments: {}, status: 'running', startTime: Date.now() }); }
            break;
          }

          // ---- Permission ----
          case 'permission': { const d = event.data as PermissionRequest; if (d?.id) { addPermissionRequest(d); setAgentStatus('awaiting_permission', `等待审批: ${d.toolName}`); } break; }

          // ---- Question ----
          case 'question': { const d = event.data as { id?: string; sessionID?: string; question?: string; options?: string[]; multiSelect?: boolean }; if (d?.id) { addQuestionRequest({ id: d.id, sessionID: d.sessionID ?? sessionId, question: d.question ?? '', options: d.options, multiSelect: d.multiSelect }); setAgentStatus('awaiting_question', '等待回答问题'); } break; }

          // ---- Agent/Model switched ----
          case 'agent_switched': {
            const d = event.data as { agent?: string };
            if (d?.agent) useChatStore.getState().setAgentStatus('tool_calling', `Agent: ${d.agent}`);
            break;
          }
          case 'model_switched': {
            const d = event.data as { model?: { id?: string } };
            if (d?.model?.id) useChatStore.getState().setSessionModel(sessionId, d.model.id);
            break;
          }

          // ---- Session diff ----
          case 'session_diff': { setLastDiff(event.data); break; }

          // ---- Retried ----
          case 'retried': {
            const d = event.data as { attempt?: number; error?: { message?: string } };
            appendStreamContent(assistantMsgId, `\n\n⚠️ 重试中 (第 ${d?.attempt ?? '?'} 次)...`);
            break;
          }

          // ---- Compaction ----
          case 'compaction_started': {
            setAgentStatus('compacting', '上下文压缩中...');
            break;
          }
          case 'compaction_delta': {
            const d = event.data as { text?: string };
            if (d?.text) appendStreamContent(assistantMsgId, `\n🔄 压缩: ${d.text}`);
            break;
          }
          case 'compaction_ended': {
            setAgentStatus('thinking', '压缩完成');
            break;
          }

          // ---- Shell ----
          case 'shell_started': {
            const d = event.data as { command?: string };
            if (d?.command) { appendStreamContent(assistantMsgId, `\n\n🖥️ 执行: \`${d.command}\``); setAgentStatus('shell_executing', `执行: ${d.command}`); }
            break;
          }
          case 'shell_ended': {
            setAgentStatus('tool_calling', 'Shell 完成');
            break;
          }

          // ---- Error ----
          case 'error': case 'session_error': { const d = event.data as { message?: string }; appendStreamContent(assistantMsgId, `\n\n❌ 错误: ${d?.message ?? '未知错误'}`); setAgentStatus('error', '发生错误'); break; }
          case 'done': finishStreaming(assistantMsgId); clearCurrentReasoning(); setAgentStatus('idle'); break;
        }
      },
      (error: Error) => { appendStreamContent(assistantMsgId, `\n\n❌ 连接错误: ${error.message}`); finishStreaming(assistantMsgId); setAgentStatus('error', '连接失败'); setSending(false); },
      () => { finishStreaming(assistantMsgId); clearCurrentReasoning(); setAgentStatus('idle'); setSending(false); },
      {
        model: currentSession?.model,
        modelID: currentSession?.model,
        providerID: 'deepseek',
        // 只有有效的 OpenCode agent 才传递，否则让服务端使用默认 agent
        agent: currentSession?.agentName && ['build', 'plan'].includes(currentSession.agentName) ? currentSession.agentName : undefined,
        delivery: isPlanMode ? 'queue' : 'steer',
      }
    );
  }, [text, isSending, currentSessionId, currentSession, isPlanMode, setSending, setAgentStatus, clearCurrentReasoning, addUserMessage, addAssistantMessage, appendStreamContent, appendReasoningContent, finishStreaming, updateToolCall, addPermissionRequest, addQuestionRequest, appendCurrentReasoning, setLastDiff]);

  const handleAbort = () => { opencodeClient.cancel(); setAgentStatus('idle'); setSending(false); };

  return (
    <div className="inbar">
      <div className="inbar-in">
        <div className={`incard ${focused ? 'fcs' : ''}`} ref={incardRef} style={{ position: 'relative' }}>
          {/* Drag Handle */}
          <div className="drag" onPointerDown={onDragStart}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /></svg>
          </div>

          {/* Command Palette */}
          <CommandPalette
            visible={showCommands}
            onSelect={(cmd) => { setText(cmd + ' '); setShowCommands(false); textareaRef.current?.focus(); }}
            onClose={() => setShowCommands(false)}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="inp"
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              // 检测 / 前缀弹出命令面板
              if (v.startsWith('/') && !v.includes(' ')) {
                setShowCommands(true);
              } else {
                setShowCommands(false);
              }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !showCommands) { e.preventDefault(); handleSend(); } }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="输入消息... (输入 / 查看命令, Enter 发送)"
            disabled={isSending}
            style={{ height: inputHeight + 'px' }}
          />

          {/* Toolbar */}
          <div className="intb">
            <div className="tl-l">
              <button className="tbtn" title="附件"><Paperclip size={14} /></button>
              <button className="tbtn" title="引用"><AtSign size={14} /></button>
              <button className={`tbtn ${isPlanMode ? 'plan-on' : ''}`} title="Plan 模式" onClick={() => setIsPlanMode(!isPlanMode)}>
                <ListChecks size={14} />
              </button>
            </div>
            <div className="tl-r">
              {isPlanMode && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'rgb(var(--purple))' }}>
                  <ListChecks size={10} />Plan
                </span>
              )}
              <span style={{ fontSize: 10, color: 'rgb(var(--t3))' }}>{tokenLabel}/{(tokenTotal / 1000).toFixed(0)}k</span>
              {isSending ? (
                <button className="stop" title="停止" onClick={handleAbort}><Square size={14} /></button>
              ) : (
                <button className={`send ${text.trim() ? 'on' : 'off'}`} title="发送" onClick={handleSend} disabled={!text.trim()}>
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ActionBar (Diff / Revert)
// ═══════════════════════════════════════════════════════════════════

function ActionBar() {
  const { isSending, setLastDiff, lastDiff, sessions, currentSessionId } = useChatStore();
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [revertResult, setRevertResult] = useState<{ success: boolean; message: string } | null>(null);
  const [compacting, setCompacting] = useState(false);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const handleViewDiff = async () => {
    const diff = await opencodeClient.getSessionDiff();
    if (diff) {
      setLastDiff(diff);
      setShowDiffModal(true);
    }
  };

  const handleCompact = async () => {
    const sid = currentSession?.serverSessionId || opencodeClient.getCurrentSessionId();
    if (!sid) return;
    setCompacting(true);
    try {
      await opencodeClient.compactSession(sid);
    } catch { /* ignore */ }
    setCompacting(false);
  };

  const handleRevert = async () => {
    const messages = currentSession?.messages ?? [];
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    const messageID = lastAssistant?.id;
    const ok = await opencodeClient.revertSession(messageID);
    setRevertResult({ success: ok.ok, message: ok.ok ? 'AI 的修改已撤销' : '无法撤销修改' });
    setShowRevertModal(true);
  };
  const handleUnrevert = async () => {
    const ok = await opencodeClient.unrevertSession();
    setRevertResult({ success: ok.ok, message: ok.ok ? '已恢复撤销的修改' : '无法恢复修改' });
    setShowRevertModal(true);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 14px' }}>
        <button onClick={handleViewDiff} disabled={isSending} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, fontSize: 10, color: 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer', opacity: isSending ? 0.3 : 1 }}>
          <GitCompare size={11} /> Diff
        </button>
        <button onClick={handleRevert} disabled={isSending} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, fontSize: 10, color: 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer', opacity: isSending ? 0.3 : 1 }}>
          <Undo2 size={11} /> 回滚
        </button>
        <button onClick={handleUnrevert} disabled={isSending} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, fontSize: 10, color: 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer', opacity: isSending ? 0.3 : 1 }}>
          <Undo2 size={11} style={{ transform: 'scaleX(-1)' }} /> 撤销回滚
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={handleCompact} disabled={isSending || compacting} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, fontSize: 10, color: 'rgb(var(--cyan))', background: 0, border: 0, cursor: 'pointer', opacity: (isSending || compacting) ? 0.3 : 1 }}>
          <Zap size={11} /> {compacting ? '压缩中...' : '压缩上下文'}
        </button>
        <button onClick={() => setShowContext(!showContext)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, fontSize: 10, color: showContext ? 'rgb(var(--blue))' : 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer' }}>
          <Eye size={11} /> 上下文
        </button>
      </div>

      {/* Context Panel */}
      <ContextPanel sessionId={currentSession?.serverSessionId || undefined} visible={showContext} onClose={() => setShowContext(false)} />

      {/* Diff Modal - 使用 DiffViewer */}
      {showDiffModal && (
        <div className="set-ov" style={{ position: 'fixed' }} onClick={() => setShowDiffModal(false)}>
          <div className="set-m" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="set-h">
              <div className="t">会话变更</div>
              <button className="set-x" onClick={() => setShowDiffModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div style={{ padding: 16, maxHeight: 400, overflow: 'auto' }}>
              <DiffViewer diff={lastDiff} />
            </div>
            <div className="set-ft">
              <div />
              <button className="btn-p" onClick={() => setShowDiffModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Revert Modal */}
      {showRevertModal && revertResult && (
        <div className="set-ov" style={{ position: 'fixed' }} onClick={() => setShowRevertModal(false)}>
          <div className="set-m" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="set-h">
              <div className="t">{revertResult.success ? '回滚成功' : '回滚失败'}</div>
              <button className="set-x" onClick={() => setShowRevertModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: revertResult.success ? 'rgb(var(--green))' : 'rgb(var(--rose))' }}>
              {revertResult.success ? <Shield size={16} /> : <ShieldAlert size={16} />}
              {revertResult.message}
            </div>
            <div className="set-ft">
              <div />
              <button className="btn-p" onClick={() => setShowRevertModal(false)}>确定</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SettingsPanel (embedded in main area)
// ═══════════════════════════════════════════════════════════════════

interface SettingsPanelProps {
  onClose: () => void;
}

function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { apiBaseUrl, apiKey, setApiBaseUrl, setApiKey } = useModelConfigStore();
  const { sessions, currentSessionId } = useChatStore();
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const [localModel, setLocalModel] = useState(currentSession?.model || 'deepseek-chat');
  const [localBaseUrl, setLocalBaseUrl] = useState(apiBaseUrl || '');
  const [localKey, setLocalKey] = useState(apiKey || '');
  const [localPvfPort, setLocalPvfPort] = useState('27000');
  const [localSystemPrompt, setLocalSystemPrompt] = useState('你是 PVF 游戏数据编辑助手，帮助用户查看和修改装备、技能等游戏数据。');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'api' | 'permissions' | 'providers' | 'skills' | 'mcp' | 'search' | 'vcs' | 'config' | 'project' | 'lsp' | 'about'>('api');

  return (
    <div className="set-ov">
      <div className="set-m" style={{ maxWidth: 480 }}>
        <div className="set-h">
          <div className="t">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--blue))" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" /></svg>
            设置
          </div>
          <button className="set-x" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '0 16px', borderBottom: '1px solid rgb(var(--bd1))', flexWrap: 'wrap' }}>
          {[
            { key: 'api' as const, label: 'API' },
            { key: 'permissions' as const, label: '权限' },
            { key: 'providers' as const, label: '提供商' },
            { key: 'skills' as const, label: '技能' },
            { key: 'mcp' as const, label: 'MCP' },
            { key: 'search' as const, label: '搜索' },
            { key: 'vcs' as const, label: 'Git' },
            { key: 'config' as const, label: '配置' },
            { key: 'project' as const, label: '项目' },
            { key: 'lsp' as const, label: 'LSP' },
            { key: 'about' as const, label: '关于' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '6px 12px', fontSize: 11, fontWeight: 500,
                color: tab === t.key ? 'rgb(var(--blue))' : 'rgb(var(--t3))',
                background: 'transparent', border: 0, cursor: 'pointer',
                borderBottom: tab === t.key ? '2px solid rgb(var(--blue))' : '2px solid transparent',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ padding: 16, maxHeight: 400, overflowY: 'auto' }}>
          {tab === 'api' && (
            <div className="set-f">
              <div>
                <label className="fl">模型名称</label>
                <input className="fi" value={localModel} onChange={(e) => setLocalModel(e.target.value)} placeholder="例如 deepseek-chat" />
              </div>
              <div>
                <label className="fl">API Key</label>
                <input className="fi mono" type="password" value={localKey} onChange={(e) => setLocalKey(e.target.value)} placeholder="sk-..." />
              </div>
              <div>
                <label className="fl">API 地址</label>
                <input className="fi" value={localBaseUrl} onChange={(e) => setLocalBaseUrl(e.target.value)} placeholder="例如 https://api.deepseek.com" />
              </div>
              <div>
                <label className="fl">PVF 端口</label>
                <input className="fi mono" style={{ width: 120 }} value={localPvfPort} onChange={(e) => setLocalPvfPort(e.target.value)} placeholder="27000" />
              </div>
              <div>
                <label className="fl">系统提示词</label>
                <textarea className="fi" rows={3} style={{ resize: 'none' }} value={localSystemPrompt} onChange={(e) => setLocalSystemPrompt(e.target.value)} />
              </div>
            </div>
          )}
          {tab === 'permissions' && <PermissionManager />}
          {tab === 'providers' && <ProviderPanel />}
          {tab === 'skills' && <SkillPanel />}
          {tab === 'mcp' && <McpManager />}
          {tab === 'search' && <SearchPanel />}
          {tab === 'vcs' && <VcsPanel />}
          {tab === 'config' && <GlobalSettingsPanel />}
          {tab === 'project' && <ProjectPanel />}
          {tab === 'lsp' && <LspPanel />}
          {tab === 'about' && <AboutPanel />}
        </div>

        {tab === 'api' && (
          <div className="set-ft">
            <button className="btn-t" onClick={async () => {
              try {
                const [opencodeOk, pvfutOk] = await Promise.all([
                  opencodeClient.healthCheck(),
                  opencodeClient.isPvfutAvailable(),
                ]);
                const lines: string[] = [];
                lines.push(`OpenCode Server: ${opencodeOk ? '✅ 已连接' : '❌ 未连接'}`);
                lines.push(`PVFut 服务: ${pvfutOk ? '✅ 已连接' : '⚠️ 未启动（不影响 AI 对话）'}`);
                alert(lines.join('\n'));
              } catch { alert('连接测试失败'); }
            }}>测试连接</button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-s" onClick={onClose}>取消</button>
              <button className="btn-p" disabled={saving} onClick={async () => {
                setSaving(true);
                try {
                  // 1. 保存到本地 store
                  setApiBaseUrl(localBaseUrl);
                  setApiKey(localKey);
                  // 2. 保存模型到当前会话
                  if (currentSessionId) {
                    useChatStore.getState().setSessionModel(currentSessionId, localModel);
                  }
                  // 3. 同步到 OpenCode 服务端配置
                  //    OpenCode PATCH /config 不支持顶层 apiKey/apiBaseUrl
                  //    必须通过 provider 配置传递，格式：
                  //    { model: "deepseek/deepseek-chat", provider: { deepseek: { options: { apiKey, baseURL } } } }
                  const configUpdate: Record<string, unknown> = {};
                  if (localModel) configUpdate['model'] = localModel;
                  if (localKey || localBaseUrl) {
                    configUpdate['provider'] = {
                      deepseek: {
                        options: {
                          ...(localKey ? { apiKey: localKey } : {}),
                          ...(localBaseUrl ? { baseURL: localBaseUrl } : {}),
                        }
                      }
                    };
                  }
                  if (Object.keys(configUpdate).length > 0) {
                    const ok = await opencodeClient.updateConfig(configUpdate);
                    if (!ok) {
                      console.warn('[Settings] updateConfig 返回 false，服务端可能未接受配置');
                    }
                  }
                  onClose();
                } catch {
                  // 即使服务端更新失败，本地配置也已保存
                  onClose();
                } finally {
                  setSaving(false);
                }
              }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ChatPanel Main
// ═══════════════════════════════════════════════════════════════════

interface ChatPanelProps {
  rightOpen: boolean;
  onToggleRight: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ rightOpen, onToggleRight, settingsOpen, onToggleSettings }) => {
  return (
    <div className="mn">
      <AgentStateBar rightOpen={rightOpen} onToggleRight={onToggleRight} />
      <ActionBar />
      <ChatCanvas />
      <InputBar />
      {settingsOpen && <SettingsPanel onClose={onToggleSettings} />}
    </div>
  );
};
