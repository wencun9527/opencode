/**
 * Relay WebSocket 客户端
 * 连接云端 Relay，注册 PVFut 工具，中继 tool_call 到本地 PVFut
 *
 * 数据流：
 *   OpenCode (云端) → Relay MCP /mcp → Relay WS → 本前端 → PVFut (本地)
 */

import { pvfBridge } from './pvfBridge';

/** Relay 服务器地址（环境变量或默认值） */
const RELAY_WS_URL = import.meta.env.VITE_RELAY_WS_URL || 'ws://1.12.207.131:9100/ws';

/** 重连间隔（初始值，指数退避） */
const RECONNECT_BASE_INTERVAL_MS = 5000;
const RECONNECT_MAX_INTERVAL_MS = 120_000; // 最大 2 分钟
const RECONNECT_MAX_ATTEMPTS = 20; // 最多重试 20 次

// ─── PVFut 工具定义（与 mcp-servers/pvfutility/index.ts 同步） ───

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const PVFUT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_version',
    description: '获取pvfUtility版本号',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_pvf_pack_file_path',
    description: '获取当前载入的封包文件路径',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_pvf_root_directory',
    description: '获取PVF根目录列表',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_file_list',
    description: '获取指定目录的文件列表',
    inputSchema: {
      type: 'object',
      properties: {
        dir_name: { type: 'string', description: '目录名称，如equipment' },
        return_type: { type: 'integer', description: '返回类型，0或1', default: 0 },
        file_type: { type: 'string', description: '文件后缀名，如.equ', default: '' },
      },
      required: ['dir_name'],
    },
  },
  {
    name: 'get_file_content',
    description: '获取文件内容',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        use_compatible_decompiler: { type: 'boolean', description: '是否使用兼容性反编译器', default: false },
        encoding_type: { type: 'string', description: '编码类型：TW/CN/KR/JP/UTF8/Unicode', default: 'UTF8' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_file_contents_batch',
    description: '批量获取文件内容',
    inputSchema: {
      type: 'object',
      properties: {
        file_list: { type: 'array', items: { type: 'string' }, description: '文件路径列表' },
        use_compatible_decompiler: { type: 'boolean', description: '是否使用兼容性反编译器', default: false },
        encoding_type: { type: 'string', description: '编码类型', default: 'UTF8' },
      },
      required: ['file_list'],
    },
  },
  {
    name: 'get_file_data_json',
    description: '获取PVF文件内容(JSON格式)',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '文件路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'search_pvf',
    description: '搜索PVF文件',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        search_folder: { type: 'string', description: '搜索文件夹', default: '' },
        search_type: { type: 'integer', description: '搜索类型', default: 1 },
        use_regex: { type: 'boolean', description: '是否使用正则表达式', default: false },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_all_lst_file_list',
    description: '获取所有LST文件列表',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_lst_file_info',
    description: '获取LST文件信息',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: 'LST文件路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'get_string_table',
    description: '获取字符串表数据',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'import_file',
    description: '导入/覆盖文件内容',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        file_content: { type: 'string', description: '文件内容' },
      },
      required: ['file_path', 'file_content'],
    },
  },
  {
    name: 'import_files_batch',
    description: '批量导入文件',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { FilePath: { type: 'string' }, FileContent: { type: 'string' } },
            required: ['FilePath', 'FileContent'],
          },
          description: '文件列表，包含路径和内容',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'delete_file',
    description: '删除文件',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '要删除的文件路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'delete_files_batch',
    description: '批量删除文件',
    inputSchema: {
      type: 'object',
      properties: { file_paths: { type: 'array', items: { type: 'string' }, description: '要删除的文件路径列表' } },
      required: ['file_paths'],
    },
  },
  {
    name: 'save_as_pvf',
    description: 'PVF封包另存为',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '保存路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'get_item_info',
    description: '获取物品信息(代码和名称)',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '物品文件路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'get_item_infos_batch',
    description: '批量获取物品信息',
    inputSchema: {
      type: 'object',
      properties: { file_paths: { type: 'array', items: { type: 'string' }, description: '物品文件路径列表' } },
      required: ['file_paths'],
    },
  },
  {
    name: 'item_code_to_file_info',
    description: '通过物品代码获取文件信息',
    inputSchema: {
      type: 'object',
      properties: {
        lst_names: { type: 'string', description: 'LST名称，多个用逗号分隔' },
        item_code: { type: 'integer', description: '物品代码' },
      },
      required: ['lst_names', 'item_code'],
    },
  },
  {
    name: 'item_codes_to_file_infos_batch',
    description: '批量通过物品代码获取文件信息',
    inputSchema: {
      type: 'object',
      properties: {
        lst_names: { type: 'array', items: { type: 'string' }, description: 'LST名称列表' },
        item_codes: { type: 'array', items: { type: 'integer' }, description: '物品代码列表' },
      },
      required: ['lst_names', 'item_codes'],
    },
  },
  {
    name: 'get_file_icon',
    description: '获取文件图标(Base64格式)',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '文件路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'file_exists',
    description: '检查文件是否存在',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '文件路径' } },
      required: ['file_path'],
    },
  },
  {
    name: 'folder_exists',
    description: '检查文件夹是否存在',
    inputSchema: {
      type: 'object',
      properties: { folder_path: { type: 'string', description: '文件夹路径' } },
      required: ['folder_path'],
    },
  },
];

// ─── PVFut 工具调用路由 ───

async function callPvfutTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_version':
      return pvfBridge.getVersion();
    case 'get_pvf_pack_file_path':
      return pvfBridge.getPvfPackFilePath();
    case 'get_pvf_root_directory':
      return pvfBridge.getPvfRootDirectory();
    case 'get_file_list':
      return pvfBridge.getFileList(args.dir_name as string, args.file_type as string ?? '', args.return_type as number ?? 0);
    case 'get_file_content':
      return pvfBridge.getFileContent(args.file_path as string, args.encoding_type as string ?? 'UTF8', args.use_compatible_decompiler as boolean ?? false);
    case 'get_file_contents_batch':
      return pvfBridge.getFileContentsBatch(args.file_list as string[] ?? [], args.encoding_type as string ?? 'UTF8', args.use_compatible_decompiler as boolean ?? false);
    case 'get_file_data_json':
      return pvfBridge.getFileDataJson(args.file_path as string);
    case 'search_pvf':
      return pvfBridge.searchPvf(args.keyword as string, args.search_folder as string ?? '', args.search_type as number ?? 1, args.use_regex as boolean ?? false);
    case 'get_all_lst_file_list':
      return pvfBridge.getAllLstFileList();
    case 'get_lst_file_info':
      return pvfBridge.getLstFileInfo(args.file_path as string);
    case 'get_string_table':
      return pvfBridge.getStringTable();
    case 'import_file':
      return pvfBridge.importFile(args.file_path as string, args.file_content as string ?? '');
    case 'import_files_batch':
      return pvfBridge.importFilesBatch(args.files as Array<{ FilePath: string; FileContent: string }> ?? []);
    case 'delete_file':
      return pvfBridge.deleteFile(args.file_path as string);
    case 'delete_files_batch':
      return pvfBridge.deleteFilesBatch(args.file_paths as string[] ?? []);
    case 'save_as_pvf':
      return pvfBridge.saveAsPvf(args.file_path as string);
    case 'get_item_info':
      return pvfBridge.getItemInfo(args.file_path as string);
    case 'get_item_infos_batch':
      return pvfBridge.getItemInfosBatch(args.file_paths as string[] ?? []);
    case 'item_code_to_file_info':
      return pvfBridge.itemCodeToFileInfo(args.lst_names as string, args.item_code as number);
    case 'item_codes_to_file_infos_batch':
      return pvfBridge.itemCodesToFileInfosBatch(args.lst_names as string[] ?? [], args.item_codes as number[] ?? []);
    case 'get_file_icon':
      return pvfBridge.getFileIcon(args.file_path as string);
    case 'file_exists':
      return pvfBridge.fileExists(args.file_path as string);
    case 'folder_exists':
      return pvfBridge.folderExists(args.folder_path as string);
    default:
      throw new Error(`未知的 PVFut 工具: ${name}`);
  }
}

// ─── WebSocket 消息类型 ───

interface WsToolCall {
  type: 'tool_call';
  request_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

interface WsToolResult {
  type: 'tool_result';
  request_id: string;
  result: unknown;
  error?: string;
}

// ─── Relay 客户端 ───

export class RelayClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private userId = `pvf-client-${Date.now().toString(36)}`;
  private statusListeners: Set<(connected: boolean) => void> = new Set();

  /** 获取连接状态 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 监听连接状态变化 */
  onStatusChange(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** 连接 Relay WebSocket */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return; // 已连接或连接中
    }

    const url = `${RELAY_WS_URL}?user_id=${encodeURIComponent(this.userId)}`;
    console.log(`[relay] Connecting to ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.warn('[relay] WebSocket 创建失败:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[relay] WebSocket 已连接');
      this.connected = true;
      this.reconnectAttempts = 0; // 连接成功，重置重试计数
      this.notifyStatus();
      // 注册 PVFut 工具
      this.sendToolList();
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'connected') {
          console.log('[relay] 服务器确认连接, user_id:', msg.user_id);
          if (msg.user_id) this.userId = msg.user_id;
          return;
        }

        if (msg.type === 'ping') {
          this.ws?.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'tool_call') {
          await this.handleToolCall(msg as WsToolCall);
          return;
        }

        console.log('[relay] 未知消息:', msg.type);
      } catch {
        // 忽略解析错误
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[relay] WebSocket 断开 (code: ${event.code})`);
      this.connected = false;
      this.notifyStatus();
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[relay] WebSocket 错误:', err);
    };
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.notifyStatus();
  }

  /** 发送工具列表到 Relay */
  private sendToolList(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      type: 'tool_list',
      tools: PVFUT_TOOLS,
    };
    this.ws.send(JSON.stringify(msg));
    console.log(`[relay] 已注册 ${PVFUT_TOOLS.length} 个 PVFut 工具`);
  }

  /** 处理来自 Relay 的 tool_call */
  private async handleToolCall(call: WsToolCall): Promise<void> {
    console.log(`[relay] ← tool_call: ${call.tool_name} (request_id: ${call.request_id})`);

    const result: WsToolResult = {
      type: 'tool_result',
      request_id: call.request_id,
      result: null,
    };

    try {
      result.result = await callPvfutTool(call.tool_name, call.arguments);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.warn(`[relay] 工具调用失败: ${call.tool_name}`, result.error);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(result));
      console.log(`[relay] → tool_result: ${call.request_id} (error: ${!!result.error})`);
    }
  }

  /** 通知状态监听器 */
  private notifyStatus(): void {
    for (const listener of this.statusListeners) {
      listener(this.connected);
    }
  }

  /** 安排重连（指数退避 + 最大重试次数） */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      console.warn(`[relay] 已达最大重试次数 (${RECONNECT_MAX_ATTEMPTS})，停止重连`);
      return;
    }

    // 指数退避: 5s → 10s → 20s → 40s → ... → 120s
    const delay = Math.min(
      RECONNECT_BASE_INTERVAL_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_INTERVAL_MS
    );

    console.log(`[relay] ${delay / 1000}s 后重连 (第 ${this.reconnectAttempts} 次)`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/** 全局 Relay 客户端实例 */
export const relayClient = new RelayClient();
