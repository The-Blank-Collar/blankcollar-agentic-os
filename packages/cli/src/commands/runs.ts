import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagString } from "../argv.js";
import { detectMode, emit, emitError, relative } from "../format.js";

type Run = {
  id: string;
  goal_id: string;
  agent_id: string | null;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const STATUS_ICON: Record<string, string> = {
  queued: "·",
  running: "▸",
  succeeded: "✓",
  failed: "✗",
  cancelled: "—",
};

export async function runRunsList(args: ParsedArgs, client: Client): Promise<number> {
  const goalId = flagString(args.flags, "goal", "");
  if (!goalId) {
    process.stderr.write("usage: bc runs --goal=<goal_id>\n");
    return 2;
  }
  const runs = await client.get<Run[]>("/api/runs", { goal_id: goalId });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", runs);
    return 0;
  }
  if (runs.length === 0) {
    emit("pretty", "no runs.");
    return 0;
  }
  const lines = [`runs · ${runs.length} on goal ${goalId.slice(0, 8)}`];
  for (const r of runs) {
    const icon = STATUS_ICON[r.status] ?? "·";
    const subtask = (r.input as { subtask?: { title?: string } } | null)?.subtask?.title ?? "";
    lines.push(`  ${icon} ${r.id.slice(0, 8)} ${r.status.padEnd(10)} ${subtask}  ${relative(r.created_at)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runRunGet(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc run <id> [--watch]\n");
    return 2;
  }

  if (flagBool(args.flags, "watch")) {
    return streamRun(id, args, client);
  }

  const run = await client.get<Run>(`/api/runs/${encodeURIComponent(id)}`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", run);
    return 0;
  }
  emit("pretty", renderRun(run));
  return 0;
}

function renderRun(r: Run): string {
  const lines = [
    `${STATUS_ICON[r.status] ?? "·"} ${r.id}  ${r.status}`,
    `  goal:    ${r.goal_id}`,
    `  agent:   ${r.agent_id ?? "—"}`,
    `  started: ${r.started_at ?? "—"}`,
    `  ended:   ${r.finished_at ?? "—"}`,
  ];
  const subtask = (r.input as { subtask?: { title?: string } } | null)?.subtask?.title;
  if (subtask) lines.push(`  subtask: ${subtask}`);
  if (r.error) lines.push(`  error:   ${r.error}`);
  if (r.output) {
    lines.push("", "  output:");
    for (const [k, v] of Object.entries(r.output)) {
      const pretty = typeof v === "string" ? v : JSON.stringify(v);
      lines.push(`    ${k}: ${pretty}`);
    }
  }
  return lines.join("\n");
}

/**
 * Stream the run's status changes via Server-Sent Events. Each `snapshot`
 * event prints a tight one-liner; the final `done` event closes the
 * stream and exits with the run's status code.
 */
async function streamRun(id: string, args: ParsedArgs, client: Client): Promise<number> {
  const url = client.buildUrl(`/api/runs/${encodeURIComponent(id)}/stream`);
  const mode = detectMode(args.flags);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        "x-bc-org-slug": client.orgSlug,
        ...(client.token ? { authorization: `Bearer ${client.token}` } : {}),
      },
    });
  } catch (err) {
    emitError(err);
    return 1;
  }
  if (!res.ok || !res.body) {
    emitError(new Error(`HTTP ${res.status} ${res.statusText}`));
    return 1;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let lastStatus = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const lines = raw.split("\n").filter((l) => !l.startsWith(":"));
        const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message";
        const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
        if (!dataLine) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (event === "snapshot") {
          const status = String(payload.status ?? "");
          if (mode === "json") {
            emit("json", { event, ...payload });
          } else if (status !== lastStatus) {
            const icon = STATUS_ICON[status] ?? "·";
            const note = payload.error ? ` — ${String(payload.error).slice(0, 80)}` : "";
            emit("pretty", `${icon} ${status}${note}`);
            lastStatus = status;
          }
        } else if (event === "done") {
          if (mode === "json") emit("json", { event, ...payload });
          else emit("pretty", `\ndone (${payload.status}).`);
          return payload.status === "succeeded" ? 0 : 1;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return 0;
}
