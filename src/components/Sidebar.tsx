import React, { useState, useCallback } from 'react';
import {
  MessageSquare, Plus, Bot, Key, Trash2, RefreshCw, ChevronLeft, ChevronRight, LogOut,
} from 'lucide-react';
import { useChatStore } from '../stores/useChatStore';
import { useAuthStore } from '../stores/useAuthStore';
import { opencodeClient } from '../services/opencodeClient';
import { UsagePanel } from './UsagePanel';
import type { Session } from '../types';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSettingsClick?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapse, onSettingsClick }) => {
  const { sessions, currentSessionId, createSession, switchSession, deleteSession, setServerSessionId } = useChatStore();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);

  const handleNewSession = useCallback(async () => {
    const localId = createSession();
    // V2 API 不需要显式创建 session，prompt 时自动创建
    // 重置 opencodeClient 的当前 session，下次发送消息时自动创建
    opencodeClient.resetConversation();
    try {
      // 如果 server 在线，提前获取现有 session 列表以关联
      if (opencodeClient.isServerMode()) {
        const result = await opencodeClient.listSessions({ limit: 1 });
        if (result.data.length > 0) {
          const first = result.data[0] as { id?: string };
          if (first.id) setServerSessionId(localId, first.id);
        }
      }
    } catch {
      // 服务端不可用时仍可使用本地会话
    }
  }, [createSession, setServerSessionId]);

  const handleSwitchSession = useCallback((id: string) => {
    if (id === currentSessionId) return;
    switchSession(id);
    // 设置 opencodeClient 的当前会话 ID
    const session = sessions.find(s => s.id === id);
    if (session?.serverSessionId) {
      opencodeClient.setCurrentSessionId(session.serverSessionId);
    } else {
      opencodeClient.resetConversation();
    }
  }, [currentSessionId, switchSession, sessions]);

  const handleDeleteSession = useCallback(async (id: string) => {
    // 先调用后端删除 API，再从本地 store 移除
    const session = sessions.find((s) => s.id === id);
    if (session?.serverSessionId) {
      await opencodeClient.deleteSession(session.serverSessionId).catch(() => {});
    }
    deleteSession(id);
  }, [deleteSession, sessions]);

  const handleRefreshServer = useCallback(async () => {
    await opencodeClient.startServer();
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo */}
      <div className="logo">
        <div className="logo-i">
          <Bot size={16} color="#fff" />
        </div>
        {!collapsed && (
          <div className="logo-t">
            PVF Suite <span style={{ fontSize: 11, color: 'rgb(var(--cyan))' }}>✦</span>
          </div>
        )}
      </div>

      {/* New Chat Button */}
      <button className="nbtn" onClick={handleNewSession}>
        <Plus size={15} />
        {!collapsed && <span className="sbt">新对话</span>}
      </button>

      {/* Session List */}
      <div className="clist">
        {sessions.length === 0 ? (
          !collapsed && <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 11, color: 'rgb(var(--t3))', opacity: 0.3 }}>暂无会话</div>
        ) : (
          sessions.map((session: Session) => (
            <div
              key={session.id}
              className={`ci ${session.id === currentSessionId ? 'on' : ''}`}
              onMouseEnter={() => setHoveredSession(session.id)}
              onMouseLeave={() => setHoveredSession(null)}
              onClick={() => handleSwitchSession(session.id)}
            >
              <MessageSquare size={14} />
              {!collapsed && (
                <>
                  <span>{session.title}</span>
                  {hoveredSession === session.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                      style={{
                        background: 0, border: 0, color: 'rgb(var(--t3))', cursor: 'pointer',
                        padding: '0 2px', fontSize: 11, opacity: 0.3, transition: '.15s',
                      }}
                      title="删除会话"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom Buttons */}
      <div className="bb">
        {!collapsed && <UsagePanel />}
        <button className="bbtn" onClick={handleRefreshServer}>
          <RefreshCw size={14} />
          {!collapsed && <span className="sbt">刷新会话</span>}
        </button>
        <button className="bbtn" onClick={onSettingsClick}>
          <Key size={14} />
          {!collapsed && <span className="sbt">API 配置</span>}
        </button>
        <button className="bbtn" onClick={() => { opencodeClient.stopServer(); logout(); }}>
          <LogOut size={14} />
          {!collapsed && <span className="sbt">退出登录</span>}
        </button>
        <button className="bbtn" onClick={onToggleCollapse}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && <span className="sbt">折叠</span>}
        </button>
      </div>
    </div>
  );
};
