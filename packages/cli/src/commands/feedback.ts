import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Feedback = {
  id: string;
  run_id: string;
  rating: number;
  tags: string[];
  note: string | null;
  created_at: string;
};

const STAR = "★";
const DIM_STAR = "☆";

function rating(n: number): string {
  return STAR.repeat(n) + DIM_STAR.repeat(Math.max(0, 5 - n));
}

/**
 * `bc feedback <run_id> --rating=N [--tag=X --tag=Y] [--note="..."]`
 * `bc feedback <run_id> --list`
 */
export async function runFeedback(args: ParsedArgs, client: Client): Promise<number> {
  const runId = args.positional[0];
  if (!runId) {
    process.stderr.write(
      "usage: bc feedback <run_id> --rating=1..5 [--tag=X --tag=Y] [--note=...]\n" +
        "       bc feedback <run_id> --list\n" +
        "  common tags: wrong-tone, missing-fact, hallucinated, too-long, too-short, off-topic, perfect, helpful\n",
    );
    return 2;
  }

  const mode = detectMode(args.flags);

  // List mode: show every feedback entry on this run
  if (args.flags.list === true || args.flags.list === "true") {
    const rows = await client.get<Feedback[]>(`/api/runs/${encodeURIComponent(runId)}/feedback`);
    if (mode === "json") {
      emit("json", rows);
      return 0;
    }
    if (rows.length === 0) {
      emit("pretty", "no feedback yet on this run.");
      return 0;
    }
    const lines = [`feedback · ${rows.length} on run ${runId.slice(0, 8)}`];
    for (const fb of rows) {
      const tags = fb.tags.length > 0 ? `  [${fb.tags.join(", ")}]` : "";
      lines.push(`  ${fb.id.slice(0, 8)}  ${rating(fb.rating)}${tags}  ${relative(fb.created_at)}`);
      if (fb.note) lines.push(`    ${trunc(fb.note, 100)}`);
    }
    emit("pretty", lines.join("\n"));
    return 0;
  }

  // Create mode
  const r = flagInt(args.flags, "rating", -1);
  if (r < 1 || r > 5) {
    process.stderr.write("--rating must be 1..5\n");
    return 2;
  }
  const tags: string[] = [];
  // Multiple --tag= values: parseArgv stores the last one only when the same
  // key repeats. CLI users can pass --tags=a,b,c instead.
  const tagsCsv = flagString(args.flags, "tags", "");
  if (tagsCsv) {
    for (const t of tagsCsv.split(",").map((s) => s.trim()).filter(Boolean)) tags.push(t);
  }
  const singleTag = flagString(args.flags, "tag", "");
  if (singleTag) tags.push(singleTag);

  const note = flagString(args.flags, "note", "");
  const body: Record<string, unknown> = { rating: r, tags };
  if (note) body.note = note;

  const out = await client.post<Feedback>(
    `/api/runs/${encodeURIComponent(runId)}/feedback`,
    body,
  );
  if (mode === "json") {
    emit("json", out);
    return 0;
  }
  const tagPart = out.tags.length > 0 ? `  [${out.tags.join(", ")}]` : "";
  emit("pretty", `recorded · ${out.id.slice(0, 8)}  ${rating(out.rating)}${tagPart}`);
  return 0;
}
