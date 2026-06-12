/**
 * Tiny Telegram Bot API client. Just the two endpoints we use:
 *
 *   - sendMessage(chat_id, text)  → bot replies in the chat
 *   - setWebhook(url, secret)     → register our paperclip webhook
 *   - getMe()                     → sanity check the token
 *
 * No third-party dep. Telegram's API is plain HTTPS + JSON.
 *
 * Reads the bot token from `process.env.TELEGRAM_BOT_TOKEN`. Throws
 * `TelegramConfigError` if unset — every public route handler should
 * 503 with a clear hint instead of hitting a 500.
 *
 * Docs: https://core.telegram.org/bots/api
 */

const TELEGRAM_BASE = "https://api.telegram.org";

export class TelegramConfigError extends Error {
  constructor(message = "TELEGRAM_BOT_TOKEN is not set") {
    super(message);
    this.name = "TelegramConfigError";
  }
}

export class TelegramApiError extends Error {
  status: number;
  description: string | null;
  constructor(status: number, description: string | null, message: string) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
    this.description = description;
  }
}

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new TelegramConfigError();
  return t;
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${TELEGRAM_BASE}/bot${botToken()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  let parsed: { ok?: boolean; result?: T; description?: string } = {};
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    throw new TelegramApiError(res.status, null, `Telegram ${method} returned non-JSON (HTTP ${res.status})`);
  }
  if (!parsed.ok) {
    throw new TelegramApiError(
      res.status,
      parsed.description ?? null,
      `Telegram ${method} failed: ${parsed.description ?? `HTTP ${res.status}`}`,
    );
  }
  return parsed.result as T;
}

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramSendResult = {
  message_id: number;
  chat: { id: number };
  date: number;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
};

export async function getMe(): Promise<TelegramUser> {
  return call<TelegramUser>("getMe");
}

/**
 * Send a plain-text message. Telegram caps text at 4096 chars; we slice
 * silently here so a chatty agent doesn't get a 400 from Telegram.
 */
export async function sendMessage(
  chatId: number,
  text: string,
  opts?: { reply_to_message_id?: number; parse_mode?: "Markdown" | "MarkdownV2" | "HTML" },
): Promise<TelegramSendResult> {
  return call<TelegramSendResult>("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    ...(opts?.reply_to_message_id ? { reply_to_message_id: opts.reply_to_message_id } : {}),
    ...(opts?.parse_mode ? { parse_mode: opts.parse_mode } : {}),
  });
}

/**
 * Register our paperclip webhook with Telegram. The `secret_token` lands
 * back in the `X-Telegram-Bot-Api-Secret-Token` header on every inbound
 * request — our route compares it to verify the call is genuine.
 */
export async function setWebhook(opts: {
  url: string;
  secret_token: string;
  drop_pending?: boolean;
}): Promise<true> {
  await call("setWebhook", {
    url: opts.url,
    secret_token: opts.secret_token,
    allowed_updates: ["message"],
    ...(opts.drop_pending ? { drop_pending_updates: true } : {}),
  });
  return true;
}

export async function deleteWebhook(): Promise<true> {
  await call("deleteWebhook", {});
  return true;
}

/**
 * Show "typing…" in the chat. Telegram refreshes the indicator on every
 * call and auto-clears after ~5s, so we send it immediately after queuing
 * the agent run to give the user instant feedback.
 *
 * Best-effort — failures are swallowed by the caller.
 */
export async function sendChatAction(
  chatId: number,
  action: "typing" | "upload_photo" | "record_voice" = "typing",
): Promise<true> {
  await call("sendChatAction", { chat_id: chatId, action });
  return true;
}

export async function getWebhookInfo(): Promise<TelegramWebhookInfo> {
  return call<TelegramWebhookInfo>("getWebhookInfo");
}
