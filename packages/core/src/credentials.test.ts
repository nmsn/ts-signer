import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCredentials,
  resolveCredentials,
  saveCredentials,
} from "./credentials.js";

const workdirs: string[] = [];

function makeWorkdir(): string {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-signer-"));
  workdirs.push(workdir);
  return workdir;
}

afterEach(() => {
  for (const workdir of workdirs.splice(0)) {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

describe("credentials", () => {
  it("returns null when credentials have not been saved", () => {
    expect(loadCredentials(makeWorkdir())).toBeNull();
  });

  it("saves and loads credentials", () => {
    const workdir = makeWorkdir();
    const credentials = { apiId: 12345, apiHash: "secret-hash" };

    saveCredentials(workdir, credentials);

    expect(loadCredentials(workdir)).toEqual(credentials);
    expect(
      fs.readFileSync(path.join(workdir, "credentials.json"), "utf8"),
    ).toBe(`${JSON.stringify(credentials, null, 2)}\n`);
  });

  it("resolveCredentials prefers environment variables over the credentials file", async () => {
    const workdir = makeWorkdir();
    saveCredentials(workdir, { apiId: 11111, apiHash: "file-hash" });

    const prevApiId = process.env.TG_API_ID;
    const prevApiHash = process.env.TG_API_HASH;
    process.env.TG_API_ID = "22222";
    process.env.TG_API_HASH = "env-hash";

    try {
      await expect(resolveCredentials(workdir)).resolves.toEqual({
        apiId: 22222,
        apiHash: "env-hash",
      });
    } finally {
      if (prevApiId === undefined) {
        delete process.env.TG_API_ID;
      } else {
        process.env.TG_API_ID = prevApiId;
      }
      if (prevApiHash === undefined) {
        delete process.env.TG_API_HASH;
      } else {
        process.env.TG_API_HASH = prevApiHash;
      }
    }
  });
});
