import { createInterface } from "node:readline/promises";

import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit } from "../format.js";

type StartResp = {
  profile_id: string;
  mode: "single_user" | "multi_user";
  track: "company" | "individual";
  questions: Array<{ id: string; prompt: string; hint?: string }>;
};

/**
 * Walks the interview interactively.
 *
 * --mode=single_user (default) | multi_user
 * --user-email=... --user-name=...
 * --json   prints the start response and exits without walking
 */
export async function runOnboard(args: ParsedArgs, client: Client): Promise<number> {
  const mode = flagString(args.flags, "mode", "single_user") as "single_user" | "multi_user";
  const userEmail = typeof args.flags["user-email"] === "string" ? args.flags["user-email"] : undefined;
  const userName = typeof args.flags["user-name"] === "string" ? args.flags["user-name"] : undefined;

  const start = await client.post<StartResp>("/api/onboarding/start", {
    mode,
    user_email: userEmail,
    user_name: userName,
  });

  if (detectMode(args.flags) === "json") {
    emit("json", start);
    return 0;
  }

  emit("pretty", `${mode} onboarding · ${start.questions.length} question${start.questions.length === 1 ? "" : "s"}\nprofile_id ${start.profile_id}`);
  if (!process.stdin.isTTY) {
    emit("pretty", "(non-interactive stdin — re-run with --json to capture profile_id and answer programmatically)");
    return 0;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const q of start.questions) {
      const hint = q.hint ? ` (${q.hint})` : "";
      const answer = (await rl.question(`\n${q.prompt}${hint}\n> `)).trim();
      if (answer.length === 0) continue;
      await client.post(`/api/onboarding/answer?profile_id=${start.profile_id}`, {
        question_id: q.id,
        answer,
      });
    }
  } finally {
    rl.close();
  }

  const finished = await client.post<{ derived: Record<string, unknown>; routines_created: number }>(
    `/api/onboarding/finish?profile_id=${start.profile_id}`,
  );
  emit(
    "pretty",
    `\nonboarding complete.\n  routines created: ${finished.routines_created}\n  voice/decisions doc seeded with hot=true\n`,
  );
  return 0;
}
