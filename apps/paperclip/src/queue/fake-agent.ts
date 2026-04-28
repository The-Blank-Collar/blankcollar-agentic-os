/**
 * Built-in fake agent. Until Phase 3 brings real Hermes / OpenClaw, every
 * dispatched run goes through this. It demonstrates the L1↔L4 wiring by
 * writing an `episode` memory to gbrain on success.
 */

import { config } from "../config.js";
import type { Scope } from "../schemas.js";

export type FakeAgentInput = {
  scope: Scope;
  goal_id: string;
  run_id: string;
  subtask: {
    index: number;
    title: string;
    description: string;
    input: Record<string, unknown>;
  };
};

export type FakeAgentResult = {
  output: Record<string, unknown>;
  memory_id?: string;
};

export async function runFakeAgent(input: FakeAgentInput): Promise<FakeAgentResult> {
  const { scope, goal_id, run_id, subtask } = input;

  // Tiny "thinking" delay so users can watch the dashboard transition.
  await new Promise((r) => setTimeout(r, 500));

  const summary = `Fake agent completed subtask ${subtask.index}: "${subtask.title}". ` +
    `Goal ${goal_id}; run ${run_id}.`;

  // Write an episode memory through gbrain so the wiring is visible.
  let memoryId: string | undefined;
  try {
    const res = await fetch(`${config.gbrainUrl}/remember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "episode",
        title: `Subtask ${subtask.index} done — ${subtask.title}`,
        content: summary,
        scope: { ...scope, goal_id },
        metadata: {
          run_id,
          subtask_index: subtask.index,
          source: "paperclip.fake-agent",
        },
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { memory_id?: string };
      memoryId = body.memory_id;
    } else {
      // Non-fatal: gbrain might be temporarily unavailable.
      // The run still succeeds.
    }
  } catch {
    // gbrain unreachable — keep the run succeeding so the dashboard doesn't lie about why.
  }

  return {
    output: {
      summary,
      subtask_index: subtask.index,
      remembered: Boolean(memoryId),
    },
    ...(memoryId ? { memory_id: memoryId } : {}),
  };
}
