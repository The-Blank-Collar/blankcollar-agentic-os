# Document ingestion

The company brain stores three kinds of context, each with a different purpose:

| Surface | Purpose | Shape |
|---|---|---|
| `ops.knowledge_doc` | Curated wiki entries — short, hand-written, link-rich | Single blob with backlinks |
| `brain.memory` | Free-form one-liners — "Mira's birthday is Sept 12" | Single sentence + vector |
| **`ops.document`** | **Long-form ingested content — files, URLs, future PDFs** | **Title row + N chunks** |

Sprint 2.4 added the third surface. It's the path you use when you want to drop something larger than a memory but more arbitrary than a wiki entry into the brain.

## Lifecycle

```
       ┌──────────────────┐
       │ markdown / URL   │
       │ (1MB cap)        │
       └────────┬─────────┘
                ▼
       ┌──────────────────┐
       │ chunker          │  paragraph-aware, ~1500 chars/chunk,
       │                  │  150-char trailing overlap, deterministic
       └────────┬─────────┘
                ▼
       ┌──────────────────┐
       │ ops.document     │  one row per logical doc
       │ ops.document_chunk│  N rows, char-range preserved
       └──────────────────┘
                │
                ├── keyword search (GIN tsvector, today)
                └── vector search via gbrain (follow-up)
```

## CLI

```bash
# From a local file
bc doc add ./meeting-notes.md
bc doc add ./report.md --title="Q3 review" --tags=q3,finance --scope=company

# From a URL — light HTML→text extraction
bc doc add --url=https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

# Re-ingest the updated version of an already-stored doc
bc doc add ./report.md --force

# List + filter
bc docs
bc docs --scope=personal
bc docs --tag=q3

# Read one
bc doc <id>

# Search
bc docs search "quarterly target"

# Delete
bc doc remove <id>
```

### Chunker tuning

Defaults are tuned for `text-embedding-3-small`:
- `target_chars = 1500` — about 375 tokens
- `overlap_chars = 150` — about 38 tokens
- `min_chars = 50` — drops tail chunks shorter than this; the first chunk is always kept

Override per-call:
```bash
bc doc add ./long.md --target-chars=2500 --overlap-chars=200
```

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/documents/markdown` | Ingest. Body: `{title, content_md, source_url?, source_filename?, mime_type?, scope?, tags?, force?, target_chars?, overlap_chars?, min_chars?}` |
| `GET` | `/api/documents` | List, filterable by `scope`, `tag` |
| `GET` | `/api/documents/search?q=...` | Keyword search across chunks |
| `GET` | `/api/documents/:id` | Single doc + metadata |
| `GET` | `/api/documents/:id/chunks` | All chunks of one doc, ordered |
| `DELETE` | `/api/documents/:id` | Delete doc; chunks cascade |

### Dedupe

Every ingest computes `sha256(content_md)`. Within an org, content_hash is unique:

- **Same hash, no `force`** → 200 with `deduplicated: true` and the existing `document_id`. No new row, no audit entry.
- **Same hash, `force=true`** → existing row + chunks are deleted, fresh ingest happens. Audited as `document.replace`.
- **New hash** → 201 with `deduplicated: false`. Audited as `document.ingest`.

## Scope semantics

- `personal` — visible to one user (Phase 6 will enforce per-user)
- `company` — visible to every member of the org *(default)*
- `shared` — global registry (rare; reserved for system docs)

## Mime types

Accepted today:
- `text/markdown` (default for `.md`, `.markdown`)
- `text/plain` (for `.txt`)
- `text/html` (the URL fetcher sniffs `<title>`, strips `<script>`/`<style>`/`<nav>`/`<header>`/`<footer>`)
- `application/json` (stored as raw text)

PDF (`application/pdf`) is **deferred** — needs a parser library; not in v0.

## What happens to a chunk after ingest

For now, chunks land in Postgres immediately and are keyword-searchable via the GIN tsvector index. The follow-up wires `gbrain.remember` per chunk so vector search via the existing recall path works. The `memory_id` column on `ops.document_chunk` is the placeholder for that linking — null today.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `422` from `bc doc add --url=...` with "no extractable text" | The page is JS-heavy; the regex extractor returned <200 chars. Save the rendered page to a `.md` file and `bc doc add` that. |
| `413` "payload too large" | Document exceeds the 1MB cap. Split before ingesting. |
| Re-uploading does nothing | Same content_hash already in your org. Use `--force` to replace. |
| Searches return nothing despite recent ingest | Search is keyword-based today; check exact-token match. Use `bc doc <id>` to confirm chunks exist. |

## What's deferred

- **PDF parsing** — needs `pdf-parse` or external service
- **Real headless URL extraction** for SPAs / paywalled / JS-only sites
- **Vector indexing** of chunks via gbrain (follow-up)
- **Re-embed-on-update** — editing a chunk doesn't currently re-vectorize
- **Auto-tagging** by topic; **auto-summarization** at ingest time
