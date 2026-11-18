# SQLite 签到历史设计

日期：2026-11-17
状态：已实现（2026-11-17）

## 1. 目标

为 CLI 增加可查询的本地签到历史，回答：什么时候执行、执行了哪些频道、每个频道是否成功、失败原因是什么。历史应在账号档案之间隔离，并继续保证“只有整轮全部成功才标记当天已签”的现有行为。

本功能记录签到执行结果，并保存发送签到后短时间内观察到的相关回复文本与发送者类别；不保存完整聊天记录，也不解析 Telegram 回复中的积分。

Telegram API 接受消息发送，不等于目标签到机器人已经完成签到。历史记录必须区分“发送/动作执行结果”和“签到确认结果”，不能仅凭 `sendText` 成功就显示为“签到已确认”。

## 2. 用户操作

```bash
pnpm ts-signer history
pnpm ts-signer history --limit 50
pnpm ts-signer --profile work history
```

默认显示最近 20 轮，每轮展示本机时区下的开始时间、触发方式、整体状态、频道结果和观察到的回复摘要；回复显示机器人、真人或未知发送者。未配置回复确认规则的频道标为“已发送，未确认”，不显示成“签到已确认”。`--limit` 限制显示条数，范围为 1–100。

`run` 的触发方式记录为 `scheduled`，`run-once` 记录为 `manual`。因当天已完成而跳过的检查不生成签到轮次。

## 3. 数据位置与隔离

数据库路径为 `<workdir>/history.sqlite`。默认开发目录中为 `.dev-signer/history.sqlite`；账号档案使用各自目录，例如 `.dev-signer/accounts/work/history.sqlite`。

SQLite 是本地单文件数据库，不运行后台服务。使用 `better-sqlite3` 同步读写；将其作为 `@ts-signer/core` 的直接依赖声明，而不是依赖 MTCute 的传递依赖。数据库文件权限设为仅当前用户可读写（`0600`）。数据库写入使用短事务，不在 Telegram 网络操作期间持有事务。

## 4. Schema

所有时间戳保存为 UTC ISO 8601 字符串，CLI 输出时转为本机时区。`chat_id` 保存为文本，兼容数字 ID 和 `@username`。

### `sign_state`

单行调度检查点，保存 `last_signed_date` 和 `last_signed_at`。只有整轮成功时更新。它是去重逻辑的唯一持久化来源。

### `sign_runs`

每轮签到一行：

- `id`：数据库生成的轮次 ID
- `started_at`、`finished_at`
- `trigger`：`scheduled` 或 `manual`
- `execution_status`：`running`、`success`、`partial` 或 `failed`，只概括 Telegram 动作执行结果

所有频道的 `action_status` 都成功时为 `success`；至少一个频道成功但未全部成功时为 `partial`；没有频道成功时为 `failed`。`success` 只表示动作执行成功，不代表签到业务已确认。

开始执行前创建 `running` 记录；每个频道完成后立即保存频道结果；整轮结束时更新状态。进程异常退出时，未结束的记录保留为 `running`，历史命令将其显示为未完成，不将其误报成成功或失败。

### `sign_run_chats`

每轮每个频道一行：

- `run_id`、配置顺序、`chat_id`、频道名称
- `started_at`、`finished_at`
- `action_status`：`success` 或 `failed`，表示 Telegram 操作是否成功
- `confirmation_status`：首版为 `unverified`；后续支持 `confirmed`、`rejected`、`timeout`
- `error`：失败动作的简短错误摘要，可空

按 `run_id` 和 `started_at` 建索引，并启用外键约束。错误摘要限制长度；不保存签到发送文本、按钮回调数据、API 凭据或 Telegram session。

### `sign_run_replies`

保存发送签到消息后观察窗口内收到的相关消息：

- `chat_run_id`（关联 `sign_run_chats`）、签到消息 ID、回复 `message_id`、`received_at`
- `sender_id`（允许为空）、`sender_name`、`sender_type`：`bot`、`human`、`channel`、`anonymous` 或 `unknown`
- `reply_to_message_id`、关联方式：直接回复签到消息，或仅在同群观察窗口内出现
- `text`：纯文本摘要，限制长度；不保存媒体内容

观察期间只关注签到目标群。精确引用刚发送消息的回复优先关联；未引用签到消息、但在观察窗口内出现的消息作为“时间窗口内消息”记录，不能据此断定它就是签到回复。群内无关聊天可能出现在这个窗口，因此历史必须保留关联方式。

首版不单独保存每个 action 的结果；如后续需要按动作排查，再加 `sign_run_actions` 表。

首版不假设 Telegram 有通用的签到确认信号。发送后开启一个有限观察窗口（建议默认 10 秒）；窗口内的新消息通过 `Message.sender` 分类：`User` 且 `isBot` 为真的是机器人，普通 `User` 是真人；匿名管理员、频道发言或缺少发送者信息归为对应类别或 `unknown`。频道配置尚无回复匹配规则时，即便 `action_status=success` 并收到机器人回复，`confirmation_status` 仍是 `unverified`。后续可以为每个频道配置可选的机器人发送者和成功/失败关键词；只有收到符合规则的回复才记为 `confirmed` 或 `rejected`，超时记为 `timeout`。

## 5. 与签到流程的集成

将当前 `SignRecordStore` 扩展为签到状态与历史记录的单一接口。SQLite 实现负责状态读取、创建轮次、保存频道结果、结束轮次和查询历史；`signOnce` 仍负责执行 Telegram 动作，并在频道完成时写入结果。

存储接口保留旧 `SignRecordStore` 的最小状态读写契约，并由 `SignHistoryStore` 增加历史轮次能力，以兼容 JSON adapter 和既有调用方。SQLite adapter 实现完整历史契约，CLI 统一使用 SQLite：

```ts
interface SignHistoryStore extends SignRecordStore {
  beginRun(startedAt: Date, trigger: "scheduled" | "manual"): number;
  recordChat(runId: number, result: SignChatResult, startedAt: Date, finishedAt: Date): void;
  finishRun(runId: number, result: SignRunResult, finishedAt: Date): void;
  listRuns(limit: number): SignRunHistory[];
}
```

`finishRun` 在一个事务内结束轮次，并且仅当所有配置的 Telegram 动作都执行成功时更新 `sign_state`。这是对现有调度语义的兼容，不能解释为机器人已确认签到。为保持现有调度语义，检查点的 `last_signed_at` 使用轮次的 `started_at`；`sign_runs.finished_at` 单独保存实际完成时间。部分失败和全部失败都写入历史，但不更新签到检查点。`signOnce` 的 `skipped` 返回不创建数据库轮次。

CLI 的 `run`、`run-once` 共用 `SqliteSignRecordStore`；`JsonSignRecordStore` 保留为兼容 adapter，不再用于 CLI。CLI 的 `history` 也通过 core 导出的历史查询接口读取数据，不直接访问 SQL。

## 6. 兼容与迁移

数据库使用 `PRAGMA user_version` 管理 schema 迁移。首次创建数据库时，如果发现有效的旧 `state.json`，将其中的最后成功日期和时间导入 `sign_state`；没有历史频道数据可迁移。原 `state.json` 保留为备份，不再继续更新。迁移完成标记写入数据库，保证重复启动不会重复导入。

旧的 JSON 格式不做破坏性改写，也不自动删除用户文件。

## 7. 失败与数据保留

- 单个频道失败后继续执行其余频道，并立即保存已完成频道结果。
- 整轮成功时更新去重检查点；部分失败时保留失败历史，以便查看。
- 进程被强制终止时，已完成频道结果仍保留，轮次为 `running`；未完成的当前频道没有结果行。
- 首版不自动清理历史。按当前规模，数据库预计很小；后续若需要再加清理/导出功能。
- 同一 workdir 不应同时运行多个签到进程；数据库锁和现有调度状态都按单进程使用设计。

## 8. 实施顺序

1. 添加 SQLite 依赖、数据库路径和 schema 迁移。
2. 实现 `SqliteSignRecordStore`、旧 `state.json` 一次性迁移和历史查询。
3. 调整 `signOnce` 与 CLI，逐频道记录结果；增加 `history` 命令和发送后的 10 秒回复观察。
4. 更新 README 与原设计文档中的 SQLite 范围说明。
5. 增加存储迁移、状态去重和历史查询测试；使用临时 workdir，不连接 Telegram。
