import React, { useState, useCallback } from 'react';
import { FileText, RefreshCw, ChevronRight, Folder, File } from 'lucide-react';
import { opencodeClient, type FsEntry } from '../services/opencodeClient';

interface FileExplorerProps {
  onFileSelect?: (path: string, content: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect }) => {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await opencodeClient.listDirectory(path ? { path } : undefined);
      setEntries(result);
      setCurrentPath(path);
      setFileContent(null);
      setViewingFile(null);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEntryClick = useCallback(async (entry: FsEntry) => {
    if (entry.type === 'directory') {
      await loadDirectory(entry.path);
    } else {
      setLoading(true);
      try {
        const content = await opencodeClient.readFile(entry.path);
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        setFileContent(text);
        setViewingFile(entry.path);
        onFileSelect?.(entry.path, text);
      } catch {
        setFileContent('读取文件失败');
      } finally {
        setLoading(false);
      }
    }
  }, [loadDirectory, onFileSelect]);

  // 面包屑
  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgb(var(--bd1))' }}>
        <FileText size={13} style={{ color: 'rgb(var(--blue))' }} />
        <span style={{ fontSize: 11, fontWeight: 500, color: 'rgb(var(--t1))' }}>文件浏览器</span>
        <button
          onClick={() => loadDirectory('')}
          disabled={loading}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 9, color: 'rgb(var(--t3))', background: 'transparent', border: 0, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}
        >
          <RefreshCw size={9} className={loading ? 'animate-spin' : ''} /> 根目录
        </button>
      </div>

      {/* Breadcrumb */}
      {pathParts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 12px', fontSize: 10, color: 'rgb(var(--t3))', borderBottom: '1px solid rgb(var(--bd1))' }}>
          <button onClick={() => loadDirectory('')} style={{ background: 0, border: 0, cursor: 'pointer', color: 'rgb(var(--blue))', fontSize: 10, padding: 0 }}>root</button>
          {pathParts.map((part, i) => (
            <React.Fragment key={i}>
              <ChevronRight size={8} />
              <button
                onClick={() => loadDirectory(pathParts.slice(0, i + 1).join('/'))}
                style={{ background: 0, border: 0, cursor: 'pointer', color: i === pathParts.length - 1 ? 'rgb(var(--t1))' : 'rgb(var(--blue))', fontSize: 10, padding: 0 }}
              >
                {part}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* File List or Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {viewingFile ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderBottom: '1px solid rgb(var(--bd1))' }}>
              <File size={10} style={{ color: 'rgb(var(--t3))' }} />
              <span style={{ fontSize: 10, color: 'rgb(var(--t1))', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewingFile}</span>
              <button onClick={() => { setViewingFile(null); setFileContent(null); }} style={{ fontSize: 9, color: 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer' }}>返回</button>
            </div>
            <pre style={{ padding: 8, fontSize: 10, lineHeight: 1.5, color: 'rgb(var(--t2))', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              {fileContent}
            </pre>
          </div>
        ) : (
          <div style={{ padding: 4 }}>
            {entries.length === 0 && !loading && (
              <div style={{ padding: '20px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 11, color: 'rgb(var(--t3))', margin: 0 }}>
                  {currentPath ? '目录为空' : '点击"根目录"浏览文件'}
                </p>
              </div>
            )}
            {entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => handleEntryClick(entry)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', padding: '5px 10px',
                  borderRadius: 5, border: 0,
                  background: 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background .1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--b3))'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {entry.type === 'directory' ? (
                  <Folder size={11} style={{ color: 'rgb(var(--amber))', flexShrink: 0 }} />
                ) : (
                  <File size={11} style={{ color: 'rgb(var(--t3))', flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 11, color: 'rgb(var(--t1))', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
