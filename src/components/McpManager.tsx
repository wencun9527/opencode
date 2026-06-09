import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, Plug, Unplug, Plus, RefreshCw, ChevronDown, ChevronRight, Shield,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import type { McpServerStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════
// MCP Server Manager
// ═══════════════════════════════════════════════════════════════════

export function McpManager() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', command: '', args: '', env: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await opencodeClient.getMcpStatus();
      setServers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleConnect = async (name: string) => {
    await opencodeClient.connectMcpServer(name);
    refresh();
  };

  const handleDisconnect = async (name: string) => {
    await opencodeClient.disconnectMcpServer(name);
    refresh();
  };

  const handleAuthenticate = async (name: string) => {
    await opencodeClient.authenticateMcp(name);
    refresh();
  };

  const handleRemoveAuth = async (name: string) => {
    await opencodeClient.removeMcpAuth(name);
    refresh();
  };

  const handleAdd = async () => {
    if (!addForm.name || !addForm.command) return;
    const args = addForm.args ? addForm.args.split(/\s+/) : undefined;
    let env: Record<string, string> | undefined;
    if (addForm.env) {
      try {
        env = JSON.parse(addForm.env);
      } catch { /* ignore */ }
    }
    await opencodeClient.addMcpServer({ name: addForm.name, command: addForm.command, args, env });
    setShowAdd(false);
    setAddForm({ name: '', command: '', args: '', env: '' });
    refresh();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'connected': return 'rgb(var(--green))';
      case 'disconnected': return 'rgb(var(--t3))';
      case 'connecting': return 'rgb(var(--amber))';
      case 'error': return 'rgb(var(--rose))';
      default: return 'rgb(var(--t3))';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Server size={16} style={{ color: 'rgb(var(--purple))' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>MCP 服务器</span>
          <span style={{ fontSize: 12, color: 'rgb(var(--t3))' }}>({servers.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={refresh} disabled={loading} title="刷新"
            style={iconBtnStyle}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} title="添加 MCP 服务器"
            style={iconBtnStyle}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div style={{ ...cardStyle, borderLeft: '3px solid rgb(var(--purple))' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>添加 MCP 服务器</div>
          <input placeholder="名称" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} style={inputStyle} />
          <input placeholder="命令 (如 npx @some/mcp-server)" value={addForm.command} onChange={(e) => setAddForm({ ...addForm, command: e.target.value })} style={inputStyle} />
          <input placeholder="参数 (空格分隔, 可选)" value={addForm.args} onChange={(e) => setAddForm({ ...addForm, args: e.target.value })} style={inputStyle} />
          <input placeholder="环境变量 (JSON, 可选)" value={addForm.env} onChange={(e) => setAddForm({ ...addForm, env: e.target.value })} style={inputStyle} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={handleAdd} style={primaryBtnStyle}>添加</button>
            <button onClick={() => setShowAdd(false)} style={ghostBtnStyle}>取消</button>
          </div>
        </div>
      )}

      {/* Server List */}
      {servers.length === 0 && !loading && (
        <div style={{ ...cardStyle, color: 'rgb(var(--t3))', textAlign: 'center', fontSize: 12 }}>
          无 MCP 服务器
        </div>
      )}
      {servers.map((srv) => (
        <div key={srv.name} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
               onClick={() => toggleExpand(srv.name)}>
            {expanded[srv.name] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(srv.status) }} />
            <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{srv.name}</span>
            <span style={{ fontSize: 11, color: 'rgb(var(--t3))', textTransform: 'capitalize' }}>{srv.status}</span>
            {srv.status === 'connected' ? (
              <button onClick={(e) => { e.stopPropagation(); handleDisconnect(srv.name); }} title="断开" style={iconBtnStyle}>
                <Unplug size={13} />
              </button>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); handleConnect(srv.name); }} title="连接" style={iconBtnStyle}>
                <Plug size={13} />
              </button>
            )}
          </div>
          {expanded[srv.name] && (
            <div style={{ marginTop: 8, paddingLeft: 22 }}>
              {srv.description && <div style={{ fontSize: 12, color: 'rgb(var(--t3))', marginBottom: 6 }}>{srv.description}</div>}
              {srv.error && <div style={{ fontSize: 12, color: 'rgb(var(--rose))', marginBottom: 6 }}>错误: {srv.error}</div>}
              {srv.tools && srv.tools.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--t2))', marginBottom: 4 }}>
                    <Shield size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                    可用工具 ({srv.tools.length})
                  </div>
                  {srv.tools.map((tool) => (
                    <div key={tool.name} style={{ fontSize: 12, padding: '2px 0', color: 'rgb(var(--t2))' }}>
                      <code style={{ color: 'rgb(var(--cyan))' }}>{tool.name}</code>
                      {tool.description && <span style={{ color: 'rgb(var(--t3))', marginLeft: 6 }}>— {tool.description}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button onClick={() => handleAuthenticate(srv.name)} style={ghostBtnStyle}>OAuth 认证</button>
                <button onClick={() => handleRemoveAuth(srv.name)} style={ghostBtnStyle}>移除凭据</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════

const cardStyle: React.CSSProperties = {
  background: 'rgb(var(--b2))',
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'rgb(var(--t2))',
  padding: 4,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid rgb(var(--b3))',
  background: 'rgb(var(--b1))',
  color: 'rgb(var(--t1))',
  fontSize: 12,
  marginBottom: 6,
  outline: 'none',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'rgb(var(--accent))',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid rgb(var(--b3))',
  background: 'transparent',
  color: 'rgb(var(--t2))',
  fontSize: 12,
  cursor: 'pointer',
};
