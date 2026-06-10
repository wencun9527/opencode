# PVF AI Editor — Phase 2 修复记录

> 完成时间: 2026-06-10  
> 修复范围: 4 个 P1 体验 Bug

---

## 修复清单

### ✅ B10: Relay 重连加指数退避

**问题**: `relayClient` 每 5 秒无限重连，无退避无上限，消耗资源  
**改动**:
- `src/services/relayClient.ts:15-16` — 增加退避参数：`RECONNECT_BASE_INTERVAL_MS=5000`, `RECONNECT_MAX_INTERVAL_MS=120000`, `RECONNECT_MAX_ATTEMPTS=20`
- `src/services/relayClient.ts` — 增加 `reconnectAttempts` 计数器
- `src/services/relayClient.ts` — `scheduleReconnect()` 实现指数退避：5s→10s→20s→40s→...→120s
- `src/services/relayClient.ts` — 连接成功时重置 `reconnectAttempts = 0`

**验证**: 重连间隔随失败次数指数增长，达上限后停止重连

---

### ✅ B7: save_as_pvf 双重编码修复

**问题**: `encodeURIComponent(args.file_path)` + `apiGet` 内部 `URLSearchParams` 再编码，导致中文路径损坏  
**改动**:
- `mcp-servers/pvfutility/index.ts:489-491` — 移除外层 `encodeURIComponent`

**验证**: 中文路径如 `equipment/血色套装.equ` 可正确传递

---

### ✅ B11: Admin API 角色检查

**问题**: `/admin/stats` 只验证 JWT 有效，不检查用户角色，任何登录用户可访问  
**改动**:
- `relay/src/auth.ts:413-427` — `handleAdminRequest` 增加 `payload.plan` 检查
- 仅 `admin` 和 `enterprise` 角色可访问，其他角色返回 403

**验证**: 普通 `free`/`pro` 用户访问 `/admin/stats` 返回 403 Forbidden

---

### ✅ B12: 密码哈希升级（Phase 1 附带完成）

**问题**: SHA-256 + 盐值，容易被暴力破解  
**改动**（已在 Phase 1 中完成）:
- `hashPassword()` 从 SHA-256+salt 改为 PBKDF2（100000 iterations）
- `verifyPassword()` 支持 `$pvf$`（旧）和 `$pvf2$`（新）两种格式
- 向后兼容：旧密码仍可验证

---

## 改动文件汇总

| 文件 | 改动类型 | 行数变化 |
|------|---------|---------|
| `src/services/relayClient.ts` | 修改 | +20 行 |
| `mcp-servers/pvfutility/index.ts` | 修改 | -1 行 |
| `relay/src/auth.ts` | 修改 | +7 行 |

---

## 遗留事项

1. `relayClient` 达到最大重试后不会自动恢复 — 需要用户刷新页面。Phase 3 可考虑加"手动重连"按钮
2. `admin` 角色在 `users.plan` 中目前没有自动创建管理员的方式 — 需手动 SQL 或 CLI
