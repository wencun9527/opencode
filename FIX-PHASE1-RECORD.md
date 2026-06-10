# PVF AI Editor — Phase 1 修复记录

> 完成时间: 2026-06-10  
> 修复范围: 5 个 P0 关键 Bug

---

## 修复清单

### ✅ B5: 端口统一 (4097 → 4096)

**问题**: 客户端写 4097，服务器实际监听 4096  
**改动**:
- `src/services/opencodeClient.ts:13` — `OPENCODE_DEFAULT_PORT = 4097` → `4096`
- `src/services/opencodeClient.ts:16` — `REMOTE_OPENCODE_URL` 中 `:4097` → `:4096`
- `src/services/opencodeClient.ts:143-146` — `serverPort = 4097` → `OPENCODE_DEFAULT_PORT`
- `vite.config.ts:13` — `OPENCODE_REMOTE_URL` 中 `:4097` → `:4096`

**验证**: 客户端所有端口引用统一为 4096

---

### ✅ B4: 移除客户端 DEEPSEEK_API_KEY

**问题**: `VITE_DEEPSEEK_API_KEY` 编译进前端 JS，违反安全要求（S1: Key 仅存服务器）  
**改动**:
- `src/services/opencodeClient.ts:24-25` — 删除 `DEEPSEEK_API_KEY` 常量，替换为注释
- `src/services/opencodeClient.ts:164` — `customApiKey || DEEPSEEK_API_KEY` → `customApiKey`
- `src/services/opencodeClient.ts:1866` — `const apiKey = DEEPSEEK_API_KEY` → `const apiKey = ''`
- `vite.config.ts:10` — 删除 `DEEPSEEK_API_KEY` 变量
- `vite.config.ts:59-72` — 删除 `/deepseek-api` 代理配置

**验证**: 前端代码中不再有任何 DEEPSEEK_API_KEY 引用

---

### ✅ B1: 认证流程集成

**问题**: `LoginPanel` 组件存在但从未被渲染，JWT 认证体系形同虚设  
**改动**:
- `src/App.tsx` — 导入 `useAuthStore` 和 `LoginPanel`
- `src/App.tsx` — 添加认证守卫：`if (!isAuthenticated) return <LoginPanel />`
- `src/services/opencodeClient.ts:2364-2382` — `getAuthHeader()` 优先读取 localStorage 中的 JWT token，fallback 到 Basic Auth

**验证**: 未登录用户自动显示 LoginPanel，登录后 JWT token 用于所有 API 请求

---

### ✅ B2: Refresh Token 哈希修复

**问题**: `hashPassword()` 用随机盐（`randomUUID()`），同一 token 每次哈希不同，`/auth/refresh` 数据库查找永远失败  
**改动**:
- `relay/src/auth.ts` — 新增 `hashRefreshToken()` 函数，使用 HMAC-SHA256（确定性哈希）
- `relay/src/auth.ts:298` — 登录时存储 refresh token：`hashPassword` → `hashRefreshToken`
- `relay/src/auth.ts:325` — 刷新时查找：`hashPassword` → `hashRefreshToken`
- `relay/src/auth.ts:346` — 新 refresh token 存储：`hashPassword` → `hashRefreshToken`

**附带修复**:
- 密码哈希从 SHA-256+salt 升级为 PBKDF2（100000 iterations），保留旧格式向后兼容

**验证**: 同一 refresh token 多次哈希结果一致，`/auth/refresh` 可正确查找并轮换 token

---

### ✅ B3: 数据库 Schema 初始化

**问题**: 代码引用 `users`/`refresh_tokens`/`daily_usage`/`sessions` 4 张表但无建表 SQL  
**改动**:
- `relay/src/auth.ts:31-52` — `initDb()` 增加 `CREATE TABLE IF NOT EXISTS` 语句：
  - `users` — 用户表（id, email, password_hash, display_name, plan, created_at, last_login_at）
  - `refresh_tokens` — Refresh token 表（id, user_id, token_hash, expires_at, revoked_at, created_at）
  - `daily_usage` — 每日用量表（id, user_id, date, tool_calls, input_tokens, output_tokens, reasoning_tokens）
  - `sessions` — 会话表（id, user_id, server_session_id, started_at, ended_at, title）
- 添加索引：`idx_refresh_tokens_user_id`, `idx_refresh_tokens_hash`, `idx_daily_usage_user_date`, `idx_sessions_user_id`

**验证**: 新部署时自动建表，幂等执行不报错

---

## 改动文件汇总

| 文件 | 改动类型 | 行数变化 |
|------|---------|---------|
| `src/services/opencodeClient.ts` | 修改 | ~20 行 |
| `src/App.tsx` | 修改 | +8 行 |
| `vite.config.ts` | 修改 | -14 行 |
| `relay/src/auth.ts` | 修改 | +80 行 |

---

## 遗留事项

1. **opencodeClient.ts 中 `getAuthHeader()` 读取 localStorage** — 这是临时方案，Phase 3 精简时会改为直接引用 zustand store
2. **旧密码格式兼容** — `$pvf$` 格式仍可验证，新注册使用 `$pvf2$` (PBKDF2)
3. **服务器端需要重启 Relay 服务** — 使 auth.ts 改动生效
