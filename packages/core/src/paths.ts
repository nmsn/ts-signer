import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveWorkdir(explicit?: string): string {
  if (explicit && explicit.trim()) {
    return path.resolve(explicit);
  }
  return path.join(os.homedir(), ".ts-signer");
}

export function normalizeAccountName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    throw new Error(
      "Account names must be 1–32 characters using letters, numbers, hyphens, or underscores.",
    );
  }
  return normalized;
}

export function resolveAccountWorkdir(
  baseWorkdir: string,
  accountName: string,
): string {
  const normalized = normalizeAccountName(accountName);
  if (normalized === "default") {
    return path.resolve(baseWorkdir);
  }
  return path.join(path.resolve(baseWorkdir), "accounts", normalized);
}

export function workdirPaths(workdir: string) {
  return {
    root: workdir,
    config: path.join(workdir, "config.json"),
    state: path.join(workdir, "state.json"),
    history: path.join(workdir, "history.sqlite"),
    sessionDir: path.join(workdir, "session"),
    credentials: path.join(workdir, "credentials.json"),
  };
}

export function ensureWorkdir(workdir: string): void {
  const p = workdirPaths(workdir);
  fs.mkdirSync(p.sessionDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    fs.chmodSync(p.sessionDir, 0o700);
  }
}
