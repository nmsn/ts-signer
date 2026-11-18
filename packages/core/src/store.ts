import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { workdirPaths } from "./paths.js";
import type { SignState } from "./schedule.js";
import { formatLocalDateString } from "./schedule.js";
import type { SignChatResult, SignRunResult } from "./signer.js";

export type SignRunTrigger = "scheduled" | "manual";
export type SignExecutionStatus = "running" | "success" | "partial" | "failed";
export type SignReplySenderType =
  | "bot"
  | "human"
  | "channel"
  | "anonymous"
  | "unknown";

export type SignHistoryReply = {
  sentMessageId: number;
  messageId: number;
  receivedAt: string;
  senderId: number | null;
  senderName: string;
  senderType: SignReplySenderType;
  replyToMessageId: number | null;
  relation: "direct_reply" | "time_window";
  text: string;
};

export type SignHistoryChat = {
  chatId: string;
  chatName: string | null;
  position: number;
  startedAt: string;
  finishedAt: string;
  actionStatus: "success" | "failed";
  confirmationStatus: "unverified";
  error: string | null;
  replies: SignHistoryReply[];
};

export type SignHistoryRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: SignRunTrigger;
  executionStatus: SignExecutionStatus;
  chats: SignHistoryChat[];
};

export interface SignRecordStore {
  load(): SignState;
  markSigned(at: Date): void;
}

export interface SignHistoryStore extends SignRecordStore {
  beginRun(startedAt: Date, trigger: SignRunTrigger): number;
  recordChat(
    runId: number,
    result: SignChatResult,
    startedAt: Date,
    finishedAt: Date,
  ): void;
  finishRun(runId: number, result: SignRunResult, finishedAt: Date): void;
  listRuns(limit: number): SignHistoryRun[];
}

type RunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: SignRunTrigger;
  execution_status: SignExecutionStatus;
};

type ChatRow = {
  id: number;
  chat_id: string;
  chat_name: string | null;
  position: number;
  started_at: string;
  finished_at: string;
  action_status: "success" | "failed";
  confirmation_status: "unverified";
  error: string | null;
};

type ReplyRow = {
  sent_message_id: number;
  message_id: number;
  received_at: string;
  sender_id: number | null;
  sender_name: string;
  sender_type: SignReplySenderType;
  reply_to_message_id: number | null;
  relation: "direct_reply" | "time_window";
  text: string;
};

const emptyState = (): SignState => ({
  last_signed_date: null,
  last_signed_at: null,
});

const toIsoString = (date: Date): string => date.toISOString();

function summarizeErrors(result: SignChatResult): string | null {
  const errors = result.actions.flatMap((action, index) =>
    action.success
      ? []
      : [`${index + 1}. ${action.error ?? "Action failed"}`],
  );
  return errors.length > 0 ? errors.join("; ").slice(0, 2_000) : null;
}

/** Legacy adapter retained for existing callers; the CLI now uses SQLite. */
export class JsonSignRecordStore implements SignRecordStore {
  private readonly statePath: string;

  constructor(workdir: string) {
    this.statePath = workdirPaths(workdir).state;
  }

  load(): SignState {
    if (!fs.existsSync(this.statePath)) {
      return emptyState();
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as Partial<SignState>;
      return {
        last_signed_date: raw.last_signed_date ?? null,
        last_signed_at: raw.last_signed_at ?? null,
      };
    } catch {
      return emptyState();
    }
  }

  markSigned(at: Date): void {
    const state: SignState = {
      last_signed_date: formatLocalDateString(at),
      last_signed_at: at.toISOString(),
    };
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

export class SqliteSignRecordStore implements SignHistoryStore {
  private readonly db: Database.Database;

  constructor(workdir: string) {
    const paths = workdirPaths(workdir);
    fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    this.db = new Database(paths.history);
    if (process.platform !== "win32") {
      fs.chmodSync(paths.history, 0o600);
    }
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
    this.importLegacyState(paths.state);
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1) {
      throw new Error(`Unsupported history database version: ${version}`);
    }
    if (version === 1) {
      return;
    }

    const createSchema = this.db.transaction(() => {
      this.db.exec(`
      CREATE TABLE sign_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        last_signed_date TEXT,
        last_signed_at TEXT
      );

      CREATE TABLE sign_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
        execution_status TEXT NOT NULL CHECK (
          execution_status IN ('running', 'success', 'partial', 'failed')
        )
      );

      CREATE TABLE sign_run_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES sign_runs(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL,
        chat_name TEXT,
        position INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        action_status TEXT NOT NULL CHECK (action_status IN ('success', 'failed')),
        confirmation_status TEXT NOT NULL DEFAULT 'unverified'
          CHECK (confirmation_status IN ('unverified', 'confirmed', 'rejected', 'timeout')),
        error TEXT,
        UNIQUE (run_id, position)
      );

      CREATE TABLE sign_run_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_run_id INTEGER NOT NULL REFERENCES sign_run_chats(id) ON DELETE CASCADE,
        sent_message_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        sender_id INTEGER,
        sender_name TEXT NOT NULL,
        sender_type TEXT NOT NULL CHECK (
          sender_type IN ('bot', 'human', 'channel', 'anonymous', 'unknown')
        ),
        reply_to_message_id INTEGER,
        relation TEXT NOT NULL CHECK (relation IN ('direct_reply', 'time_window')),
        text TEXT NOT NULL
      );

      CREATE INDEX sign_runs_started_at_idx ON sign_runs(started_at DESC);
      CREATE INDEX sign_run_chats_run_id_idx ON sign_run_chats(run_id, position);
      CREATE INDEX sign_run_replies_chat_run_id_idx ON sign_run_replies(chat_run_id, received_at);
      `);
      this.db.pragma("user_version = 1");
    });
    createSchema();
  }

  private importLegacyState(statePath: string): void {
    const existing = this.db
      .prepare("SELECT singleton FROM sign_state WHERE singleton = 1")
      .get();
    if (existing) {
      return;
    }

    let state = emptyState();
    if (fs.existsSync(statePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as Partial<SignState>;
        state = {
          last_signed_date:
            typeof raw.last_signed_date === "string" ? raw.last_signed_date : null,
          last_signed_at:
            typeof raw.last_signed_at === "string" && !Number.isNaN(Date.parse(raw.last_signed_at))
              ? raw.last_signed_at
              : null,
        };
      } catch {
        console.warn(`Could not import legacy sign state from ${statePath}; starting with empty state.`);
      }
    }

    this.db
      .prepare(
        "INSERT INTO sign_state (singleton, last_signed_date, last_signed_at) VALUES (1, ?, ?)",
      )
      .run(state.last_signed_date, state.last_signed_at);
  }

  load(): SignState {
    const row = this.db
      .prepare(
        "SELECT last_signed_date, last_signed_at FROM sign_state WHERE singleton = 1",
      )
      .get() as Pick<SignState, "last_signed_date" | "last_signed_at"> | undefined;
    return row ?? emptyState();
  }

  markSigned(at: Date): void {
    this.db
      .prepare(
        `UPDATE sign_state
         SET last_signed_date = ?, last_signed_at = ?
         WHERE singleton = 1`,
      )
      .run(formatLocalDateString(at), toIsoString(at));
  }

  beginRun(startedAt: Date, trigger: SignRunTrigger): number {
    const result = this.db
      .prepare(
        "INSERT INTO sign_runs (started_at, trigger, execution_status) VALUES (?, ?, 'running')",
      )
      .run(toIsoString(startedAt), trigger);
    return Number(result.lastInsertRowid);
  }

  recordChat(
    runId: number,
    result: SignChatResult,
    startedAt: Date,
    finishedAt: Date,
  ): void {
    const writeChat = this.db.transaction(() => {
      const chatRow = this.db
        .prepare(
          `INSERT INTO sign_run_chats
            (run_id, chat_id, chat_name, position, started_at, finished_at,
             action_status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          String(result.chatId),
          result.chatName ?? null,
          result.position,
          toIsoString(startedAt),
          toIsoString(finishedAt),
          result.success ? "success" : "failed",
          summarizeErrors(result),
        );
      const chatRunId = Number(chatRow.lastInsertRowid);
      const insertReply = this.db.prepare(
        `INSERT INTO sign_run_replies
          (chat_run_id, sent_message_id, message_id, received_at, sender_id,
           sender_name, sender_type, reply_to_message_id, relation, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const reply of result.replies) {
        insertReply.run(
          chatRunId,
          reply.sentMessageId,
          reply.messageId,
          toIsoString(reply.receivedAt),
          reply.senderId,
          reply.senderName.slice(0, 256),
          reply.senderType,
          reply.replyToMessageId,
          reply.relation,
          reply.text.slice(0, 2_000),
        );
      }
    });
    writeChat();
  }

  finishRun(runId: number, result: SignRunResult, finishedAt: Date): void {
    const finish = this.db.transaction(() => {
      const run = this.db
        .prepare("SELECT started_at FROM sign_runs WHERE id = ?")
        .get(runId) as { started_at: string } | undefined;
      if (!run) {
        throw new Error(`Unknown sign run: ${runId}`);
      }

      const succeededChats = result.chats.filter((chat) => chat.success).length;
      const executionStatus: SignExecutionStatus = result.success
        ? "success"
        : succeededChats > 0
          ? "partial"
          : "failed";
      this.db
        .prepare(
          "UPDATE sign_runs SET finished_at = ?, execution_status = ? WHERE id = ?",
        )
        .run(toIsoString(finishedAt), executionStatus, runId);

      if (result.success) {
        const startedAt = new Date(run.started_at);
        this.db
          .prepare(
            `UPDATE sign_state
             SET last_signed_date = ?, last_signed_at = ?
             WHERE singleton = 1`,
          )
          .run(formatLocalDateString(startedAt), run.started_at);
      }
    });
    finish();
  }

  listRuns(limit: number): SignHistoryRun[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("History limit must be an integer from 1 to 100.");
    }
    const runs = this.db
      .prepare(
        `SELECT id, started_at, finished_at, trigger, execution_status
         FROM sign_runs ORDER BY started_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as RunRow[];

    return runs.map((run) => {
      const chats = this.db
        .prepare(
          `SELECT id, chat_id, chat_name, position, started_at, finished_at,
                  action_status, confirmation_status, error
           FROM sign_run_chats WHERE run_id = ? ORDER BY position`,
        )
        .all(run.id) as ChatRow[];
      return {
        id: run.id,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        trigger: run.trigger,
        executionStatus: run.execution_status,
        chats: chats.map((chat) => {
          const replies = this.db
            .prepare(
              `SELECT sent_message_id, message_id, received_at, sender_id,
                      sender_name, sender_type, reply_to_message_id, relation, text
               FROM sign_run_replies WHERE chat_run_id = ? ORDER BY received_at`,
            )
            .all(chat.id) as ReplyRow[];
          return {
            chatId: chat.chat_id,
            chatName: chat.chat_name,
            position: chat.position,
            startedAt: chat.started_at,
            finishedAt: chat.finished_at,
            actionStatus: chat.action_status,
            confirmationStatus: chat.confirmation_status,
            error: chat.error,
            replies: replies.map((reply) => ({
              sentMessageId: reply.sent_message_id,
              messageId: reply.message_id,
              receivedAt: reply.received_at,
              senderId: reply.sender_id,
              senderName: reply.sender_name,
              senderType: reply.sender_type,
              replyToMessageId: reply.reply_to_message_id,
              relation: reply.relation,
              text: reply.text,
            })),
          };
        }),
      };
    });
  }

  close(): void {
    this.db.close();
  }
}
