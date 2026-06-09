import React, { useState, useEffect, useCallback } from 'react';
import {
  Code2, RefreshCw, Circle, FileCode2,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import type { LspStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════
// LSP / Formatter Status Panel
// ═══════════════════════════════════════════════════════════════════

export function LspPanel() {
  const [lspServers, setLspServers] = useState<LspStatus[]>([]);
  const [formatter, setFormatter] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [lsp, fmt] = await Promise.all([
        opencodeClient.getLspStatus(),
        opencodeClient.getFormatterStatus(),
      ]);
      setLspServers(lsp);
      setFormatter(fmt);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const statusColor = (s: string) => {
    switch (s) {
      case 'running': return 'rgb(var(--green))';
      case 'stopped': return 'rgb(var(--t3))';
      case 'error': return 'rgb(var(--rose))';
      default: return 'rgb(var(--t3))';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Code2 size={16} style={{ color: 'rgb(var(--purple))' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>LSP / 格式化</span>
        </div>
        <button onClick={refresh} disabled={loading} style={iconBtnStyle} title="刷新">
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* LSP Servers */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'rgb(var(--t2))' }}>
          语言服务器
        </div>
        {lspServers.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgb(var(--t3))' }}>无 LSP 服务器</div>
        ) : (
          lspServers.map((srv) => (
            <div key={srv.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <Circle size={8} fill={statusColor(srv.status)} color={statusColor(srv.status)} />
              <span style={{ fontSize: 12, fontWeight: 500 }}>{srv.name}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>({srv.languageId})</span>
              <span style={{ fontSize: 11, color: statusColor(srv.status), flex: 1, textAlign: 'right' }}>
                {srv.status}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Formatter */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'rgb(var(--t2))' }}>
          <FileCode2 size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          格式化器
        </div>
        {formatter ? (
          <div style={{ fontSize: 12, color: 'rgb(var(--t2))' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(formatter, null, 2)}</pre>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgb(var(--t3))' }}>无格式化器</div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════

const cardStyle: React.CSSProperties = {
  background: 'rgb(var(--b2))', borderRadius: 8, padding: 10, fontSize: 13,
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'rgb(var(--t2))', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center',
};
