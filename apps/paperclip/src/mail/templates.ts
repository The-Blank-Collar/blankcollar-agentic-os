/**
 * Mail templates — text-first, HTML optional.
 *
 * Each function returns a fully-rendered { subject, text, html } so the
 * caller can drop it straight into mail.send().
 */

const APP_URL = (process.env.WEBSITE_PUBLIC_URL?.split(",")[0] ?? "http://localhost:3000")
  .replace(/\/+$/, "");

export function welcome(args: {
  email: string;
  full_name?: string | null;
  org_name: string;
}): { subject: string; text: string; html: string } {
  const greeting = args.full_name?.trim() ? `Hi ${args.full_name.split(" ")[0]},` : "Hi,";
  const text = [
    greeting,
    "",
    `Welcome to Blank Collar — your studio "${args.org_name}" is set up and ready.`,
    "",
    "Three things you can try right now:",
    "  1. Open the dashboard and read today's briefing.",
    "  2. Hit ⌘K and capture your first goal — try a real intent like",
    `     "Remind me to call Mira on Friday" or "Every Monday at 9, generate the weekly digest".`,
    "  3. Walk through the onboarding wizard if you skipped it — Settings → Onboarding.",
    "",
    `→ ${APP_URL}`,
    "",
    "— The Blank Collar",
  ].join("\n");
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system; max-width: 520px; line-height: 1.5; color: #111;">
      <p>${greeting}</p>
      <p>Welcome to Blank Collar — your studio <b>${escapeHtml(args.org_name)}</b> is set up and ready.</p>
      <p>Three things you can try right now:</p>
      <ol>
        <li>Open the dashboard and read today's briefing.</li>
        <li>Hit ⌘K and capture your first goal — try a real intent like
          <em>"Remind me to call Mira on Friday"</em> or
          <em>"Every Monday at 9, generate the weekly digest"</em>.</li>
        <li>Walk through the onboarding wizard if you skipped it — Settings → Onboarding.</li>
      </ol>
      <p><a href="${APP_URL}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Open the dashboard</a></p>
      <p style="color: #666; font-size: 13px;">— The Blank Collar</p>
    </div>
  `.trim();
  return {
    subject: `Welcome to Blank Collar — ${args.org_name}`,
    text,
    html,
  };
}

export function invitation(args: {
  email: string;
  inviter_name?: string | null;
  org_name: string;
  role: string;
  invite_url: string;
  expires_at: string;
}): { subject: string; text: string; html: string } {
  const inviter = args.inviter_name?.trim() || "Someone at " + args.org_name;
  const expiresFmt = new Date(args.expires_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const subject = `${inviter} invited you to ${args.org_name}`;
  const text = [
    `${inviter} invited you to join "${args.org_name}" on Blank Collar as a ${args.role}.`,
    "",
    `Accept the invitation: ${args.invite_url}`,
    "",
    `The link expires on ${expiresFmt}. If you weren't expecting this, you can safely ignore.`,
  ].join("\n");
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system; max-width: 520px; line-height: 1.5; color: #111;">
      <p><b>${escapeHtml(inviter)}</b> invited you to join
        <b>${escapeHtml(args.org_name)}</b> on Blank Collar as a <code>${escapeHtml(args.role)}</code>.</p>
      <p><a href="${args.invite_url}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Accept invitation</a></p>
      <p style="color: #666; font-size: 13px;">The link expires on <b>${escapeHtml(expiresFmt)}</b>.<br/>
        If you weren't expecting this, you can safely ignore.</p>
    </div>
  `.trim();
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
    : c === "<" ? "&lt;"
    : c === ">" ? "&gt;"
    : c === "\"" ? "&quot;"
    : "&#39;",
  );
}
