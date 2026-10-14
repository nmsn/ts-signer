import type { SignerConfig } from "./config.js";
import { findButtonByText } from "./keyboard.js";
import { needSign } from "./schedule.js";
import type { SignRecordStore } from "./store.js";

type ChatId = number | string;

export type IncomingButton = {
  text: string;
  data: Uint8Array;
};

export type IncomingMessage = {
  messageId: number;
  buttons: IncomingButton[];
};

export interface TelegramBridge {
  sendText(chatId: ChatId, text: string): Promise<{ messageId: number }>;
  deleteMessages(chatId: ChatId, ids: number[]): Promise<void>;
  clearIncoming(chatId: ChatId): void;
  waitForIncoming(
    chatId: ChatId,
    timeoutMs: number,
  ): Promise<IncomingMessage[]>;
  clickCallback(
    chatId: ChatId,
    messageId: number,
    data: Uint8Array,
  ): Promise<void>;
}

type SignOnceOptions = {
  config: SignerConfig;
  bridge: TelegramBridge;
  store: SignRecordStore;
  force?: boolean;
  now?: Date;
  clickTimeoutMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function signOnce({
  config,
  bridge,
  store,
  force = false,
  now = new Date(),
  clickTimeoutMs = 10_000,
}: SignOnceOptions): Promise<void> {
  if (!needSign(store.load(), config.sign_at, now, force)) {
    return;
  }

  for (const [chatIndex, chat] of config.chats.entries()) {
    try {
      for (const [actionIndex, action] of chat.actions.entries()) {
        try {
          if (action.type === "send_text") {
            const sent = await bridge.sendText(chat.chat_id, action.text);
            if (chat.delete_after !== null) {
              await sleep(chat.delete_after * 1_000);
              await bridge.deleteMessages(chat.chat_id, [sent.messageId]);
            }
          } else {
            bridge.clearIncoming(chat.chat_id);
            const deadline = Date.now() + clickTimeoutMs;
            let match:
              | {
                  message: IncomingMessage;
                  button: IncomingButton;
                }
              | undefined;

            do {
              const messages = await bridge.waitForIncoming(
                chat.chat_id,
                Math.max(0, deadline - Date.now()),
              );
              match = messages
                .map((message) => ({
                  message,
                  button: findButtonByText(message.buttons, action.text),
                }))
                .find(
                  (
                    candidate,
                  ): candidate is {
                    message: IncomingMessage;
                    button: IncomingButton;
                  } => candidate.button !== undefined,
                );
            } while (!match && Date.now() < deadline);

            if (match) {
              await bridge.clickCallback(
                chat.chat_id,
                match.message.messageId,
                match.button.data,
              );
            } else {
              console.warn(
                `No callback button containing "${action.text}" found in ${String(chat.chat_id)}`,
              );
            }
          }
        } catch (error) {
          console.error(
            `Failed action ${actionIndex + 1} in chat ${String(chat.chat_id)}:`,
            error,
          );
        }

        if (actionIndex < chat.actions.length - 1) {
          await sleep(chat.action_interval * 1_000);
        }
      }
    } catch (error) {
      console.error(`Failed to sign chat ${String(chat.chat_id)}:`, error);
    }

    if (chatIndex < config.chats.length - 1) {
      await sleep(config.sign_interval * 1_000);
    }
  }

  store.markSigned(now);
}
