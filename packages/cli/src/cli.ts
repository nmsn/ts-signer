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
  saveCredentials,
  signOnce,
} from "@ts-signer/core";
import { cancel, isCancel, password, text } from "@clack/prompts";
import { defineCommand, runMain } from "citty";

let workdir = resolveWorkdir();

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
      await signOnce({
        config,
        bridge: createTelegramBridge(client),
        store: new JsonSignRecordStore(workdir),
        force: true,
      });
    } finally {
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
    login,
    "run-once": runOnce,
  },
});

await runMain(main);
