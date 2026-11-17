import fs from "node:fs";
import {
  loginAndListDialogs,
  parseSignAt,
  saveConfig,
  type SignAction,
  type SignChat,
  type SignerConfig,
  workdirPaths,
} from "@ts-signer/core";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiline,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";

class WizardCancelled extends Error {}

type ChatTarget = {
  id: number | string;
  name?: string;
};

type TargetInputMode = "recent" | "batch" | "manual";

function promptValue<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Configuration cancelled");
    throw new WizardCancelled();
  }
  return value as Exclude<T, symbol>;
}

function required(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return "A value is required";
  }
}

function nonNegativeInteger(value: string | undefined): string | undefined {
  const parsed = Number(value);
  if (!value?.trim() || !Number.isSafeInteger(parsed) || parsed < 0) {
    return "Enter a non-negative integer";
  }
}

function parseChatId(value: string): number | string {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  return trimmed;
}

function parseChatTargets(input: string): ChatTarget[] {
  const values = input.split(/[\s,;]+/).filter(Boolean);
  if (values.length === 0) {
    throw new Error("Enter at least one chat ID or @username");
  }

  const targets = new Map<string, ChatTarget>();
  for (const value of values) {
    let id: number | string;
    if (/^-?\d+$/.test(value)) {
      const numericId = Number(value);
      if (!Number.isSafeInteger(numericId)) {
        throw new Error(`Chat ID is outside the safe integer range: ${value}`);
      }
      id = numericId;
    } else if (/^@[A-Za-z0-9_]+$/.test(value)) {
      id = value;
    } else {
      throw new Error(`Invalid chat ID or @username: ${value}`);
    }

    const key = String(id).toLowerCase();
    if (!targets.has(key)) {
      targets.set(key, { id });
    }
  }

  return [...targets.values()];
}

async function promptAction(type: SignAction["type"]): Promise<SignAction> {
  const actionText = promptValue(
    await text({
      message:
        type === "send_text"
          ? "Text to send"
          : "Inline keyboard text to click",
      initialValue: type === "send_text" ? "签到" : undefined,
      validate: required,
    }),
  );
  return { type, text: actionText.trim() };
}

async function promptActions(): Promise<SignAction[]> {
  const actions: SignAction[] = [await promptAction("send_text")];
  while (
    promptValue(
      await confirm({
        message: "Add another action?",
        initialValue: false,
      }),
    )
  ) {
    const type = promptValue(
      await select<SignAction["type"]>({
        message: "Action type",
        options: [
          { value: "send_text", label: "Send text" },
          {
            value: "click_keyboard_by_text",
            label: "Click inline keyboard by text",
          },
        ],
      }),
    );
    actions.push(await promptAction(type));
  }
  return actions;
}

async function promptDeleteAfter(): Promise<number | null> {
  return promptValue(
    await select<number | null>({
      message: "Delete sent messages after how long?",
      initialValue: 10,
      options: [
        { value: null, label: "Don't delete" },
        { value: 10, label: "10 seconds" },
        { value: 30, label: "30 seconds" },
        { value: 60, label: "60 seconds" },
      ],
    }),
  );
}

async function configureSharedChatSettings(
  targets: ChatTarget[],
): Promise<SignChat[]> {
  const actions = await promptActions();
  const deleteAfter = await promptDeleteAfter();
  return targets.map(({ id, name }) => ({
    chat_id: id,
    ...(name ? { name } : {}),
    delete_after: deleteAfter,
    action_interval: 1,
    actions: actions.map((action) => ({ ...action })),
  }));
}

async function promptChat(): Promise<SignChat> {
  const chatId = promptValue(
    await text({
      message: "Chat ID or @username",
      validate: required,
    }),
  );
  const name = promptValue(
    await text({
      message: "Optional chat name",
      placeholder: "Leave blank to omit",
    }),
  ).trim();

  const actions = await promptActions();
  const deleteAfter = await promptDeleteAfter();

  return {
    chat_id: parseChatId(chatId),
    ...(name ? { name } : {}),
    delete_after: deleteAfter,
    action_interval: 1,
    actions,
  };
}

export async function runInitWizard(workdir: string): Promise<void> {
  intro("Configure ts-signer");

  try {
    const configPath = workdirPaths(workdir).config;
    if (fs.existsSync(configPath)) {
      const overwrite = promptValue(
        await confirm({
          message: `${configPath} already exists. Overwrite it?`,
          initialValue: false,
        }),
      );
      if (!overwrite) {
        cancel("Existing configuration kept");
        return;
      }
    }

    const inputMode = promptValue(
      await select<TargetInputMode>({
        message: "How would you like to add chats?",
        options: [
          {
            value: "recent",
            label: "Choose multiple from recent Telegram dialogs",
          },
          { value: "batch", label: "Paste multiple chat IDs or @usernames" },
          { value: "manual", label: "Enter chats one at a time" },
        ],
      }),
    );

    let chats: SignChat[];
    if (inputMode === "recent") {
      const dialogs = await loginAndListDialogs(workdir, 50);
      if (dialogs.length === 0) {
        throw new Error("No recent Telegram dialogs were found.");
      }
      const selectedIds = promptValue(
        await multiselect<number>({
          message: "Select target chats (use space to toggle, enter to confirm)",
          options: dialogs.map((dialog) => ({
            value: dialog.id,
            label: `${dialog.type}: ${dialog.name} (${dialog.id})`,
          })),
          required: true,
        }),
      );
      const targets = dialogs
        .filter((dialog) => selectedIds.includes(dialog.id))
        .map((dialog) => ({ id: dialog.id, name: dialog.name }));
      chats = await configureSharedChatSettings(targets);
    } else if (inputMode === "batch") {
      const pastedIds = promptValue(
        await multiline({
          message:
            "Paste chat IDs or @usernames, separated by lines, commas, semicolons, or spaces",
          placeholder: "-1001234567890\n@sign_bot",
          showSubmit: true,
          validate(value) {
            try {
              parseChatTargets(value ?? "");
            } catch (error) {
              return error instanceof Error ? error.message : "Invalid chat list";
            }
          },
        }),
      );
      chats = await configureSharedChatSettings(parseChatTargets(pastedIds));
    } else {
      chats = [];
      do {
        chats.push(await promptChat());
      } while (
        promptValue(
          await confirm({
            message: "Add another chat?",
            initialValue: false,
          }),
        )
      );
    }

    const signAtInput = promptValue(
      await text({
        message: "Sign-in time or cron expression",
        initialValue: "08:00:00",
        validate(value) {
          try {
            parseSignAt(value ?? "");
          } catch (error) {
            return error instanceof Error ? error.message : "Invalid schedule";
          }
        },
      }),
    );
    const randomSecondsInput = promptValue(
      await text({
        message: "Maximum random delay in seconds",
        initialValue: "60",
        validate: nonNegativeInteger,
      }),
    );

    const config: SignerConfig = {
      version: 1,
      sign_at: parseSignAt(signAtInput),
      random_seconds: Number(randomSecondsInput),
      sign_interval: 1,
      chats,
    };
    saveConfig(workdir, config);
    outro(`Configuration saved to ${configPath}`);
  } catch (error) {
    if (error instanceof WizardCancelled) {
      return;
    }
    throw error;
  }
}
