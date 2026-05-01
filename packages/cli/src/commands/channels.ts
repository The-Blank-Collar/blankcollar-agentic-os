import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit, relative } from "../format.js";

type ChannelsResp = {
  channels: Array<{
    provider: string;
    display: string;
    state: "connected" | "disconnected";
    last_activity_at: string | null;
    recent_capture_count: number;
  }>;
};

const STATE_DOT = { connected: "●", disconnected: "○" } as const;

export async function runChannels(args: ParsedArgs, client: Client): Promise<number> {
  const data = await client.get<ChannelsResp>("/api/channels");
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  const lines = [`channels · ${data.channels.length}`];
  for (const c of data.channels) {
    const last = c.last_activity_at ? relative(c.last_activity_at) : "—";
    lines.push(
      `  ${STATE_DOT[c.state]} ${c.display.padEnd(22)} captures=${String(c.recent_capture_count).padStart(3)}  last=${last}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
