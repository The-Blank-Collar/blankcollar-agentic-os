import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit, trunc } from "../format.js";

type Doc = {
  id: string;
  slug: string;
  title: string;
  scope: "personal" | "company" | "shared";
  hot: boolean;
  content_md: string;
  tags: string[];
  updated_at: string;
};

export async function runKnowledgeList(args: ParsedArgs, client: Client): Promise<number> {
  const docs = await client.get<Doc[]>("/api/knowledge", {
    scope: typeof args.flags.scope === "string" ? args.flags.scope : undefined,
    hot: args.flags.hot ? true : undefined,
    tag: typeof args.flags.tag === "string" ? args.flags.tag : undefined,
    q: typeof args.flags.q === "string" ? args.flags.q : undefined,
    limit: 50,
  });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", docs);
    return 0;
  }
  if (docs.length === 0) {
    emit("pretty", "no docs.");
    return 0;
  }
  const lines = [`knowledge · ${docs.length} doc${docs.length === 1 ? "" : "s"}`];
  for (const d of docs) {
    const flag = d.hot ? "★" : " ";
    lines.push(`  ${flag} ${d.scope.padEnd(8)} ${d.slug.padEnd(30)} ${trunc(d.title, 50)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runKnowledgeGet(args: ParsedArgs, client: Client): Promise<number> {
  const slug = args.positional[0];
  if (!slug) {
    process.stderr.write("usage: bc knowledge get <slug>\n");
    return 2;
  }
  const data = await client.get<
    Doc & { outbound_links: Array<{ slug: string }>; backlinks: Array<{ slug: string }> }
  >(`/api/knowledge/${encodeURIComponent(slug)}`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  const lines = [
    `# ${data.title}`,
    `(${data.scope}${data.hot ? " · hot" : ""}${data.tags.length > 0 ? " · " + data.tags.join(", ") : ""})`,
    "",
    data.content_md,
  ];
  if (data.outbound_links.length > 0) {
    lines.push("", "→ links to: " + data.outbound_links.map((l) => l.slug).join(", "));
  }
  if (data.backlinks.length > 0) {
    lines.push("← linked from: " + data.backlinks.map((l) => l.slug).join(", "));
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
