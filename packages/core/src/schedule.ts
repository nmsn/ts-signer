import { Cron } from "croner";

export type SignState = {
  last_signed_date: string | null;
  last_signed_at: string | null;
};

export function formatLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextCronAfter(signAtCron: string, from: Date): Date {
  const cron = new Cron(signAtCron);
  const next = cron.nextRun(from);
  if (!next) {
    throw new Error(`No next run for cron: ${signAtCron}`);
  }
  return next;
}

export function needSign(
  state: SignState,
  signAtCron: string,
  now: Date,
  force: boolean,
): boolean {
  if (force) {
    return true;
  }
  if (state.last_signed_date === null) {
    return true;
  }
  const today = formatLocalDateString(now);
  if (state.last_signed_date !== today) {
    return true;
  }
  if (state.last_signed_at === null) {
    return true;
  }
  const lastAt = new Date(state.last_signed_at);
  const next = nextCronAfter(signAtCron, lastAt);
  return next.getTime() <= now.getTime();
}

export function computeNextRun(
  signAtCron: string,
  now: Date,
  randomSeconds: number,
  rng: () => number = Math.random,
): Date {
  const next = nextCronAfter(signAtCron, now);
  const jitter = Math.floor(rng() * (randomSeconds + 1));
  return new Date(next.getTime() + jitter * 1000);
}
