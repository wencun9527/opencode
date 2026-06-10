# PVF AI Editor — Phase 3 修复记录

> 完成时间: 2026-06-10  
> 修复范围: opencodeClient 精简 + 配置清理

---

## 修复清单

### ✅ 3.1 删除 isTauri 双路径

**问题**: `opencodeClient.ts` 中 `isTauri` 判断导致两套代码路径，维护困难  
**改动**:
- 删除 `const isTauri = '__TAURI_INTERNALS__' in window`
- 删除 `REMOTE_OPENCODE_URL` 常量（统一走 Vite 代理 `/opencode-api`）
- `startServer()` — 删除 Tauri sidecar 启动逻辑和 fallback，统一走 `/opencode-api`
- `stopServer()` — 删除 Tauri invoke 调用
- `getServerStatus()` — 删除 Tauri invoke 调用
- `getAuthHeader()` — 删除 isTauri 判断

**行数变化**: startServer ~50行→5行, stopServer ~14行→6行, getServerStatus ~23行→12行

---

### ✅ 3.2 删除 sendMessageViaRust()

**问题**: 130 行 Tauri fallback 代码，云端模式下不再需要  
**改动**:
- 删除整个 `sendMessageViaRust()` 方法（~130 行）
- `sendMessage()` 简化为仅调用 `sendMessageViaServer()`
- 删除 `import('@tauri-apps/api/core')` 和 `import('@tauri-apps/api/event')` 引用

---

### ✅ 3.3 精简 lib.rs

**问题**: 409 行旧版 Rust 后端代码（sidecar 启动/停止/状态查询/opencode_run）  
**改动**:
- 删除 `ServerState` / `find_bun()` / `build_path_with_bun()` / `parse_port_from_output()` / `opencode_server_start` / `opencode_server_stop` / `opencode_server_status` / `opencode_run` 等所有函数
- 保留 `opencode_health_check` 命令（返回远程服务器信息）
- 删除 `Command` / `BufReader` / `Mutex` / `Child` 等不再需要的 import

**行数变化**: 409 行 → 30 行

---

### ✅ 3.4 精简 build.rs

**问题**: 包含从源码编译 OpenCode 的逻辑  
**改动**:
- 删除 `build_opencode()` / `find_bun()` 函数
- 仅保留 `tauri_build::build()`

**行数变化**: 86 行 → 3 行

---

### ✅ 3.5 清理 tauri.conf.json

**改动**:
- 删除 `"externalBin": ["opencode-bin/opencode"]`
- 删除 `"../mcp-servers/**/*"` 资源引用（已走 Relay）

---

### ✅ 3.6 清理 capabilities/default.json

**改动**:
- 删除 `shell:allow-spawn` / `shell:allow-stdin-write` / `shell:allow-kill` 权限
- 删除 opencode sidecar 配置
- 删除 `https://api.deepseek.com/**` fetch 权限（不再直接调 DeepSeek）
- 新增 `http://1.12.207.131:*/**` fetch 权限

---

## 改动文件汇总

| 文件 | 改动类型 | 行数变化 |
|------|---------|---------|
| `src/services/opencodeClient.ts` | 精简 | -约 200 行 |
| `src-tauri/src/lib.rs` | 重写 | 409→30 行 |
| `src-tauri/build.rs` | 重写 | 86→3 行 |
| `src-tauri/tauri.conf.json` | 修改 | -2 行 |
| `src-tauri/capabilities/default.json` | 修改 | -7 行 |
| `vite.config.ts` | 修改 | -14 行 (Phase 1 已完成) |

---

## 遗留事项

1. `opencodeClient.ts` 中仍保留 `OPENCODE_PASSWORD` 常量 — 这是 Vite 代理层的 fallback，Phase 5 完全切换到 JWT 后可删除
2. `.gitmodules` 中的 opencode submodule 引用 — 需要 `git submodule deinit` 清理
3. `mcp-servers/` 目录 — 标记为可选，云端已走 Relay
