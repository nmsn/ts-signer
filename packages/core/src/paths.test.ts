import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkdir, workdirPaths } from "./paths.js";

describe("resolveWorkdir", () => {
  it("uses explicit path when provided", () => {
    expect(resolveWorkdir("/tmp/foo")).toBe(path.resolve("/tmp/foo"));
  });

  it("defaults to ~/.ts-signer", () => {
    expect(resolveWorkdir()).toBe(path.join(os.homedir(), ".ts-signer"));
  });
});

describe("workdirPaths", () => {
  it("maps standard filenames", () => {
    const p = workdirPaths("/tmp/wd");
    expect(p.config).toBe(path.join("/tmp/wd", "config.json"));
    expect(p.state).toBe(path.join("/tmp/wd", "state.json"));
    expect(p.sessionDir).toBe(path.join("/tmp/wd", "session"));
    expect(p.credentials).toBe(path.join("/tmp/wd", "credentials.json"));
  });
});
