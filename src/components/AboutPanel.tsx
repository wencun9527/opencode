import React, { useState, useCallback } from 'react';
import {
  Info, RefreshCw, Download, Trash2, AlertTriangle,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';

// ═══════════════════════════════════════════════════════════════════
// About Panel — Version, Health, Upgrade, Dispose
// ═══════════════════════════════════════════════════════════════════

export function AboutPanel() {
  const [healthStatus, setHealthStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [globalHealth, setGlobalHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [upgrading, setUpgrading] = useState(false);
  const [serverUrl] = useState(opencodeClient.getServerUrl());

  const checkHealth = useCallback(async () => {
    const ok = await opencodeClient.healthCheck();
    setHealthStatus(ok ? 'ok' : 'error');
  }, []);

  const checkGlobalHealth = useCallback(async () => {
    const ok = await opencodeClient.globalHealthCheck();
    setGlobalHealth(ok ? 'ok' : 'error');
  }, []);

  const handleUpgrade = async () => {
    setUpgrading(true);
    await opencodeClient.upgrade();
    setUpgrading(false);
  };

  const handleDispose = async () => {
    if (!confirm('确定要释放所有 OpenCode 实例吗？这将断开所有连接。')) return;
    await opencodeClient.globalDispose();
  };

  const handleInstanceDispose = async () => {
    if (!confirm('确定要释放当前实例吗？')) return;
    await opencodeClient.disposeInstance();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'ok': return 'rgb(var(--green))';
      case 'error': return 'rgb(var(--rose))';
      default: return 'rgb(var(--t3))';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Info size={16} style={{ color: 'rgb(var(--blue))' }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>关于 / 系统</span>
      </div>

      {/* Server Info */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>服务器信息</div>
        <div style={{ fontSize: 12, color: 'rgb(var(--t2))' }}>
          <div>URL: <code style={{ color: 'rgb(var(--cyan))' }}>{serverUrl || '未连接'}</code></div>
          <div>模式: {opencodeClient.isServerMode() ? 'Server' : 'Standalone'}</div>
        </div>
      </div>

      {/* Health Checks */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>健康检查</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(healthStatus) }} />
            <span style={{ fontSize: 12, flex: 1 }}>V2 API (/api/health)</span>
            <button onClick={checkHealth} style={ghostBtnStyle}>
              <RefreshCw size={12} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(globalHealth) }} />
            <span style={{ fontSize: 12, flex: 1 }}>全局 (/global/health)</span>
            <button onClick={checkGlobalHealth} style={ghostBtnStyle}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>操作</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={handleUpgrade} disabled={upgrading} style={{
            ...primaryBtnStyle, display: 'flex', alignItems: 'center', gap: 4,
            opacity: upgrading ? 0.5 : 1,
          }}>
            <Download size={13} /> {upgrading ? '升级中...' : '升级 OpenCode'}
          </button>
          <button onClick={handleInstanceDispose} style={{
            ...dangerBtnStyle, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Trash2 size={13} /> 释放当前实例
          </button>
          <button onClick={handleDispose} style={{
            ...dangerBtnStyle, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <AlertTriangle size={13} /> 释放所有实例
          </button>
        </div>
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

const ghostBtnStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 6, border: '1px solid rgb(var(--b3))',
  background: 'transparent', color: 'rgb(var(--t2))', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: 'none',
  background: 'rgb(var(--accent))', color: '#fff', fontSize: 12, cursor: 'pointer',
  width: '100%',
};

const dangerBtnStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid rgb(var(--rose) / .3)',
  background: 'rgb(var(--rose) / .05)', color: 'rgb(var(--rose))', fontSize: 12, cursor: 'pointer',
  width: '100%',
};
