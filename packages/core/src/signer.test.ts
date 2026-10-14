import { describe, expect, it, vi } from "vitest";
import type { SignerConfig } from "./config.js";
import type { SignRecordStore } from "./store.js";
import {
  signOnce,
  type IncomingMessage,
  type TelegramBridge,
} from "./signer.js";

class FakeBridge implements TelegramBridge {
  readonly sent: Array<{ chatId: number | string; text: string }> = [];
  readonly deleted: Array<{
    chatId: number | string;
    ids: number[];
  }> = [];
  readonly clicked: Array<{
    chatId: number | string;
    messageId: number;
    data: Uint8Array;
  }> = [];
  incoming: IncomingMessage[] = [];

  async sendText(
    chatId: number | string,
    text: string,
  ): Promise<{ messageId: number }> {
    this.sent.push({ chatId, text });
    return { messageId: 42 };
  }

  async deleteMessages(
    chatId: number | string,
    ids: number[],
  ): Promise<void> {
    this.deleted.push({ chatId, ids });
  }

  async waitForIncoming(
    _chatId: number | string,
    _timeoutMs: number,
  ): Promise<IncomingMessage[]> {
    return this.incoming;
  }

  async clickCallback(
    chatId: number | string,
    messageId: number,
    data: Uint8Array,
  ): Promise<void> {
    this.clicked.push({ chatId, messageId, data });
  }
}

class FakeStore implements SignRecordStore {
  state = {
    last_signed_date: null,
    last_signed_at: null,
  };
  readonly marked: Date[] = [];

  load() {
    return this.state;
  }

  markSigned(at: Date): void {
    this.marked.push(at);
  }
}

function config(
  actions: SignerConfig["chats"][number]["actions"],
): SignerConfig {
  return {
    version: 1,
    sign_at: "0 6 * * *",
    random_seconds: 0,
    sign_interval: 0,
    chats: [
      {
        chat_id: "@signbot",
        delete_after: null,
        action_interval: 0,
        actions,
      },
    ],
  };
}

describe("signOnce", () => {
  it("sends configured text and marks the round signed", async () => {
    const bridge = new FakeBridge();
    const store = new FakeStore();
    const now = new Date("2026-10-14T06:03:12.000Z");

    await signOnce({
      config: config([{ type: "send_text", text: "/sign" }]),
      bridge,
      store,
      now,
    });

    expect(bridge.sent).toEqual([{ chatId: "@signbot", text: "/sign" }]);
    expect(store.marked).toEqual([now]);
  });

  it("finds a matching callback button and clicks it", async () => {
    const bridge = new FakeBridge();
    const store = new FakeStore();
    const callbackData = new Uint8Array([1, 2, 3]);
    bridge.incoming = [
      {
        messageId: 77,
        buttons: [
          { text: "Help", data: new Uint8Array([0]) },
          { text: "每日签到", data: callbackData },
        ],
      },
    ];

    await signOnce({
      config: config([
        { type: "click_keyboard_by_text", text: "签到" },
      ]),
      bridge,
      store,
      clickTimeoutMs: 25,
    });

    expect(bridge.clicked).toEqual([
      {
        chatId: "@signbot",
        messageId: 77,
        data: callbackData,
      },
    ]);
  });

  it("warns on click timeout and still completes the round", async () => {
    const bridge = new FakeBridge();
    const store = new FakeStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await signOnce({
      config: config([
        { type: "click_keyboard_by_text", text: "missing" },
      ]),
      bridge,
      store,
      clickTimeoutMs: 1,
    });

    expect(bridge.clicked).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(store.marked).toHaveLength(1);
    warn.mockRestore();
  });

  it("returns without actions or marking when the round is not due", async () => {
    const bridge = new FakeBridge();
    const store = new FakeStore();
    const now = new Date(2026, 9, 14, 10, 0, 0);
    store.state = {
      last_signed_date: "2026-10-14",
      last_signed_at: new Date(2026, 9, 14, 6, 3, 0).toISOString(),
    };

    await signOnce({
      config: config([{ type: "send_text", text: "/sign" }]),
      bridge,
      store,
      now,
    });

    expect(bridge.sent).toEqual([]);
    expect(store.marked).toEqual([]);
  });
});
