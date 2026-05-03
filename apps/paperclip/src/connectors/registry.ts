/**
 * Connector provider registry.
 *
 * Adding a provider:
 *   1. Implement `ConnectorProvider` in `./<provider>.ts`.
 *   2. Register here.
 *
 * The framework is intentionally tiny — no plugin loading, no dynamic
 * import. Adding a provider is a code change, which is what we want at
 * this maturity (the operator surface is the configuration, not the
 * provider list).
 */

import type { ConnectorProvider, ProviderKey } from "./types.js";

import { gdriveProvider } from "./providers/gdrive.js";
import { hubspotProvider } from "./providers/hubspot.js";
import { manualPasteProvider } from "./providers/manual_paste.js";
import { notionProvider } from "./providers/notion.js";
import { slackProvider } from "./providers/slack.js";
import { urlPollProvider } from "./providers/url_poll.js";
import { zoomProvider } from "./providers/zoom.js";

const PROVIDERS: Record<ProviderKey, ConnectorProvider> = {
  manual_paste: manualPasteProvider,
  url_poll: urlPollProvider,
  slack: slackProvider,
  gdrive: gdriveProvider,
  zoom: zoomProvider,
  hubspot: hubspotProvider,
  notion: notionProvider,
};

export function getProvider(key: string): ConnectorProvider | null {
  return (PROVIDERS as Record<string, ConnectorProvider | undefined>)[key] ?? null;
}

export function listProviders(): ConnectorProvider[] {
  return Object.values(PROVIDERS);
}
