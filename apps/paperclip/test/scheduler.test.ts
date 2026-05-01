import { describe, expect, it } from "vitest";

import { briefingHourReached, CronParseError, firedInWindow, parseCron } from "../src/scheduler.js";

describe("parseCron", () => {
  it("parses an every-minute-of-an-hour expression", () => {
    expect(parseCron("0 9 * * 1")).toEqual({ minute: 0, hour: 9, dow: 1 });
  });

  it("treats * as a wildcard", () => {
    expect(parseCron("0 * * * *")).toEqual({ minute: 0, hour: "*", dow: "*" });
  });

  it("rejects too few fields", () => {
    expect(() => parseCron("0 9 *")).toThrow(CronParseError);
  });

  it("rejects ranges", () => {
    expect(() => parseCron("0-5 9 * * 1")).toThrow(CronParseError);
  });

  it("rejects day-of-month constraints", () => {
    expect(() => parseCron("0 9 15 * *")).toThrow(CronParseError);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseCron("0 25 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 9 * * 7")).toThrow(CronParseError);
  });
});

describe("firedInWindow", () => {
  it("fires when the cron's minute boundary falls inside the window", () => {
    const cron = parseCron("30 9 * * *");
    const lastTick = new Date("2026-04-29T09:29:30Z");
    const now = new Date("2026-04-29T09:30:30Z");
    expect(firedInWindow(cron, lastTick, now)).toBe(true);
  });

  it("does not fire outside the window", () => {
    const cron = parseCron("30 9 * * *");
    const lastTick = new Date("2026-04-29T09:31:00Z");
    const now = new Date("2026-04-29T09:32:00Z");
    expect(firedInWindow(cron, lastTick, now)).toBe(false);
  });

  it("respects day-of-week", () => {
    const cron = parseCron("0 9 * * 1"); // Mondays
    // 2026-04-27 is a Monday
    const monLast = new Date("2026-04-27T08:59:00Z");
    const monNow = new Date("2026-04-27T09:00:30Z");
    expect(firedInWindow(cron, monLast, monNow)).toBe(true);
    // 2026-04-28 is a Tuesday — should not fire
    const tueLast = new Date("2026-04-28T08:59:00Z");
    const tueNow = new Date("2026-04-28T09:00:30Z");
    expect(firedInWindow(cron, tueLast, tueNow)).toBe(false);
  });

  it("hourly cron fires every hour boundary", () => {
    const cron = parseCron("0 * * * *");
    const lastTick = new Date("2026-04-29T13:59:30Z");
    const now = new Date("2026-04-29T14:00:30Z");
    expect(firedInWindow(cron, lastTick, now)).toBe(true);
  });
});

describe("briefingHourReached", () => {
  it("fires when the configured UTC hour boundary is crossed", () => {
    const lastTick = new Date("2026-04-29T07:59:30Z");
    const now = new Date("2026-04-29T08:00:30Z");
    expect(briefingHourReached(lastTick, now, 8)).toBe(true);
  });

  it("does not fire outside the boundary minute", () => {
    const lastTick = new Date("2026-04-29T08:01:00Z");
    const now = new Date("2026-04-29T08:02:00Z");
    expect(briefingHourReached(lastTick, now, 8)).toBe(false);
  });

  it("does not fire on a different hour", () => {
    const lastTick = new Date("2026-04-29T07:59:30Z");
    const now = new Date("2026-04-29T08:00:30Z");
    expect(briefingHourReached(lastTick, now, 9)).toBe(false);
  });

  it("respects multi-minute windows that contain the boundary", () => {
    // Scheduler crashed for 5 minutes — the briefing minute is still in the window.
    const lastTick = new Date("2026-04-29T07:55:00Z");
    const now = new Date("2026-04-29T08:03:00Z");
    expect(briefingHourReached(lastTick, now, 8)).toBe(true);
  });
});
