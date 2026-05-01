import { describe, expect, it } from "vitest";

import { extractWikilinks } from "../src/knowledge/wiki.js";

describe("extractWikilinks", () => {
  it("finds bare slug links", () => {
    const links = extractWikilinks("See [[brand-voice]] and [[governance]].");
    expect(links).toEqual([
      { slug: "brand-voice", anchor: null },
      { slug: "governance", anchor: null },
    ]);
  });

  it("captures anchor and alias separately", () => {
    const links = extractWikilinks("Read [[ops-handbook#hiring|hiring]] for the bands.");
    expect(links).toEqual([{ slug: "ops-handbook", anchor: "hiring" }]);
  });

  it("returns empty array when no links present", () => {
    expect(extractWikilinks("Plain prose, no links.")).toEqual([]);
  });

  it("ignores doubled brackets without slugs", () => {
    expect(extractWikilinks("[[]] [[ ]]").length).toBe(0);
  });
});

describe("matchesEvent", () => {
  // Imported lazily because triggers.ts imports audit/db which need the pool.
  // The matcher itself is pure; we just ensure it stays so.
  it("matches by exact action", async () => {
    const { matchesEvent } = await import("../src/routines/triggers.js");
    expect(
      matchesEvent({ action: "decision.approve" }, { action: "decision.approve", metadata: {} }),
    ).toBe(true);
    expect(
      matchesEvent({ action: "decision.approve" }, { action: "decision.decline", metadata: {} }),
    ).toBe(false);
  });

  it("matches dotted metadata paths", async () => {
    const { matchesEvent } = await import("../src/routines/triggers.js");
    expect(
      matchesEvent(
        { action: "goal.create", match: { "metadata.kind": "standing" } },
        { action: "goal.create", metadata: { kind: "standing" } },
      ),
    ).toBe(true);
    expect(
      matchesEvent(
        { action: "goal.create", match: { "metadata.kind": "standing" } },
        { action: "goal.create", metadata: { kind: "ephemeral" } },
      ),
    ).toBe(false);
  });

  it("ignores extra event fields not in spec", async () => {
    const { matchesEvent } = await import("../src/routines/triggers.js");
    expect(
      matchesEvent({ action: "anything" }, { action: "anything", metadata: { foo: "bar", baz: 1 } }),
    ).toBe(true);
  });
});
