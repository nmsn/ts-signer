import { describe, expect, it } from "vitest";
import { computeNextRun, needSign, type SignState } from "./schedule.js";

function localDateParts(d: Date): { y: number; m: number; day: number } {
  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
}

describe("needSign", () => {
  const dailyCron = "0 6 * * *";

  it("returns true when force is set", () => {
    const state: SignState = {
      last_signed_date: "2026-10-14",
      last_signed_at: "2026-10-14T06:03:00.000Z",
    };
    const now = new Date(2026, 9, 14, 10, 0, 0);
    expect(needSign(state, dailyCron, now, true)).toBe(true);
  });

  it("returns true when never signed", () => {
    const state: SignState = {
      last_signed_date: null,
      last_signed_at: null,
    };
    expect(needSign(state, dailyCron, new Date(), false)).toBe(true);
  });

  it("returns true when last sign was on another calendar day", () => {
    const state: SignState = {
      last_signed_date: "2026-10-13",
      last_signed_at: "2026-10-13T06:00:00.000Z",
    };
    const now = new Date(2026, 9, 14, 7, 0, 0);
    expect(needSign(state, dailyCron, now, false)).toBe(true);
  });

  it("returns false when signed today and next cron is still in the future", () => {
    const now = new Date(2026, 9, 14, 10, 0, 0);
    const signedAt = new Date(2026, 9, 14, 6, 3, 0);
    const state: SignState = {
      last_signed_date: "2026-10-14",
      last_signed_at: signedAt.toISOString(),
    };
    expect(needSign(state, dailyCron, now, false)).toBe(false);
  });

  it("returns true when signed today but next cron fire has passed", () => {
    const hourlyCron = "0 * * * *";
    const signedAt = new Date(2026, 9, 14, 10, 5, 0);
    const now = new Date(2026, 9, 14, 11, 30, 0);
    const state: SignState = {
      last_signed_date: "2026-10-14",
      last_signed_at: signedAt.toISOString(),
    };
    expect(needSign(state, hourlyCron, now, false)).toBe(true);
  });
});

describe("computeNextRun", () => {
  it("adds random jitter seconds after the next cron tick", () => {
    const now = new Date(2026, 9, 14, 5, 0, 0);
    const next = computeNextRun("0 6 * * *", now, 120, () => 0.5);
    expect(next.getTime()).toBe(new Date(2026, 9, 14, 6, 1, 0).getTime());
  });

  it("uses zero jitter when randomSeconds is 0", () => {
    const now = new Date(2026, 9, 14, 5, 0, 0);
    const next = computeNextRun("0 6 * * *", now, 0, () => 0.99);
    expect(localDateParts(next)).toEqual(localDateParts(new Date(2026, 9, 14, 6, 0, 0)));
    expect(next.getMinutes()).toBe(0);
  });
});
