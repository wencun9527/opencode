import React, { useState, useCallback } from 'react';
import { Layers, RefreshCw, X } from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';

interface ContextPanelProps {
  sessionId?: string;
  visible: boolean;
  onClose: () => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ sessionId, visible, onClose }) => {
  const [context, setContext] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  const loadContext = useCallback(async () => {
    const sid = sessionId || opencodeClient.getCurrentSessionId();
    if (!sid) return;
    setLoading(true);
    try {
      const result = await opencodeClient.getSessionContext(sid);
      setContext(result);
    } catch {
      setContext([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (visible) loadContext();
  }, [visible, loadContext]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 320, zIndex: 40,
      background: 'rgb(var(--b1))',
      borderLeft: '1px solid rgb(var(--bd1))',
      display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 20px rgba(0,0,0,.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid rgb(var(--bd1))' }}>
        <Layers size={13} style={{ color: 'rgb(var(--blue))' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t1))', flex: 1 }}>会话上下文</span>
        <button onClick={loadContext} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 9, color: 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
          <RefreshCw size={9} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={onClose} style={{ padding: 2, background: 0, border: 0, cursor: 'pointer', color: 'rgb(var(--t3))' }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {context.length === 0 ? (
          <p style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>暂无上下文数据</p>
        ) : (
          <pre style={{ fontSize: 10, lineHeight: 1.5, color: 'rgb(var(--t2))', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {JSON.stringify(context, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};
