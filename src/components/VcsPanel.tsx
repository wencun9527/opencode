import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, RefreshCw, FilePlus, FileMinus, FileEdit, ArrowRightLeft,
  ChevronDown, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import type { VcsInfo, VcsFileStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════
// VCS / Git Panel
// ═══════════════════════════════════════════════════════════════════

export function VcsPanel() {
  const [vcsInfo, setVcsInfo] = useState<VcsInfo | null>(null);
  const [files, setFiles] = useState<VcsFileStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [info, status] = await Promise.all([
        opencodeClient.getVcsInfo(),
        opencodeClient.getVcsStatus(),
      ]);
      setVcsInfo(info);
      setFiles(status);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const viewDiff = async (filePath?: string) => {
    const d = await opencodeClient.getVcsDiff(filePath ? { path: filePath } : undefined);
    setDiff(d);
    setShowDiff(true);
  };

  const viewRawPatch = async () => {
    const d = await opencodeClient.getVcsDiffRaw();
    setDiff(d);
    setShowDiff(true);
  };

  const toggleFile = (p: string) => {
    setExpandedFiles((prev) => ({ ...prev, [p]: !prev[p] }));
  };

  const statusIcon = (s: VcsFileStatus['status']) => {
    switch (s) {
      case 'added': return <FilePlus size={13} style={{ color: 'rgb(var(--green))' }} />;
      case 'modified': return <FileEdit size={13} style={{ color: 'rgb(var(--amber))' }} />;
      case 'deleted': return <FileMinus size={13} style={{ color: 'rgb(var(--rose))' }} />;
      case 'renamed': return <ArrowRightLeft size={13} style={{ color: 'rgb(var(--cyan))' }} />;
      case 'untracked': return <FilePlus size={13} style={{ color: 'rgb(var(--t3))' }} />;
    }
  };

  const stagedCount = files.filter((f) => f.staged).length;
  const unstagedCount = files.length - stagedCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={16} style={{ color: 'rgb(var(--amber))' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Git</span>
        </div>
        <button onClick={refresh} disabled={loading} style={iconBtnStyle} title="刷新">
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Branch Info */}
      {vcsInfo ? (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <GitBranch size={13} />
            <span style={{ fontWeight: 500, fontSize: 13 }}>{vcsInfo.branch}</span>
            {vcsInfo.dirty && (
              <span style={{ fontSize: 11, color: 'rgb(var(--amber))' }}>• 有变更</span>
            )}
            {!vcsInfo.dirty && (
              <CheckCircle2 size={12} style={{ color: 'rgb(var(--green))' }} />
            )}
          </div>
          {vcsInfo.remote && (
            <div style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>remote: {vcsInfo.remote}</div>
          )}
        </div>
      ) : (
        <div style={{ ...cardStyle, color: 'rgb(var(--t3))', textAlign: 'center', fontSize: 12 }}>
          非 Git 仓库或未连接
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => viewDiff()} style={ghostBtnStyle}>查看 Diff</button>
        <button onClick={viewRawPatch} style={ghostBtnStyle}>原始补丁</button>
      </div>

      {/* Changed Files */}
      {files.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            变更文件 ({files.length})
            <span style={{ color: 'rgb(var(--t3))', fontWeight: 400, marginLeft: 8 }}>
              已暂存 {stagedCount} · 未暂存 {unstagedCount}
            </span>
          </div>
          {files.map((f, i) => (
            <div key={`${f.path}:${i}`} style={{ padding: '2px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                   onClick={() => toggleFile(f.path)}>
                {expandedFiles[f.path] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {statusIcon(f.status)}
                <span style={{ fontSize: 12, flex: 1 }}>{f.path}</span>
                <span style={{ fontSize: 10, color: f.staged ? 'rgb(var(--green))' : 'rgb(var(--t3))' }}>
                  {f.staged ? 'staged' : f.status}
                </span>
              </div>
              {expandedFiles[f.path] && (
                <div style={{ paddingLeft: 24, marginTop: 2 }}>
                  <button onClick={() => viewDiff(f.path)} style={ghostBtnStyle}>查看 Diff</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Diff Viewer */}
      {showDiff && diff && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Diff</span>
            <button onClick={() => setShowDiff(false)} style={iconBtnStyle}>✕</button>
          </div>
          <pre style={{
            fontSize: 11, maxHeight: 300, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            color: 'rgb(var(--t2))', lineHeight: 1.5,
          }}>
            {diff}
          </pre>
        </div>
      )}
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

const ghostBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid rgb(var(--b3))',
  background: 'transparent',
  color: 'rgb(var(--t2))',
  fontSize: 12,
  cursor: 'pointer',
};
