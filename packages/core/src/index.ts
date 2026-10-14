export const CORE_VERSION = "0.1.0";

export { resolveWorkdir, workdirPaths, ensureWorkdir } from "./paths.js";
export {
  signerConfigSchema,
  parseSignAt,
  loadConfig,
  saveConfig,
  type SignerConfig,
  type SignChat,
  type SignAction,
} from "./config.js";
export {
  JsonSignRecordStore,
  type SignRecordStore,
} from "./store.js";
export { needSign, computeNextRun, type SignState } from "./schedule.js";
export { findButtonByText } from "./keyboard.js";
export {
  loadCredentials,
  saveCredentials,
  resolveCredentials,
  type TelegramCredentials,
} from "./credentials.js";
export { createTelegramClient, loginAndListDialogs } from "./client.js";
