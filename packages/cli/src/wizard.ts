import fs from "node:fs";
import {
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
  outro,
  select,
  text,
} from "@clack/prompts";

class WizardCancelled extends Error {}

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

function optionalNonNegativeNumber(
  value: string | undefined,
): string | undefined {
  if (!value?.trim()) {
    return;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "Enter a non-negative number or leave blank";
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

async function promptAction(type: SignAction["type"]): Promise<SignAction> {
  const actionText = promptValue(
    await text({
      message:
        type === "send_text"
          ? "Text to send"
          : "Inline keyboard text to click",
      validate: required,
    }),
  );
  return { type, text: actionText.trim() };
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

  const deleteAfterInput = promptValue(
    await text({
      message: "Delete sent messages after how many seconds?",
      placeholder: "Leave blank to keep messages",
      validate: optionalNonNegativeNumber,
    }),
  ).trim();

  return {
    chat_id: parseChatId(chatId),
    ...(name ? { name } : {}),
    delete_after: deleteAfterInput ? Number(deleteAfterInput) : null,
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

    const chats: SignChat[] = [];
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

    const signAtInput = promptValue(
      await text({
        message: "Sign-in time or cron expression",
        placeholder: "06:00:00",
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
        initialValue: "0",
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
