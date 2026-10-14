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
export { runScheduler, type SchedulerOptions } from "./scheduler.js";
export { findButtonByText } from "./keyboard.js";
export {
  signOnce,
  type IncomingButton,
  type IncomingMessage,
  type TelegramBridge,
} from "./signer.js";
export {
  loadCredentials,
  saveCredentials,
  resolveCredentials,
  type TelegramCredentials,
} from "./credentials.js";
export {
  createTelegramBridge,
  createTelegramClient,
  loginAndListDialogs,
  withFloodRetry,
} from "./client.js";
