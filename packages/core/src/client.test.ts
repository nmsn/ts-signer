import { tl, type Message, type TelegramClient } from "@mtcute/node";
import { describe, expect, it } from "vitest";
import {
  createTelegramBridge,
  withFloodRetry,
} from "./client.js";

function floodWait(seconds = 0): tl.RpcError {
  return tl.RpcError.fromTl({
    errorCode: tl.RpcError.FLOOD,
    errorMessage: `FLOOD_WAIT_${seconds}`,
  });
}

describe("withFloodRetry", () => {
  it("retries FloodWait failures up to three times", async () => {
    let attempts = 0;

    const result = await withFloodRetry(async () => {
      attempts += 1;
      if (attempts <= 3) {
        throw floodWait();
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(4);
  });

  it("does not retry non-FloodWait failures", async () => {
    let attempts = 0;
    const failure = new Error("offline");

    await expect(
      withFloodRetry(async () => {
        attempts += 1;
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(attempts).toBe(1);
  });
});

describe("createTelegramBridge", () => {
  it("does not buffer outgoing messages as incoming bot replies", async () => {
    let listener: ((message: Message) => void) | undefined;
    const client = {
      onNewMessage: {
        add(next: (message: Message) => void) {
          listener = next;
        },
      },
    } as unknown as TelegramClient;
    const bridge = createTelegramBridge(client);

    listener?.({
      id: 12,
      isOutgoing: true,
      chat: { id: 10, username: "signbot" },
      markup: {
        type: "inline",
        buttons: [
          [
            {
              _: "keyboardInlineButton",
              text: "签到",
              type: {
                _: "inlineButtonTypeCallback",
                data: new Uint8Array([1]),
              },
            },
          ],
        ],
      },
    } as Message);

    await expect(bridge.waitForIncoming("@signbot", 0)).resolves.toEqual(
      [],
    );
  });

  it("drains every alias for a chat when messages are consumed", async () => {
    let listener: ((message: Message) => void) | undefined;
    const client = {
      onNewMessage: {
        add(next: (message: Message) => void) {
          listener = next;
        },
      },
    } as unknown as TelegramClient;
    const bridge = createTelegramBridge(client);

    listener?.({
      id: 12,
      isOutgoing: false,
      chat: { id: 10, username: "signbot" },
      markup: {
        type: "inline",
        buttons: [
          [
            {
              _: "keyboardInlineButton",
              text: "签到",
              type: {
                _: "inlineButtonTypeCallback",
                data: new Uint8Array([1]),
              },
            },
          ],
        ],
      },
    } as Message);

    await expect(bridge.waitForIncoming("@signbot", 0)).resolves.toEqual([
      {
        messageId: 12,
        buttons: [{ text: "签到", data: new Uint8Array([1]) }],
      },
    ]);
    await expect(bridge.waitForIncoming(10, 0)).resolves.toEqual([]);
    await expect(bridge.waitForIncoming("signbot", 0)).resolves.toEqual([]);
  });

  it("clears buffered callbacks for every alias before a wait window", async () => {
    let listener: ((message: Message) => void) | undefined;
    const client = {
      onNewMessage: {
        add(next: (message: Message) => void) {
          listener = next;
        },
      },
    } as unknown as TelegramClient;
    const bridge = createTelegramBridge(client);

    listener?.({
      id: 12,
      isOutgoing: false,
      chat: { id: 10, username: "signbot" },
      markup: {
        type: "inline",
        buttons: [
          [
            {
              _: "keyboardInlineButton",
              text: "签到",
              type: {
                _: "inlineButtonTypeCallback",
                data: new Uint8Array([1]),
              },
            },
          ],
        ],
      },
    } as Message);

    bridge.clearIncoming("@signbot");

    await expect(bridge.waitForIncoming("@signbot", 0)).resolves.toEqual(
      [],
    );
    await expect(bridge.waitForIncoming(10, 0)).resolves.toEqual([]);
    await expect(bridge.waitForIncoming("signbot", 0)).resolves.toEqual([]);
  });
});
