/**
 * Skill manifest loader.
 *
 * YAML on disk is the source of truth. The loader walks `packages/skills/manifests/`
 * (relative to the repo root) at boot, parses every `.yaml`, validates against
 * the SkillManifest Zod schema, and returns a typed list. The registry then
 * mirrors the result into `ops.skill` for fast SQL queries with RLS scoping.
 *
 * Resolution order (highest precedence first):
 *   1. PAPERCLIP_SKILLS_DIR env var (absolute path) — for tests / overrides
 *   2. /app/packages/skills/manifests inside the container
 *   3. ../../../packages/skills/manifests relative to this source file
 *      (so `npm run dev` works from the apps/paperclip/ directory)
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";

import { SkillManifest, type SkillScope } from "../schemas.js";

export type LoadedSkill = SkillManifest & {
  manifest_path: string;
  scope: SkillScope;
};

function candidateDirs(): string[] {
  return [
    process.env.PAPERCLIP_SKILLS_DIR,
    "/app/packages/skills/manifests",
    path.resolve(process.cwd(), "packages/skills/manifests"),
    path.resolve(process.cwd(), "../../packages/skills/manifests"),
  ].filter((p): p is string => Boolean(p));
}

async function resolveSkillsRoot(): Promise<string | null> {
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

async function readManifestsForScope(
  rootDir: string,
  scopeDir: SkillScope,
): Promise<LoadedSkill[]> {
  const dir = path.join(rootDir, scopeDir);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
  } catch {
    return [];
  }

  const out: LoadedSkill[] = [];
  for (const f of files) {
    const fullPath = path.join(dir, f);
    try {
      const raw = await readFile(fullPath, "utf8");
      const parsed = yaml.load(raw);
      const validated = SkillManifest.safeParse(parsed);
      if (!validated.success) {
        console.warn(
          `[skills] manifest ${fullPath} failed validation:`,
          validated.error.flatten(),
        );
        continue;
      }
      out.push({
        ...validated.data,
        // Trust the YAML's declared scope; folder is just organisational.
        manifest_path: fullPath,
      });
    } catch (err) {
      console.warn(`[skills] failed to read ${fullPath}:`, (err as Error).message);
    }
  }
  return out;
}

export async function loadSkillManifests(log: { info: (m: string) => void; warn?: (m: string) => void }): Promise<LoadedSkill[]> {
  const root = await resolveSkillsRoot();
  if (!root) {
    log.warn?.("[skills] no manifests directory found — registry will be empty");
    return [];
  }
  const [shared, company, personal] = await Promise.all([
    readManifestsForScope(root, "shared"),
    readManifestsForScope(root, "company"),
    readManifestsForScope(root, "personal"),
  ]);
  const all = [...shared, ...company, ...personal];
  log.info(
    `[skills] loaded ${all.length} manifests from ${root} (shared=${shared.length} company=${company.length} personal=${personal.length})`,
  );
  return all;
}
