/**
 * P1-3 模拟：真实场景的 PVFut WebSocket 客户端
 *
 * 这个脚本模拟了未来 Rust 客户端将要做的事情：
 * 1. 连接 Relay WebSocket /ws
 * 2. 上报 PVFut 工具列表
 * 3. 收到 tool_call → 调用 PVFut API (localhost:27000) → 回传 tool_result
 * 4. 心跳
 *
 * 用法:
 *   bun run relay/test-pvfut-client.ts [--relay-url ws://localhost:9100/ws] [--pvfut-url http://localhost:27000]
 */

const DEFAULT_RELAY_URL = "ws://localhost:9100/ws?user_id=pvfut-client-001";
const DEFAULT_PVFUT_URL = "http://localhost:27000";

// ─── PVFut 工具定义（从 mcp-servers/pvfutility/index.ts 提取） ───

const PVFUT_TOOLS = [
  {
    name: "get_version",
    description: "获取 PVFut 版本号",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_pvf_pack_file_path",
    description: "获取当前加载的封包文件路径",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_pvf_root_directory",
    description: "获取 PVF 根目录结构",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_file_list",
    description: "列出指定目录的文件",
    inputSchema: {
      type: "object",
      properties: {
        dir_name: { type: "string", description: "目录路径" },
        return_type: { type: "string", description: "返回类型" },
        file_type: { type: "string", description: "文件类型过滤" },
      },
      required: ["dir_name"],
    },
  },
  {
    name: "get_file_content",
    description: "获取 PVF 文件内容",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件路径" },
        encoding_type: { type: "string", description: "编码类型: TW/CN/KR/JP/UTF8/Unicode" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "search_pvf",
    description: "搜索 PVF 文件（支持正则表达式）",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "搜索模式（正则表达式）" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "file_exists",
    description: "检查文件是否存在",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件路径" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "folder_exists",
    description: "检查文件夹是否存在",
    inputSchema: {
      type: "object",
      properties: {
        folder_path: { type: "string", description: "文件夹路径" },
      },
      required: ["folder_path"],
    },
  },
  {
    name: "get_item_info",
    description: "获取物品信息（代码和名称）",
    inputSchema: {
      type: "object",
      properties: {
        item_code: { type: "number", description: "物品代码" },
      },
      required: ["item_code"],
    },
  },
  {
    name: "import_file",
    description: "导入/覆盖单个文件内容",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件路径" },
        file_content: { type: "string", description: "文件内容" },
      },
      required: ["file_path", "file_content"],
    },
  },
  {
    name: "delete_file",
    description: "删除单个文件",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件路径" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "save_as_pvf",
    description: "保存 PVF 封包",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "保存路径" },
      },
      required: ["file_path"],
    },
  },
];

// ─── PVFut API 调用映射 ───

const PVFUT_BASE_URL = process.argv.find(a => a.startsWith("--pvfut-url="))?.split("=")[1]
  || DEFAULT_PVFUT_URL;

async function callPvfutApi(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (toolName) {
      case "get_version":
        return await pvfutGet("/Api/PvfUtiltiy/getVersion");
      case "get_pvf_pack_file_path":
        return await pvfutGet("/Api/PvfUtiltiy/GetPvfPackFilePath");
      case "get_pvf_root_directory":
        return await pvfutGet("/Api/PvfUtiltiy/GetPvfRootDirectory");
      case "get_file_list":
        return await pvfutGet(`/Api/PvfUtiltiy/GetFileList?dirName=${encodeURIComponent(args.dir_name as string)}&returnType=${args.return_type || ""}&fileType=${args.file_type || ""}`);
      case "get_file_content":
        return await pvfutGet(`/Api/PvfUtiltiy/GetFileContent?filePath=${encodeURIComponent(args.file_path as string)}&encodingType=${args.encoding_type || "CN"}`);
      case "search_pvf":
        return await pvfutPost("/Api/PvfUtiltiy/SearchPvf", { pattern: args.pattern });
      case "file_exists":
        return await pvfutGet(`/Api/PvfUtiltiy/FileExists?filePath=${encodeURIComponent(args.file_path as string)}`);
      case "folder_exists":
        return await pvfutGet(`/Api/PvfUtiltiy/FolderExists?folderPath=${encodeURIComponent(args.folder_path as string)}`);
      case "get_item_info":
        return await pvfutGet(`/Api/PvfUtiltiy/GetItemInfo?itemCode=${args.item_code}`);
      case "import_file":
        return await pvfutPostText(`/Api/PvfUtiltiy/ImportFile?filePath=${encodeURIComponent(args.file_path as string)}`, args.file_content as string);
      case "delete_file":
        return await pvfutGet(`/Api/PvfUtiltiy/DeleteFile?filePath=${encodeURIComponent(args.file_path as string)}`);
      case "save_as_pvf":
        return await pvfutGet(`/Api/PvfUtiltiy/SaveAsPvfFile?filePath=${encodeURIComponent(args.file_path as string)}`);
      default:
        return { error: `Unknown PVFut tool: ${toolName}` };
    }
  } catch (err) {
    return { error: `PVFut API call failed: ${(err as Error).message}` };
  }
}

async function pvfutGet(path: string): Promise<unknown> {
  const resp = await fetch(`${PVFUT_BASE_URL}${path}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

async function pvfutPost(path: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${PVFUT_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

async function pvfutPostText(path: string, text: string): Promise<unknown> {
  const resp = await fetch(`${PVFUT_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: text,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

// ─── Main ───

async function main() {
  const relayUrl = process.argv.find(a => a.startsWith("--relay-url="))?.split("=")[1]
    || DEFAULT_RELAY_URL;

  console.log("=== PVFut WebSocket Client ===");
  console.log(`Relay URL: ${relayUrl}`);
  console.log(`PVFut URL: ${PVFUT_BASE_URL}`);
  console.log();

  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(relayUrl);

  ws.on("open", () => {
    console.log("[client] Connected to Relay!");

    // 上报工具列表
    ws.send(JSON.stringify({ type: "tool_list", tools: PVFUT_TOOLS }));
    console.log(`[client] Sent tool_list: ${PVFUT_TOOLS.length} tools`);
  });

  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case "connected":
        console.log(`[client] Server confirmed connection, user_id: ${msg.user_id}`);
        break;

      case "tool_call":
        console.log(`[client] → Received tool_call: ${msg.tool_name} (request_id: ${msg.request_id})`);
        // 异步调用 PVFut API
        (async () => {
          const result = await callPvfutApi(msg.tool_name, msg.arguments);
          ws.send(JSON.stringify({
            type: "tool_result",
            request_id: msg.request_id,
            result,
          }));
          console.log(`[client] ← Sent tool_result for ${msg.tool_name}`);
        })();
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      default:
        console.log(`[client] Unknown message: ${msg.type}`);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[client] Disconnected: code=${code}`);
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error(`[client] Error: ${err.message}`);
    process.exit(1);
  });

  // Keep alive
  console.log("[client] Waiting for tool calls... (Ctrl+C to exit)");
}

main().catch(console.error);
