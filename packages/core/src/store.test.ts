import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { workdirPaths } from "./paths.js";
import { JsonSignRecordStore } from "./store.js";

describe("JsonSignRecordStore", () => {
  it("loads empty state when file is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-signer-store-"));
    const store = new JsonSignRecordStore(dir);
    expect(store.load()).toEqual({
      last_signed_date: null,
      last_signed_at: null,
    });
  });

  it("round-trips markSigned via state.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-signer-store-"));
    const store = new JsonSignRecordStore(dir);
    const at = new Date(2026, 9, 14, 6, 3, 12);

    store.markSigned(at);

    const statePath = workdirPaths(dir).state;
    expect(fs.existsSync(statePath)).toBe(true);

    const reloaded = new JsonSignRecordStore(dir);
    expect(reloaded.load()).toEqual({
      last_signed_date: "2026-10-14",
      last_signed_at: at.toISOString(),
    });
  });
});
