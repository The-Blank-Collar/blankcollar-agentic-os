import { describe, expect, it } from "vitest";

import { chunkText } from "../src/documents/chunker.js";

describe("chunkText", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  \n  ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    const t = "Hello world.\n\nThis is a small doc.";
    const chunks = chunkText(t);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.total).toBe(1);
    expect(chunks[0]?.char_start).toBe(0);
    expect(chunks[0]?.char_end).toBe(t.length);
    expect(chunks[0]?.text).toContain("Hello world");
  });

  it("splits long input on paragraph boundaries", () => {
    const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);
    const t = `${para}\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = chunkText(t, { targetChars: 600, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      // No chunk should split mid-paragraph: each chunk ends at a
      // paragraph boundary in the source text.
      const end = c.char_end;
      expect(t.slice(end, end + 2) === "\n\n" || end === t.length).toBe(true);
    }
  });

  it("produces overlapping chunks when overlap > 0", () => {
    const para = "Sentence number {{n}} stands alone in its own paragraph.";
    const paras = Array.from({ length: 8 }, (_, i) => para.replace("{{n}}", String(i)));
    const t = paras.join("\n\n");
    const chunks = chunkText(t, { targetChars: 200, overlapChars: 80 });
    expect(chunks.length).toBeGreaterThan(1);
    // The last paragraph of chunk N should appear in chunk N+1 (the
    // overlap may be 1+ paragraphs deep, so we use `includes`, not
    // `startsWith`).
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1]!.text.split("\n\n").slice(-1)[0]!;
      expect(chunks[i]!.text.includes(prevTail)).toBe(true);
    }
  });

  it("keeps an oversized single paragraph as its own chunk", () => {
    const long = "x".repeat(5000);
    const chunks = chunkText(long, { targetChars: 1000, overlapChars: 0 });
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.text.length).toBe(5000);
    expect(chunks[0]?.char_start).toBe(0);
    expect(chunks[0]?.char_end).toBe(5000);
  });

  it("char_start and char_end form non-overlapping spans of paragraphs", () => {
    // With overlap=0 the chunk ranges should be strictly increasing.
    // Use minChars=0 so the test isn't subject to the tail-filter rule.
    const t = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
    const chunks = chunkText(t, { targetChars: 25, overlapChars: 0, minChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.char_start).toBeGreaterThanOrEqual(chunks[i - 1]!.char_start);
    }
  });

  it("normalises CRLF to LF before splitting", () => {
    const t = "Line one.\r\n\r\nLine two.\r\n\r\nLine three.";
    const chunks = chunkText(t, { targetChars: 50 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // No \r should leak into chunk text.
    for (const c of chunks) expect(c.text.includes("\r")).toBe(false);
  });

  it("respects minChars and drops tiny tail chunks", () => {
    const t = "main content paragraph that is reasonably long and meaningful.\n\nx";
    const chunks = chunkText(t, { targetChars: 20, overlapChars: 0, minChars: 10 });
    // The tail "x" should be dropped (below minChars).
    expect(chunks.every((c) => c.text.length >= 10)).toBe(true);
  });

  it("backfills total on every chunk so consumers can render '3 of 7'", () => {
    const para = "Paragraph content. ".repeat(20);
    const t = `${para}\n\n${para}\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = chunkText(t, { targetChars: 400, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    const total = chunks.length;
    for (const c of chunks) expect(c.total).toBe(total);
  });

  it("is deterministic — same input → identical output", () => {
    const t = Array.from({ length: 30 }, (_, i) => `Para ${i}: ${"word ".repeat(15)}`).join("\n\n");
    const a = chunkText(t, { targetChars: 500, overlapChars: 100 });
    const b = chunkText(t, { targetChars: 500, overlapChars: 100 });
    expect(a).toEqual(b);
  });
});
