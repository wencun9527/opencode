import React, { useState, useCallback } from 'react';
import {
  Search, FileText, Code2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import type { SearchResult, FileSearchResult, SymbolSearchResult } from '../types';

// ═══════════════════════════════════════════════════════════════════
// Search Panel — Text / File / Symbol search
// ═══════════════════════════════════════════════════════════════════

type SearchTab = 'text' | 'file' | 'symbol';

export function SearchPanel() {
  const [tab, setTab] = useState<SearchTab>('text');
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);

  // Results
  const [textResults, setTextResults] = useState<SearchResult[]>([]);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [symbolResults, setSymbolResults] = useState<SymbolSearchResult[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const opts = path ? { path } : undefined;
      switch (tab) {
        case 'text': {
          const r = await opencodeClient.findText(query, opts);
          setTextResults(r);
          break;
        }
        case 'file': {
          const r = await opencodeClient.findFile(query, opts);
          setFileResults(r);
          break;
        }
        case 'symbol': {
          const r = await opencodeClient.findSymbol(query, opts);
          setSymbolResults(r);
          break;
        }
      }
    } finally {
      setLoading(false);
    }
  }, [query, tab, path]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch();
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const tabs: { key: SearchTab; label: string; icon: React.ReactNode }[] = [
    { key: 'text', label: '文本', icon: <Search size={13} /> },
    { key: 'file', label: '文件', icon: <FileText size={13} /> },
    { key: 'symbol', label: '符号', icon: <Code2 size={13} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={16} style={{ color: 'rgb(var(--cyan))' }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>搜索</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'rgb(var(--b1))', borderRadius: 8, padding: 2 }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderRadius: 6,
              background: tab === t.key ? 'rgb(var(--b2))' : 'transparent',
              color: tab === t.key ? 'rgb(var(--t1))' : 'rgb(var(--t3))',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontWeight: tab === t.key ? 600 : 400,
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          placeholder={tab === 'text' ? '搜索文本 (ripgrep)...' : tab === 'file' ? '文件名模式...' : '符号名称...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          placeholder="路径 (可选)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          style={{ ...inputStyle, width: 120 }}
        />
        <button onClick={doSearch} disabled={loading} style={primaryBtnStyle}>
          <Search size={14} />
        </button>
      </div>

      {/* Results */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {tab === 'text' && textResults.map((r, i) => (
          <div key={`${r.file}:${r.line}:${i}`} style={resultStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                 onClick={() => toggleExpand(`t${i}`)}>
              {expanded[`t${i}`] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <FileText size={12} style={{ color: 'rgb(var(--cyan))' }} />
              <span style={{ fontSize: 12, color: 'rgb(var(--t1))' }}>{r.file}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>:{r.line}</span>
            </div>
            {expanded[`t${i}`] && (
              <pre style={{ margin: '4px 0 0 16px', fontSize: 11, color: 'rgb(var(--t2))', whiteSpace: 'pre-wrap' }}>
                {r.text}
              </pre>
            )}
          </div>
        ))}

        {tab === 'file' && fileResults.map((r, i) => (
          <div key={`${r.path}:${i}`} style={resultStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {r.type === 'directory' ? '📁' : '📄'}
              <span style={{ fontSize: 12 }}>{r.name}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--t3))', flex: 1, textAlign: 'right' }}>{r.path}</span>
            </div>
          </div>
        ))}

        {tab === 'symbol' && symbolResults.map((r, i) => (
          <div key={`${r.path}:${r.name}:${i}`} style={resultStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Code2 size={12} style={{ color: 'rgb(var(--purple))' }} />
              <span style={{ fontSize: 12, fontWeight: 500 }}>{r.name}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>{r.kind}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--t3))', flex: 1, textAlign: 'right' }}>{r.path}:{r.line}</span>
            </div>
          </div>
        ))}

        {!loading && query && (
          (tab === 'text' && textResults.length === 0) ||
          (tab === 'file' && fileResults.length === 0) ||
          (tab === 'symbol' && symbolResults.length === 0)
        ) && (
          <div style={{ textAlign: 'center', color: 'rgb(var(--t3))', fontSize: 12, padding: 20 }}>
            无结果
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid rgb(var(--b3))',
  background: 'rgb(var(--b1))',
  color: 'rgb(var(--t1))',
  fontSize: 12,
  outline: 'none',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'rgb(var(--accent))',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
};

const resultStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  borderBottom: '1px solid rgb(var(--b3) / .3)',
};
