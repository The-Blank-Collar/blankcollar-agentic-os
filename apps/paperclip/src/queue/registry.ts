/**
 * Maps an agent `kind` to its in-cluster URL.
 *
 * Phase 3: hardcoded for the two shipping kinds. Phase 5+ will let users
 * register custom adapters via `ops.agent.config.url`.
 */

import { AdapterClient } from "./adapter-client.js";

const ENV = process.env;

const URLS: Record<string, string> = {
  hermes: ENV.HERMES_URL ?? "http://hermes:80",
  openclaw: ENV.OPENCLAW_URL ?? "http://openclaw:80",
  // LangGraph dispatcher — speaks the same adapter contract; routes
  // internally to hermes / openclaw. Use kind="langgraph" on a subtask
  // when you want the multi-agent dispatcher to decide.
  langgraph: ENV.LANGGRAPH_URL ?? "http://langgraph:80",
};

const cache = new Map<string, AdapterClient>();

export function getAdapter(kind: string): AdapterClient | undefined {
  const url = URLS[kind];
  if (!url) return undefined;
  let client = cache.get(kind);
  if (!client) {
    client = new AdapterClient(url);
    cache.set(kind, client);
  }
  return client;
}

export function knownKinds(): string[] {
  return Object.keys(URLS);
}
