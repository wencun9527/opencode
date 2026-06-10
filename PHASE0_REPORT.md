# Phase 0 实施记录：Fork OpenCode 并验证集成

> 日期: 2026-06-10  
> 状态: 基本完成（P0-7 待 PVFut 环境验证）  
> 执行人: AI + 用户

---

## 执行摘要

Phase 0 核心目标达成：OpenCode 已 fork 到用户 GitHub，submodule 指向改为 fork 仓库，commercial 分支创建，OpenCode Server 通过 Bun 直接运行源码验证通过。

---

## 任务清单与结果

| # | 任务 | 状态 | 结果 |
|---|------|------|------|
| P0-1 | Fork sst/opencode | ✅ 完成 | fork 地址: https://github.com/wencun9527/opencode |
| P0-2 | 添加 upstream remote | ✅ 完成 | origin→fork, upstream→sst/opencode |
| P0-3 | 创建 commercial 分支 | ✅ 完成 | 基于 dev 分支创建 |
| P0-4 | 修改 submodule 指向 | ✅ 完成 | .gitmodules 已改为 fork + branch=commercial |
| P0-5 | 编译 OpenCode 二进制 | ⚠️ 跳过 | dist 产物不完整，但开发模式不依赖编译 |
| P0-6 | 验证 Bun 运行 OpenCode Server | ✅ 完成 | `bun run src/index.ts serve --port 4096` 启动成功 |
| P0-7 | 验证 MCP 工具调用 | ⏳ 待验证 | 需 PVFut 服务运行在 localhost:27000 |

---

## 详细操作记录

### P0-1: Fork sst/opencode

**操作**: 用户在 GitHub 网页端手动 Fork

**结果**:
- Fork 地址: `https://github.com/wencun9527/opencode`
- 上游: `https://github.com/sst/opencode`

### P0-2: 配置 Remote

**操作**: 在 opencode submodule 目录中重命名和添加 remote

```bash
cd opencode/
git remote rename origin upstream          # sst/opencode → upstream
git remote add origin https://github.com/wencun9527/opencode.git
```

**验证**:
```
origin    https://github.com/wencun9527/opencode.git (fetch)
origin    https://github.com/wencun9527/opencode.git (push)
upstream  https://github.com/sst/opencode.git (fetch)
upstream  https://github.com/sst/opencode.git (push)
```

### P0-3: 创建 commercial 分支

**操作**: 基于 submodule 当前分支 (dev) 创建 commercial 分支

```bash
cd opencode/
git checkout -b commercial
```

**注意**: submodule 当前指向 commit `76c631d198f9`，上游默认分支是 `dev`（不是 main）。commercial 分支基于此 commit 创建。

**待完成**: 需要用户手动推送 commercial 分支到 fork（需 GitHub 认证）：
```bash
cd opencode/
git push -u origin commercial
```

### P0-4: 修改 Submodule 指向

**操作**: 修改项目根目录 `.gitmodules`

**变更前**:
```ini
[submodule "opencode"]
    path = opencode
    url = https://github.com/sst/opencode.git
```

**变更后**:
```ini
[submodule "opencode"]
    path = opencode
    url = https://github.com/wencun9527/opencode.git
    branch = commercial
```

**同步**:
```bash
cd PVF-AI-Editor/
git submodule sync
# Synchronizing submodule url for 'opencode'
```

**验证**: `git config --get submodule.opencode.url` 返回 `https://github.com/wencun9527/opencode.git`

### P0-5: 编译 OpenCode 二进制

**状态**: 跳过

**原因**: 
- `opencode/packages/opencode/dist/opencode-windows-x64/bin/` 目录为空，上次编译不完整
- 编译需要完整依赖安装（`bun install`），耗时较长
- 开发模式用 Bun 直接运行源码，不需要编译产物
- 编译二进制是发布模式的步骤，Phase 0 验证阶段不需要

**后续**: Phase 1 开始前需要完成编译，或确认开发模式足够

### P0-6: 验证 Bun 运行 OpenCode Server

**操作**: 使用 Bun 直接运行 OpenCode 源码启动 Server

```bash
cd PVF-AI-Editor/
$env:DEEPSEEK_API_KEY="sk-placeholder-test"
$env:OPENCODE_SERVER_PASSWORD="test123"
bun run opencode/packages/opencode/src/index.ts serve --port 4096
```

**结果**:
- 进程 PID: 43424
- 输出: `opencode server listening on http://127.0.0.1:4096`
- 启动成功

**API 验证**:

| API | 方法 | 结果 |
|-----|------|------|
| `/api/health` | GET | `{"healthy": true}` |
| `/api/model` | GET | 返回 4 个 DeepSeek 模型 (V4 Flash, V4 Pro, Reasoner, Chat) |
| `/api/agent` | GET | 返回 3 个 Agent (build, plan, summary) |

**模型详情**:

| 模型 ID | 名称 | 上下文长度 | 成本 (input/output per 1M tokens) |
|---------|------|-----------|----------------------------------|
| deepseek-v4-flash | DeepSeek V4 Flash | 1M | $0.14 / $0.28 |
| deepseek-v4-pro | DeepSeek V4 Pro | 1M | $0.435 / $0.87 |
| deepseek-reasoner | DeepSeek Reasoner | 1M | $0.14 / $0.28 |
| deepseek-chat | DeepSeek Chat | 1M | $0.14 / $0.28 |

**注意**: 上述成本是 OpenCode 配置中的标注价格，实际 DeepSeek API 价格可能不同。

### P0-7: MCP 工具调用验证

**状态**: 待验证

**原因**: 需要外部工具 PVFut 运行在 `localhost:27000`

**计划**: 下次有 PVFut 环境时验证完整 MCP 工具调用链路

---

## 环境信息

| 项目 | 值 |
|------|-----|
| 操作系统 | Windows (win32) |
| Git 版本 | 2.54.0.windows.1 |
| Bun 版本 | 1.3.14 (C:\Users\Administrator\.bun\bin\bun.exe) |
| gh CLI | 未安装 |
| OpenCode commit | 76c631d198f9 (dev 分支) |
| OpenCode fork | https://github.com/wencun9527/opencode |
| Fork 默认分支 | commercial |

---

## 遗留问题

| # | 问题 | 影响 | 后续处理 |
|---|------|------|---------|
| 1 | commercial 分支未推送到 fork | 本地有分支但远程没有，其他人/CI 无法获取 | 用户需手动 `git push -u origin commercial` |
| 2 | OpenCode 编译产物不完整 | 发布模式需要编译二进制 | 后续需要完整执行 `bun script/build.ts --single --skip-embed-web-ui` |
| 3 | P0-7 MCP 工具调用未验证 | 无法确认 MCP 端到端可用 | 需 PVFut 环境 |
| 4 | OpenCode 上游默认分支是 dev 不是 main | fork 工作流需适配 | commercial 基于 dev 创建，merge 时注意对齐 |

---

## Phase 0 → Phase 1 前置条件

- [x] Fork 创建完成
- [x] Submodule 指向 fork
- [x] commercial 分支创建
- [ ] commercial 分支推送到 fork（需用户操作）
- [x] OpenCode Server 可通过 Bun 启动
- [ ] MCP 工具调用端到端验证（需 PVFut 环境）
- [ ] （可选）编译 OpenCode 二进制

**结论**: Phase 0 核心目标达成。P0-7 留到有 PVFut 环境时验证，不阻塞 Phase 1 启动。

---

## 下一步: Phase 1 准备

Phase 1 目标：本地验证 WebSocket MCP Transport

开始前需要：
1. 用户推送 commercial 分支到 fork
2. 深入阅读 OpenCode MCP Client 源码，确认 transport 抽象接口
3. 实现 RelayTransport 原型
