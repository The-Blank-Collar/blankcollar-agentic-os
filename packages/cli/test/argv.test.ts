import { describe, expect, it } from "vitest";

import { flagBool, flagInt, flagString, parseArgv } from "../src/argv.js";

describe("parseArgv", () => {
  it("captures the subcommand as the first non-flag", () => {
    const r = parseArgv(["capture", "Hello", "world"]);
    expect(r.subcommand).toBe("capture");
    expect(r.positional).toEqual(["Hello", "world"]);
  });

  it("parses --key=value flags", () => {
    const r = parseArgv(["health", "--json", "--limit=10"]);
    expect(r.flags.json).toBe(true);
    expect(r.flags.limit).toBe("10");
  });

  it("parses --key value flags", () => {
    const r = parseArgv(["goals", "--status", "active"]);
    expect(r.flags.status).toBe("active");
    expect(r.positional).toEqual([]);
  });

  it("treats trailing standalone --flag as boolean true", () => {
    const r = parseArgv(["briefing", "--pretty"]);
    expect(r.flags.pretty).toBe(true);
  });

  it("supports `--` to end flag parsing", () => {
    const r = parseArgv(["capture", "--", "--this-is-positional"]);
    expect(r.positional).toEqual(["--this-is-positional"]);
  });

  it("returns null subcommand on empty argv", () => {
    expect(parseArgv([]).subcommand).toBeNull();
  });

  it("flagInt parses integers, falls back when missing", () => {
    expect(flagInt({ limit: "20" }, "limit", 5)).toBe(20);
    expect(flagInt({}, "limit", 5)).toBe(5);
    expect(flagInt({ limit: "abc" }, "limit", 5)).toBe(5);
  });

  it("flagString takes the value or fallback", () => {
    expect(flagString({ status: "active" }, "status", "all")).toBe("active");
    expect(flagString({}, "status", "all")).toBe("all");
    // boolean true (presence only) → fallback
    expect(flagString({ status: true }, "status", "all")).toBe("all");
  });

  it("flagBool is true when present (any value), false when missing", () => {
    expect(flagBool({ pretty: true }, "pretty")).toBe(true);
    expect(flagBool({ pretty: "yes" }, "pretty")).toBe(true);
    expect(flagBool({}, "pretty")).toBe(false);
  });
});
