export const CORE_VERSION = "0.1.0";

export {
  resolveWorkdir,
  normalizeAccountName,
  resolveAccountWorkdir,
  workdirPaths,
  ensureWorkdir,
} from "./paths.js";
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
  SqliteSignRecordStore,
  type SignRecordStore,
  type SignHistoryStore,
  type SignRunTrigger,
  type SignHistoryRun,
  type SignHistoryChat,
  type SignHistoryReply,
  type SignExecutionStatus,
  type SignReplySenderType,
} from "./store.js";
export { needSign, computeNextRun, type SignState } from "./schedule.js";
export { runScheduler, type SchedulerOptions } from "./scheduler.js";
export { findButtonByText } from "./keyboard.js";
export {
  signOnce,
  type IncomingButton,
  type IncomingMessage,
  type ObservedMessage,
  type IncomingWatch,
  type SignReply,
  type SignActionResult,
  type SignChatResult,
  type SignRunResult,
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
