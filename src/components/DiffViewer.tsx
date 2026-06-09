import React, { useMemo } from 'react';
import { Plus, Minus, FileCode } from 'lucide-react';

interface DiffViewerProps {
  diff: unknown;
}

interface DiffEntry {
  path?: string;
  type?: 'add' | 'delete' | 'modify';
  content?: string;
  hunks?: DiffHunk[];
}

interface DiffHunk {
  header?: string;
  lines?: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
}

function parseDiff(raw: unknown): DiffEntry[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return [{ path: 'unknown', type: 'modify', content: raw }];
  }
  if (Array.isArray(raw)) {
    return raw.map((item: Record<string, unknown>) => ({
      path: String(item.path ?? item.file ?? 'unknown'),
      type: item.type as DiffEntry['type'] ?? 'modify',
      content: typeof item.content === 'string' ? item.content : JSON.stringify(item, null, 2),
    }));
  }
  return [{ path: 'data', type: 'modify', content: JSON.stringify(raw, null, 2) }];
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff }) => {
  const entries = useMemo(() => parseDiff(diff), [diff]);

  if (entries.length === 0) {
    return <p style={{ fontSize: 11, color: 'rgb(var(--t3))', padding: 8 }}>无变更</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((entry, i) => {
        const icon = entry.type === 'add' ? <Plus size={10} style={{ color: 'rgb(var(--green))' }} /> :
                     entry.type === 'delete' ? <Minus size={10} style={{ color: 'rgb(var(--rose))' }} /> :
                     <FileCode size={10} style={{ color: 'rgb(var(--blue))' }} />;
        const badgeColor = entry.type === 'add' ? 'rgb(var(--green) / .1)' :
                          entry.type === 'delete' ? 'rgb(var(--rose) / .1)' :
                          'rgb(var(--blue) / .1)';
        const badgeText = entry.type === 'add' ? '新增' : entry.type === 'delete' ? '删除' : '修改';
        const badgeTextColor = entry.type === 'add' ? 'rgb(var(--green))' :
                              entry.type === 'delete' ? 'rgb(var(--rose))' :
                              'rgb(var(--blue))';

        return (
          <div key={i} style={{ borderRadius: 8, border: '1px solid rgb(var(--bd1))', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgb(var(--b2))', borderBottom: '1px solid rgb(var(--bd1))' }}>
              {icon}
              <span style={{ fontSize: 11, color: 'rgb(var(--t1))', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.path}
              </span>
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: badgeColor, color: badgeTextColor, fontWeight: 500 }}>
                {badgeText}
              </span>
            </div>
            {entry.content && (
              <pre style={{ padding: 8, fontSize: 10, lineHeight: 1.5, color: 'rgb(var(--t2))', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: 200, overflowY: 'auto' }}>
                {entry.content}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};
