import type { SignerConfig } from "./config.js";
import { computeNextRun } from "./schedule.js";

export type SchedulerOptions = {
  getNow?: () => Date;
  sleep: (ms: number) => Promise<void>;
  shouldStop: () => boolean;
  tick: () => Promise<void>;
  config: SignerConfig;
};

export async function runScheduler({
  getNow = () => new Date(),
  sleep,
  shouldStop,
  tick,
  config,
}: SchedulerOptions): Promise<void> {
  while (!shouldStop()) {
    await tick();
    if (shouldStop()) {
      return;
    }

    const now = getNow();
    const next = computeNextRun(
      config.sign_at,
      now,
      config.random_seconds,
    );
    await sleep(Math.max(0, next.getTime() - now.getTime()));
  }
}
