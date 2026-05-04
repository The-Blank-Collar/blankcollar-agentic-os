/**
 * Transactional email — Phase 8.4.
 *
 * One module, multiple providers. The default is `console` (logs the
 * email to the paperclip log instead of sending) so OSS local installs
 * + tests don't need an API key. Hosted deployments set
 * `MAIL_PROVIDER=resend` (or `postmark`, `ses`) and the matching key.
 *
 *   send(letter)     fire-and-forget; returns id or null on failure
 *
 * `letter` is provider-agnostic — to/from/subject/text/html. Templates
 * live in `templates.ts` so the routes don't pile up with HTML.
 */

import { config } from "../config.js";

export type MailLetter = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Override the default reply-to. */
  reply_to?: string;
};

export type MailResult = {
  id: string | null;
  provider: "console" | "resend" | "postmark";
  delivered: boolean;
  error?: string;
};

type Provider = (letter: MailLetter) => Promise<MailResult>;

function fromAddress(): string {
  return config.mailFrom || "Blank Collar <noreply@blankcollar.ai>";
}

const consoleProvider: Provider = async (letter) => {
  // eslint-disable-next-line no-console
  console.log(
    `[mail/console] from=${fromAddress()} to=${letter.to} subject=${JSON.stringify(letter.subject)}\n` +
      `--- text ---\n${letter.text}\n--- end ---`,
  );
  return { id: null, provider: "console", delivered: true };
};

const resendProvider: Provider = async (letter) => {
  if (!config.mailApiKey) {
    return { id: null, provider: "resend", delivered: false, error: "MAIL_API_KEY not set" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.mailApiKey}`,
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [letter.to],
        subject: letter.subject,
        text: letter.text,
        ...(letter.html ? { html: letter.html } : {}),
        ...(letter.reply_to ? { reply_to: letter.reply_to } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        id: null,
        provider: "resend",
        delivered: false,
        error: `HTTP ${res.status}: ${body.slice(0, 240)}`,
      };
    }
    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? null, provider: "resend", delivered: true };
  } catch (err) {
    return {
      id: null,
      provider: "resend",
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const postmarkProvider: Provider = async (letter) => {
  if (!config.mailApiKey) {
    return { id: null, provider: "postmark", delivered: false, error: "MAIL_API_KEY not set" };
  }
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": config.mailApiKey,
      },
      body: JSON.stringify({
        From: fromAddress(),
        To: letter.to,
        Subject: letter.subject,
        TextBody: letter.text,
        ...(letter.html ? { HtmlBody: letter.html } : {}),
        ...(letter.reply_to ? { ReplyTo: letter.reply_to } : {}),
        MessageStream: "outbound",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        id: null,
        provider: "postmark",
        delivered: false,
        error: `HTTP ${res.status}: ${body.slice(0, 240)}`,
      };
    }
    const json = (await res.json()) as { MessageID?: string };
    return { id: json.MessageID ?? null, provider: "postmark", delivered: true };
  } catch (err) {
    return {
      id: null,
      provider: "postmark",
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

function resolveProvider(): Provider {
  switch ((config.mailProvider || "console").toLowerCase()) {
    case "resend":   return resendProvider;
    case "postmark": return postmarkProvider;
    default:         return consoleProvider;
  }
}

export async function send(letter: MailLetter): Promise<MailResult> {
  if (!letter.to || !letter.to.includes("@")) {
    return { id: null, provider: "console", delivered: false, error: "invalid_recipient" };
  }
  const provider = resolveProvider();
  return provider(letter);
}
