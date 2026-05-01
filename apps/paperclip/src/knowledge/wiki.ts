/**
 * Markdown wiki helpers — Karpathy-style hot-context docs.
 *
 * Each `ops.knowledge_doc` row is one markdown file, scoped personal /
 * company / shared. Wiki-style backlinks (`[[other-slug]]`) are extracted
 * on save and stored in `ops.knowledge_link` so the graph is queryable.
 *
 * "Hot context" = docs flagged with `hot=true`. Hermes pulls every hot doc
 * for the caller's scope at run time and injects them as system context,
 * before semantic recall. Reserve hot for the small handful of docs that
 * always matter (brand voice, governance rules, decision categories).
 *
 * gbrain bridge: when a doc is created/updated, we also write a `document`
 * memory to gbrain so semantic recall can find it. The memory_id lives on
 * the doc row for round-tripping.
 */

import { config } from "../config.js";

export type KnowledgeDoc = {
  id: string;
  org_id: string;
  user_id: string | null;
  slug: string;
  title: string;
  scope: "personal" | "company" | "shared";
  hot: boolean;
  content_md: string;
  tags: string[];
  memory_id: string | null;
  created_at: string;
  updated_at: string;
};

const WIKILINK_RE = /\[\[\s*([^\]|#\s][^\]|#]*?)\s*(?:#([^\]|]+))?\s*(?:\|([^\]]+))?\]\]/g;

export type ParsedLink = {
  slug: string;
  anchor: string | null;
};

export function extractWikilinks(md: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(md)) !== null) {
    out.push({ slug: m[1]!.trim(), anchor: m[2]?.trim() ?? null });
  }
  return out;
}

/**
 * Push the doc into gbrain as a `document` memory so semantic recall can
 * surface it alongside other documents. Idempotent at the gbrain layer:
 * gbrain dedupes by (scope, content) hash internally.
 *
 * Failures are logged-and-swallowed — wiki writes shouldn't fail because
 * gbrain is down. The memory_id returned is stored on the doc row for
 * round-tripping; null is acceptable.
 */
export async function pushDocToBrain(args: {
  orgId: string;
  scope: "personal" | "company" | "shared";
  title: string;
  content: string;
  tags: string[];
}): Promise<string | null> {
  const visibleTo = args.scope === "personal" ? ["owner"] : ["owner", "department_lead", "team_member"];
  try {
    const res = await fetch(`${config.gbrainUrl}/remember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "document",
        title: args.title.slice(0, 200),
        content: args.content.slice(0, 50_000),
        scope: { org_id: args.orgId, role: "owner" },
        visible_to: visibleTo,
        metadata: { source: "knowledge_wiki", tags: args.tags },
      }),
      // Short timeout — wiki writes are user-facing.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { memory_id?: string };
    return body.memory_id ?? null;
  } catch {
    return null;
  }
}
