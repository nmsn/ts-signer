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
