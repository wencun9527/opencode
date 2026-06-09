import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Save, RefreshCw, Key, Server,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import type { ConfigInfo } from '../types';

// ═══════════════════════════════════════════════════════════════════
// Global Settings Panel — Config + Auth management
// ═══════════════════════════════════════════════════════════════════

export function SettingsPanel() {
  const [config, setConfig] = useState<ConfigInfo>({});
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editingValue, setEditingValue] = useState('');
  const [authProvider, setAuthProvider] = useState('');
  const [authCreds, setAuthCreds] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await opencodeClient.getConfig();
      setConfig(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUpdate = async () => {
    if (!editingKey) return;
    const updated = { ...config, [editingKey]: editingValue };
    await opencodeClient.updateConfig(updated);
    setConfig(updated);
    setEditingKey('');
    setEditingValue('');
  };

  const handleSetAuth = async () => {
    if (!authProvider || !authCreds) return;
    try {
      const creds = JSON.parse(authCreds);
      await opencodeClient.setAuthProvider(authProvider, creds);
      setAuthProvider('');
      setAuthCreds('');
    } catch {
      // invalid JSON
    }
  };

  const handleRemoveAuth = async (provider: string) => {
    await opencodeClient.removeAuthProvider(provider);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings size={16} style={{ color: 'rgb(var(--blue))' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>全局配置</span>
        </div>
        <button onClick={refresh} disabled={loading} style={iconBtnStyle} title="刷新">
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Current Config */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'rgb(var(--t2))' }}>
          <Server size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          当前配置
        </div>
        {Object.keys(config).length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgb(var(--t3))' }}>无配置数据</div>
        ) : (
          Object.entries(config).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
              <code style={{ color: 'rgb(var(--cyan))', minWidth: 120 }}>{key}</code>
              <span style={{ color: 'rgb(var(--t2))' }}>{String(value)}</span>
            </div>
          ))
        )}
      </div>

      {/* Edit Config */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          <Save size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          修改配置
        </div>
        <input placeholder="配置键" value={editingKey} onChange={(e) => setEditingKey(e.target.value)} style={inputStyle} />
        <input placeholder="配置值" value={editingValue} onChange={(e) => setEditingValue(e.target.value)} style={inputStyle} />
        <button onClick={handleUpdate} disabled={!editingKey} style={primaryBtnStyle}>更新</button>
      </div>

      {/* Auth Management */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          <Key size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          认证管理
        </div>
        <input placeholder="Provider ID (如 openai)" value={authProvider} onChange={(e) => setAuthProvider(e.target.value)} style={inputStyle} />
        <input placeholder='凭据 JSON (如 {"apiKey":"sk-..."})' value={authCreds} onChange={(e) => setAuthCreds(e.target.value)} style={inputStyle} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={handleSetAuth} disabled={!authProvider || !authCreds} style={primaryBtnStyle}>设置认证</button>
          <button onClick={() => handleRemoveAuth(authProvider)} disabled={!authProvider} style={ghostBtnStyle}>移除认证</button>
        </div>
      </div>
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
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'rgb(var(--t2))', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 6,
  border: '1px solid rgb(var(--b3))', background: 'rgb(var(--b1))',
  color: 'rgb(var(--t1))', fontSize: 12, marginBottom: 6, outline: 'none',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 6, border: 'none',
  background: 'rgb(var(--accent))', color: '#fff', fontSize: 12, cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid rgb(var(--b3))',
  background: 'transparent', color: 'rgb(var(--t2))', fontSize: 12, cursor: 'pointer',
};
