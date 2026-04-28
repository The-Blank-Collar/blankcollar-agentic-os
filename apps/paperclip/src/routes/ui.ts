/**
 * Server-rendered, htmx-driven dashboard. Calm by default.
 * Goal-first: the home view is the goals list grouped by department.
 */

import type { FastifyInstance } from "fastify";

import { query } from "../db.js";
import { resolveCallerScope } from "../scope.js";

const escape = (s: unknown): string =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const STATUS_PILL: Record<string, string> = {
  draft: "background:#1a1f25;color:#9aa4b1",
  active: "background:#1f3a52;color:#9ec5ff",
  paused: "background:#3a2f12;color:#f5c97a",
  achieved: "background:#163b29;color:#7be0a3",
  archived: "background:#1a1f25;color:#5a626c",
};

const KIND_PILL: Record<string, string> = {
  hermes: "background:#1f2e3a;color:#9ec5ff",
  openclaw: "background:#3a2f12;color:#f5c97a",
};

function renderKindPill(kind: string | undefined): string {
  if (!kind) return "";
  const style = KIND_PILL[kind] ?? "background:#1a1f25;color:#9aa4b1";
  return `<span class="pill" style="${style};font-size:.7rem;margin-left:.25rem">${escape(kind)}</span>`;
}

const RUN_STATUS_PILL: Record<string, string> = {
  queued: "background:#1a1f25;color:#9aa4b1",
  running: "background:#1f3a52;color:#9ec5ff",
  succeeded: "background:#163b29;color:#7be0a3",
  failed: "background:#3a1f1f;color:#ff8a8a",
  cancelled: "background:#1a1f25;color:#5a626c",
};

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escape(title)} · Paperclip</title>
  <script src="https://unpkg.com/htmx.org@2.0.3" crossorigin></script>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
           background:#0b0d10; color:#e7eaee; margin:0; min-height:100vh }
    a { color:#7aa7ff; text-decoration:none } a:hover{text-decoration:underline}
    header { padding: 1.25rem 2rem; border-bottom:1px solid #1f242b; display:flex; align-items:center; justify-content:space-between }
    header h1 { margin:0; font-size:1.1rem; font-weight:600; letter-spacing:-.01em }
    header .tag { color:#7e8794; font-size:.85rem }
    main { max-width:1100px; margin:0 auto; padding:1.5rem 2rem 4rem }
    h2 { font-size:1.5rem; letter-spacing:-.02em; margin:1.5rem 0 .75rem }
    h3 { font-size:1rem; color:#9aa4b1; font-weight:500; margin:1.5rem 0 .5rem; text-transform:uppercase; letter-spacing:.08em }
    .pill { display:inline-block; padding:.15rem .55rem; border-radius:999px; font-size:.78rem; font-weight:500 }
    .card { background:#121519; border:1px solid #1f242b; border-radius:12px; padding:1rem 1.25rem; margin-bottom:.6rem }
    .card.goal { display:flex; gap:1rem; align-items:flex-start }
    .card.goal .body { flex:1 }
    .card.goal .title { font-weight:600; margin-bottom:.15rem }
    .card.goal .meta { color:#7e8794; font-size:.85rem }
    .grid { display:grid; gap:.6rem }
    .empty { color:#7e8794; padding:2rem; text-align:center; border:1px dashed #1f242b; border-radius:12px }
    form.inline { display:flex; gap:.5rem; flex-wrap:wrap; align-items:flex-end; background:#121519; border:1px solid #1f242b; border-radius:12px; padding:1rem }
    input, textarea, button, select { font:inherit; color:inherit; background:#0b0d10; border:1px solid #1f242b; border-radius:8px; padding:.5rem .65rem }
    input:focus, textarea:focus { outline: 1px solid #7aa7ff }
    button { background:#1f3a52; border-color:#1f3a52; cursor:pointer; color:#e7eaee }
    button:hover { background:#2a4a68 }
    button.subtle { background:#121519; border-color:#1f242b; color:#aab2bd }
    button.subtle:hover { background:#1a1f25 }
    label { display:block; font-size:.8rem; color:#9aa4b1; margin-bottom:.25rem }
    .field { display:flex; flex-direction:column }
    .row { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap }
    code { background:#1a1f25; padding:.05rem .35rem; border-radius:5px; font-size:.85em }
    .runs { display:grid; gap:.4rem }
    .run { display:grid; grid-template-columns:auto 1fr auto; gap:.75rem; align-items:center; padding:.55rem .75rem; background:#121519; border:1px solid #1f242b; border-radius:10px }
    .run .id { color:#7e8794; font-family: ui-monospace, monospace; font-size:.8rem }
    .subtask-list { margin:.5rem 0 0 1rem; padding:0; color:#aab2bd; font-size:.9rem }
    .breadcrumb { color:#7e8794; font-size:.85rem; margin-bottom:.4rem }
    pre { background:#0b0d10; border:1px solid #1f242b; border-radius:8px; padding:.75rem; overflow:auto; font-size:.8rem }
  </style>
</head>
<body>
  <header>
    <h1>📎 Paperclip</h1>
    <div class="tag">Goal Command Centre · v0.1.0</div>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function renderGoalCard(g: GoalSummary): string {
  const status = STATUS_PILL[g.status] ?? "background:#1a1f25;color:#9aa4b1";
  return `
    <a class="card goal" href="/goals/${escape(g.id)}">
      <span class="pill" style="${status}">${escape(g.status)}</span>
      <div class="body">
        <div class="title">${escape(g.title)}</div>
        <div class="meta">
          ${g.department_name ? `Dept: ${escape(g.department_name)} · ` : ""}
          Updated ${escape(new Date(g.updated_at).toLocaleString())} ·
          ${g.run_count} run${g.run_count === 1 ? "" : "s"}
        </div>
      </div>
    </a>`;
}

type GoalSummary = {
  id: string;
  title: string;
  status: string;
  department_name: string | null;
  updated_at: string;
  run_count: number;
};

type GoalRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  department_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  goal_id: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export async function uiRoutes(app: FastifyInstance): Promise<void> {
  // -- home --------------------------------------------------------------
  app.get("/", async (_req, reply) => {
    reply.type("text/html");
    return shell("Goals", await renderHome());
  });

  // -- goal detail ------------------------------------------------------
  app.get<{ Params: { id: string } }>("/goals/:id", async (req, reply) => {
    reply.type("text/html");
    const html = await renderGoalDetail(req.params.id);
    if (!html) return reply.code(404).type("text/html").send(shell("Not found", `<p class="empty">Goal not found.</p><p><a href="/">← back</a></p>`));
    return shell("Goal", html);
  });

  // -- htmx fragments ---------------------------------------------------
  app.get<{ Params: { id: string } }>("/goals/:id/runs.fragment", async (req, reply) => {
    reply.type("text/html");
    return await renderRunsFragment(req.params.id);
  });

  app.get("/goals.fragment", async (_req, reply) => {
    reply.type("text/html");
    return await renderGoalsFragment();
  });
}

async function renderHome(): Promise<string> {
  const goals = await fetchGoalSummaries();
  return `
    <h2>Goals</h2>
    <p class="tag" style="color:#7e8794">Manage outcomes. The OS handles execution.</p>

    <h3>Create a goal</h3>
    <form class="inline" hx-post="/api/goals" hx-ext="json-enc-form" hx-on::after-request="this.reset(); document.getElementById('goalsList').dispatchEvent(new Event('refresh'))">
      <div class="field" style="flex:2; min-width:260px">
        <label>Title</label>
        <input name="title" required maxlength="200" placeholder="Reach 1,000 newsletter subscribers by July" />
      </div>
      <div class="field" style="flex:3; min-width:260px">
        <label>Description (optional)</label>
        <input name="description" maxlength="5000" placeholder="Why this matters, success criteria, deadlines…" />
      </div>
      <div class="field"><label>&nbsp;</label><button type="submit">Create</button></div>
    </form>
    <p class="tag" style="color:#7e8794;font-size:.8rem;margin-top:.4rem">
      Tip: the dashboard auto-refreshes every few seconds. Click a goal to plan it.
    </p>

    <h3>Active &amp; recent</h3>
    <div id="goalsList" class="grid"
         hx-get="/goals.fragment"
         hx-trigger="load, every 4s, refresh from:closest #goalsList">
      ${goals.length === 0 ? `<p class="empty">No goals yet — create one above.</p>` : goals.map(renderGoalCard).join("")}
    </div>

    <script>
      // Tiny inline ext: serialize forms as JSON for our /api endpoints.
      htmx.defineExtension('json-enc-form', {
        onEvent: function(name, evt) {
          if (name === 'htmx:configRequest') {
            const data = {};
            (new FormData(evt.detail.elt)).forEach((v, k) => { if (v !== "") data[k] = v });
            evt.detail.headers['Content-Type'] = 'application/json';
            evt.detail.parameters = {};
            evt.detail.body = JSON.stringify(data);
          }
        }
      });
    </script>
  `;
}

async function renderGoalsFragment(): Promise<string> {
  const goals = await fetchGoalSummaries();
  if (goals.length === 0) return `<p class="empty">No goals yet — create one above.</p>`;
  return goals.map(renderGoalCard).join("");
}

async function fetchGoalSummaries(): Promise<GoalSummary[]> {
  const scope = await resolveCallerScope();
  const { rows } = await query<{
    id: string;
    title: string;
    status: string;
    department_name: string | null;
    updated_at: string;
    run_count: string;
  }>(
    `
    SELECT g.id, g.title, g.status::text, d.name AS department_name, g.updated_at,
           (SELECT count(*) FROM ops.run r WHERE r.goal_id = g.id) AS run_count
    FROM ops.goal g
    LEFT JOIN core.department d ON d.id = g.department_id
    WHERE g.org_id = $1 AND g.status <> 'archived'
    ORDER BY g.updated_at DESC
    LIMIT 50
    `,
    [scope.org_id],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    department_name: r.department_name,
    updated_at: r.updated_at,
    run_count: Number(r.run_count),
  }));
}

async function renderGoalDetail(id: string): Promise<string | undefined> {
  const scope = await resolveCallerScope();
  const { rows } = await query<GoalRow>(
    "SELECT id, title, description, status, department_id, metadata, created_at, updated_at FROM ops.goal WHERE id = $1 AND org_id = $2",
    [id, scope.org_id],
  );
  if (rows.length === 0) return undefined;
  const goal = rows[0]!;
  const plan = (goal.metadata as { plan?: { subtasks: { index: number; title: string; description: string; agent_kind?: string }[] } } | null)
    ?.plan;
  const subtasks = plan?.subtasks ?? [];

  const planSection = subtasks.length === 0
    ? `<form class="inline" hx-post="/api/goals/${escape(goal.id)}/plan" hx-swap="none" hx-on::after-request="window.location.reload()">
         <button type="submit">Generate plan</button>
       </form>`
    : `<div class="card">
         <div class="row" style="justify-content:space-between;margin-bottom:.4rem">
           <strong>Plan (${subtasks.length} subtasks)</strong>
           <form hx-post="/api/goals/${escape(goal.id)}/dispatch-all" hx-swap="none"
                 hx-on::after-request="document.getElementById('runsList').dispatchEvent(new Event('refresh'))">
             <button type="submit">Run plan</button>
           </form>
         </div>
         <ol class="subtask-list">
           ${subtasks
             .map(
               (s) => `<li>
                 <strong>${escape(s.title)}</strong> ${renderKindPill(s.agent_kind)}
                 — ${escape(s.description)}
                 <form style="display:inline" hx-post="/api/goals/${escape(goal.id)}/dispatch" hx-ext="json-enc-form" hx-swap="none" hx-on::after-request="document.getElementById('runsList').dispatchEvent(new Event('refresh'))">
                   <input type="hidden" name="subtask_index" value="${s.index}" />
                   <button class="subtle" type="submit" style="margin-left:.5rem;font-size:.8rem;padding:.2rem .55rem">Dispatch</button>
                 </form>
               </li>`,
             )
             .join("")}
         </ol>
       </div>`;

  return `
    <p class="breadcrumb"><a href="/">← All goals</a></p>
    <div class="row" style="margin-bottom:.4rem">
      <span class="pill" style="${STATUS_PILL[goal.status] ?? ""}">${escape(goal.status)}</span>
      <h2 style="margin:0">${escape(goal.title)}</h2>
    </div>
    ${goal.description ? `<p style="color:#aab2bd">${escape(goal.description)}</p>` : ""}

    <h3>Plan</h3>
    ${planSection}

    <h3>Runs</h3>
    <div id="runsList" class="runs"
         hx-get="/goals/${escape(goal.id)}/runs.fragment"
         hx-trigger="load, every 2s, refresh from:closest #runsList">
      <p class="tag" style="color:#7e8794">Loading…</p>
    </div>

    <script>
      htmx.defineExtension('json-enc-form', {
        onEvent: function(name, evt) {
          if (name === 'htmx:configRequest') {
            const data = {};
            (new FormData(evt.detail.elt)).forEach((v, k) => { if (v !== "") data[k] = isNaN(v) ? v : Number(v) });
            evt.detail.headers['Content-Type'] = 'application/json';
            evt.detail.parameters = {};
            evt.detail.body = JSON.stringify(data);
          }
        }
      });
    </script>
  `;
}

async function renderRunsFragment(goalId: string): Promise<string> {
  const scope = await resolveCallerScope();
  const { rows } = await query<RunRow>(
    `SELECT r.id, r.goal_id, r.status::text, r.input, r.output, r.error, r.started_at, r.finished_at
     FROM ops.run r JOIN ops.goal g ON g.id = r.goal_id
     WHERE r.goal_id = $1 AND g.org_id = $2
     ORDER BY r.created_at DESC LIMIT 30`,
    [goalId, scope.org_id],
  );
  if (rows.length === 0) {
    return `<p class="empty">No runs yet — dispatch a subtask above.</p>`;
  }
  return rows
    .map((r) => {
      const subtask = (r.input as { subtask?: { title?: string } }).subtask;
      const title = subtask?.title ?? "(no title)";
      const cancelBtn = r.status === "queued" || r.status === "running"
        ? `<form hx-post="/api/runs/${escape(r.id)}/cancel" hx-swap="none">
             <button class="subtle" type="submit" style="font-size:.75rem;padding:.2rem .5rem">cancel</button>
           </form>`
        : "";
      return `<div class="run">
        <span class="pill" style="${RUN_STATUS_PILL[r.status] ?? ""}">${escape(r.status)}</span>
        <div>
          <div>${escape(title)}</div>
          <div class="id">${escape(r.id)}</div>
          ${r.error ? `<div style="color:#ff8a8a;font-size:.85rem">${escape(r.error)}</div>` : ""}
        </div>
        ${cancelBtn}
      </div>`;
    })
    .join("");
}
