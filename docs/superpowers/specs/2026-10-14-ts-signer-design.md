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
| 架构风格 | 精简单体 CLI（方案 1） |
| 选签到目标 | 手填 `chat_id`；`login` 打印最近对话供对照；不做自动探测、不做点选菜单 |
| Node | **24+** |

### 1.2 明确不做（v1）

- 内置 HTTP/SOCKS 代理
- 多账号 / `multi-run`
- 群组话题 `message_thread_id`
- Dice、AI 识图、AI 算题
- WebUI、monitor、automation 规则引擎
- SQLite；从 Python 版自动迁移
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

```
ts-signer (CLI)
├── login          → MTCute 登录，session 落到 workdir
├── init           → 交互向导，写出 config.json
├── run            → 常驻：到点执行签到循环
└── run-once       → 立即跑一轮（调试用）

运行时：
  TelegramClient (@mtcute/node)
       ↓
  SignerEngine
       ├── Scheduler（cron + random_seconds）
       ├── ActionRunner（send_text / click_keyboard_by_text）
       └── SignRecordStore（state.json）
```

原则：

- 单账号、单 `config.json`（不做多 task 目录）
- 配置是业务唯一真相；向导只负责生成/改写
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

执行顺序：按 `chats` → 按 `actions` 依次执行。整轮尝试结束后写签到记录（个别 chat 失败仍记「本轮已跑过」，避免失败 chat 导致无限重试；与原版行为一致）。

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

```
ts-signer/
├── package.json          # engines.node: >=24
├── tsconfig.json
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── wizard.ts
│   ├── client.ts
│   ├── signer.ts
│   ├── scheduler.ts
│   ├── store.ts
│   └── paths.ts
├── .dev-signer/          # 开发 workdir（gitignore）
├── docs/superpowers/specs/
└── README.md
```

| 用途 | 选型 |
|------|------|
| 运行时 | Node.js **24+** + TypeScript |
| Telegram | `@mtcute/node` |
| CLI | `citty` 或 `commander`（实现时选轻量者） |
| 校验 | `zod` |
| 调度 | `croner` |
| 交互 | `@clack/prompts` 或 `prompts` |
| 包管理 | `pnpm` |

### 命令

| 命令 | 作用 |
|------|------|
| `ts-signer login` | 登录并打印最近对话 |
| `ts-signer init` | 向导生成/覆盖 `config.json` |
| `ts-signer run` | 常驻调度签到 |
| `ts-signer run-once` | 立刻跑一轮 |

全局选项：`--workdir <path>`。

## 7. 测试策略（v1）

- 单测：config Zod 校验、是否需要签到的日期/cron 逻辑、按钮文案匹配（纯函数）
- 不做真实 Telegram E2E；自用靠手工 `login` + `run-once` 验证

## 8. 风险与合规（实现时需在 README 说明）

- MTProto 用户客户端自动化属于灰区；官方主推 Bot API
- 与官方 App 可同时登录，但是同一账号；脚本滥用会影响该账号
- Session 与 API 凭据按密钥保管，永不提交

## 9. 实现顺序（供后续 plan 拆分）

1. 脚手架：Node 24、pnpm、TS、gitignore、paths（dev 默认 `.dev-signer`）
2. config Zod + store + 纯函数单测
3. MTCute client + `login`
4. wizard `init`
5. ActionRunner + `run-once`
6. Scheduler + `run`
7. README（含开发 workdir 与清理提醒）
