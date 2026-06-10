# Phase 5 修复记录 — 商用功能完善

> 完成时间: 2026-06-10  
> 修复范围: Token 计费、限流、用量展示、DB Schema 同步

---

## 5.1 IP 限流中间件

**问题**: 无任何限流措施，API 可被滥用

**修复**:
- 在 `relay/src/auth.ts` 添加 `rateLimiter()` 函数
- 基于 IP 维度，每分钟 60 次请求上限
- 在 `relay/src/index.ts` HTTP handler 中集成，超出返回 429
- 使用内存 Map 存储，自动过期清理

**文件**:
- `relay/src/auth.ts` — 新增 `rateLimiter()`
- `relay/src/index.ts` — 导入并在请求处理前调用

---

## 5.2 Token 用量统计

**问题**: `incrementUsage` 只统计 tool_calls，不统计 token 用量

**修复**:
- `incrementUsage()` 新增 `tokens` 参数：`{ input, output, reasoning }`
- `daily_usage` 表添加 `input_tokens`、`output_tokens`、`reasoning_tokens` 列
- `initDb()` 中 CREATE TABLE 已包含新列
- `deploy/postgres/schema.sql` 同步更新

**文件**:
- `relay/src/auth.ts` — `incrementUsage()` 签名变更
- `deploy/postgres/schema.sql` — 新增 3 列

---

## 5.3 用量查询 API

**问题**: 用户无法查看自己的用量和配额

**修复**:
- 新增 `GET /auth/quota` 端点
- 返回: `plan`, `usage`, `limit`, `remaining`, `today: { tool_calls, input_tokens, output_tokens, reasoning_tokens }`
- 需要 Bearer token 认证

**文件**: `relay/src/auth.ts` — `handleAuthRequest()` 新增 `/auth/quota` 处理

---

## 5.4 前端用量展示组件

**问题**: 前端无任何用量/配额信息展示

**修复**:
- 新建 `UsagePanel` 组件，展示：
  - 当前 Plan 标签（免费版/专业版/企业版/管理员）
  - 工具调用进度条（使用/上限）
  - Token 用量统计
  - 剩余调用次数
  - 每 30 秒自动刷新
- 集成到 Sidebar 底部（展开时可见）
- 进度条颜色：蓝色(正常) → 琥珀色(>70%) → 红色(>90%)

**文件**:
- `src/components/UsagePanel.tsx` — 新建
- `src/components/Sidebar.tsx` — 导入并渲染

---

## 5.5 DB Schema 幂等性改进

**问题**: `initDb()` 中 `daily_usage` 的 UNIQUE 约束在表已存在时可能冲突

**修复**:
- 改用 `DO $$ ... END $$` 块检查约束是否存在后再添加
- 保证 `initDb()` 可重复执行不报错

**文件**: `relay/src/auth.ts` — `initDb()` 改进

---

## 改动汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `relay/src/auth.ts` | 更新 | 限流 + Token 统计 + quota API + Schema 幂等 |
| `relay/src/index.ts` | 更新 | 导入 rateLimiter + 429 响应 |
| `deploy/postgres/schema.sql` | 更新 | 新增 token 列 + 视图更新 |
| `src/components/UsagePanel.tsx` | 新建 | 用量配额展示组件 |
| `src/components/Sidebar.tsx` | 更新 | 集成 UsagePanel |
