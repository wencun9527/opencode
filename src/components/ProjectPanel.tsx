import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderKanban, RefreshCw, GitBranchPlus, Edit3, Folder,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import type { ProjectInfo } from '../types';

// ═══════════════════════════════════════════════════════════════════
// Project Panel — Project list, edit, Git init
// ═══════════════════════════════════════════════════════════════════

export function ProjectPanel() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editName, setEditName] = useState('');
  const [directories, setDirectories] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, current] = await Promise.all([
        opencodeClient.listProjects(),
        opencodeClient.getCurrentProject(),
      ]);
      setProjects(list);
      setCurrentProject(current);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleInitGit = async () => {
    await opencodeClient.initGit();
    refresh();
  };

  const handleUpdate = async (id: string) => {
    if (!editName) return;
    await opencodeClient.updateProject(id, { name: editName });
    setEditingId('');
    setEditName('');
    refresh();
  };

  const handleShowDirs = async (id: string) => {
    const dirs = await opencodeClient.getProjectDirectories(id);
    setDirectories(dirs);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderKanban size={16} style={{ color: 'rgb(var(--amber))' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>项目管理</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={handleInitGit} style={ghostBtnStyle} title="初始化 Git">
            <GitBranchPlus size={14} />
          </button>
          <button onClick={refresh} disabled={loading} style={iconBtnStyle} title="刷新">
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* Current Project */}
      {currentProject && (
        <div style={{ ...cardStyle, borderLeft: '3px solid rgb(var(--green))' }}>
          <div style={{ fontSize: 11, color: 'rgb(var(--green))', marginBottom: 4, fontWeight: 600 }}>当前项目</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{currentProject.name}</div>
          <div style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>{currentProject.path}</div>
        </div>
      )}

      {/* Project List */}
      {projects.length === 0 && !loading && (
        <div style={{ ...cardStyle, color: 'rgb(var(--t3))', textAlign: 'center', fontSize: 12 }}>
          无项目
        </div>
      )}
      {projects.map((proj) => (
        <div key={proj.id} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Folder size={14} style={{ color: 'rgb(var(--amber))' }} />
            <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>
              {editingId === proj.id ? (
                <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
              ) : proj.name}
            </span>
            <span style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>{proj.id.slice(0, 8)}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgb(var(--t3))', marginTop: 2 }}>{proj.path}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {editingId === proj.id ? (
              <>
                <button onClick={() => handleUpdate(proj.id)} style={primaryBtnStyle}>保存</button>
                <button onClick={() => setEditingId('')} style={ghostBtnStyle}>取消</button>
              </>
            ) : (
              <>
                <button onClick={() => { setEditingId(proj.id); setEditName(proj.name); }} style={ghostBtnStyle}>
                  <Edit3 size={12} /> 重命名
                </button>
                <button onClick={() => handleShowDirs(proj.id)} style={ghostBtnStyle}>
                  <Folder size={12} /> 目录
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {/* Directories */}
      {directories.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>项目目录</div>
          {directories.map((d, i) => (
            <div key={i} style={{ fontSize: 12, padding: '2px 0', color: 'rgb(var(--t2))' }}>{d}</div>
          ))}
        </div>
      )}
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

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '4px 6px', borderRadius: 4,
  border: '1px solid rgb(var(--b3))', background: 'rgb(var(--b1))',
  color: 'rgb(var(--t1))', fontSize: 12, outline: 'none',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 6, border: 'none',
  background: 'rgb(var(--accent))', color: '#fff', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid rgb(var(--b3))',
  background: 'transparent', color: 'rgb(var(--t2))', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4,
};
