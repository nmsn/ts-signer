import path from "node:path";
import { TelegramClient, tl, type Message } from "@mtcute/node";
import { resolveCredentialsSync } from "./credentials.js";
import { ensureWorkdir, workdirPaths } from "./paths.js";
import type {
  IncomingMessage,
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

function toIncomingMessage(message: Message): IncomingMessage {
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
  return { messageId: message.id, buttons };
}

export function createTelegramBridge(client: TelegramClient): TelegramBridge {
  const buffers = new Map<string, IncomingMessage[]>();
  const waiters = new Map<string, () => void>();

  client.onNewMessage.add((message) => {
    if (message.isOutgoing) {
      return;
    }
    const incoming = toIncomingMessage(message);
    if (incoming.buttons.length === 0) {
      return;
    }
    for (const key of chatKeys(message)) {
      const messages = buffers.get(key) ?? [];
      messages.push(incoming);
      buffers.set(key, messages);
      waiters.get(key)?.();
    }
  });

  const drain = (key: string): IncomingMessage[] => {
    const messages = buffers.get(key) ?? [];
    buffers.delete(key);
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
): Promise<Array<{ id: number; name: string }>> {
  const client = createTelegramClient(workdir);

  try {
    await client.start();
    const dialogs: Array<{ id: number; name: string }> = [];
    for await (const dialog of client.iterDialogs({ limit })) {
      dialogs.push({
        id: dialog.peer.id,
        name: dialog.peer.displayName,
      });
    }
    return dialogs;
  } finally {
    await client.destroy();
  }
}
