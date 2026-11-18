import path from "node:path";
import {
  TelegramClient,
  tl,
  type ChatType,
  type Message,
} from "@mtcute/node";
import { resolveCredentialsSync } from "./credentials.js";
import { ensureWorkdir, workdirPaths } from "./paths.js";
import type {
  IncomingMessage,
  ObservedMessage,
  TelegramBridge,
} from "./signer.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withFloodRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (
        !tl.RpcError.is(error, "FLOOD_WAIT_%d") ||
        retries >= maxRetries
      ) {
        throw error;
      }
      retries += 1;
      await sleep(error.seconds * 1_000);
    }
  }
}

export function createTelegramClient(workdir: string): TelegramClient {
  const credentials = resolveCredentialsSync(workdir);
  ensureWorkdir(workdir);
  const { sessionDir } = workdirPaths(workdir);

  return new TelegramClient({
    ...credentials,
    storage: path.join(sessionDir, "telegram.session"),
  });
}

function chatKeys(message: Message): string[] {
  const keys = [String(message.chat.id)];
  if (message.chat.username) {
    keys.push(`@${message.chat.username.toLowerCase()}`);
    keys.push(message.chat.username.toLowerCase());
  }
  return keys;
}

function normalizeChatKey(chatId: number | string): string {
  return typeof chatId === "string" ? chatId.toLowerCase() : String(chatId);
}

function toIncomingMessage(message: Message): ObservedMessage {
  const sender = message.sender;
  let senderType: ObservedMessage["senderType"];
  if (sender?.type === "user") {
    senderType = sender.isBot ? "bot" : "human";
  } else if (sender?.type === "chat" && sender.chatType === "channel") {
    senderType = "channel";
  } else if (sender && sender.id === message.chat.id) {
    senderType = "anonymous";
  } else {
    senderType = "unknown";
  }

  const buttons =
    message.markup?.type === "inline"
      ? message.markup.buttons
          .flat()
          .flatMap((button) =>
            button.type._ === "inlineButtonTypeCallback"
              ? [{ text: button.text, data: button.type.data }]
              : [],
          )
      : [];
  return {
    messageId: message.id,
    chatId: message.chat.id,
    date: message.date ?? new Date(),
    text: message.text ?? "",
    senderId: sender?.id ?? null,
    senderName: sender?.displayName ?? "Unknown sender",
    senderType,
    replyToMessageId: message.replyToMessage?.id ?? null,
    buttons,
  };
}

type MessageWatcher = {
  messages: ObservedMessage[];
  resolve(messages: ObservedMessage[]): void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
};

export function createTelegramBridge(client: TelegramClient): TelegramBridge {
  const buffers = new Map<string, IncomingMessage[]>();
  const waiters = new Map<string, () => void>();
  const watchers = new Map<string, Set<MessageWatcher>>();

  client.onNewMessage.add((message) => {
    if (message.isOutgoing || message.isService) {
      return;
    }
    const incoming = toIncomingMessage(message);
    const keys = chatKeys(message);

    const activeWatchers = new Set(
      keys.flatMap((key) => [...(watchers.get(key) ?? [])]),
    );
    for (const watcher of activeWatchers) {
      watcher.messages.push(incoming);
    }

    if (incoming.buttons.length === 0) {
      return;
    }

    const callbackMessage: IncomingMessage = {
      messageId: incoming.messageId,
      buttons: incoming.buttons,
    };
    const messages =
      keys.map((key) => buffers.get(key)).find((buffer) => buffer !== undefined) ??
      [];
    messages.push(callbackMessage);
    for (const key of keys) {
      buffers.set(key, messages);
      waiters.get(key)?.();
    }
  });

  const drain = (key: string): IncomingMessage[] => {
    const messages = buffers.get(key) ?? [];
    for (const [alias, buffer] of buffers) {
      if (buffer === messages) {
        buffers.delete(alias);
      }
    }
    return messages;
  };

  return {
    async sendText(chatId, text) {
      const message = await withFloodRetry(() =>
        client.sendText(chatId, text),
      );
      return { messageId: message.id };
    },
    deleteMessages(chatId, ids) {
      return withFloodRetry(() => client.deleteMessagesById(chatId, ids));
    },
    clearIncoming(chatId) {
      drain(normalizeChatKey(chatId));
    },
    watchIncoming(chatId, timeoutMs) {
      const key = normalizeChatKey(chatId);
      let watcher!: MessageWatcher;
      let finish!: () => void;
      const result = new Promise<ObservedMessage[]>((resolve) => {
        watcher = {
          messages: [],
          resolve,
          timer: setTimeout(() => finish(), timeoutMs),
          settled: false,
        };
      });

      const removeWatcher = () => {
        const watchersForChat = watchers.get(key);
        watchersForChat?.delete(watcher);
        if (watchersForChat?.size === 0) {
          watchers.delete(key);
        }
      };
      finish = () => {
        if (watcher.settled) {
          return;
        }
        watcher.settled = true;
        clearTimeout(watcher.timer);
        removeWatcher();
        watcher.resolve(watcher.messages);
      };

      const watchersForChat = watchers.get(key) ?? new Set<MessageWatcher>();
      watchersForChat.add(watcher);
      watchers.set(key, watchersForChat);
      return { result, cancel: finish };
    },
    async waitForIncoming(chatId, timeoutMs) {
      const key = normalizeChatKey(chatId);
      const buffered = drain(key);
      if (buffered.length > 0) {
        return buffered;
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(key);
          resolve();
        }, timeoutMs);
        waiters.set(key, () => {
          clearTimeout(timer);
          waiters.delete(key);
          resolve();
        });
      });
      return drain(key);
    },
    async clickCallback(chatId, messageId, data) {
      await withFloodRetry(() =>
        client.getCallbackAnswer({
          chatId,
          message: messageId,
          data,
        }),
      );
    },
  };
}

export async function loginAndListDialogs(
  workdir: string,
  limit = 20,
): Promise<
  Array<{ id: number; name: string; type: "user" | "bot" | ChatType }>
> {
  const client = createTelegramClient(workdir);

  try {
    await client.start();
    const dialogs: Array<{
      id: number;
      name: string;
      type: "user" | "bot" | ChatType;
    }> = [];
    for await (const dialog of client.iterDialogs({ limit })) {
      const peer = dialog.peer;
      dialogs.push({
        id: peer.id,
        name: peer.displayName,
        type:
          peer.type === "user"
            ? peer.isBot
              ? "bot"
              : "user"
            : peer.chatType,
      });
    }
    return dialogs;
  } finally {
    await client.destroy();
  }
}
