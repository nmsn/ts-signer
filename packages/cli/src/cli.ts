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
  normalizeAccountName,
  resolveCredentials,
  resolveAccountWorkdir,
  resolveWorkdir,
  workdirPaths,
  runScheduler,
  saveCredentials,
  signOnce,
  type SignRunResult,
} from "@ts-signer/core";
import fs from "node:fs";
import path from "node:path";
import { cancel, isCancel, password, text } from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { runInitWizard } from "./wizard.js";

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}

let baseWorkdir = resolveWorkdir();
let workdir = baseWorkdir;
let selectedProfile = "default";

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

async function promptForCredentials(targetWorkdir: string): Promise<void> {
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

  saveCredentials(targetWorkdir, {
    apiId: Number(apiIdInput),
    apiHash,
  });
}

async function ensureCredentials(targetWorkdir: string): Promise<void> {
  ensureWorkdir(targetWorkdir);
  if (loadCredentials(targetWorkdir)) {
    return;
  }

  try {
    await resolveCredentials(targetWorkdir);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("Telegram API credentials not found.")
    ) {
      throw error;
    }
    await promptForCredentials(targetWorkdir);
  }
}

const login = defineCommand({
  meta: {
    name: "login",
    description: "Log in to Telegram and list recent dialogs",
  },
  async run() {
    await ensureCredentials(workdir);
    const dialogs = await loginAndListDialogs(workdir);
    console.table(dialogs);
  },
});

const logout = defineCommand({
  meta: {
    name: "logout",
    description: "Log out the Telegram account selected by --profile",
  },
  async run() {
    const { sessionDir } = workdirPaths(workdir);
    const sessionFile = path.join(sessionDir, "telegram.session");
    if (!fs.existsSync(sessionFile)) {
      console.log(`No local Telegram session found for profile "${selectedProfile}".`);
      return;
    }

    const client = createTelegramClient(workdir);
    try {
      await client.logOut();
      console.log(`Logged out profile "${selectedProfile}" from Telegram.`);
    } finally {
      await client.destroy();
    }
  },
});

const accountList = defineCommand({
  meta: {
    name: "list",
    description: "List local account profiles",
  },
  run() {
    const accountsDir = path.join(baseWorkdir, "accounts");
    const profiles = [{ name: "default", dir: baseWorkdir }];
    if (fs.existsSync(accountsDir)) {
      for (const entry of fs.readdirSync(accountsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          profiles.push({ name: entry.name, dir: path.join(accountsDir, entry.name) });
        }
      }
    }

    console.table(
      profiles.map(({ name, dir }) => ({
        profile: name,
        selected: name === selectedProfile ? "✓" : "",
        session: fs.existsSync(path.join(workdirPaths(dir).sessionDir, "telegram.session"))
          ? "file present"
          : "file missing",
      })),
    );
  },
});

const accountAdd = defineCommand({
  meta: {
    name: "add",
    description: "Create a profile and log in a Telegram account",
  },
  args: {
    name: {
      type: "positional",
      description: "Profile name (letters, numbers, hyphens, underscores)",
      required: true,
    },
  },
  async run({ args }) {
    const name = normalizeAccountName(args.name);
    if (name === "default") {
      throw new Error('The profile name "default" is reserved for the base work directory.');
    }
    const profileWorkdir = resolveAccountWorkdir(baseWorkdir, name);
    if (fs.existsSync(profileWorkdir)) {
      throw new Error(
        `Profile "${name}" already exists. To log in or retry, run: ts-signer --profile ${name} login`,
      );
    }

    await ensureCredentials(profileWorkdir);
    const dialogs = await loginAndListDialogs(profileWorkdir);
    console.log(`Profile "${name}" logged in. Recent dialogs:`);
    console.table(dialogs);
    console.log(`Use it with: ts-signer --profile ${name} init`);
  },
});

const account = defineCommand({
  meta: {
    name: "account",
    description: "Manage isolated Telegram account profiles",
  },
  subCommands: {
    add: accountAdd,
    list: accountList,
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
    profile: {
      type: "string",
      description: "Account profile to use (default: base work directory)",
    },
  },
  setup({ args }) {
    baseWorkdir = resolveWorkdir(args.workdir);
    selectedProfile = args.profile ? normalizeAccountName(args.profile) : "default";
    workdir = resolveAccountWorkdir(baseWorkdir, selectedProfile);
  },
  subCommands: {
    init,
    login,
    logout,
    account,
    run,
    "run-once": runOnce,
  },
});

await runMain(main);
