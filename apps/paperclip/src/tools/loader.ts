/**
 * Tool manifest loader — mirrors `skills/loader.ts` for the MCP tool
 * registry. YAML on disk is the source of truth.
 *
 * Resolution order:
 *   1. PAPERCLIP_TOOLS_DIR env var (absolute path, for tests/overrides)
 *   2. /app/packages/tools/manifests inside the container
 *   3. ../../packages/tools/manifests relative to CWD
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";

import { type SkillScope, ToolManifest } from "../schemas.js";

export type LoadedTool = ToolManifest & {
  manifest_path: string;
  scope: SkillScope;
};

function candidateDirs(): string[] {
  return [
    process.env.PAPERCLIP_TOOLS_DIR,
    "/app/packages/tools/manifests",
    path.resolve(process.cwd(), "packages/tools/manifests"),
    path.resolve(process.cwd(), "../../packages/tools/manifests"),
  ].filter((p): p is string => Boolean(p));
}

async function resolveToolsRoot(): Promise<string | null> {
  for (const dir of candidateDirs()) {
    try {
      const entries = await readdir(dir);
      if (entries.length > 0) return dir;
    } catch {
      // try next
    }
  }
  return null;
}

async function readManifestsForScope(rootDir: string, scopeDir: SkillScope): Promise<LoadedTool[]> {
  const dir = path.join(rootDir, scopeDir);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    return [];
  }
  const out: LoadedTool[] = [];
  for (const f of files) {
    const fullPath = path.join(dir, f);
    try {
      const raw = await readFile(fullPath, "utf8");
      const parsed = yaml.load(raw);
      const validated = ToolManifest.safeParse(parsed);
      if (!validated.success) {
        console.warn(`[tools] manifest ${fullPath} failed validation:`, validated.error.flatten());
        continue;
      }
      out.push({ ...validated.data, manifest_path: fullPath });
    } catch (err) {
      console.warn(`[tools] failed to read ${fullPath}:`, (err as Error).message);
    }
  }
  return out;
}

export async function loadToolManifests(log: {
  info: (m: string) => void;
  warn?: (m: string) => void;
}): Promise<LoadedTool[]> {
  const root = await resolveToolsRoot();
  if (!root) {
    log.warn?.("[tools] no manifests directory found — registry will be empty");
    return [];
  }
  const [shared, company, personal] = await Promise.all([
    readManifestsForScope(root, "shared"),
    readManifestsForScope(root, "company"),
    readManifestsForScope(root, "personal"),
  ]);
  const all = [...shared, ...company, ...personal];
  log.info(
    `[tools] loaded ${all.length} manifests from ${root} (shared=${shared.length} company=${company.length} personal=${personal.length})`,
  );
  return all;
}
