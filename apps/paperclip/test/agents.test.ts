import { describe, expect, it } from "vitest";

import { sigilSeed } from "../src/routes/agents.js";

describe("sigilSeed", () => {
  it("is deterministic for the same agent", () => {
    const agent = { id: "11111111-2222-3333-4444-555555555555", name: "Aster", kind: "hermes" };
    expect(sigilSeed(agent)).toBe(sigilSeed(agent));
  });

  it("produces a slug-friendly identifier", () => {
    const seed = sigilSeed({
      id: "11111111-2222-3333-4444-555555555555",
      name: "Hermes — Marketing",
      kind: "hermes",
    });
    expect(seed).toBe("hermes-marketing-hermes-11111111");
  });

  it("varies across agents", () => {
    const a = sigilSeed({ id: "11111111-aaaa", name: "Aster", kind: "hermes" });
    const b = sigilSeed({ id: "22222222-bbbb", name: "Aster", kind: "hermes" });
    expect(a).not.toBe(b);
  });

  it("normalises punctuation in the name", () => {
    const seed = sigilSeed({
      id: "00000000-1111-2222-3333-444444444444",
      name: "Q!u@i#l$l & co.",
      kind: "openclaw",
    });
    expect(seed).toMatch(/^q-u-i-l-l-co-openclaw-00000000$/);
  });
});
