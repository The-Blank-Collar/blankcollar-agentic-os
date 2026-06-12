/**
 * Channel reply cascade.
 *
 * When a worker run reaches a terminal state, we check whether the run's
 * goal originated from an external channel (Telegram today; Slack /
 * WhatsApp later). If so, we send the run's output back to that channel.
 *
 * This is intentionally a best-effort path — channel send failures must
 * never roll back the run, since the run itself succeeded. The audit log
 * captures the send attempt either way.
 */

import type { PoolClient } from "pg";

import { sendMessage as tgSendMessage, TelegramApiError } from "../telegram/client.js";

type GoalRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type TelegramOrigin = {
  chat_id: number;
  message_id?: number;
};

type Logger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (err: unknown, msg: string) => void;
};

function readTelegramOrigin(meta: Record<string, unknown> | null): TelegramOrigin | null {
  if (!meta) return null;
  const tg = (meta as { telegram?: unknown }).telegram;
  if (!tg || typeof tg !== "object") return null;
  const chatId = (tg as { chat_id?: unknown }).chat_id;
  if (typeof chatId !== "number") return null;
  const messageId = (tg as { message_id?: unknown }).message_id;
  return {
    chat_id: chatId,
    ...(typeof messageId === "number" ? { message_id: messageId } : {}),
  };
}

function pickReplyText(output: Record<string, unknown> | null): string {
  if (!output) return "(no reply generated)";
  const summary = (output as { summary?: unknown }).summary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    return summary.trim();
  }
  // Fallback: try `text` or `message`. Some adapters use those names.
  const text = (output as { text?: unknown; message?: unknown }).text
    ?? (output as { message?: unknown }).message;
  if (typeof text === "string" && text.trim().length > 0) {
    return text.trim();
  }
  return "(no reply generated)";
}

export async function replyToChannelOnTerminal(
  client: PoolClient,
  goalId: string,
  status: "succeeded" | "failed",
  output: Record<string, unknown> | null,
  error: string | null,
  log: Logger = {},
): Promise<void> {
  const { rows } = await client.query<GoalRow>(
    "SELECT id, metadata FROM ops.goal WHERE id = $1",
    [goalId],
  );
  const goal = rows[0];
  if (!goal) return;
  const origin = readTelegramOrigin(goal.metadata);
  if (!origin) return;

  const text = status === "succeeded"
    ? pickReplyText(output)
    : `⚠️ ${error ?? "Brain unavailable right now."}`;

  try {
    await tgSendMessage(
      origin.chat_id,
      text,
      origin.message_id ? { reply_to_message_id: origin.message_id } : undefined,
    );
  } catch (err) {
    const detail = err instanceof TelegramApiError
      ? `${err.status} ${err.description ?? err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    log.warn?.(`telegram reply for goal ${goalId} failed: ${detail}`);
  }
}
