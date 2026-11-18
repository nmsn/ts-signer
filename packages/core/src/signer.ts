import type { SignAction, SignerConfig } from "./config.js";
import { findButtonByText } from "./keyboard.js";
import { needSign } from "./schedule.js";
import type { SignHistoryStore, SignRecordStore } from "./store.js";

type ChatId = number | string;

export type IncomingButton = {
  text: string;
  data: Uint8Array;
};

export type IncomingMessage = {
  messageId: number;
  buttons: IncomingButton[];
};

export type ObservedMessage = IncomingMessage & {
  chatId: number;
  date: Date;
  text: string;
  senderId: number | null;
  senderName: string;
  senderType: "bot" | "human" | "channel" | "anonymous" | "unknown";
  replyToMessageId: number | null;
};

export type SignReply = {
  sentMessageId: number;
  messageId: number;
  receivedAt: Date;
  senderId: number | null;
  senderName: string;
  senderType: ObservedMessage["senderType"];
  replyToMessageId: number | null;
  relation: "direct_reply" | "time_window";
  text: string;
};

export type IncomingWatch = {
  result: Promise<ObservedMessage[]>;
  cancel(): void;
};

export type SignActionResult = {
  action: SignAction;
  success: boolean;
  error?: string;
};

export type SignChatResult = {
  chatId: ChatId;
  chatName?: string;
  position: number;
  success: boolean;
  actions: SignActionResult[];
  replies: SignReply[];
};

export type SignRunResult = {
  skipped: boolean;
  success: boolean;
  chats: SignChatResult[];
};

export interface TelegramBridge {
  sendText(chatId: ChatId, text: string): Promise<{ messageId: number }>;
  deleteMessages(chatId: ChatId, ids: number[]): Promise<void>;
  clearIncoming(chatId: ChatId): void;
  watchIncoming?(chatId: ChatId, timeoutMs: number): IncomingWatch;
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
  trigger?: "scheduled" | "manual";
  now?: Date;
  clickTimeoutMs?: number;
  replyTimeoutMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function supportsHistory(store: SignRecordStore): store is SignHistoryStore {
  const candidate = store as Partial<SignHistoryStore>;
  return (
    typeof candidate.beginRun === "function" &&
    typeof candidate.recordChat === "function" &&
    typeof candidate.finishRun === "function" &&
    typeof candidate.listRuns === "function"
  );
}

export async function signOnce({
  config,
  bridge,
  store,
  force = false,
  trigger = "scheduled",
  now = new Date(),
  clickTimeoutMs = 10_000,
  replyTimeoutMs = 10_000,
}: SignOnceOptions): Promise<SignRunResult> {
  if (!needSign(store.load(), config.sign_at, now, force)) {
    return { skipped: true, success: true, chats: [] };
  }

  const historyStore = supportsHistory(store) ? store : undefined;
  const runId = historyStore?.beginRun(now, trigger);
  const chatResults: SignChatResult[] = [];
  for (const [chatIndex, chat] of config.chats.entries()) {
    const chatStartedAt = new Date();
    const replies: SignReply[] = [];
    const actionResults: SignActionResult[] = [];
    bridge.clearIncoming(chat.chat_id);
    for (const [actionIndex, action] of chat.actions.entries()) {
      try {
        if (action.type === "send_text") {
          const watch = bridge.watchIncoming?.(chat.chat_id, replyTimeoutMs);
          let sent: { messageId: number };
          try {
            sent = await bridge.sendText(chat.chat_id, action.text);
          } catch (error) {
            watch?.cancel();
            throw error;
          }

          let deleteError: unknown;
          if (chat.delete_after !== null) {
            try {
              await sleep(chat.delete_after * 1_000);
              await bridge.deleteMessages(chat.chat_id, [sent.messageId]);
            } catch (error) {
              deleteError = error;
            }
          }

          const incoming = watch ? await watch.result : [];
          replies.push(
            ...incoming.map((message) => ({
              sentMessageId: sent.messageId,
              messageId: message.messageId,
              receivedAt: message.date,
              senderId: message.senderId,
              senderName: message.senderName,
              senderType: message.senderType,
              replyToMessageId: message.replyToMessageId,
              relation:
                message.replyToMessageId === sent.messageId
                  ? ("direct_reply" as const)
                  : ("time_window" as const),
              text: message.text.slice(0, 2_000),
            })),
          );
          if (deleteError !== undefined) {
            throw deleteError;
          }
        } else {
          const deadline = Date.now() + clickTimeoutMs;
          let match:
            | {
                message: IncomingMessage;
                button: IncomingMessage["buttons"][number];
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
                  button: IncomingMessage["buttons"][number];
                } => candidate.button !== undefined,
              );
          } while (!match && Date.now() < deadline);

          if (!match) {
            throw new Error(
              `No callback button containing "${action.text}" found`,
            );
          }
          await bridge.clickCallback(
            chat.chat_id,
            match.message.messageId,
            match.button.data,
          );
        }

        actionResults.push({ action, success: true });
      } catch (error) {
        actionResults.push({
          action,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (actionIndex < chat.actions.length - 1) {
        await sleep(chat.action_interval * 1_000);
      }
    }

    const chatResult: SignChatResult = {
      chatId: chat.chat_id,
      ...(chat.name ? { chatName: chat.name } : {}),
      position: chatIndex,
      success: actionResults.every((result) => result.success),
      actions: actionResults,
      replies,
    };
    chatResults.push(chatResult);
    historyStore?.recordChat(runId!, chatResult, chatStartedAt, new Date());

    if (chatIndex < config.chats.length - 1) {
      await sleep(config.sign_interval * 1_000);
    }
  }

  const success = chatResults.every((result) => result.success);
  const result = { skipped: false, success, chats: chatResults };
  if (historyStore) {
    historyStore.finishRun(runId!, result, new Date());
  } else if (success) {
    store.markSigned(now);
  }
  return result;
}
