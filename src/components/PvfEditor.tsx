import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Save, RefreshCw, Pencil, File, Link, Search, Download, Trash2,
  Table as TableIcon, Bug, FileText, Copy, ShoppingBag, Database,
  Check, X, Columns, ChevronLeft, ChevronRight, Loader2, XCircle,
  AlertCircle, CheckCircle, FolderOpen, Folder, ChevronDown, Wrench,
} from 'lucide-react';
import { usePvfStore } from '../stores/usePvfStore';
import { pvfBridge } from '../services/pvfBridge';
import type { PvfItem, ItemInfo, LstFileEntry, TreeNode } from '../types';

// ===== Tab 定义 =====
type RightTab = 'files' | 'editor' | 'tools';

const TABS: { key: RightTab; label: string; icon: typeof FolderOpen }[] = [
  { key: 'files', label: '文件', icon: FolderOpen },
  { key: 'editor', label: '编辑', icon: Pencil },
  { key: 'tools', label: '工具', icon: Wrench },
];

// ===== 简易通知系统 =====
type ToastType = 'success' | 'error' | 'warning';

interface Toast { id: number; type: ToastType; message: string; }

let toastIdCounter = 0;
const toastListeners: Set<(toasts: Toast[]) => void> = new Set();
let currentToasts: Toast[] = [];

function emitToast(type: ToastType, message: string) {
  const id = ++toastIdCounter;
  currentToasts = [...currentToasts, { id, type, message }];
  toastListeners.forEach((fn) => fn(currentToasts));
  setTimeout(() => {
    currentToasts = currentToasts.filter((t) => t.id !== id);
    toastListeners.forEach((fn) => fn(currentToasts));
  }, 3000);
}

const msg = {
  success: (text: string) => emitToast('success', text),
  error: (text: string) => emitToast('error', text),
  warning: (text: string) => emitToast('warning', text),
};

const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    toastListeners.add(setToasts);
    return () => { toastListeners.delete(setToasts); };
  }, []);
  if (toasts.length === 0) return null;
  const iconMap: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle size={14} />,
    error: <XCircle size={14} />,
    warning: <AlertCircle size={14} />,
  };
  return (
    <div className="toast-c">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {iconMap[t.type]}
          <p style={{ flex: 1 }}>{t.message}</p>
          <button onClick={() => { currentToasts = currentToasts.filter(x => x.id !== t.id); toastListeners.forEach(fn => fn(currentToasts)); }} style={{ flexShrink: 0, color: 'rgb(var(--t3))', background: 0, border: 0, cursor: 'pointer', padding: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
};

// ===== PVF Editor =====
const PAGE_SIZE = 100;

export const PvfEditor: React.FC = () => {
  const {
    connectionStatus, editState, packInfo, lstFiles, selectedFiles, editingField,
    treeData, setConnectionStatus, openFile, updateFieldValue, markDirty, saveFile, setError,
    setPackInfo, setLstFiles, setSelectedFiles, toggleFileSelection, setEditingField, setTreeData,
  } = usePvfStore();

  const [rightTab, setRightTab] = useState<RightTab>('files');
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<PvfItem[] | null>(null);
  const [editorMode, setEditorMode] = useState<'field' | 'text' | 'info'>('field');
  const [textContent, setTextContent] = useState('');
  const [encoding, setEncoding] = useState<string>('UTF8');
  const [itemInfoModalOpen, setItemInfoModalOpen] = useState(false);
  const [currentItemInfo, setCurrentItemInfo] = useState<ItemInfo | null>(null);
  const [itemInfoTab, setItemInfoTab] = useState<'itemInfo' | 'itemCode'>('itemInfo');
  const [itemCodeSearch, setItemCodeSearch] = useState<number | null>(null);
  const [itemCodeResult, setItemCodeResult] = useState<Record<string, unknown> | null>(null);
  const [lstModalOpen, setLstModalOpen] = useState(false);
  const [lstDetail, setLstDetail] = useState<unknown>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const fieldInputRef = useRef<HTMLInputElement>(null);

  const refreshFileList = useCallback(async () => {
    setConnectionStatus('connecting'); setLoading(true);
    try {
      const status = await pvfBridge.checkConnection();
      setConnectionStatus(status);
      if (status === 'connected') {
        const dirs = await pvfBridge.getPvfRootDirectory();
        const dirList = Array.isArray(dirs) ? (dirs as string[]) : [];
        // 根目录直接作为顶层树节点，path 统一以 / 结尾
        const roots: TreeNode[] = dirList.map(d => ({
          name: d.replace(/\/$/, ''),
          path: d.endsWith('/') ? d : d + '/',
          isDirectory: true,
          children: [],
          loaded: false,
          expanded: false,
        }));
        setTreeData(roots);
        const packPath = await pvfBridge.getPvfPackFilePath();
        const version = await pvfBridge.getVersion();
        setPackInfo({ filePath: packPath, version });
      }
    } catch (err) { setConnectionStatus('error'); setError(`连接失败: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setLoading(false); }
  }, []);

  /** 加载指定目录的内容并构建子树节点 */
  const loadTreeNode = async (dirPath: string): Promise<TreeNode[]> => {
    // 确保 dirPath 以 / 结尾，避免切片后首元素为空
    const normalizedDir = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const fileListData = await pvfBridge.getFileList(dirPath, '', 0);
    const nodes: TreeNode[] = [];
    if (!Array.isArray(fileListData)) return nodes;

    const subDirs = new Map<string, true>(); // 收集子目录
    const fileNodes: TreeNode[] = [];

    for (const file of fileListData) {
      const filePath = typeof file === 'string' ? file : (file as Record<string, unknown>).FileName as string;
      if (!filePath) continue;

      // 去掉前缀，得到相对路径
      let relPath = filePath.startsWith(normalizedDir) ? filePath.slice(normalizedDir.length)
        : filePath.startsWith(dirPath) ? filePath.slice(dirPath.length)
        : filePath;
      // 去掉开头的 /
      if (relPath.startsWith('/')) relPath = relPath.slice(1);

      if (relPath.includes('/')) {
        // 路径含 /，说明有子目录，提取第一级子目录名
        const subDirName = relPath.split('/')[0];
        if (subDirName && !subDirs.has(subDirName)) {
          subDirs.set(subDirName, true);
          nodes.push({
            name: subDirName,
            path: normalizedDir + subDirName + '/',
            isDirectory: true,
            children: [],
            loaded: false,
            expanded: false,
          });
        }
      } else {
        // 直接文件
        fileNodes.push({
          name: relPath,
          path: filePath,
          isDirectory: false,
          children: [],
          loaded: true,
          expanded: false,
        });
      }
    }

    // 目录排在前面，文件排在后面
    return [...nodes, ...fileNodes];
  };

  /** 展开/折叠树节点 */
  const toggleTreeNode = async (path: string) => {
    const update = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map(node => {
        if (node.path === path) {
          if (!node.loaded) {
            // 懒加载：异步获取子节点后更新
            loadTreeNode(path).then(children => {
              setTreeData(prev => setNodeChildren(prev, path, children, true));
            });
            return { ...node, expanded: true };
          }
          return { ...node, expanded: !node.expanded };
        }
        if (node.children.length > 0) {
          return { ...node, children: update(node.children) };
        }
        return node;
      });
    setTreeData(prev => update(prev));
  };

  /** 更新指定路径节点的 children */
  const setNodeChildren = (nodes: TreeNode[], path: string, children: TreeNode[], expanded: boolean): TreeNode[] =>
    nodes.map(node => {
      if (node.path === path) return { ...node, children, loaded: true, expanded };
      if (node.children.length > 0) return { ...node, children: setNodeChildren(node.children, path, children, expanded) };
      return node;
    });

  const handleSearch = async () => {
    if (!searchKeyword.trim()) { setSearchResults(null); return; }
    setLoading(true);
    try {
      const results = await pvfBridge.searchPvf(searchKeyword, '', 1, false);
      const items: PvfItem[] = [];
      if (Array.isArray(results)) {
        for (const r of results.slice(0, 200)) {
          const filePath = typeof r === 'string' ? r : (r as Record<string, unknown>)?.FilePath as string ?? (r as Record<string, unknown>)?.FileName as string;
          if (!filePath) continue;
          const fileName = filePath.includes('/') ? filePath.split('/').pop()! : filePath;
          items.push({ path: filePath, name: fileName, isDirectory: false, size: 0 });
        }
      }
      setSearchResults(items); setCurrentPage(1);
    } catch (err) { msg.error(`搜索失败: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setLoading(false); }
  };

  const handleOpenFile = async (record: PvfItem) => {
    if (record.isDirectory) return; // 目录由 TreeNodeView 的 toggleTreeNode 处理
    setLoading(true);
    try {
      const content = await pvfBridge.getFileContent(record.path, encoding, false);
      setTextContent(typeof content === 'string' ? content : JSON.stringify(content));
      const data = await pvfBridge.getFileDataJson(record.path);
      openFile(record.path, data as Record<string, unknown>);
      setEditorMode('field');
      setRightTab('editor');
    } catch (err) { msg.error(`打开文件失败: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!editState.currentFile) return;
    try {
      if (editorMode === 'text') await pvfBridge.importFile(editState.currentFile, textContent);
      else await pvfBridge.importFile(editState.currentFile, JSON.stringify(editState.fileData));
      saveFile(); msg.success('文件已保存');
    } catch (err) { msg.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleSaveAs = async () => {
    const path = prompt('输入保存路径:');
    if (!path) return;
    try { await pvfBridge.saveAsPvf(path); msg.success(`已另存为: ${path}`); }
    catch (err) { msg.error(`另存为失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleDelete = async (record: PvfItem) => {
    if (!confirm(`确定删除 ${record.name}？`)) return;
    try { await pvfBridge.deleteFile(record.path); msg.success('已删除'); refreshFileList(); }
    catch (err) { msg.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleViewItemInfo = async (filePath: string) => {
    try { const info = await pvfBridge.getItemInfo(filePath); setCurrentItemInfo(info as ItemInfo); setItemInfoModalOpen(true); setItemInfoTab('itemInfo'); }
    catch (err) { msg.error(`获取物品信息失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleItemCodeSearch = async () => {
    if (itemCodeSearch === null) return;
    try { const result = await pvfBridge.itemCodeToFileInfo('', itemCodeSearch); setItemCodeResult(result as Record<string, unknown> | null); }
    catch (err) { msg.error(`物品代码查询失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleOpenLstBrowser = async () => {
    try {
      const files = await pvfBridge.getAllLstFileList();
      const entries: LstFileEntry[] = [];
      if (Array.isArray(files)) {
        for (const f of files) {
          const path = typeof f === 'string' ? f : (f as Record<string, unknown>)?.FilePath as string ?? String(f);
          entries.push({ path, lstName: path.split('/').pop() ?? path });
        }
      }
      setLstFiles(entries); setLstModalOpen(true); setLstDetail(null);
    } catch (err) { msg.error(`加载 LST 列表失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleLstDetail = async (filePath: string) => {
    try { const detail = await pvfBridge.getLstFileInfo(filePath); setLstDetail(detail); }
    catch (err) { msg.error(`获取 LST 详情失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleBatchDelete = async () => {
    if (selectedFiles.length === 0) return;
    if (!confirm(`确定删除 ${selectedFiles.length} 个文件？`)) return;
    try { await pvfBridge.deleteFilesBatch(selectedFiles); msg.success(`已删除 ${selectedFiles.length} 个文件`); setSelectedFiles([]); refreshFileList(); }
    catch (err) { msg.error(`批量删除失败: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleFieldEdit = (key: string, currentValue: unknown) => { setEditingField({ key, value: String(currentValue ?? '') }); };
  const handleFieldSave = (newValue: string) => {
    if (!editingField) return;
    let parsed: unknown = newValue;
    if (newValue === 'true') parsed = true;
    else if (newValue === 'false') parsed = false;
    else if (!isNaN(Number(newValue)) && newValue.trim() !== '') parsed = Number(newValue);
    else { try { parsed = JSON.parse(newValue); } catch { /* keep as string */ } }
    updateFieldValue(editingField.key, parsed); msg.success(`字段 ${editingField.key} 已更新`);
  };

  const handleCopyPath = (path: string) => { navigator.clipboard.writeText(path); msg.success('已复制路径'); };

  useEffect(() => { if (usePvfStore.getState().treeData.length === 0) refreshFileList(); }, []);

  const displayFiles = searchResults ?? [];
  const totalPages = Math.max(1, Math.ceil(displayFiles.length / PAGE_SIZE));
  const pagedFiles = displayFiles.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // ── Render ──
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ToastContainer />

      {/* Tabs */}
      <div className="rp-tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`rp-tab ${rightTab === key ? 'on' : ''}`} onClick={() => setRightTab(key)}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rp-srch">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input
          placeholder={rightTab === 'files' ? '搜索文件...' : rightTab === 'editor' ? '搜索字段...' : '搜索物品代码...'}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { if (rightTab === 'files') handleSearch(); else if (rightTab === 'tools') handleItemCodeSearch(); } }}
        />
      </div>

      {/* Content */}
      <div className="rp-con">
        {rightTab === 'files' && (
          <FilesTab
            connectionStatus={connectionStatus} treeData={treeData}
            toggleTreeNode={toggleTreeNode} searchResults={searchResults} setSearchResults={setSearchResults}
            setSearchKeyword={setSearchKeyword} pagedFiles={pagedFiles} loading={loading}
            batchMode={batchMode} selectedFiles={selectedFiles} currentPage={currentPage}
            totalPages={totalPages} setCurrentPage={setCurrentPage} handleOpenFile={handleOpenFile}
            handleDelete={handleDelete} handleViewItemInfo={handleViewItemInfo} handleCopyPath={handleCopyPath}
            toggleFileSelection={toggleFileSelection} handleBatchDelete={handleBatchDelete}
            refreshFileList={refreshFileList} encoding={encoding} setEncoding={setEncoding}
          />
        )}
        {rightTab === 'editor' && (
          <EditorTab editState={editState} editorMode={editorMode} setEditorMode={setEditorMode}
            textContent={textContent} setTextContent={setTextContent} encoding={encoding}
            packInfo={packInfo} editingField={editingField} fieldInputRef={fieldInputRef}
            handleFieldEdit={handleFieldEdit} handleFieldSave={handleFieldSave} setEditingField={setEditingField}
            handleViewItemInfo={handleViewItemInfo} markDirty={markDirty}
          />
        )}
        {rightTab === 'tools' && (
          <ToolsTab connectionStatus={connectionStatus} handleOpenLstBrowser={handleOpenLstBrowser}
            setItemInfoModalOpen={setItemInfoModalOpen} setItemInfoTab={setItemInfoTab}
            itemCodeSearch={itemCodeSearch} setItemCodeSearch={setItemCodeSearch}
            handleItemCodeSearch={handleItemCodeSearch} itemCodeResult={itemCodeResult} handleSaveAs={handleSaveAs}
          />
        )}
      </div>

      {/* Bottom Actions */}
      <div className="rp-bt">
        {rightTab === 'files' && (
          <>
            <button className="rp-act" onClick={() => { setBatchMode(!batchMode); setSelectedFiles([]); }}>
              <Columns size={12} />{batchMode ? '退出批量' : '批量模式'}
            </button>
            <button className="rp-act" onClick={refreshFileList} style={{ flex: '0 0 auto', padding: '7px 10px' }}>
              {loading ? <Loader2 size={12} className="anim-spin" /> : <RefreshCw size={12} />}
            </button>
          </>
        )}
        {rightTab === 'editor' && (
          <>
            <button className="rp-act" onClick={handleSave} disabled={!editState.currentFile || !editState.isDirty} style={{ opacity: editState.isDirty ? 1 : 0.4 }}>
              <Save size={12} />保存
            </button>
            <button className="rp-act" onClick={() => { usePvfStore.getState().closeFile(); setTextContent(''); setRightTab('files'); }} style={{ flex: '0 0 auto', padding: '7px 10px' }}>
              <ChevronLeft size={12} />
            </button>
          </>
        )}
        {rightTab === 'tools' && (
          <button className="rp-act" onClick={refreshFileList} disabled={connectionStatus !== 'connected'} style={{ opacity: connectionStatus === 'connected' ? 1 : 0.4 }}>
            <RefreshCw size={12} />重新连接
          </button>
        )}
      </div>

      {/* Item Info Modal */}
      {itemInfoModalOpen && (
        <div className="set-ov" style={{ position: 'fixed' }} onClick={() => setItemInfoModalOpen(false)}>
          <div className="set-m" style={{ maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="set-h">
              <div className="t"><ShoppingBag size={14} style={{ color: 'rgb(var(--purple))' }} /> 物品信息 & 代码查询</div>
              <button className="set-x" onClick={() => setItemInfoModalOpen(false)}><X size={14} /></button>
            </div>
            <div style={{ display: 'flex', padding: '0 4px', borderBottom: '1px solid rgb(var(--bd1))' }}>
              {(['itemInfo', 'itemCode'] as const).map((key) => (
                <button key={key} className={`rp-tab ${itemInfoTab === key ? 'on' : ''}`} onClick={() => setItemInfoTab(key)} style={{ flex: 1 }}>
                  {key === 'itemInfo' ? <><ShoppingBag size={13} />物品信息</> : <><Search size={13} />物品代码查询</>}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {itemInfoTab === 'itemInfo' ? (
                currentItemInfo ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Object.entries(currentItemInfo).map(([k, v]) => (
                      <div key={k} className="rp-it" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))', minWidth: 80 }}>{k}</span>
                        <span style={{ fontSize: 12, color: 'rgb(var(--t1))', wordBreak: 'break-all' }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgb(var(--t3))' }}>
                    <ShoppingBag size={28} style={{ marginBottom: 12 }} />
                    <p style={{ fontSize: 13 }}>点击文件列表中的物品图标查看</p>
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" className="fi" placeholder="输入物品代码" value={itemCodeSearch ?? ''} onChange={(e) => setItemCodeSearch(e.target.value === '' ? null : Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') handleItemCodeSearch(); }} />
                    <button className="btn-p" onClick={handleItemCodeSearch}>查询</button>
                  </div>
                  {itemCodeResult && <pre style={{ padding: 12, borderRadius: 5, background: 'rgb(var(--b0))', fontSize: 11, color: 'rgb(var(--t2))', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(itemCodeResult, null, 2)}</pre>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LST Modal */}
      {lstModalOpen && (
        <div className="set-ov" style={{ position: 'fixed' }} onClick={() => setLstModalOpen(false)}>
          <div className="set-m" style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="set-h">
              <div className="t"><Database size={14} style={{ color: 'rgb(var(--purple))' }} /> LST 文件浏览器</div>
              <button className="set-x" onClick={() => setLstModalOpen(false)}><X size={14} /></button>
            </div>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ width: '50%', overflow: 'auto', borderRight: '1px solid rgb(var(--bd1))' }}>
                {lstFiles.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgb(var(--t3))' }}><Database size={28} style={{ marginBottom: 12 }} /><p style={{ fontSize: 13 }}>无 LST 文件</p></div>
                ) : lstFiles.map((lst) => (
                  <div key={lst.path} className="rp-it" style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgb(var(--bd1) / .5)' }} onClick={() => handleLstDetail(lst.path)}>
                    <div style={{ width: 24, height: 24, borderRadius: 5, background: 'rgb(var(--purple) / .1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Database size={11} style={{ color: 'rgb(var(--purple))' }} />
                    </div>
                    <span style={{ fontSize: 13, color: 'rgb(var(--t1))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lst.lstName}</span>
                  </div>
                ))}
              </div>
              <div style={{ width: '50%', overflow: 'auto', padding: 12 }}>
                {lstDetail ? <pre style={{ padding: 12, borderRadius: 5, background: 'rgb(var(--b0))', fontSize: 11, color: 'rgb(var(--t2))', maxHeight: 400, overflow: 'auto' }}>{JSON.stringify(lstDetail, null, 2).slice(0, 5000)}</pre>
                  : <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgb(var(--t3))' }}><Database size={28} style={{ marginBottom: 12 }} /><p style={{ fontSize: 13 }}>选择左侧 LST 文件查看详情</p></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// Tree Node View (递归组件)
// ══════════════════════════════════════════════════════════════════

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  toggleTreeNode: (path: string) => void;
  handleOpenFile: (record: PvfItem) => Promise<void>;
  handleDelete: (record: PvfItem) => Promise<void>;
  handleViewItemInfo: (filePath: string) => Promise<void>;
  handleCopyPath: (path: string) => void;
  batchMode: boolean;
  selectedFiles: string[];
  toggleFileSelection: (path: string) => void;
}

const TreeNodeView: React.FC<TreeNodeViewProps> = ({
  node, depth, toggleTreeNode, handleOpenFile, handleDelete,
  handleViewItemInfo, handleCopyPath, batchMode, selectedFiles, toggleFileSelection,
}) => {
  const isDir = node.isDirectory;

  const handleClick = () => {
    if (isDir) {
      toggleTreeNode(node.path);
    } else {
      handleOpenFile({ path: node.path, name: node.name, isDirectory: false, size: 0 });
    }
  };

  return (
    <div>
      <div
        className="rp-it"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingLeft: depth * 16 + 6,
          cursor: 'pointer',
        }}
        onClick={handleClick}
      >
        {batchMode && !isDir && (
          <input type="checkbox" checked={selectedFiles.includes(node.path)} onChange={() => toggleFileSelection(node.path)} onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }} />
        )}
        {/* 展开/折叠箭头 */}
        <div style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isDir ? (
            node.expanded ? <ChevronDown size={11} style={{ color: 'rgb(var(--t3))' }} /> : <ChevronRight size={11} style={{ color: 'rgb(var(--t3))' }} />
          ) : null}
        </div>
        {/* 图标 */}
        <div style={{ width: 22, height: 22, borderRadius: 4, background: isDir ? 'rgb(var(--amber) / .1)' : 'rgb(var(--blue) / .1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isDir ? (
            node.expanded ? <FolderOpen size={11} style={{ color: 'rgb(var(--amber))' }} /> : <Folder size={11} style={{ color: 'rgb(var(--amber))' }} />
          ) : (
            <File size={11} style={{ color: 'rgb(var(--blue))' }} />
          )}
        </div>
        {/* 名称 */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 13, color: 'rgb(var(--t1))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isDir ? 500 : 400 }}>
            {node.name}
          </p>
        </div>
        {/* 操作按钮（仅文件） */}
        {!isDir && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button className="sbtn" title="编辑" onClick={() => handleOpenFile({ path: node.path, name: node.name, isDirectory: false, size: 0 })}><Pencil size={12} /></button>
            <button className="sbtn" title="物品信息" onClick={() => handleViewItemInfo(node.path)}><ShoppingBag size={12} /></button>
            <button className="sbtn" title="复制路径" onClick={() => handleCopyPath(node.path)}><Copy size={12} /></button>
            {!batchMode && <button className="sbtn" title="删除" onClick={() => handleDelete({ path: node.path, name: node.name, isDirectory: false, size: 0 })} style={{ color: 'rgb(var(--rose))' }}><Trash2 size={12} /></button>}
          </div>
        )}
      </div>
      {/* 递归渲染子节点 */}
      {isDir && node.expanded && (
        node.loaded && node.children.length === 0 ? (
          <div style={{ paddingLeft: (depth + 1) * 16 + 6, padding: '6px 0', fontSize: 11, color: 'rgb(var(--t3))' }}>空目录</div>
        ) : (
          node.children.map(child => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              toggleTreeNode={toggleTreeNode}
              handleOpenFile={handleOpenFile}
              handleDelete={handleDelete}
              handleViewItemInfo={handleViewItemInfo}
              handleCopyPath={handleCopyPath}
              batchMode={batchMode}
              selectedFiles={selectedFiles}
              toggleFileSelection={toggleFileSelection}
            />
          ))
        )
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// Files Tab
// ══════════════════════════════════════════════════════════════════

interface FilesTabProps {
  connectionStatus: string; treeData: TreeNode[];
  toggleTreeNode: (path: string) => void; searchResults: PvfItem[] | null;
  setSearchResults: (v: PvfItem[] | null) => void; setSearchKeyword: (v: string) => void;
  pagedFiles: PvfItem[]; loading: boolean; batchMode: boolean; selectedFiles: string[];
  currentPage: number; totalPages: number;
  setCurrentPage: (v: number | ((p: number) => number)) => void;
  handleOpenFile: (record: PvfItem) => Promise<void>;
  handleDelete: (record: PvfItem) => Promise<void>;
  handleViewItemInfo: (filePath: string) => Promise<void>;
  handleCopyPath: (path: string) => void; toggleFileSelection: (path: string) => void;
  handleBatchDelete: () => Promise<void>; refreshFileList: () => Promise<void>;
  encoding: string; setEncoding: (v: string) => void;
}

const FilesTab: React.FC<FilesTabProps> = ({
  connectionStatus, treeData, toggleTreeNode,
  searchResults, setSearchResults, setSearchKeyword,
  pagedFiles, loading, batchMode, selectedFiles,
  currentPage, totalPages, setCurrentPage,
  handleOpenFile, handleDelete, handleViewItemInfo, handleCopyPath,
  toggleFileSelection, handleBatchDelete, refreshFileList, encoding, setEncoding,
}) => {
  if (connectionStatus !== 'connected') {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgb(var(--t3))' }}>
        <File size={28} style={{ marginBottom: 12 }} />
        <p style={{ fontSize: 13 }}>PVFut 服务未连接</p>
        <button className="btn-p" style={{ marginTop: 12 }} onClick={refreshFileList}><Link size={13} /> 重新连接</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Encoding */}
      <div style={{ padding: '4px 10px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <select className="fi" value={encoding} onChange={(e) => setEncoding(e.target.value)} style={{ fontSize: 11, padding: '4px 8px' }}>
          <option value="UTF8">UTF8</option><option value="CN">CN</option><option value="TW">TW</option><option value="KR">KR</option><option value="JP">JP</option>
        </select>
        {searchResults !== null && (
          <button style={{ fontSize: 11, color: 'rgb(var(--rose))', background: 0, border: 0, cursor: 'pointer' }} onClick={() => { setSearchResults(null); setSearchKeyword(''); }}>清除搜索</button>
        )}
      </div>

      {/* Batch bar */}
      {batchMode && selectedFiles.length > 0 && (
        <div style={{ padding: '0 10px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgb(var(--t3))' }}>已选 {selectedFiles.length} 个文件</span>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 500, background: 'rgb(var(--rose) / .1)', color: 'rgb(var(--rose))', border: '1px solid rgb(var(--rose) / .3)', cursor: 'pointer' }} onClick={handleBatchDelete}><Trash2 size={11} /> 删除选中</button>
        </div>
      )}

      {/* Tree or Search results */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 2px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}><Loader2 size={24} className="anim-spin" style={{ color: 'rgb(var(--blue))' }} /></div>
        ) : searchResults !== null ? (
          /* 搜索结果：平铺展示 */
          pagedFiles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgb(var(--t3))' }}><Search size={28} style={{ marginBottom: 12 }} /><p style={{ fontSize: 13 }}>无搜索结果</p></div>
          ) : pagedFiles.map((record) => (
            <div key={record.path} className="rp-it" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {batchMode && <input type="checkbox" checked={selectedFiles.includes(record.path)} onChange={() => toggleFileSelection(record.path)} style={{ flexShrink: 0 }} />}
              <div style={{ width: 24, height: 24, borderRadius: 5, background: 'rgb(var(--blue) / .1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <File size={11} style={{ color: 'rgb(var(--blue))' }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }} onClick={() => handleOpenFile(record)}>
                <p style={{ fontSize: 13, color: 'rgb(var(--t1))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.name}</p>
                <p style={{ fontSize: 11, color: 'rgb(var(--t3))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.path}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <button className="sbtn" title="编辑" onClick={() => handleOpenFile(record)}><Pencil size={12} /></button>
                <button className="sbtn" title="物品信息" onClick={() => handleViewItemInfo(record.path)}><ShoppingBag size={12} /></button>
                <button className="sbtn" title="复制路径" onClick={() => handleCopyPath(record.path)}><Copy size={12} /></button>
                {!batchMode && <button className="sbtn" title="删除" onClick={() => handleDelete(record)} style={{ color: 'rgb(var(--rose))' }}><Trash2 size={12} /></button>}
              </div>
            </div>
          ))
        ) : (
          /* 树形展示 */
          treeData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgb(var(--t3))' }}><FolderOpen size={28} style={{ marginBottom: 12 }} /><p style={{ fontSize: 13 }}>无文件</p></div>
          ) : treeData.map(node => (
            <TreeNodeView
              key={node.path}
              node={node}
              depth={0}
              toggleTreeNode={toggleTreeNode}
              handleOpenFile={handleOpenFile}
              handleDelete={handleDelete}
              handleViewItemInfo={handleViewItemInfo}
              handleCopyPath={handleCopyPath}
              batchMode={batchMode}
              selectedFiles={selectedFiles}
              toggleFileSelection={toggleFileSelection}
            />
          ))
        )}
      </div>

      {/* Pagination (搜索模式) */}
      {searchResults !== null && totalPages > 1 && (
        <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <button className="sbtn" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}><ChevronLeft size={12} style={{ transform: 'rotate(90deg)' }} /></button>
          <button className="sbtn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}><ChevronLeft size={12} /></button>
          <span style={{ fontSize: 11, color: 'rgb(var(--t3))', padding: '0 8px' }}>{currentPage} / {totalPages}</span>
          <button className="sbtn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={12} /></button>
          <button className="sbtn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}><ChevronRight size={12} style={{ transform: 'rotate(90deg)' }} /></button>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// Editor Tab
// ══════════════════════════════════════════════════════════════════

interface EditorTabProps {
  editState: { currentFile: string | null; fileData: Record<string, unknown> | null; isDirty: boolean };
  editorMode: 'field' | 'text' | 'info'; setEditorMode: (v: 'field' | 'text' | 'info') => void;
  textContent: string; setTextContent: (v: string) => void; encoding: string;
  packInfo: { filePath: string | null; version: string | null };
  editingField: { key: string; value: string } | null;
  fieldInputRef: React.MutableRefObject<HTMLInputElement | null>;
  handleFieldEdit: (key: string, value: unknown) => void;
  handleFieldSave: (value: string) => void;
  setEditingField: (v: { key: string; value: string } | null) => void;
  handleViewItemInfo: (filePath: string) => Promise<void>;
  markDirty: () => void;
}

const EditorTab: React.FC<EditorTabProps> = ({
  editState, editorMode, setEditorMode, textContent, setTextContent,
  encoding, packInfo, editingField, fieldInputRef,
  handleFieldEdit, handleFieldSave, setEditingField, handleViewItemInfo, markDirty,
}) => {
  if (!editState.currentFile) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgb(var(--t3))' }}>
        <FileText size={28} style={{ marginBottom: 12 }} /><p style={{ fontSize: 13 }}>未打开文件</p>
        <p style={{ fontSize: 11, marginTop: 4 }}>在文件标签中选择文件开始编辑</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* File info */}
      <div style={{ padding: '0 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 7, background: 'rgb(var(--b2))' }}>
          <FileText size={13} style={{ color: 'rgb(var(--blue))', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'rgb(var(--t1))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={editState.currentFile}>{editState.currentFile}</span>
          {editState.isDirty && <span style={{ fontSize: 10, color: 'rgb(var(--amber))', background: 'rgb(var(--amber) / .1)', padding: '2px 6px', borderRadius: 3 }}>未保存</span>}
        </div>
      </div>

      {/* Mode switch */}
      <div style={{ padding: '0 10px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {([['field', '字段', TableIcon], ['text', '文本', FileText], ['info', '信息', Bug]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setEditorMode(key)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 500, background: editorMode === key ? 'rgb(var(--blue) / .1)' : 'transparent', color: editorMode === key ? 'rgb(var(--blue))' : 'rgb(var(--t3))', border: 0, cursor: 'pointer' }}>
            <Icon size={12} />{label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="sbtn" title="物品信息" onClick={() => handleViewItemInfo(editState.currentFile!)}><ShoppingBag size={13} /></button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 6px' }}>
        {editorMode === 'field' && editState.fileData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {Object.entries(editState.fileData).slice(0, 500).map(([key, value]) => {
              const isEditing = editingField?.key === key;
              const displayValue = typeof value === 'object' && value !== null ? JSON.stringify(value).slice(0, 300) : String(value ?? '').slice(0, 300);
              return (
                <div key={key} className="rp-it" onClick={() => !isEditing && handleFieldEdit(key, value)} style={{ cursor: 'pointer' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input ref={fieldInputRef} className="fi" defaultValue={displayValue} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleFieldSave((e.target as HTMLInputElement).value); else if (e.key === 'Escape') setEditingField(null); }} onBlur={(e) => handleFieldSave(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }} />
                      <button className="sbtn" onClick={() => { if (fieldInputRef.current) handleFieldSave(fieldInputRef.current.value); }}><Check size={12} style={{ color: 'rgb(var(--green))' }} /></button>
                      <button className="sbtn" onClick={() => setEditingField(null)}><X size={12} style={{ color: 'rgb(var(--rose))' }} /></button>
                    </div>
                  ) : (
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))' }}>{key}</span>
                      <p style={{ fontSize: 12, color: 'rgb(var(--t1))', marginTop: 2, wordBreak: 'break-all' }}>{displayValue}</p>
                    </div>
                  )}
                </div>
              );
            })}
            {Object.keys(editState.fileData).length > 500 && <div style={{ textAlign: 'center', fontSize: 11, color: 'rgb(var(--t3))', padding: 8 }}>共 {Object.keys(editState.fileData).length} 个字段，仅显示前 500 个</div>}
          </div>
        )}
        {editorMode === 'text' && (
          <textarea className="fi mono" style={{ height: '100%', resize: 'none', fontSize: 13, lineHeight: 1.6 }} value={textContent} onChange={(e) => { setTextContent(e.target.value); if (!editState.isDirty) markDirty(); }} />
        )}
        {editorMode === 'info' && editState.fileData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="rp-it"><span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))' }}>文件路径</span><p style={{ fontSize: 12, color: 'rgb(var(--t1))', marginTop: 2, wordBreak: 'break-all' }}>{editState.currentFile}</p></div>
            <div className="rp-it"><span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))' }}>字段数量</span><p style={{ fontSize: 12, color: 'rgb(var(--t1))', marginTop: 2 }}>{Object.keys(editState.fileData).length}</p></div>
            <div className="rp-it"><span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))' }}>编码</span><p style={{ fontSize: 12, color: 'rgb(var(--t1))', marginTop: 2 }}>{encoding}</p></div>
            <div className="rp-it"><span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))' }}>封包路径</span><p style={{ fontSize: 12, color: 'rgb(var(--t1))', marginTop: 2 }}>{packInfo.filePath ?? '未知'}</p></div>
            <div><span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t3))', padding: '0 10px' }}>原始数据</span><pre style={{ maxHeight: 300, overflow: 'auto', padding: 12, borderRadius: 5, background: 'rgb(var(--b0))', fontSize: 11, color: 'rgb(var(--t2))', margin: '4px 6px' }}>{JSON.stringify(editState.fileData, null, 2).slice(0, 5000)}</pre></div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// Tools Tab
// ══════════════════════════════════════════════════════════════════

interface ToolsTabProps {
  connectionStatus: string; handleOpenLstBrowser: () => Promise<void>;
  setItemInfoModalOpen: (v: boolean) => void; setItemInfoTab: (v: 'itemInfo' | 'itemCode') => void;
  itemCodeSearch: number | null; setItemCodeSearch: (v: number | null) => void;
  handleItemCodeSearch: () => Promise<void>; itemCodeResult: Record<string, unknown> | null;
  handleSaveAs: () => Promise<void>;
}

const ToolsTab: React.FC<ToolsTabProps> = ({
  connectionStatus, handleOpenLstBrowser, setItemInfoModalOpen, setItemInfoTab,
  itemCodeSearch, setItemCodeSearch, handleItemCodeSearch, itemCodeResult, handleSaveAs,
}) => {
  const tools = [
    { icon: Database, label: 'LST 浏览器', desc: '浏览和搜索 LST 文件列表', color: 'var(--purple)', onClick: handleOpenLstBrowser },
    { icon: ShoppingBag, label: '物品信息查询', desc: '查看物品属性和代码信息', color: 'var(--cyan)', onClick: () => { setItemInfoModalOpen(true); setItemInfoTab('itemInfo'); } },
    { icon: Search, label: '物品代码查询', desc: '通过代码反查物品文件', color: 'var(--amber)', onClick: () => { setItemInfoModalOpen(true); setItemInfoTab('itemCode'); } },
    { icon: Download, label: '另存为 PVF', desc: '将当前封包另存为新文件', color: 'var(--green)', onClick: handleSaveAs },
  ];

  return (
    <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button key={tool.label} className="rp-it" onClick={tool.onClick} disabled={connectionStatus !== 'connected'} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%', background: 0, border: 0, color: 'inherit', font: 'inherit', cursor: connectionStatus === 'connected' ? 'pointer' : 'default', opacity: connectionStatus === 'connected' ? 1 : 0.4 }}>
            <div style={{ width: 26, height: 26, borderRadius: 5, background: `rgb(${tool.color} / .1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              <Icon size={12} style={{ color: `rgb(${tool.color})` }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13, color: 'rgb(var(--t1))', fontWeight: 500 }}>{tool.label}</p>
              <p style={{ fontSize: 11, color: 'rgb(var(--t3))', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{tool.desc}</p>
            </div>
          </button>
        );
      })}

      {/* Quick item code search */}
      <div style={{ padding: '10px', marginTop: 8, borderRadius: 7, background: 'rgb(var(--b2))' }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--t2))', marginBottom: 8 }}>快速物品代码查询</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="number" className="fi" placeholder="输入物品代码" value={itemCodeSearch ?? ''} onChange={(e) => setItemCodeSearch(e.target.value === '' ? null : Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') handleItemCodeSearch(); }} />
          <button className="btn-p" onClick={handleItemCodeSearch} disabled={connectionStatus !== 'connected'}>查询</button>
        </div>
        {itemCodeResult && <pre style={{ marginTop: 8, padding: 8, borderRadius: 5, background: 'rgb(var(--b0))', fontSize: 11, color: 'rgb(var(--t2))', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(itemCodeResult, null, 2)}</pre>}
      </div>
    </div>
  );
};
