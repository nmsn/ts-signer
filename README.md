# ts-signer

Minimal Telegram **user-account** check-in tool: log in via MTProto (MTCute), run cron-driven sign flows (send text, optionally tap inline keyboard buttons), and track whether today’s run already happened.

Inspired by the Python [tg-signer](https://github.com/nmsn/tg-signer) project, but v1 is a deliberately small subset (CLI only, single account, JSON state).

## Requirements

- **Node.js 24+**
- **[pnpm](https://pnpm.io/) 9** (monorepo; see `packageManager` in root `package.json`)

## Monorepo layout

| Package | Role | v1 |
|---------|------|-----|
| [`packages/core`](packages/core) (`@ts-signer/core`) | Config, MTCute client, scheduler, actions, storage | Implemented |
| [`packages/cli`](packages/cli) (`@ts-signer/cli`) | CLI entry (`ts-signer` bin) | Implemented |
| [`packages/electron`](packages/electron) (`@ts-signer/electron`) | Desktop shell | **Placeholder only** — see [design doc §10](docs/superpowers/specs/2026-10-14-ts-signer-design.md#10-后续计划不在-v1-实现) |

Design and scope: [`docs/superpowers/specs/2026-10-14-ts-signer-design.md`](docs/superpowers/specs/2026-10-14-ts-signer-design.md).

## Work directory

**Product default (personal use):** `~/.ts-signer/`
Override anytime: `ts-signer --workdir <path> …`

**Development (this repo):** keep generated data under **`./.dev-signer/`** so nothing lands in your home directory by accident. Root scripts pass `--workdir ./.dev-signer` automatically.

Typical layout:

```
<workdir>/
├── config.json          # schedule + chats + actions
├── state.json           # last signed date (v1)
├── session/             # MTCute session storage (sensitive)
└── credentials.json     # optional apiId/apiHash (sensitive)
```

Get Telegram API credentials from [my.telegram.org](https://my.telegram.org/) (or use env vars — see design doc §5.1).

For local development, copy `.env.example` to `.env` and set `TG_API_ID` and `TG_API_HASH`. The CLI loads `.env` from the current working directory; `.env` is gitignored. Existing shell environment variables take precedence.

## Setup

```bash
pnpm install
pnpm build
```

## Commands (development)

From the repo root (uses `./.dev-signer`):

| Script | CLI command | Purpose |
|--------|-------------|---------|
| `pnpm signer:login` | `login` | Sign in; print recent dialogs (ids/names) for manual `chat_id` |
| `pnpm signer:init` | `init` | Interactive wizard to create/overwrite `config.json`; choose recent chats, paste IDs in bulk, or enter them one at a time |
| `pnpm signer:run-once` | `run-once` | Run one sign round now; failed actions are reported and the round is not recorded as signed |
| `pnpm signer:run` | `run` | Long-running cron scheduler |

The initial CLI flow is `login` → `init` → `run-once` → `run`. In `init`, you can select multiple chats from the 50 most recent dialogs, paste multiple IDs or `@usernames` separated by lines/commas/semicolons/spaces, or keep entering chats manually. Recent-chat selection and bulk input use one shared set of actions for all selected chats; manual entry retains per-chat setup. The first send-text action defaults to `签到` and can be edited. Sent-message cleanup is a shared choice of keep, 10, 30, or 60 seconds, defaulting to 10 seconds. A round is recorded as signed only when every configured action succeeds; a missing callback button or Telegram error is shown against its chat/action.

Low-level entry (same dev workdir):

```bash
pnpm ts-signer --help
pnpm ts-signer login
```

For production, build then invoke the CLI with default or explicit workdir, e.g.:

```bash
pnpm --filter @ts-signer/cli exec node ./dist/cli.js login
# or: … --workdir ~/.ts-signer run
```

Other root scripts: `pnpm test`, `pnpm build`.

Timezone for “today” checks: set `TZ` (e.g. `TZ=Asia/Shanghai`) if needed.

## Cleanup checklist (after development)

Before sharing the repo or switching to personal use, verify ([design §2.3](docs/superpowers/specs/2026-10-14-ts-signer-design.md#23-清理提醒开发结束必查)):

- [ ] Check whether `.dev-signer/` still exists in the repo (includes session data)
- [ ] If you no longer need it, delete the entire `.dev-signer/` directory
- [ ] Confirm no session files or credentials were committed to git
- [ ] For daily use, switch to `~/.ts-signer/` or pass `--workdir` explicitly

`.gitignore` already excludes `.dev-signer/`, `.ts-signer/`, and common secret paths — do not remove those entries.

## Risks and session safety

- Automating a **user** session over MTProto is a **gray area**; Telegram’s documented path is the Bot API. Use at your own risk on accounts you control.
- The same account can stay logged in on the official app and this tool (multiple sessions), but abusive or high-volume automation can still affect the account.
- Treat `session/` and API credentials like passwords: never commit them, back them up carefully, and rotate if leaked.

## Out of scope in v1 (planned later)

Not implemented in this release; see [design §10](docs/superpowers/specs/2026-10-14-ts-signer-design.md#10-后续计划不在-v1-实现):

- **Electron** desktop UI (`packages/electron` is reserved)
- **Points / reply parsing** from sign-in bot messages
- **SQLite** history and analytics (v1 uses `state.json` only)

Also excluded in v1: proxy UI, multi-account, topics, monitor/automation/WebUI, AI actions, and migration from the Python project — full list in the design doc §1.2.

## License

See repository license file when published.
