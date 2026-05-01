/**
 * Onboarding API.
 *
 *   POST /api/onboarding/start             begin or resume a profile
 *   GET  /api/onboarding/questions         next batch of questions for the caller
 *   POST /api/onboarding/answer            store one answer; returns the next question
 *   POST /api/onboarding/finish            apply derived config (auto-create routines,
 *                                          knowledge docs, agent config patches)
 *   GET  /api/onboarding/profile           the current profile + derived config
 *
 * Mode-aware: single_user gets the 7-question personal interview; multi_user
 * gets a company track and an individual track per teammate. The same
 * `ops.onboarding_profile` row backs both — the `mode` column distinguishes.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { deriveFromAnswers } from "../onboarding/derive.js";
import { questionsFor } from "../onboarding/questions.js";
import { resolveCallerScope } from "../scope.js";
import { OnboardingAnswer, OnboardingStart } from "../schemas.js";

type ProfileRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  mode: "single_user" | "multi_user";
  answers: { question_id: string; question: string; answer: string; asked_at: string }[];
  derived: Record<string, unknown>;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const PROFILE_COLUMNS = "id, org_id, user_id, mode, answers, derived, completed_at, created_at, updated_at";

async function findOrCreateProfile(
  orgId: string,
  userId: string | null,
  mode: "single_user" | "multi_user",
): Promise<ProfileRow> {
  return withOrgScope(orgId, async (client) => {
    const { rows: existing } = await client.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS}
         FROM ops.onboarding_profile
        WHERE org_id = $1
          AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        LIMIT 1`,
      [orgId, userId],
    );
    if (existing.length > 0) return existing[0]!;

    const { rows } = await client.query<ProfileRow>(
      `INSERT INTO ops.onboarding_profile (org_id, user_id, mode)
       VALUES ($1, $2, $3::ops.onboarding_mode)
       RETURNING ${PROFILE_COLUMNS}`,
      [orgId, userId, mode],
    );
    return rows[0]!;
  });
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // -- start --------------------------------------------------------------
  app.post("/api/onboarding/start", async (req, reply) => {
    const parsed = OnboardingStart.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);

    let userId: string | null = null;
    if (parsed.data.user_email) {
      userId = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO core.user_account (org_id, email, display_name, is_active)
           VALUES ($1, $2, $3, true)
           ON CONFLICT (email) DO UPDATE
              SET display_name = COALESCE(EXCLUDED.display_name, core.user_account.display_name),
                  is_active = true
           RETURNING id`,
          [scope.org_id, parsed.data.user_email, parsed.data.user_name ?? null],
        );
        return rows[0]!.id;
      });
    }

    // For multi_user mode, the company track has user_id NULL; the per-user
    // track has user_id set. Single_user mode collapses to one profile per
    // org with user_id = the lone user (or NULL when no email yet).
    const profile = await findOrCreateProfile(scope.org_id, userId, parsed.data.mode);
    const track =
      parsed.data.mode === "multi_user" && userId === null ? "company" : "individual";

    return reply.code(201).send({
      profile_id: profile.id,
      mode: profile.mode,
      track,
      questions: questionsFor(parsed.data.mode, track),
      answered: profile.answers.length,
    });
  });

  // -- next questions -----------------------------------------------------
  app.get<{ Querystring: { profile_id?: string } }>("/api/onboarding/questions", async (req, reply) => {
    const profileId = req.query.profile_id;
    if (!profileId) return reply.code(400).send({ error: "missing_profile_id" });
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM ops.onboarding_profile WHERE id = $1 AND org_id = $2`,
        [profileId, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    const profile = rows[0]!;
    const track =
      profile.mode === "multi_user" && profile.user_id === null ? "company" : "individual";
    const all = questionsFor(profile.mode, track);
    const answeredIds = new Set(profile.answers.map((a) => a.question_id));
    const remaining = all.filter((q) => !answeredIds.has(q.id));
    return {
      profile_id: profile.id,
      mode: profile.mode,
      track,
      total: all.length,
      answered: profile.answers.length,
      next: remaining[0] ?? null,
      remaining,
    };
  });

  // -- answer -------------------------------------------------------------
  app.post<{ Querystring: { profile_id?: string } }>("/api/onboarding/answer", async (req, reply) => {
    const parsed = OnboardingAnswer.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const profileId = req.query.profile_id;
    if (!profileId) return reply.code(400).send({ error: "missing_profile_id" });
    const scope = await resolveCallerScope(req);

    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows: existing } = await client.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM ops.onboarding_profile
          WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [profileId, scope.org_id],
      );
      if (existing.length === 0) return { kind: "not_found" as const };
      const profile = existing[0]!;

      const track =
        profile.mode === "multi_user" && profile.user_id === null ? "company" : "individual";
      const allQuestions = questionsFor(profile.mode, track);
      const q = allQuestions.find((x) => x.id === parsed.data.question_id);
      if (!q) return { kind: "unknown_question" as const };

      const newAnswer = {
        question_id: q.id,
        question: q.prompt,
        answer: parsed.data.answer,
        asked_at: new Date().toISOString(),
      };
      const filtered = profile.answers.filter((a) => a.question_id !== q.id);
      const next = [...filtered, newAnswer];

      const { rows } = await client.query<ProfileRow>(
        `UPDATE ops.onboarding_profile
            SET answers    = $2::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING ${PROFILE_COLUMNS}`,
        [profileId, JSON.stringify(next)],
      );
      await audit(
        {
          scope,
          action: "onboarding.answer",
          target_type: "onboarding_profile",
          target_id: profileId,
          metadata: { question_id: q.id },
        },
        client,
      );
      return { kind: "ok" as const, profile: rows[0]! };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "unknown_question") return reply.code(400).send({ error: "unknown_question" });
    return result.profile;
  });

  // -- finish (apply derived config) --------------------------------------
  app.post<{ Querystring: { profile_id?: string } }>("/api/onboarding/finish", async (req, reply) => {
    const profileId = req.query.profile_id;
    if (!profileId) return reply.code(400).send({ error: "missing_profile_id" });
    const scope = await resolveCallerScope(req);

    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows: existing } = await client.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM ops.onboarding_profile
          WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [profileId, scope.org_id],
      );
      if (existing.length === 0) return { kind: "not_found" as const };
      const profile = existing[0]!;

      const derived = deriveFromAnswers(profile.answers, profile.mode);

      // Materialise the routine hints into draft routine goals. The user
      // can edit/enable them before the scheduler picks them up.
      let routinesCreated = 0;
      for (const hint of derived.routine_hints.slice(0, 5)) {
        const title = `Recurring: ${hint}`;
        const cron = hint.includes("daily") || hint.includes("every day")
          ? "0 8 * * *"
          : hint.includes("weekly") || hint.includes("every monday")
            ? "0 9 * * 1"
            : null;
        await client.query(
          `INSERT INTO ops.goal (org_id, title, kind, cron_expr, status, metadata)
           VALUES ($1, $2, 'routine'::ops.goal_kind, $3, 'draft'::ops.goal_status, $4::jsonb)
           ON CONFLICT DO NOTHING`,
          [scope.org_id, title, cron, JSON.stringify({ source: "onboarding", hint })],
        );
        routinesCreated++;
      }

      // Drop a "voice & decisions" knowledge doc so Hermes & briefings can
      // recall the user's stated preferences.
      const slug =
        profile.mode === "multi_user" && profile.user_id === null
          ? "company-voice"
          : profile.user_id
            ? `voice-${profile.user_id.slice(0, 8)}`
            : "personal-voice";
      const docMd = renderVoiceDoc(profile.mode, derived);
      await client.query(
        `INSERT INTO ops.knowledge_doc (org_id, user_id, slug, title, scope, hot, content_md, tags)
         VALUES ($1, $2, $3, $4, $5::ops.knowledge_scope, true, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          scope.org_id,
          profile.user_id,
          slug,
          profile.mode === "multi_user" && profile.user_id === null
            ? "Company voice & governance"
            : "Personal voice & decisions",
          profile.mode === "multi_user" && profile.user_id === null ? "company" : "personal",
          docMd,
          ["voice", "onboarding", "hot-context"],
        ],
      );

      const { rows } = await client.query<ProfileRow>(
        `UPDATE ops.onboarding_profile
            SET derived      = $2::jsonb,
                completed_at = now(),
                updated_at   = now()
          WHERE id = $1
          RETURNING ${PROFILE_COLUMNS}`,
        [profileId, JSON.stringify(derived)],
      );
      await audit(
        {
          scope,
          action: "onboarding.finish",
          target_type: "onboarding_profile",
          target_id: profileId,
          metadata: { routines_created: routinesCreated, mode: profile.mode },
        },
        client,
      );
      return { kind: "ok" as const, profile: rows[0]!, derived, routines_created: routinesCreated };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    return reply.code(201).send({
      profile: result.profile,
      derived: result.derived,
      routines_created: result.routines_created,
    });
  });

  // -- get profile --------------------------------------------------------
  app.get<{ Querystring: { profile_id?: string } }>("/api/onboarding/profile", async (req, reply) => {
    const profileId = req.query.profile_id;
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = profileId
        ? await client.query<ProfileRow>(
            `SELECT ${PROFILE_COLUMNS} FROM ops.onboarding_profile WHERE id = $1 AND org_id = $2`,
            [profileId, scope.org_id],
          )
        : await client.query<ProfileRow>(
            `SELECT ${PROFILE_COLUMNS} FROM ops.onboarding_profile
              WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [scope.org_id],
          );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });
}

function renderVoiceDoc(
  mode: "single_user" | "multi_user",
  d: ReturnType<typeof deriveFromAnswers>,
): string {
  const lines: string[] = [];
  lines.push(`# ${mode === "multi_user" ? "Company" : "Personal"} voice & governance`, "");
  if (d.voice_words.length > 0) {
    lines.push(`**Voice:** ${d.voice_words.join(", ")}`, "");
  }
  if (d.banned_words.length > 0) {
    lines.push(`**Banned words:** ${d.banned_words.join(", ")}`, "");
  }
  if (d.decision_categories.length > 0) {
    lines.push(
      "**Decisions that always need approval:**",
      ...d.decision_categories.map((c) => `- ${c}`),
      "",
    );
  }
  if (d.channels.length > 0) {
    lines.push(`**Active channels:** ${d.channels.join(", ")}`, "");
  }
  if (d.routine_hints.length > 0) {
    lines.push(`**Cadence cues from onboarding:** ${d.routine_hints.join(", ")}`, "");
  }
  if (d.briefing_hour_utc !== undefined) {
    lines.push(`**Preferred briefing hour (UTC):** ${d.briefing_hour_utc}`, "");
  }
  return lines.join("\n");
}
