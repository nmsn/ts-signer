# ts-signer v1 设计文档

日期：2026-10-14  
仓库：`~/studio/ts-signer`（GitHub: `nmsn/ts-signer`）  
状态：已评审通过，作为实现指导

## 1. 目标与范围

为个人自用重写一套精简的 Telegram **用户端**自动签到工具：用 MTProto（MTCute）登录账号，按 cron 对指定对话执行「发文本 → 可选点 Inline 按钮」，并记录是否已签。

灵感来自 Python 项目 `tg-signer`（Kurigram），但 **v1 只做最小可用子集**，不复刻 monitor / automation / WebUI / AI。

### 1.1 已锁定决策

| 项 | 决策 |
|----|------|
| 能力范围 | 最小自用：登录、cron 签到、发文本、按文案点按钮、已签记录 |
| 运行方式 | 常驻进程，进程内调度 |
| 配置方式 | 交互向导生成 `config.json`，可手改 |
| 账号 | 单账号 |
| 代理 | 不内置，依赖系统/VPN |
| Telegram 库 | MTCute（`@mtcute/node`） |
| 架构风格 | 精简能力（方案 1）+ **pnpm monorepo** 分包 |
| 选签到目标 | 手填 `chat_id`；`login` 打印最近对话供对照；不做自动探测、不做点选菜单 |
| Node | **24+** |

### 1.2 明确不做（v1）

- 内置 HTTP/SOCKS 代理
- 多账号 / `multi-run`
- 群组话题 `message_thread_id`
- Dice、AI 识图、AI 算题
- WebUI / Electron 桌面端（见 §10 后续计划）
- monitor、automation 规则引擎
- SQLite 与积分回读展示（见 §10；v1 仅用 `state.json`）
- 从 Python 版自动迁移
- 自动探测「可签到」群组

## 2. 工作目录约定

### 2.1 正式自用（产品默认）

- 默认：`~/.ts-signer/`
- 覆盖：`--workdir <path>`

### 2.2 开发阶段（当前实现期强制）

- **所有生成内容放在仓库项目下**：`./.dev-signer/`
- 开发时通过 `--workdir ./.dev-signer` 或开发脚本默认指向该目录
- **不要**在开发阶段默认写入 `~/.ts-signer/`，以免遗忘清理

目录内容：

```
<workdir>/
├── config.json       # 任务与动作
├── state.json        # 签到记录
├── session/          # MTCute storage（账号会话，敏感）
└── credentials.json  # 可选：apiId/apiHash（敏感，不进 git）
```

### 2.3 清理提醒（开发结束必查）

- [ ] 检查仓库内是否仍有 `.dev-signer/`（含 session）
- [ ] 不需要则删除整个 `.dev-signer/`
- [ ] 确认未误把 session / credentials 提交进 git
- [ ] 正式自用时改用 `~/.ts-signer/` 或显式 `--workdir`

`.gitignore` 必须忽略：`.dev-signer/`、`.ts-signer/`、以及任何 credentials/session 路径。

## 3. 整体架构

仓库为 **pnpm monorepo**：核心逻辑与入口应用分包，CLI 与日后 Electron 都依赖同一套 core。

```
packages/core          # 签到引擎、配置、存储抽象、MTCute 封装
packages/cli           # 命令行入口（v1 实现）
packages/electron      # 桌面壳（目录先建好，v1 不实现业务）

依赖关系：
  cli ──────────┐
                ├──► @ts-signer/core
  electron ─────┘（后续）
```

CLI 命令面（`packages/cli`）：

```
login | init | run | run-once
```

Core 运行时（`packages/core`）：

```
TelegramClient (@mtcute/node)
     ↓
SignerEngine
     ├── Scheduler（cron + random_seconds）
     ├── ActionRunner（send_text / click_keyboard_by_text）
     └── SignRecordStore（v1: state.json；接口可换 SQLite）
```

原则：

- 单账号、单 `config.json`（不做多 task 目录）
- 配置是业务唯一真相；向导（CLI）只负责生成/改写
- 业务逻辑不进 `cli` / `electron`，只进 `core`
- 与官方 App 可同时在线（多 session）

## 4. 配置模型与动作语义

### 4.1 `config.json`

用 Zod 校验，示意：

```json
{
  "version": 1,
  "sign_at": "0 6 * * *",
  "random_seconds": 300,
  "sign_interval": 1,
  "chats": [
    {
      "chat_id": 123456789,
      "name": "optional label",
      "delete_after": null,
      "action_interval": 1,
      "actions": [
        { "type": "send_text", "text": "/checkin" },
        { "type": "click_keyboard_by_text", "text": "签到" }
      ]
    }
  ]
}
```

| 字段 | 含义 |
|------|------|
| `sign_at` | crontab；向导可接受 `06:00:00`，写入前转为 cron |
| `random_seconds` | 下次执行在 cron 点上再加 `0..N` 秒 |
| `sign_interval` | 多个 chat 之间的间隔（秒） |
| `chat_id` | 数字 id 或 `@username`（手填） |
| `delete_after` | 发送后多少秒删除自己发的消息；`null` 不删 |
| `action_interval` | 同一 chat 内动作间隔（秒） |

### 4.2 动作

1. **`send_text`**：向该 chat 发文本；若配置了 `delete_after` 则稍后删除。
2. **`click_keyboard_by_text`**：在超时窗口内收集该 chat 新消息，找 Inline 按钮文案**包含**配置文字的项并触发 callback；超时则打 warning 并跳过（不中断整次任务）。

执行顺序：按 `chats` → 按 `actions` 依次执行。每个 chat/action 的结果返回给 CLI；所有配置动作都成功后才写签到记录。动作失败或按钮等待超时会显示为失败，不把未完成的轮次记为已签到。

### 4.3 `state.json`

```json
{
  "last_signed_date": "2026-10-14",
  "last_signed_at": "2026-10-14T06:03:12+08:00"
}
```

- `run`：若今日已签且未到下一 cron，则跳过本轮。
- `run-once`：强制再跑一轮并更新 state。

时区：优先环境变量 `TZ`，否则系统本地时区；文档建议自用设置 `TZ=Asia/Shanghai`。

## 5. 运行时行为

### 5.1 登录（`login`）

- `apiId` / `apiHash`：环境变量，或首次写入 workdir 本地文件（不进 git）
- Session：`workdir/session/`
- 登录成功后打印最近对话（id / 名称），供手填配置对照

### 5.2 常驻调度（`run`）

```
启动 → 确保已登录 → 加载并校验 config
  → 若需要签到 → signOnce
  → next = cron.next() + random(0..random_seconds)
  → sleep 到 next → 循环
```

- `SIGINT` / `SIGTERM`：停止调度、断开 client 后退出

### 5.3 点按钮等待

- 默认超时约 10s（实现时可提为常量）
- 同一 chat 动作间：`action_interval`
- chat 之间：`sign_interval`

### 5.4 错误处理

| 情况 | 行为 |
|------|------|
| 单个 chat / action 失败 | 记日志，继续后续 |
| FloodWait / 限流 | 等待后重试当前调用（有次数上限） |
| 未登录 / session 失效 | 报错并提示先 `login` |
| 配置校验失败 | 启动前退出，不连 Telegram |
| 网络短暂断开 | 打日志，短睡后继续调度循环 |

## 6. 仓库结构与技术栈

### 6.1 Monorepo 目录（脚手架即按此创建）

```
ts-signer/
├── package.json                 # private workspace root；engines.node: >=24
├── pnpm-workspace.yaml          # packages/*
├── tsconfig.base.json
├── packages/
│   ├── core/                    # @ts-signer/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts         # 对外导出
│   │       ├── config.ts
│   │       ├── client.ts
│   │       ├── signer.ts
│   │       ├── scheduler.ts
│   │       ├── store.ts         # Store 接口 + JsonSignRecordStore
│   │       └── paths.ts
│   ├── cli/                     # @ts-signer/cli（bin: ts-signer）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── cli.ts
│   │       └── wizard.ts        # 交互向导属 CLI 层
│   └── electron/                # @ts-signer/electron
│       ├── package.json         # v1：占位包（README 标明未实现）
│       └── README.md            # 指向设计文档 §10
├── .dev-signer/                 # 开发 workdir（gitignore）
├── docs/superpowers/specs/
└── README.md
```

包职责：

| 包 | 职责 | v1 |
|----|------|----|
| `@ts-signer/core` | MTCute、配置 schema、调度、动作执行、存储抽象 | **实现** |
| `@ts-signer/cli` | 参数解析、向导、调用 core | **实现** |
| `@ts-signer/electron` | Electron 窗口与 GUI | **仅建目录/占位，不实现** |

### 6.2 技术选型

| 用途 | 选型 |
|------|------|
| 运行时 | Node.js **24+** + TypeScript |
| Workspace | **pnpm** monorepo（`pnpm-workspace.yaml`） |
| Telegram | `@mtcute/node`（依赖放在 `core`） |
| CLI | `citty` 或 `commander`（实现时选轻量者，放在 `cli`） |
| 校验 | `zod`（`core`） |
| 调度 | `croner`（`core`） |
| 交互 | `@clack/prompts` 或 `prompts`（`cli`） |

### 6.3 命令

| 命令 | 作用 |
|------|------|
| `ts-signer login` | 登录并打印最近对话 |
| `ts-signer init` | 向导生成/覆盖 `config.json` |
| `ts-signer run` | 常驻调度签到 |
| `ts-signer run-once` | 立刻跑一轮 |

全局选项：`--workdir <path>`。开发期通过 workspace script 默认 `--workdir ./.dev-signer`。

## 7. 测试策略（v1）

- 单测放在 `packages/core`：config Zod 校验、是否需要签到的日期/cron 逻辑、按钮文案匹配（纯函数）
- 不做真实 Telegram E2E；自用靠手工 `login` + `run-once` 验证

## 8. 风险与合规（实现时需在 README 说明）

- MTProto 用户客户端自动化属于灰区；官方主推 Bot API
- 与官方 App 可同时登录，但是同一账号；脚本滥用会影响该账号
- Session 与 API 凭据按密钥保管，永不提交

## 9. v1 实现顺序（供 plan 拆分；不含 §10 业务）

1. Monorepo 脚手架：Node 24、pnpm workspace、`packages/{core,cli,electron}` 占位、gitignore、paths（dev 默认 `.dev-signer`）
2. `core`：config Zod + Store 接口 + JSON 实现 + 纯函数单测
3. `core`：MTCute client；`cli`：`login`
4. `cli`：wizard `init`
5. `core`：ActionRunner；`cli`：`run-once`
6. `core`：Scheduler；`cli`：`run`
7. 根 README（monorepo 说明、开发 workdir、清理提醒、electron 占位说明）

## 10. 后续计划（不在 v1 实现）

以下为产品演进意向，**当前空仓实现与 writing-plans 均不包含**。v1 先把 CLI 签到内核做稳；后续再开独立设计/计划。

### 10.1 Electron 桌面客户端

- 包路径已预留：`packages/electron`（`@ts-signer/electron`）
- 用 Electron 提供图形界面（登录引导、任务配置、运行状态、历史查看）
- **必须**依赖 `@ts-signer/core`，不得复制签到逻辑
- UI 技术栈（React/Vue 等）留给后续专项设计再定

### 10.2 签到回复回读与积分展示

- 签到动作执行后，监听/抓取目标群组或机器人的**回复消息**（典型内容：积分、连续签到天数等）
- 从回复文本中解析积分数值（规则可为：正则 / 简单模板；是否上 AI 解析另议）
- 将解析出的积分等字段展示在客户端界面

依赖前提：v1 已具备「发消息 + 收消息」能力；后续需扩展配置（例如「积分消息匹配规则」）与展示模型。

### 10.3 本地 SQLite 持久化与查看

- 用 SQLite 在客户端侧持久化：签到历史、解析出的积分、关联 chat、原始回复摘要等
- 提供查看能力：按日期 / 按 chat 浏览历史与积分变化
- 替代或升级 v1 的 `state.json`（仅「是否已签」不够支撑历史与积分曲线）

### 10.4 建议落地顺序（仅规划，不实施）

1. v1：`core` + `cli` 稳定；`electron` 保持占位（本文件 §1–§9）
2. `core`：回复捕获 + 积分解析 + 存储抽象扩展（可先仍落文件）
3. `core`：SQLite schema 与查询 / 迁移（从 `state.json` 如有需要）
4. `electron`：壳 + 展示运行状态、积分与历史
5. 打磨 GUI 向导与打包分发

### 10.5 对 v1 的约束（避免推倒重来）

实现 v1 时注意：

- **Monorepo 分包从第一天就建好**（含 `electron` 空包），禁止把业务写进 `cli` 导致日后无法复用
- `SignRecordStore` 以接口形式存在于 `core`，v1 用 JSON 实现；日后可换 SQLite 而不改 ActionRunner
- 收消息路径（点按钮已在用）保持可扩展，便于挂「回复解析」钩子
