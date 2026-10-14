import fs from "node:fs";
import { Cron } from "croner";
import { z } from "zod";
import { workdirPaths } from "./paths.js";

const timePattern = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

export function parseSignAt(input: string): string {
  const trimmed = input.replace(/：/g, ":").trim();
  const timeMatch = timePattern.exec(trimmed);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const second = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0;
    if (
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      Number.isNaN(second)
    ) {
      throw new Error(`Invalid time: ${input}`);
    }
    if (second !== 0) {
      return `${second} ${minute} ${hour} * * *`;
    }
    return `${minute} ${hour} * * *`;
  }

  try {
    new Cron(trimmed, { paused: true });
  } catch {
    throw new Error(`Invalid sign_at: ${input}`);
  }
  return trimmed;
}

const signActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_text"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("click_keyboard_by_text"),
    text: z.string().min(1),
  }),
]);

const signChatSchema = z.object({
  chat_id: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  delete_after: z.number().nullable().default(null),
  action_interval: z.number().nonnegative().default(1),
  actions: z.array(signActionSchema).min(1),
});

export const signerConfigSchema = z.object({
  version: z.literal(1),
  sign_at: z.string().transform((value) => parseSignAt(value)),
  random_seconds: z.number().nonnegative().default(0),
  sign_interval: z.number().nonnegative().default(1),
  chats: z.array(signChatSchema).min(1),
});

export type SignAction = z.infer<typeof signActionSchema>;
export type SignChat = z.infer<typeof signChatSchema>;
export type SignerConfig = z.infer<typeof signerConfigSchema>;

export function loadConfig(workdir: string): SignerConfig {
  const { config } = workdirPaths(workdir);
  const raw = JSON.parse(fs.readFileSync(config, "utf8")) as unknown;
  return signerConfigSchema.parse(raw);
}

export function saveConfig(workdir: string, config: SignerConfig): void {
  const parsed = signerConfigSchema.parse(config);
  const { config: configPath, root } = workdirPaths(workdir);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}
