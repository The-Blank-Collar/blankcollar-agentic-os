/**
 * Document chunker — splits long text into ~1500-char overlapping chunks
 * at paragraph boundaries.
 *
 * Properties:
 *   - Pure function (same input → same output, every time).
 *   - Never splits a paragraph mid-sentence.
 *   - Single paragraph longer than `targetChars` gets its own chunk
 *     (no hard wrap; preserves semantic coherence even at the cost of
 *     occasionally over-sized chunks).
 *   - Each chunk overlaps the previous by `overlapChars` worth of
 *     trailing paragraphs, so a passage sliced near a chunk boundary is
 *     still recoverable in two adjacent chunks.
 *   - Char-range (`char_start`, `char_end`) is preserved so the operator
 *     can map a chunk back to the exact passage in the original.
 *
 * Defaults are tuned for `text-embedding-3-small` (8 192 token context):
 *   - target 1500 chars  ≈ 375 tokens — well under the cap
 *   - overlap 150 chars  ≈ 38 tokens
 *
 * The chunker is intentionally NOT markdown-aware in v0 (no
 * heading-hierarchy preservation). Markdown still works fine because
 * the paragraph rule (`\n\n`) is the same in markdown as in plain text.
 * Heading-aware chunking is a Phase-3 polish.
 */

export type ChunkerOptions = {
  /** Target chars per chunk; an oversized paragraph still gets its own chunk. */
  targetChars?: number;
  /** Trailing-paragraph overlap between adjacent chunks. */
  overlapChars?: number;
  /** Skip chunks shorter than this. Set to 0 to keep all. */
  minChars?: number;
};

export type Chunk = {
  index: number;
  total: number;
  text: string;
  char_start: number;
  char_end: number;
};

const DEFAULT_TARGET = 1500;
const DEFAULT_OVERLAP = 150;
const DEFAULT_MIN = 50;

/**
 * Splits text on `\n\n` (one or more blank lines) → groups paragraphs into
 * chunks ≤ targetChars → adds trailing-paragraph overlap between adjacent
 * chunks. Returns an array of chunks ready for embedding + storage.
 */
export function chunkText(input: string, opts: ChunkerOptions = {}): Chunk[] {
  const targetChars = opts.targetChars ?? DEFAULT_TARGET;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP;
  const minChars = opts.minChars ?? DEFAULT_MIN;

  const text = input.replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) return [];

  // Split on 2+ newlines — preserve the offsets so we can compute char_start
  // and char_end of each paragraph inside the original text.
  type Para = { text: string; start: number; end: number };
  const paragraphs: Para[] = [];
  const re = /\n{2,}/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const piece = text.slice(lastEnd, match.index);
    if (piece.trim().length > 0) {
      paragraphs.push({ text: piece, start: lastEnd, end: match.index });
    }
    lastEnd = match.index + match[0].length;
  }
  const tail = text.slice(lastEnd);
  if (tail.trim().length > 0) {
    paragraphs.push({ text: tail, start: lastEnd, end: text.length });
  }

  if (paragraphs.length === 0) return [];

  // Greedy pack: append paragraphs to the current chunk until adding the
  // next would exceed targetChars (with the running total measured by the
  // raw char-range, not just trimmed text).
  const groups: Para[][] = [];
  let buf: Para[] = [];
  let bufLen = 0;

  for (const p of paragraphs) {
    const pLen = p.text.length;
    if (bufLen === 0) {
      // first para in this chunk — always include, even if oversized.
      buf.push(p);
      bufLen = pLen;
      continue;
    }
    if (bufLen + pLen + 2 /* "\n\n" */ > targetChars) {
      groups.push(buf);
      // Start the next chunk with the trailing-overlap paragraphs of the
      // current one, picked greedily to hit `overlapChars` of context.
      const overlap: Para[] = [];
      let overlapLen = 0;
      for (let i = buf.length - 1; i >= 0 && overlapLen < overlapChars; i--) {
        overlap.unshift(buf[i]!);
        overlapLen += buf[i]!.text.length + 2;
      }
      buf = [...overlap, p];
      bufLen = buf.reduce((n, x) => n + x.text.length + 2, -2); // first has no leading \n\n
      continue;
    }
    buf.push(p);
    bufLen += pLen + 2;
  }
  if (buf.length > 0) groups.push(buf);

  // Materialise chunks. Char range = first.start … last.end of the group.
  // minChars filters tail chunks only — never the first. Ingesting a tiny
  // doc shouldn't silently produce zero chunks; the operator should always
  // get back what they put in.
  const chunks: Chunk[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    const start = g[0]!.start;
    const end = g[g.length - 1]!.end;
    const t = g.map((p) => p.text).join("\n\n");
    if (chunks.length > 0 && t.length < minChars) continue;
    chunks.push({
      index: chunks.length,
      total: 0, // backfilled below
      text: t,
      char_start: start,
      char_end: end,
    });
  }
  for (const c of chunks) c.total = chunks.length;
  return chunks;
}
