import path from "node:path";
import { TelegramClient } from "@mtcute/node";
import { resolveCredentialsSync } from "./credentials.js";
import { ensureWorkdir, workdirPaths } from "./paths.js";

export function createTelegramClient(workdir: string): TelegramClient {
  const credentials = resolveCredentialsSync(workdir);
  ensureWorkdir(workdir);
  const { sessionDir } = workdirPaths(workdir);

  return new TelegramClient({
    ...credentials,
    storage: path.join(sessionDir, "telegram.session"),
  });
}

export async function loginAndListDialogs(
  workdir: string,
  limit = 20,
): Promise<Array<{ id: number; name: string }>> {
  const client = createTelegramClient(workdir);

  try {
    await client.start();
    const dialogs: Array<{ id: number; name: string }> = [];
    for await (const dialog of client.iterDialogs({ limit })) {
      dialogs.push({
        id: dialog.peer.id,
        name: dialog.peer.displayName,
      });
    }
    return dialogs;
  } finally {
    await client.destroy();
  }
}
