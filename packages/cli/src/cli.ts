#!/usr/bin/env node
import {
  CORE_VERSION,
  JsonSignRecordStore,
  createTelegramBridge,
  createTelegramClient,
  ensureWorkdir,
  loadConfig,
  loadCredentials,
  loginAndListDialogs,
  resolveCredentials,
  resolveWorkdir,
  runScheduler,
  saveCredentials,
  signOnce,
  type SignRunResult,
} from "@ts-signer/core";
import { cancel, isCancel, password, text } from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { runInitWizard } from "./wizard.js";

let workdir = resolveWorkdir();

function printSignResult(result: SignRunResult): void {
  if (result.skipped) {
    console.log("Today's check-in is already complete; skipped.");
    return;
  }

  for (const chat of result.chats) {
    console.log(`${chat.success ? "✓" : "✗"} ${String(chat.chatId)}`);
    for (const [index, action] of chat.actions.entries()) {
      const description = `${action.action.type}: ${action.action.text}`;
      console.log(
        `  ${action.success ? "✓" : "✗"} ${index + 1}. ${description}${
          action.error ? ` — ${action.error}` : ""
        }`,
      );
    }
  }

  console.log(
    result.success
      ? "Check-in round completed successfully."
      : "Check-in round incomplete; failed actions were not recorded as signed.",
  );
}

async function promptForCredentials(): Promise<void> {
  const apiIdInput = await text({
    message: "Telegram API ID",
    validate(value) {
      const apiId = Number(value);
      if (!Number.isInteger(apiId) || apiId <= 0) {
        return "API ID must be a positive integer";
      }
    },
  });
  if (isCancel(apiIdInput)) {
    cancel("Login cancelled");
    throw new Error("Login cancelled");
  }

  const apiHash = await password({
    message: "Telegram API hash",
    validate(value) {
      if (!value?.trim()) {
        return "API hash is required";
      }
    },
  });
  if (isCancel(apiHash)) {
    cancel("Login cancelled");
    throw new Error("Login cancelled");
  }

  saveCredentials(workdir, {
    apiId: Number(apiIdInput),
    apiHash,
  });
}

const login = defineCommand({
  meta: {
    name: "login",
    description: "Log in to Telegram and list recent dialogs",
  },
  async run() {
    ensureWorkdir(workdir);
    if (!loadCredentials(workdir)) {
      try {
        await resolveCredentials(workdir);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith("Telegram API credentials not found.")
        ) {
          throw error;
        }
        await promptForCredentials();
      }
    }

    const dialogs = await loginAndListDialogs(workdir);
    console.table(dialogs);
  },
});

const init = defineCommand({
  meta: {
    name: "init",
    description: "Create an interactive signer configuration",
  },
  async run() {
    await runInitWizard(workdir);
  },
});

const runOnce = defineCommand({
  meta: {
    name: "run-once",
    description: "Run one sign-in round even if it already ran",
  },
  async run() {
    const config = loadConfig(workdir);
    const client = createTelegramClient(workdir);

    try {
      await client.start();
      const result = await signOnce({
        config,
        bridge: createTelegramBridge(client),
        store: new JsonSignRecordStore(workdir),
        force: true,
      });
      printSignResult(result);
      if (!result.success) {
        process.exitCode = 1;
      }
    } finally {
      await client.destroy();
    }
  },
});

const run = defineCommand({
  meta: {
    name: "run",
    description: "Run sign-in rounds on the configured schedule",
  },
  async run() {
    const config = loadConfig(workdir);
    const client = createTelegramClient(workdir);
    const bridge = createTelegramBridge(client);
    const store = new JsonSignRecordStore(workdir);
    let stopped = false;
    let wakeSleep: (() => void) | undefined;

    const stop = () => {
      stopped = true;
      wakeSleep?.();
    };
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (wakeSleep === finish) {
            wakeSleep = undefined;
          }
          resolve();
        };
        const timer = setTimeout(finish, ms);
        wakeSleep = finish;
        if (stopped) {
          finish();
        }
      });

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    try {
      await client.start();
      await runScheduler({
        config,
        shouldStop: () => stopped,
        sleep,
        tick: async () => {
          const result = await signOnce({
            config,
            bridge,
            store,
            force: false,
          });
          printSignResult(result);
        },
      });
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      await client.destroy();
    }
  },
});

const main = defineCommand({
  meta: {
    name: "ts-signer",
    version: CORE_VERSION,
    description: "Telegram sign-in automation",
  },
  args: {
    workdir: {
      type: "string",
      description: "Working directory",
    },
  },
  setup({ args }) {
    workdir = resolveWorkdir(args.workdir);
  },
  subCommands: {
    init,
    login,
    run,
    "run-once": runOnce,
  },
});

await runMain(main);
