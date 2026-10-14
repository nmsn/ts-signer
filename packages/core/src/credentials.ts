import fs from "node:fs";
import { z } from "zod";
import { workdirPaths } from "./paths.js";

const credentialsSchema = z.object({
  apiId: z.number().int().positive(),
  apiHash: z.string().min(1),
});

export type TelegramCredentials = z.infer<typeof credentialsSchema>;

export function loadCredentials(workdir: string): TelegramCredentials | null {
  const { credentials } = workdirPaths(workdir);
  if (!fs.existsSync(credentials)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(credentials, "utf8")) as unknown;
  return credentialsSchema.parse(raw);
}

export function saveCredentials(
  workdir: string,
  credentials: TelegramCredentials,
): void {
  const parsed = credentialsSchema.parse(credentials);
  const paths = workdirPaths(workdir);
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(
    paths.credentials,
    `${JSON.stringify(parsed, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function resolveCredentialsSync(workdir: string): TelegramCredentials {
  const apiId = process.env.TG_API_ID ?? process.env.API_ID;
  const apiHash = process.env.TG_API_HASH ?? process.env.API_HASH;

  if (apiId !== undefined || apiHash !== undefined) {
    const parsed = credentialsSchema.safeParse({
      apiId: Number(apiId),
      apiHash,
    });
    if (parsed.success) {
      return parsed.data;
    }
    throw new Error(
      "Invalid Telegram API credentials in TG_API_ID/TG_API_HASH or API_ID/API_HASH",
    );
  }

  const credentials = loadCredentials(workdir);
  if (credentials) {
    return credentials;
  }

  throw new Error(
    "Telegram API credentials not found. Set TG_API_ID/TG_API_HASH (or API_ID/API_HASH), or run the login wizard.",
  );
}

export async function resolveCredentials(
  workdir: string,
): Promise<TelegramCredentials> {
  return resolveCredentialsSync(workdir);
}

export { resolveCredentialsSync };
