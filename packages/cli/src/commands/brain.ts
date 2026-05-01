import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagInt } from "../argv.js";
import { detectMode, emit } from "../format.js";

type Node = {
  id: string;
  kind: "person" | "agent" | "goal" | "capture" | "tool";
  label: string;
  metadata?: Record<string, unknown>;
};

type Edge = {
  from: string;
  to: string;
  kind: "owns" | "contributes" | "captures" | "ran";
};

type Graph = {
  nodes: Node[];
  edges: Edge[];
  truncated: boolean;
  generated_at: string;
};

export async function runBrain(args: ParsedArgs, client: Client): Promise<number> {
  const limit = flagInt(args.flags, "limit", 80);
  const refresh = flagBool(args.flags, "refresh");
  const params: Record<string, string | number | boolean | undefined> = { limit };
  if (refresh) params.refresh = true;

  const graph = await client.get<Graph>("/api/brain/graph", params);
  const mode = detectMode(args.flags);

  if (mode === "json" || !flagBool(args.flags, "summary")) {
    // The whole graph is JSON-shaped — emit JSON unconditionally unless
    // the caller asked for a summary. The data shape doesn't render
    // editorially in any useful way without a layout.
    emit("json", graph);
    return 0;
  }

  // --summary: counts per node-kind + edge-kind, plus density.
  const nodesByKind: Record<string, number> = {};
  for (const n of graph.nodes) {
    nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;
  }
  const edgesByKind: Record<string, number> = {};
  for (const e of graph.edges) {
    edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;
  }
  const lines = [
    `brain graph · ${graph.nodes.length} nodes · ${graph.edges.length} edges${graph.truncated ? " (truncated)" : ""}`,
    "",
    "nodes:",
    `  person     ${nodesByKind.person ?? 0}`,
    `  agent      ${nodesByKind.agent ?? 0}`,
    `  goal       ${nodesByKind.goal ?? 0}`,
    `  capture    ${nodesByKind.capture ?? 0}`,
    `  tool       ${nodesByKind.tool ?? 0}`,
    "",
    "edges:",
    `  owns         ${edgesByKind.owns ?? 0}`,
    `  contributes  ${edgesByKind.contributes ?? 0}`,
    `  captures     ${edgesByKind.captures ?? 0}`,
    `  ran          ${edgesByKind.ran ?? 0}`,
  ];
  emit("pretty", lines.join("\n"));
  return 0;
}
