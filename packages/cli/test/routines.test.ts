import { describe, expect, it } from "vitest";

import { nextCronFire } from "../src/commands/routines.js";

describe("nextCronFire", () => {
  it("returns the next Monday 09:00 UTC for '0 9 * * 1'", () => {
    // Sunday 23:00 UTC → next fire is Monday 09:00 UTC, same week.
    const sun = new Date("2026-04-26T23:00:00.000Z");
    const next = nextCronFire("0 9 * * 1", sun);
    expect(next?.toISOString()).toBe("2026-04-27T09:00:00.000Z");
  });

  it("returns the next 08:00 UTC for daily '0 8 * * *'", () => {
    const t = new Date("2026-04-27T08:30:00.000Z");
    const next = nextCronFire("0 8 * * *", t);
    expect(next?.toISOString()).toBe("2026-04-28T08:00:00.000Z");
  });

  it("returns next minute for '* * * * *'", () => {
    const t = new Date("2026-04-27T12:00:00.000Z");
    const next = nextCronFire("* * * * *", t);
    expect(next?.toISOString()).toBe("2026-04-27T12:01:00.000Z");
  });

  it("returns null for malformed expressions", () => {
    expect(nextCronFire("not a cron")).toBeNull();
    expect(nextCronFire("0 9 1 * 1")).toBeNull(); // day-of-month not supported
    expect(nextCronFire("0 25 * * *")).toBeNull(); // hour out of range
  });

  it("returns null for ranges/lists/slashes (out of v0 grammar)", () => {
    expect(nextCronFire("0 9-17 * * *")).toBeNull();
    expect(nextCronFire("0 9,12 * * *")).toBeNull();
    expect(nextCronFire("*/5 * * * *")).toBeNull();
  });
});
