import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  confirm,
  intro,
  outro,
  select,
  text,
} from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInitWizard } from "./wizard.js";

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  outro: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

const workdirs: string[] = [];

function makeWorkdir(): string {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-signer-wizard-"));
  workdirs.push(workdir);
  return workdir;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const workdir of workdirs.splice(0)) {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

describe("runInitWizard", () => {
  it("writes a config whose first action is send_text", async () => {
    const workdir = makeWorkdir();
    vi.mocked(text)
      .mockResolvedValueOnce("@daily_bot")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("/checkin")
      .mockResolvedValueOnce("签到")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("06:00:00")
      .mockResolvedValueOnce("30");
    vi.mocked(confirm)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(select).mockResolvedValueOnce("click_keyboard_by_text");

    await runInitWizard(workdir);

    const config = JSON.parse(
      fs.readFileSync(path.join(workdir, "config.json"), "utf8"),
    );
    expect(config).toEqual({
      version: 1,
      sign_at: "0 6 * * *",
      random_seconds: 30,
      sign_interval: 1,
      chats: [
        {
          chat_id: "@daily_bot",
          delete_after: null,
          action_interval: 1,
          actions: [
            { type: "send_text", text: "/checkin" },
            { type: "click_keyboard_by_text", text: "签到" },
          ],
        },
      ],
    });
    expect(intro).toHaveBeenCalledOnce();
    expect(outro).toHaveBeenCalledOnce();
  });

  it("leaves an existing config unchanged when overwrite is declined", async () => {
    const workdir = makeWorkdir();
    const configPath = path.join(workdir, "config.json");
    fs.writeFileSync(configPath, '{"existing":true}\n', "utf8");
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runInitWizard(workdir);

    expect(fs.readFileSync(configPath, "utf8")).toBe('{"existing":true}\n');
    expect(text).not.toHaveBeenCalled();
  });
});
