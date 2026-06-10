import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PvfConnectionStatus, PvfItem, PvfEditState, PvfPackInfo, ItemInfo, LstFileEntry, TreeNode } from '../types';

/** PVF 状态管理 */
interface PvfState {
  /** PVF 连接状态 */
  connectionStatus: PvfConnectionStatus;
  /** 文件列表 */
  fileList: PvfItem[];
  /** 当前编辑状态 */
  editState: PvfEditState;
  /** 错误信息 */
  error: string | null;
  /** 封包信息（P7） */
  packInfo: PvfPackInfo;
  /** 物品信息缓存（P1） */
  itemInfoCache: Record<string, ItemInfo>;
  /** LST 文件列表（P4） */
  lstFiles: LstFileEntry[];
  /** 字符串表缓存（P5） */
  stringTable: Record<string, string> | null;
  /** 批量选中文件列表（P6） */
  selectedFiles: string[];
  /** 当前编辑字段（P9） */
  editingField: { key: string; value: string } | null;
  /** 文件树数据（持久化避免切换 tab 重新加载） */
  treeData: TreeNode[];

  // ===== 操作方法 =====
  /** 设置连接状态 */
  setConnectionStatus: (status: PvfConnectionStatus) => void;
  /** 设置文件列表 */
  setFileList: (files: PvfItem[]) => void;
  /** 打开文件进行编辑 */
  openFile: (path: string, data: Record<string, unknown>) => void;
  /** 更新编辑中的文件数据 */
  updateFileData: (data: Record<string, unknown>) => void;
  /** 更新单个字段值（P9） */
  updateFieldValue: (key: string, value: unknown) => void;
  /** 标记文件已修改 */
  markDirty: () => void;
  /** 保存文件（清除脏标记） */
  saveFile: () => void;
  /** 关闭当前文件 */
  closeFile: () => void;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
  /** 设置封包信息（P7） */
  setPackInfo: (info: Partial<PvfPackInfo>) => void;
  /** 缓存物品信息（P1） */
  cacheItemInfo: (filePath: string, info: ItemInfo) => void;
  /** 批量缓存物品信息（P1） */
  cacheItemInfos: (infos: ItemInfo[]) => void;
  /** 设置 LST 文件列表（P4） */
  setLstFiles: (files: LstFileEntry[]) => void;
  /** 设置字符串表（P5） */
  setStringTable: (table: Record<string, string> | null) => void;
  /** 批量选中文件（P6） */
  setSelectedFiles: (files: string[]) => void;
  /** 切换选中文件（P6） */
  toggleFileSelection: (file: string) => void;
  /** 设置当前编辑字段（P9） */
  setEditingField: (field: { key: string; value: string } | null) => void;
  /** 设置文件树数据 */
  setTreeData: (tree: TreeNode[] | ((prev: TreeNode[]) => TreeNode[])) => void;
}

export const usePvfStore = create<PvfState>()(
  persist(
    (set) => ({
      connectionStatus: 'disconnected',
      fileList: [],
      editState: {
        currentFile: null,
        fileData: null,
        isDirty: false,
      },
      error: null,
      packInfo: {
        filePath: null,
        version: null,
      },
      itemInfoCache: {},
      lstFiles: [],
      stringTable: null,
      selectedFiles: [],
      editingField: null,
      treeData: [],

      setConnectionStatus: (status: PvfConnectionStatus) => {
        set({ connectionStatus: status });
      },

      setFileList: (files: PvfItem[]) => {
        set({ fileList: files });
      },

      openFile: (path: string, data: Record<string, unknown>) => {
        set({
          editState: {
            currentFile: path,
            fileData: data,
            isDirty: false,
            lastSavedAt: Date.now(),
          },
          editingField: null,
        });
      },

      updateFileData: (data: Record<string, unknown>) => {
        set((state) => ({
          editState: {
            ...state.editState,
            fileData: data,
            isDirty: true,
          },
        }));
      },

      updateFieldValue: (key: string, value: unknown) => {
        set((state) => {
          if (!state.editState.fileData) return state;
          return {
            editState: {
              ...state.editState,
              fileData: { ...state.editState.fileData, [key]: value },
              isDirty: true,
            },
            editingField: null,
          };
        });
      },

      markDirty: () => {
        set((state) => ({
          editState: { ...state.editState, isDirty: true },
        }));
      },

      saveFile: () => {
        set((state) => ({
          editState: {
            ...state.editState,
            isDirty: false,
            lastSavedAt: Date.now(),
          },
        }));
      },

      closeFile: () => {
        set({
          editState: {
            currentFile: null,
            fileData: null,
            isDirty: false,
          },
          editingField: null,
        });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      setPackInfo: (info: Partial<PvfPackInfo>) => {
        set((state) => ({
          packInfo: { ...state.packInfo, ...info },
        }));
      },

      cacheItemInfo: (filePath: string, info: ItemInfo) => {
        set((state) => ({
          itemInfoCache: { ...state.itemInfoCache, [filePath]: info },
        }));
      },

      cacheItemInfos: (infos: ItemInfo[]) => {
        set((state) => {
          const cache = { ...state.itemInfoCache };
          for (const info of infos) {
            cache[info.filePath] = info;
          }
          return { itemInfoCache: cache };
        });
      },

      setLstFiles: (files: LstFileEntry[]) => {
        set({ lstFiles: files });
      },

      setStringTable: (table: Record<string, string> | null) => {
        set({ stringTable: table });
      },

      setSelectedFiles: (files: string[]) => {
        set({ selectedFiles: files });
      },

      toggleFileSelection: (file: string) => {
        set((state) => {
          const selected = state.selectedFiles.includes(file)
            ? state.selectedFiles.filter((f) => f !== file)
            : [...state.selectedFiles, file];
          return { selectedFiles: selected };
        });
      },

      setEditingField: (field: { key: string; value: string } | null) => {
        set({ editingField: field });
      },

      setTreeData: (tree: TreeNode[] | ((prev: TreeNode[]) => TreeNode[])) => {
        if (typeof tree === 'function') {
          set((state) => ({ treeData: tree(state.treeData) }));
        } else {
          set({ treeData: tree });
        }
      },
    }),
    {
      name: 'pvf-store',
      partialize: (state) => ({
        packInfo: state.packInfo,
        lstFiles: state.lstFiles,
      }),
    }
  )
);
