import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt } from "../argv.js";
import { detectMode, emit } from "../format.js";

type Heartbeat = {
  period_days: number;
  period_start: string;
  period_end: string;
  series: Array<{
    kpi: string;
    label: string;
    unit: string;
    points: Array<{ date: string; value: number }>;
  }>;
};

const SPARK = "▁▂▃▄▅▆▇█";

function spark(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.round(((v - min) / range) * (SPARK.length - 1)))])
    .join("");
}

export async function runHeartbeat(args: ParsedArgs, client: Client): Promise<number> {
  const days = flagInt(args.flags, "days", 14);
  const data = await client.get<Heartbeat>("/api/heartbeat", { days });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  const lines = [`heartbeat · ${data.period_days} days`];
  for (const s of data.series) {
    const values = s.points.map((p) => p.value);
    const total = values.reduce((a, b) => a + b, 0);
    const last = values[values.length - 1] ?? 0;
    lines.push(
      `  ${s.label.padEnd(20)} ${spark(values)}  total ${total} ${s.unit}  last ${last}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
