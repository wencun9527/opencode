import React, { useState } from 'react';
import { Globe, Search, RefreshCw } from 'lucide-react';
import { pvfBridge } from '../services/pvfBridge';
import { usePvfStore } from '../stores/usePvfStore';

export const StringTableViewer: React.FC = () => {
  const { stringTable, setStringTable } = usePvfStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStringTable = async () => {
    setLoading(true);
    try {
      const data = await pvfBridge.getStringTable();
      if (data && typeof data === 'object') {
        setStringTable(data as Record<string, string>);
      }
    } catch (err) {
      console.error('加载字符串表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    if (!stringTable) {
      await loadStringTable();
    }
  };

  const filteredEntries = stringTable
    ? Object.entries(stringTable).filter(([key, value]) =>
        !search || key.toLowerCase().includes(search.toLowerCase()) || value.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const displayEntries = filteredEntries.slice(0, 500);

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-t-2 hover:text-t-1 hover:bg-bg-2 transition-colors"
      >
        <Globe size={15} />
        字符串表
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-3xl rounded-2xl border border-bdr-1 bg-bg-1 shadow-xl animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-bdr-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-t-1">
                <Globe size={15} className="text-brand-blue" />
                字符串表
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded-md text-t-3 hover:text-t-1 hover:bg-bg-3 transition-colors">
                ✕
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-t-3" />
                <input
                  type="text"
                  placeholder="搜索键或值..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-bg-2 border border-bdr-1 rounded-lg py-2 pl-9 pr-3 text-sm text-t-1 outline-none focus:border-brand-blue/50 transition-colors"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={loadStringTable}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-t-3 hover:text-t-1 hover:bg-bg-3 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  重新加载
                </button>
                <span className="text-xs text-t-3">
                  共 {filteredEntries.length} 条{filteredEntries.length > 500 ? '（仅显示前 500 条）' : ''}
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-1">
                  <tr className="border-b border-bdr-1">
                    <th className="text-left px-5 py-2 text-[11px] font-medium text-t-3 uppercase tracking-wider">键</th>
                    <th className="text-left px-5 py-2 text-[11px] font-medium text-t-3 uppercase tracking-wider">值</th>
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.map(([key, value]) => (
                    <tr key={key} className="border-b border-bdr-1 hover:bg-bg-2 transition-colors">
                      <td className="px-5 py-1.5 text-xs mono text-brand-cyan truncate max-w-[200px]">{key}</td>
                      <td className="px-5 py-1.5 text-xs text-t-2 truncate">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
