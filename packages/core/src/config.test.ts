import { describe, expect, it } from "vitest";
import { parseSignAt, signerConfigSchema } from "./config.js";

describe("parseSignAt", () => {
  it("converts HH:mm:ss to cron", () => {
    expect(parseSignAt("06:00:00")).toBe("0 6 * * *");
  });

  it("accepts crontab passthrough", () => {
    expect(parseSignAt("30 7 * * *")).toBe("30 7 * * *");
  });

  it("rejects invalid", () => {
    expect(() => parseSignAt("not-a-time")).toThrow();
  });
});

describe("signerConfigSchema", () => {
  it("accepts minimal valid config", () => {
    const cfg = signerConfigSchema.parse({
      version: 1,
      sign_at: "0 6 * * *",
      random_seconds: 0,
      sign_interval: 1,
      chats: [
        {
          chat_id: 1,
          actions: [{ type: "send_text", text: "/checkin" }],
        },
      ],
    });
    expect(cfg.chats).toHaveLength(1);
  });

  it("rejects empty chats", () => {
    expect(() =>
      signerConfigSchema.parse({
        version: 1,
        sign_at: "0 6 * * *",
        chats: [],
      }),
    ).toThrow();
  });
});
