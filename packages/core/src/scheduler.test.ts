import { describe, expect, it, vi } from "vitest";
import type { SignerConfig } from "./config.js";
import { runScheduler } from "./scheduler.js";

const config: SignerConfig = {
  version: 1,
  sign_at: "0 6 * * *",
  random_seconds: 0,
  sign_interval: 1,
  chats: [
    {
      chat_id: 1,
      delete_after: null,
      action_interval: 1,
      actions: [{ type: "send_text", text: "/sign" }],
    },
  ],
};

describe("runScheduler", () => {
  it("ticks immediately, then sleeps until the next run and stops", async () => {
    const now = new Date(2026, 9, 14, 5, 0, 0);
    let stopped = false;
    const tick = vi.fn(async () => undefined);
    const sleep = vi.fn(async () => {
      stopped = true;
    });

    await runScheduler({
      config,
      getNow: () => now,
      shouldStop: () => stopped,
      sleep,
      tick,
    });

    expect(tick).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(60 * 60 * 1000);
    expect(tick.mock.invocationCallOrder[0]).toBeLessThan(
      sleep.mock.invocationCallOrder[0],
    );
  });
});
