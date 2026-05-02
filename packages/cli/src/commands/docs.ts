/**
 * `bc doc` and `bc docs` — operator surface for document ingestion.
 *
 *   bc doc add <file.md> [--title=...] [--tags=a,b,c] [--scope=...] [--force]
 *   bc doc add --url=https://...    [--title=...] [--tags=a,b,c] [--force]
 *   bc docs                         list (filter --scope --tag)
 *   bc docs search <query>          keyword search across chunks
 *   bc doc <id>                     show one doc + chunk count
 *   bc doc remove <id>              delete a doc (chunks cascade)
 *
 * Chunker defaults (CLI surfaces these in --help):
 *   targetChars  = 1500   one chunk ~ 1500 chars / ~ 375 tokens
 *   overlapChars = 150    trailing-paragraph overlap between chunks
 *   minChars     = 50     drop tail chunks shorter than this (the
 *                          first chunk is always kept regardless)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Doc = {
  id: string;
  scope: string;
  title: string;
  source_url: string | null;
  source_filename: string | null;
  mime_type: string;
  tags: string[];
  char_count: number;
  chunk_count: number;
  ingested_at: string;
};

type IngestResp = {
  document_id: string;
  chunk_count: number;
  deduplicated: boolean;
  document: Doc;
};

type SearchHit = {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  total_chunks: number;
  text: string;
  title: string;
  source_url: string | null;
  source_filename: string | null;
  ingested_at: string;
};

const HELP_USAGE = `usage:
  bc doc add <file>                    ingest a local markdown file
  bc doc add --url=https://...         fetch a URL, ingest the body text
  bc doc add ... --title="My doc"      override the auto-derived title
  bc doc add ... --tags=alpha,beta     attach tags
  bc doc add ... --scope=personal      personal | company (default) | shared
  bc doc add ... --force               re-ingest if same content already stored
  bc docs                              list ingested docs
  bc docs search <query>               keyword search across chunks
  bc doc <id>                          show one doc + metadata
  bc doc remove <id>                   delete a doc (chunks cascade)

chunker defaults: target=1500 chars, overlap=150, min=50. tune via:
  --target-chars=N --overlap-chars=N --min-chars=N
`;

function inferMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".md": return "text/markdown";
    case ".markdown": return "text/markdown";
    case ".txt": return "text/plain";
    case ".html": return "text/html";
    case ".htm": return "text/html";
    case ".json": return "application/json";
    default: return "text/plain";
  }
}

/**
 * Light HTML→text. Strips <script>/<style>/<nav>/<header>/<footer>,
 * collapses whitespace, decodes basic entities. Good enough for v0 —
 * sites that need real headless extraction (heavy SPA, paywalls)
 * will still produce thin output and trigger the 422 path on the
 * server.
 */
function htmlToText(html: string): string {
  let s = html;
  // Drop the noisy regions.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  s = s.replace(/<header[\s\S]*?<\/header>/gi, "");
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  // Block-level → paragraph break; inline → space.
  s = s.replace(/<\/(p|div|article|section|h[1-6]|li|tr|br)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  // Decode common entities.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Collapse runs of whitespace (preserving paragraph breaks).
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

async function fetchUrl(url: string): Promise<{ text: string; mime: string; title: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": "bc-doc-ingest/0.1 (+blankcollar)" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  let text: string;
  let mime: string;
  let title = url;
  if (ct.includes("text/html")) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    if (titleMatch?.[1]) title = titleMatch[1].trim().replace(/\s+/g, " ");
    text = htmlToText(body);
    mime = "text/html";
  } else if (ct.includes("markdown") || ct.includes("text/plain")) {
    text = body;
    mime = ct.includes("markdown") ? "text/markdown" : "text/plain";
  } else if (ct.includes("application/json")) {
    text = body;
    mime = "application/json";
  } else {
    // Best-effort treat as text.
    text = body;
    mime = ct || "text/plain";
  }
  return { text: text.trim(), mime, title };
}

export async function runDocAdd(args: ParsedArgs, client: Client): Promise<number> {
  const url = flagString(args.flags, "url", "");
  const filePath = args.positional[0] ?? "";
  if (!url && !filePath) {
    process.stderr.write(HELP_USAGE);
    return 2;
  }

  let content_md = "";
  let source_url: string | null = null;
  let source_filename: string | null = null;
  let mime_type = "text/markdown";
  let derivedTitle = "";

  if (url) {
    try {
      const r = await fetchUrl(url);
      content_md = r.text;
      mime_type = r.mime;
      derivedTitle = r.title;
      source_url = url;
    } catch (err) {
      process.stderr.write(`✗ fetch failed: ${(err as Error).message}\n`);
      return 1;
    }
  } else {
    try {
      const buf = await readFile(filePath, "utf8");
      content_md = buf;
      const base = path.basename(filePath);
      source_filename = base;
      derivedTitle = base.replace(/\.[a-z]+$/i, "");
      mime_type = inferMime(base);
    } catch (err) {
      process.stderr.write(`✗ read failed: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (!content_md || content_md.trim().length === 0) {
    process.stderr.write("✗ document has no extractable text\n");
    return 1;
  }

  const tagsCsv = flagString(args.flags, "tags", "");
  const tags = tagsCsv
    ? tagsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const body: Record<string, unknown> = {
    title: flagString(args.flags, "title", derivedTitle || "Untitled"),
    content_md,
    mime_type,
    scope: flagString(args.flags, "scope", "company"),
    tags,
    force: flagBool(args.flags, "force"),
  };
  if (source_url) body.source_url = source_url;
  if (source_filename) body.source_filename = source_filename;
  // Optional chunker overrides
  for (const k of ["target-chars", "overlap-chars", "min-chars"]) {
    const v = flagString(args.flags, k, "");
    if (v && /^\d+$/.test(v)) body[k.replace(/-/g, "_")] = Number(v);
  }

  const out = await client.post<IngestResp>("/api/documents/markdown", body);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", out);
    return 0;
  }
  const verb = out.deduplicated ? "deduplicated" : (body.force ? "replaced" : "ingested");
  emit(
    "pretty",
    `${verb} · ${out.document.id.slice(0, 8)}  ${out.chunk_count} chunk${out.chunk_count === 1 ? "" : "s"}  · ${out.document.char_count.toLocaleString()} chars\n  title: ${out.document.title}`,
  );
  return 0;
}

export async function runDocsList(args: ParsedArgs, client: Client): Promise<number> {
  const params: Record<string, string | number | boolean | undefined> = {};
  const scope = flagString(args.flags, "scope", "");
  const tag = flagString(args.flags, "tag", "");
  if (scope) params.scope = scope;
  if (tag) params.tag = tag;
  const docs = await client.get<Doc[]>("/api/documents", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", docs);
    return 0;
  }
  if (docs.length === 0) {
    emit("pretty", "no documents.");
    return 0;
  }
  const lines = [`documents · ${docs.length}`];
  for (const d of docs) {
    const tags = d.tags.length > 0 ? `  [${d.tags.slice(0, 3).join(", ")}]` : "";
    const src = d.source_filename ?? d.source_url ?? "";
    lines.push(
      `  ${d.id.slice(0, 8)} ${d.scope.padEnd(8)} ${trunc(d.title, 40).padEnd(40)} ${String(d.chunk_count).padStart(3)} chunks  ${relative(d.ingested_at)}${tags}`,
    );
    if (src) lines.push(`        from: ${trunc(src, 80)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runDocGet(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc doc <id>\n");
    return 2;
  }
  const doc = await client.get<Doc>(`/api/documents/${encodeURIComponent(id)}`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", doc);
    return 0;
  }
  const lines = [
    `${doc.id}  ${doc.scope}  ${doc.mime_type}`,
    doc.title,
    "",
    `  chunks:    ${doc.chunk_count}`,
    `  chars:     ${doc.char_count.toLocaleString()}`,
    `  ingested:  ${relative(doc.ingested_at)}`,
  ];
  if (doc.source_url) lines.push(`  source:    ${doc.source_url}`);
  if (doc.source_filename) lines.push(`  filename:  ${doc.source_filename}`);
  if (doc.tags.length > 0) lines.push(`  tags:      ${doc.tags.join(", ")}`);
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runDocRemove(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc doc remove <id>\n");
    return 2;
  }
  await client.del(`/api/documents/${encodeURIComponent(id)}`);
  emit(detectMode(args.flags), `removed · ${id.slice(0, 8)}`);
  return 0;
}

export async function runDocsSearch(args: ParsedArgs, client: Client): Promise<number> {
  const q = args.positional.join(" ").trim();
  if (q.length < 2) {
    process.stderr.write("usage: bc docs search <query>\n");
    return 2;
  }
  const hits = await client.get<SearchHit[]>("/api/documents/search", { q, limit: 20 });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", hits);
    return 0;
  }
  if (hits.length === 0) {
    emit("pretty", `no hits for "${q}".`);
    return 0;
  }
  const lines = [`docs search · ${hits.length} hit${hits.length === 1 ? "" : "s"} for "${q}"`];
  for (const h of hits) {
    lines.push(
      `  ${h.document_id.slice(0, 8)} chunk ${h.chunk_index + 1}/${h.total_chunks}  ${trunc(h.title, 50)}  ${relative(h.ingested_at)}`,
    );
    // Show the matching span: 60 chars on either side of the first
    // case-insensitive hit, falling back to the chunk head.
    const lc = h.text.toLowerCase();
    const idx = lc.indexOf(q.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(h.text.length, idx + q.length + 60);
      const snippet = (start > 0 ? "…" : "") + h.text.slice(start, end).replace(/\s+/g, " ") + (end < h.text.length ? "…" : "");
      lines.push(`        ${snippet}`);
    } else {
      lines.push(`        ${trunc(h.text.replace(/\s+/g, " "), 120)}`);
    }
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

// Sub-dispatcher used by `bc doc` (no subcommand → get; `add` / `remove` etc).
export async function runDoc(args: ParsedArgs, client: Client): Promise<number> {
  const verb = args.positional[0];
  if (verb === "add") {
    const sub = { ...args, positional: args.positional.slice(1) };
    return await runDocAdd(sub, client);
  }
  if (verb === "remove" || verb === "rm" || verb === "delete") {
    const sub = { ...args, positional: args.positional.slice(1) };
    return await runDocRemove(sub, client);
  }
  // Default: treat the first positional as a doc ID
  return await runDocGet(args, client);
}

// `bc docs` — list by default; `bc docs search <q>` → search.
export async function runDocs(args: ParsedArgs, client: Client): Promise<number> {
  if (args.positional[0] === "search") {
    const sub = { ...args, positional: args.positional.slice(1) };
    return await runDocsSearch(sub, client);
  }
  return await runDocsList(args, client);
}
