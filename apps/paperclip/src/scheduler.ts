/**
 * Routine scheduler.
 *
 * Wakes every `schedulerTickMs`, finds active routine goals (kind=routine,
 * status in draft|active) whose cron_expr fires in the window since the last
 * tick, and dispatches a fresh run for each. The original routine row stays
 * alive so the next tick fires it again on schedule.
 *
 * v0 supports a constrained cron grammar (matches what the capture
 * classifier produces): `M H D MON DOW` where:
 *   - M  : exact minute (0–59) or *
 *   - H  : exact hour (0–23) or *
 *   - D  : * only (day-of-month not supported in v0)
 *   - MON: * only
 *   - DOW: exact day-of-week (0=Sunday … 6=Saturday) or *
 *
 * Examples that work:
 *   `0 9 * * 1`   Mondays at 9:00
 *   `0 8 * * *`   every day at 8:00
 *   `30 18 * * 5` Fridays at 18:30
 *   `0 * * * *`   every hour on the hour
 *
 * Anything richer (ranges, lists, slashes) is rejected with a warning and
 * the routine is skipped until the user fixes the expression.
 */

import { audit } from "./audit.js";
import { composeBriefing } from "./briefing.js";
import { config } from "./config.js";
import { query, tx } from "./db.js";
import { generatePlan } from "./plan.js";
import { fireRoutineFromTrigger, matchesEvent, type TriggerRow } from "./routines/triggers.js";
import type { Scope } from "./schemas.js";

type Logger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error: (err: unknown, msg: string) => void;
};

type RoutineRow = {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  cron_expr: string | null;
};

export type CronField = number | "*";
export type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dow: CronField;
};

export class CronParseError extends Error {}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(`expected 5 fields, got ${parts.length}: "${expr}"`);
  }
  const [m, h, d, mon, dow] = parts as [string, string, string, string, string];
  if (d !== "*" || mon !== "*") {
    throw new CronParseError(`day-of-month and month must be * in v0: "${expr}"`);
  }
  const parseField = (raw: string, lo: number, hi: number, name: string): CronField => {
    if (raw === "*") return "*";
    if (!/^\d+$/.test(raw)) throw new CronParseError(`${name} must be a single integer or *: "${raw}"`);
    const n = Number(raw);
    if (n < lo || n > hi) throw new CronParseError(`${name} out of range [${lo}, ${hi}]: ${n}`);
    return n;
  };
  return {
    minute: parseField(m, 0, 59, "minute"),
    hour:   parseField(h, 0, 23, "hour"),
    dow:    parseField(dow, 0, 6, "day-of-week"),
  };
}

/**
 * Has the cron expression fired in the (lastTick, now] interval?
 *
 * The expressions we accept fire at most once per minute boundary, so we walk
 * each minute boundary in the window and check whether all three fields
 * match. The window is normally a single tick (~60s) so this is cheap.
 */
export function firedInWindow(cron: ParsedCron, lastTick: Date, now: Date): boolean {
  // Walk minute boundaries strictly after lastTick, up to and including now.
  const start = new Date(lastTick);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  for (
    let t = start;
    t.getTime() <= now.getTime();
    t = new Date(t.getTime() + 60_000)
  ) {
    const min = t.getUTCMinutes();
    const hr = t.getUTCHours();
    const dow = t.getUTCDay();
    if (cron.minute !== "*" && cron.minute !== min) continue;
    if (cron.hour !== "*" && cron.hour !== hr) continue;
    if (cron.dow !== "*" && cron.dow !== dow) continue;
    return true;
  }
  return false;
}

/**
 * True when `hour:00 UTC` falls in (lastTick, now]. Used to fire the daily
 * briefing exactly once per UTC day. Idempotent at the DB level (the
 * briefing query skips orgs that already have today's briefing) so the
 * exact window doesn't have to be perfectly tight.
 */
export function briefingHourReached(lastTick: Date, now: Date, hourUtc: number): boolean {
  const start = new Date(lastTick);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  for (
    let t = start;
    t.getTime() <= now.getTime();
    t = new Date(t.getTime() + 60_000)
  ) {
    if (t.getUTCHours() === hourUtc && t.getUTCMinutes() === 0) return true;
  }
  return false;
}

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastTick: Date;

  constructor() {
    // First tick fires from "now" so we don't backfire historical schedules.
    this.lastTick = new Date();
  }

  start(log: Logger): void {
    if (this.running) return;
    this.running = true;
    log.info(`paperclip scheduler started (tick=${config.schedulerTickMs}ms)`);
    const loop = async (): Promise<void> => {
      if (!this.running) return;
      try {
        await this.tick(log);
      } catch (err) {
        log.error(err, "scheduler tick failed");
      } finally {
        if (this.running) {
          this.timer = setTimeout(loop, config.schedulerTickMs);
        }
      }
    };
    this.timer = setTimeout(loop, config.schedulerTickMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Exposed for tests. Single iteration. */
  async tick(log: Logger): Promise<number> {
    const now = new Date();
    const since = this.lastTick;
    this.lastTick = now;

    const { rows } = await query<RoutineRow>(
      `SELECT id, org_id, title, description, cron_expr
         FROM ops.goal
        WHERE kind = 'routine'
          AND status IN ('draft','active')
          AND cron_expr IS NOT NULL`,
    );

    let fired = 0;
    for (const r of rows) {
      let parsed: ParsedCron;
      try {
        parsed = parseCron(r.cron_expr!);
      } catch (err) {
        log.warn?.(`scheduler: skipping routine ${r.id} — bad cron "${r.cron_expr}": ${(err as Error).message}`);
        continue;
      }
      if (!firedInWindow(parsed, since, now)) continue;

      try {
        await this.fireRoutine(r, log);
        fired++;
      } catch (err) {
        log.error(err, `scheduler: failed to fire routine ${r.id}`);
      }
    }
    if (fired > 0) log.info(`scheduler: fired ${fired} routine${fired === 1 ? "" : "s"}`);

    // Daily briefing auto-fire — once per org per day, at the configured UTC
    // hour. Skips orgs that already have a daily briefing for today.
    if (briefingHourReached(since, now, config.briefingHourUtc)) {
      try {
        await this.generateMissingBriefings(log);
      } catch (err) {
        log.error(err, "scheduler: briefing auto-fire failed");
      }
    }

    // Event-triggered routines — scan audit_log entries created since the
    // last tick, match against enabled event triggers, fire matching ones.
    try {
      const eventFires = await this.fireEventTriggers(since, now, log);
      if (eventFires > 0) log.info(`scheduler: fired ${eventFires} event-triggered routine(s)`);
    } catch (err) {
      log.error(err, "scheduler: event-trigger pass failed");
    }

    return fired;
  }

  private async fireEventTriggers(since: Date, now: Date, log: Logger): Promise<number> {
    // 1. Pull audit entries created in (since, now]. These are the events
    //    that *might* match a trigger.
    const { rows: events } = await query<{
      id: string;
      org_id: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT id, org_id, action, target_type, target_id, metadata, created_at
         FROM core.audit_log
        WHERE created_at > $1 AND created_at <= $2
        ORDER BY created_at ASC
        LIMIT 500`,
      [since.toISOString(), now.toISOString()],
    );
    if (events.length === 0) return 0;

    // 2. Pull every enabled event trigger. At v0 scale (one operator) the
    //    set is tiny; we scan in-memory.
    const { rows: triggers } = await query<TriggerRow & { goal_org_id: string }>(
      `SELECT t.id, t.goal_id, t.trigger_kind, t.trigger_spec,
              t.enabled, t.last_fired_at, g.org_id AS goal_org_id
         FROM ops.routine_trigger t
         JOIN ops.goal g ON g.id = t.goal_id
        WHERE t.trigger_kind = 'event'
          AND t.enabled = true
          AND g.status IN ('draft','active')`,
    );
    if (triggers.length === 0) return 0;

    let fires = 0;
    for (const ev of events) {
      for (const tr of triggers) {
        // Same-org constraint: an event in org A can't trigger a routine in org B.
        if (ev.org_id && tr.goal_org_id && ev.org_id !== tr.goal_org_id) continue;
        if (!matchesEvent(tr.trigger_spec, ev)) continue;

        try {
          await tx(async (client) => {
            const r = await fireRoutineFromTrigger(client, tr, {
              cause_event_id: ev.id,
              cause_action: ev.action,
            });
            if (r.run_count > 0) fires++;
          });
        } catch (err) {
          log.error(err, `scheduler: event-trigger ${tr.id} failed for event ${ev.id}`);
        }
      }
    }
    return fires;
  }

  private async generateMissingBriefings(log: Logger): Promise<void> {
    // One briefing per org. Find orgs that have any goal/run/audit activity
    // (i.e. real users, not empty test orgs) and don't already have a daily
    // briefing today.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { rows } = await query<{ id: string }>(
      `SELECT DISTINCT o.id
         FROM core.organization o
        WHERE EXISTS (SELECT 1 FROM ops.goal g WHERE g.org_id = o.id)
          AND NOT EXISTS (
            SELECT 1 FROM ops.briefing b
             WHERE b.org_id = o.id
               AND b.kind = 'daily'
               AND b.generated_at >= $1
          )`,
      [todayStart.toISOString()],
    );

    for (const o of rows) {
      try {
        const composed = await composeBriefing(o.id, "daily");
        await tx(async (client) => {
          const { rows: brRows } = await client.query<{ id: string }>(
            `INSERT INTO ops.briefing (org_id, kind, period_start, period_end, summary_md, sources)
             VALUES ($1, 'daily'::ops.briefing_kind, $2, $3, $4, $5::jsonb)
             RETURNING id`,
            [o.id, composed.period_start, composed.period_end, composed.summary_md, JSON.stringify(composed.sources)],
          );
          const briefingId = brRows[0]!.id;
          const scope: Scope = { org_id: o.id, role: "owner" };
          await audit(
            {
              scope,
              action: "briefing.generate",
              target_type: "briefing",
              target_id: briefingId,
              metadata: { kind: "daily", source: "scheduler" },
            },
            client,
          );
        });
        log.info(`scheduler: generated daily briefing for org ${o.id}`);
      } catch (err) {
        log.error(err, `scheduler: briefing generation failed for org ${o.id}`);
      }
    }
  }

  private async fireRoutine(r: RoutineRow, log: Logger): Promise<void> {
    const subtasks = generatePlan({ title: r.title, description: r.description });
    const scope: Scope = { org_id: r.org_id, role: "owner" };

    await tx(async (client) => {
      // Bump original routine to active on first fire.
      await client.query(
        `UPDATE ops.goal
            SET status = CASE WHEN status = 'draft' THEN 'active'::ops.goal_status ELSE status END,
                updated_at = now()
          WHERE id = $1`,
        [r.id],
      );
      // Each fire becomes one run per subtask, just like POST /goals/:id/dispatch-all.
      // We attach the runs directly to the routine goal — no child goal — so the
      // routine accumulates a heartbeat over time.
      for (const st of subtasks) {
        const { rows: runRows } = await client.query<{ id: string }>(
          `INSERT INTO ops.run (goal_id, status, input)
           VALUES ($1, 'queued', $2::jsonb) RETURNING id`,
          [r.id, JSON.stringify({ subtask: st, source: "scheduler" })],
        );
        const runId = runRows[0]!.id;
        await audit(
          {
            scope,
            action: "run.dispatch",
            target_type: "run",
            target_id: runId,
            metadata: { goal_id: r.id, subtask_index: st.index, source: "scheduler" },
          },
          client,
        );
      }
    });
    log.info(`scheduler: fired routine "${r.title}" (${subtasks.length} subtasks)`);
  }
}

export const scheduler = new Scheduler();
