#!/usr/bin/env bun
/**
 * pvfUtility WebApi MCP Server (TypeScript)
 * 为pvfUtility软件提供MCP (Model Context Protocol) 接口封装
 * 使用 Bun 运行，无需 Python 依赖
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.PVFUT_BASE_URL || "http://localhost:27000";

// ═══ 工具定义 ═══

const TOOLS = [
  {
    name: "get_version",
    description: "获取pvfUtility版本号",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_file_list",
    description: "获取指定目录的文件列表",
    inputSchema: {
      type: "object" as const,
      properties: {
        dir_name: { type: "string", description: "目录名称，如equipment" },
        return_type: { type: "integer", description: "返回类型，0或1", default: 0 },
        file_type: { type: "string", description: "文件后缀名，如.equ", default: "" },
      },
      required: ["dir_name"],
    },
  },
  {
    name: "get_pvf_root_directory",
    description: "获取PVF根目录列表",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_file_content",
    description: "获取文件内容",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "文件路径" },
        use_compatible_decompiler: { type: "boolean", description: "是否使用兼容性反编译器", default: false },
        encoding_type: { type: "string", description: "编码类型：TW/CN/KR/JP/UTF8/Unicode", default: "UTF8" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "get_file_contents_batch",
    description: "批量获取文件内容",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_list: { type: "array", items: { type: "string" }, description: "文件路径列表" },
        use_compatible_decompiler: { type: "boolean", description: "是否使用兼容性反编译器", default: false },
        encoding_type: { type: "string", description: "编码类型", default: "UTF8" },
      },
      required: ["file_list"],
    },
  },
  {
    name: "get_file_data_json",
    description: "获取PVF文件内容(JSON格式)",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "文件路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "delete_file",
    description: "删除文件",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "要删除的文件路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "delete_files_batch",
    description: "批量删除文件",
    inputSchema: {
      type: "object" as const,
      properties: { file_paths: { type: "array", items: { type: "string" }, description: "要删除的文件路径列表" } },
      required: ["file_paths"],
    },
  },
  {
    name: "import_file",
    description: "导入/覆盖文件内容",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "文件路径" },
        file_content: { type: "string", description: "文件内容" },
      },
      required: ["file_path", "file_content"],
    },
  },
  {
    name: "import_files_batch",
    description: "批量导入文件",
    inputSchema: {
      type: "object" as const,
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { FilePath: { type: "string" }, FileContent: { type: "string" } },
            required: ["FilePath", "FileContent"],
          },
          description: "文件列表，包含路径和内容",
        },
      },
      required: ["files"],
    },
  },
  {
    name: "get_item_info",
    description: "获取物品信息(代码和名称)",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "物品文件路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "get_item_infos_batch",
    description: "批量获取物品信息",
    inputSchema: {
      type: "object" as const,
      properties: { file_paths: { type: "array", items: { type: "string" }, description: "物品文件路径列表" } },
      required: ["file_paths"],
    },
  },
  {
    name: "search_pvf",
    description: "搜索PVF文件",
    inputSchema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        search_folder: { type: "string", description: "搜索文件夹", default: "" },
        search_type: { type: "integer", description: "搜索类型", default: 1 },
        use_regex: { type: "boolean", description: "是否使用正则表达式", default: false },
      },
      required: ["keyword"],
    },
  },
  {
    name: "item_code_to_file_info",
    description: "通过物品代码获取文件信息",
    inputSchema: {
      type: "object" as const,
      properties: {
        lst_names: { type: "string", description: "LST名称，多个用逗号分隔，如equipment,stackable" },
        item_code: { type: "integer", description: "物品代码" },
      },
      required: ["lst_names", "item_code"],
    },
  },
  {
    name: "item_codes_to_file_infos_batch",
    description: "批量通过物品代码获取文件信息",
    inputSchema: {
      type: "object" as const,
      properties: {
        lst_names: { type: "array", items: { type: "string" }, description: "LST名称列表" },
        item_codes: { type: "array", items: { type: "integer" }, description: "物品代码列表" },
      },
      required: ["lst_names", "item_codes"],
    },
  },
  {
    name: "get_file_icon",
    description: "获取文件图标(Base64格式)",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "文件路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "file_exists",
    description: "检查文件是否存在",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "文件路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "save_as_pvf",
    description: "PVF封包另存为",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "保存路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "get_pvf_pack_file_path",
    description: "获取当前载入的封包文件路径",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_all_lst_file_list",
    description: "获取所有LST文件列表",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_lst_file_info",
    description: "获取LST文件信息",
    inputSchema: {
      type: "object" as const,
      properties: { file_path: { type: "string", description: "LST文件路径" } },
      required: ["file_path"],
    },
  },
  {
    name: "get_string_table",
    description: "获取字符串表数据",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "folder_exists",
    description: "检查文件夹是否存在",
    inputSchema: {
      type: "object" as const,
      properties: { folder_path: { type: "string", description: "文件夹路径" } },
      required: ["folder_path"],
    },
  },
];

// ═══ API 调用 ═══

async function apiGet(endpoint: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      filtered[k] = String(v);
    }
  }
  const qs = Object.keys(filtered).length > 0 ? "?" + new URLSearchParams(filtered).toString() : "";
  const resp = await fetch(`${BASE_URL}${endpoint}${qs}`);
  if (!resp.ok) throw new Error(`API调用失败: HTTP ${resp.status}`);
  return resp.json();
}

async function apiPost(endpoint: string, data: unknown): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`API调用失败: HTTP ${resp.status}`);
  return resp.json();
}

async function apiPostText(endpoint: string, params: Record<string, unknown>, textBody: string): Promise<unknown> {
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      filtered[k] = String(v);
    }
  }
  const qs = Object.keys(filtered).length > 0 ? "?" + new URLSearchParams(filtered).toString() : "";
  const resp = await fetch(`${BASE_URL}${endpoint}${qs}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: textBody,
  });
  if (!resp.ok) throw new Error(`API调用失败: HTTP ${resp.status}`);
  return resp.json();
}

// ═══ 工具调用处理 ═══

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_version":
      return apiGet("/Api/PvfUtiltiy/getVersion");

    case "get_file_list":
      return apiGet("/Api/PvfUtiltiy/GetFileList", {
        dirName: args.dir_name,
        returnType: args.return_type ?? 0,
        fileType: args.file_type ?? "",
      });

    case "get_pvf_root_directory":
      return apiGet("/Api/PvfUtiltiy/getPvfRootDirectory");

    case "get_file_content":
      return apiGet("/Api/PvfUtiltiy/GetFileContent", {
        filePath: args.file_path,
        useCompatibleDecompiler: args.use_compatible_decompiler ?? false,
        encodingType: args.encoding_type ?? "UTF8",
      });

    case "get_file_contents_batch":
      return apiPost("/Api/PvfUtiltiy/GetFileContents", {
        FileList: args.file_list ?? [],
        UseCompatibleDecompiler: args.use_compatible_decompiler ?? false,
        EncodingType: args.encoding_type ?? "UTF8",
      });

    case "get_file_data_json":
      return apiGet("/Api/PvfUtiltiy/getFileData", { filePath: args.file_path });

    case "delete_file":
      return apiGet("/Api/PvfUtiltiy/DeleteFile", { filePath: args.file_path });

    case "delete_files_batch":
      return apiPost("/Api/PvfUtiltiy/DeleteFiles", args.file_paths ?? []);

    case "import_file":
      return apiPostText(
        "/Api/PvfUtiltiy/ImportFile",
        { filePath: args.file_path },
        args.file_content as string ?? ""
      );

    case "import_files_batch":
      return apiPost("/Api/PvfUtiltiy/ImportFiles", args.files ?? []);

    case "get_item_info":
      return apiGet("/Api/PvfUtiltiy/GetItemInfo", { filePath: args.file_path });

    case "get_item_infos_batch":
      return apiPost("/Api/PvfUtiltiy/GetItemInfos", args.file_paths ?? []);

    case "search_pvf":
      return apiPost("/Api/PvfUtiltiy/SearchPvf", {
        SearchFolder: args.search_folder ?? "",
        Keyword: args.keyword,
        Type: args.search_type ?? 1,
        SourceType: 0,
        NormalUsing: 1,
        IsStartMatch: false,
        SearchResult: null,
        ScriptContentSearchMode: 1,
        IsUseLikeSearchPath: false,
        Trait: false,
        UseRegularExpression: args.use_regex ?? false,
        WholeWordMatch: false,
        RemoveOrKeep: 1,
        FileTypesString: null,
        ScriptContent: "",
        ScriptContentStart: "",
        ScriptContentStop: "",
      });

    case "item_code_to_file_info":
      return apiGet("/Api/PvfUtiltiy/ItemCodeToFileInfo", {
        lstNames: args.lst_names,
        itemCode: args.item_code,
      });

    case "item_codes_to_file_infos_batch":
      return apiPost("/Api/PvfUtiltiy/ItemCodesToFileInfos", {
        lstNames: args.lst_names ?? [],
        ItemCodes: args.item_codes ?? [],
      });

    case "get_file_icon":
      return apiGet("/Api/PvfUtiltiy/getFileIcon", { filePath: args.file_path });

    case "file_exists":
      return apiGet("/Api/PvfUtiltiy/FileIsExists", { filePath: args.file_path });

    case "save_as_pvf":
      return apiGet("/Api/PvfUtiltiy/SaveAsPvfFile", {
        filePath: encodeURIComponent(args.file_path as string ?? ""),
      });

    case "get_pvf_pack_file_path":
      return apiGet("/Api/PvfUtiltiy/GetPvfPackFilePath");

    case "get_all_lst_file_list":
      return apiGet("/Api/PvfUtiltiy/GetAllLstFileList");

    case "get_lst_file_info":
      return apiGet("/Api/PvfUtiltiy/getLstFileInfo", { filePath: args.file_path });

    case "get_string_table":
      return apiGet("/Api/PvfUtiltiy/getStringTable");

    case "folder_exists":
      return apiGet("/Api/PvfUtiltiy/FolderIsExists", { folderPath: args.folder_path });

    default:
      throw new Error(`未知的工具: ${name}`);
  }
}

// ═══ 启动 MCP Server ═══

const server = new Server(
  { name: "pvfutility-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await callTool(request.params.name, request.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `错误: ${e.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("pvfutility-mcp server running on stdio");
}

main().catch(console.error);
