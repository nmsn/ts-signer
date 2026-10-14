import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveWorkdir(explicit?: string): string {
  if (explicit && explicit.trim()) {
    return path.resolve(explicit);
  }
  return path.join(os.homedir(), ".ts-signer");
}

export function workdirPaths(workdir: string) {
  return {
    root: workdir,
    config: path.join(workdir, "config.json"),
    state: path.join(workdir, "state.json"),
    sessionDir: path.join(workdir, "session"),
    credentials: path.join(workdir, "credentials.json"),
  };
}

export function ensureWorkdir(workdir: string): void {
  const p = workdirPaths(workdir);
  fs.mkdirSync(p.sessionDir, { recursive: true });
}
