/**
 * PVFut 本地工具桥接
 * 直接调用 pvfUtility WebApi (localhost:27000)
 * API 路径格式: /Api/PvfUtiltiy/{方法名}
 */

import type { PvfConnectionStatus } from '../types';

/** PVFut 服务基础地址（开发模式通过 Vite 代理，生产模式通过 Tauri HTTP 插件） */
const PVFUT_BASE_URL_DEV = '/pvfut-api';
const PVFUT_BASE_URL_PROD = 'http://localhost:27000';

/** 判断是否在 Tauri 桌面环境中运行 */
const isTauri = '__TAURI_INTERNALS__' in window;

/** PVFut 服务基础地址 */
const PVFUT_BASE_URL = isTauri ? PVFUT_BASE_URL_PROD : PVFUT_BASE_URL_DEV;

/**
 * PVFut 本地工具桥接
 * 与 pvfUtility WebApi 通信，管理 PVF 文件的读取、编辑和保存
 */
export class PvfBridge {
  private baseUrl: string;
  private connected: boolean = false;

  constructor(baseUrl: string = PVFUT_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /** 获取连接状态 */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 检查 PVFut 服务连接状态
   */
  async checkConnection(): Promise<PvfConnectionStatus> {
    try {
      const version = await this.getVersion();
      this.connected = !!version;
      return this.connected ? 'connected' : 'error';
    } catch {
      this.connected = false;
      return 'disconnected';
    }
  }

  // ==================== 基础信息 ====================

  /** 获取 pvfUtility 版本号 */
  async getVersion(): Promise<string | null> {
    const data = await this.get('/Api/PvfUtiltiy/getVersion');
    return data != null ? String(data) : null;
  }

  /** 获取 PVF 根目录列表 */
  async getPvfRootDirectory(): Promise<string[]> {
    const data = await this.get('/Api/PvfUtiltiy/getPvfRootDirectory');
    return Array.isArray(data) ? data : [];
  }

  /** 获取当前载入的封包文件路径 */
  async getPvfPackFilePath(): Promise<string | null> {
    const data = await this.get('/Api/PvfUtiltiy/GetPvfPackFilePath');
    return data != null ? String(data) : null;
  }

  // ==================== 文件操作 ====================

  /** 获取指定目录的文件列表 */
  async getFileList(dirName: string, fileType: string = '', returnType: number = 0): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/GetFileList', {
      dirName, returnType, fileType
    });
  }

  /** 获取文件内容 */
  async getFileContent(filePath: string, encodingType: string = 'UTF8', useCompatibleDecompiler: boolean = false): Promise<string> {
    const data = await this.get('/Api/PvfUtiltiy/GetFileContent', {
      filePath, useCompatibleDecompiler, encodingType
    });
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  /** 批量获取文件内容 */
  async getFileContentsBatch(fileList: string[], encodingType: string = 'UTF8', useCompatibleDecompiler: boolean = false): Promise<unknown> {
    return this.post('/Api/PvfUtiltiy/GetFileContents', {
      FileList: fileList,
      UseCompatibleDecompiler: useCompatibleDecompiler,
      EncodingType: encodingType
    });
  }

  /** 获取 PVF 文件内容 (JSON 格式) */
  async getFileDataJson(filePath: string): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/getFileData', { filePath });
  }

  // ==================== 文件写入 ====================

  /** 导入/覆盖文件内容 */
  async importFile(filePath: string, fileContent: string): Promise<unknown> {
    return this.postRaw('/Api/PvfUtiltiy/ImportFile', fileContent, { filePath });
  }

  /** 批量导入文件 */
  async importFilesBatch(files: Array<{ FilePath: string; FileContent: string }>): Promise<unknown> {
    return this.post('/Api/PvfUtiltiy/ImportFiles', files);
  }

  /** 删除文件 */
  async deleteFile(filePath: string): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/DeleteFile', { filePath });
  }

  /** 批量删除文件 */
  async deleteFilesBatch(filePaths: string[]): Promise<unknown> {
    return this.post('/Api/PvfUtiltiy/DeleteFiles', filePaths);
  }

  /** PVF 封包另存为 */
  async saveAsPvf(filePath: string): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/SaveAsPvfFile', { filePath });
  }

  // ==================== 搜索 ====================

  /** 搜索 PVF 文件 */
  async searchPvf(keyword: string, searchFolder: string = '', searchType: number = 1, useRegex: boolean = false): Promise<unknown> {
    return this.post('/Api/PvfUtiltiy/SearchPvf', {
      SearchFolder: searchFolder,
      Keyword: keyword,
      Type: searchType,
      SourceType: 0,
      NormalUsing: 1,
      IsStartMatch: false,
      SearchResult: null,
      ScriptContentSearchMode: 1,
      IsUseLikeSearchPath: false,
      Trait: false,
      UseRegularExpression: useRegex,
      WholeWordMatch: false,
      RemoveOrKeep: 1,
      FileTypesString: null,
      ScriptContent: '',
      ScriptContentStart: '',
      ScriptContentStop: ''
    });
  }

  // ==================== LST 操作 ====================

  /** 获取所有 LST 文件列表 */
  async getAllLstFileList(): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/GetAllLstFileList');
  }

  /** 获取 LST 文件信息 */
  async getLstFileInfo(filePath: string): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/getLstFileInfo', { filePath });
  }

  /** 获取字符串表数据 */
  async getStringTable(): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/getStringTable');
  }

  // ==================== 物品操作 ====================

  /** 获取物品信息 */
  async getItemInfo(filePath: string): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/GetItemInfo', { filePath });
  }

  /** 批量获取物品信息 */
  async getItemInfosBatch(filePaths: string[]): Promise<unknown> {
    return this.post('/Api/PvfUtiltiy/GetItemInfos', filePaths);
  }

  /** 通过物品代码获取文件信息 */
  async itemCodeToFileInfo(lstNames: string, itemCode: number): Promise<unknown> {
    return this.get('/Api/PvfUtiltiy/ItemCodeToFileInfo', { lstNames, itemCode });
  }

  /** 批量通过物品代码获取文件信息 */
  async itemCodesToFileInfosBatch(lstNames: string[], itemCodes: number[]): Promise<unknown> {
    return this.post('/Api/PvfUtiltiy/ItemCodesToFileInfos', {
      lstNames, ItemCodes: itemCodes
    });
  }

  /** 获取文件图标 (Base64) */
  async getFileIcon(filePath: string): Promise<string | null> {
    const data = await this.get('/Api/PvfUtiltiy/getFileIcon', { filePath });
    return data != null ? String(data) : null;
  }

  // ==================== 检查操作 ====================

  /** 检查文件是否存在 */
  async fileExists(filePath: string): Promise<boolean> {
    const data = await this.get('/Api/PvfUtiltiy/FileIsExists', { filePath });
    return !!data;
  }

  /** 检查文件夹是否存在 */
  async folderExists(folderPath: string): Promise<boolean> {
    const data = await this.get('/Api/PvfUtiltiy/FolderIsExists', { folderPath });
    return !!data;
  }

  // ==================== 底层 HTTP 方法 ====================

  /** 从 API 响应中提取 Data 字段 */
  private unwrapData(response: unknown): unknown {
    if (response && typeof response === 'object' && 'Data' in response) {
      const wrapped = response as { Data: unknown; IsError?: boolean; Msg?: string };
      if (wrapped.IsError) {
        throw new Error(`API 错误: ${wrapped.Msg || '未知错误'}`);
      }
      return wrapped.Data;
    }
    return response;
  }

  /** GET 请求 */
  private async get(path: string, params?: Record<string, unknown>): Promise<unknown> {
    const fetchFn = await this.getFetch();
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const filtered = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (filtered) url += `?${filtered}`;
    }
    const response = await fetchFn(url, { method: 'GET' });
    if (!response.ok) throw new Error(`GET ${path} 失败: ${response.status}`);
    return this.unwrapData(await response.json());
  }

  /** POST JSON 请求 */
  private async post(path: string, body: unknown): Promise<unknown> {
    const fetchFn = await this.getFetch();
    const response = await fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`POST ${path} 失败: ${response.status}`);
    return this.unwrapData(await response.json());
  }

  /** POST 原始文本请求 (用于 importFile) */
  private async postRaw(path: string, body: string, params?: Record<string, unknown>): Promise<unknown> {
    const fetchFn = await this.getFetch();
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const filtered = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (filtered) url += `?${filtered}`;
    }
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    if (!response.ok) throw new Error(`POST ${path} 失败: ${response.status}`);
    return this.unwrapData(await response.json());
  }

  /** 获取可用的 fetch 函数 (Tauri 环境用插件，浏览器用原生 fetch + Vite 代理) */
  private async getFetch(): Promise<typeof fetch> {
    if (isTauri) {
      try {
        const http = await import('@tauri-apps/plugin-http');
        return http.fetch;
      } catch {
        return window.fetch;
      }
    }
    return window.fetch;
  }
}

/** 全局 PVF 桥接实例 */
export const pvfBridge = new PvfBridge();
