import fs from "node:fs";
import path from "node:path";
import { workdirPaths } from "./paths.js";
import type { SignState } from "./schedule.js";
import { formatLocalDateString } from "./schedule.js";

export interface SignRecordStore {
  load(): SignState;
  markSigned(at: Date): void;
}

const emptyState = (): SignState => ({
  last_signed_date: null,
  last_signed_at: null,
});

export class JsonSignRecordStore implements SignRecordStore {
  private readonly statePath: string;

  constructor(workdir: string) {
    this.statePath = workdirPaths(workdir).state;
  }

  load(): SignState {
    if (!fs.existsSync(this.statePath)) {
      return emptyState();
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as Partial<
        SignState
      >;
      return {
        last_signed_date: raw.last_signed_date ?? null,
        last_signed_at: raw.last_signed_at ?? null,
      };
    } catch {
      return emptyState();
    }
  }

  markSigned(at: Date): void {
    const state: SignState = {
      last_signed_date: formatLocalDateString(at),
      last_signed_at: at.toISOString(),
    };
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}
