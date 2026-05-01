import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadSkillManifests } from "../src/skills/loader.js";

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "bc-skills-"));
  const sharedDir = path.join(tmpRoot, "shared");
  const companyDir = path.join(tmpRoot, "company");
  await mkdir(sharedDir, { recursive: true });
  await mkdir(companyDir, { recursive: true });
  await writeFile(
    path.join(sharedDir, "demo.yaml"),
    [
      "id: demo.skill",
      "version: 2",
      "scope: shared",
      "agent_kind: hermes",
      "title: Demo skill",
      "description: |",
      "  Test fixture.",
      "side_effects: read",
      "permissions:",
      "  required_role: owner",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(companyDir, "secret.yaml"),
    [
      "id: company.secret",
      "version: 1",
      "scope: company",
      "agent_kind: openclaw",
      "title: Company secret",
      "side_effects: external",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(sharedDir, "broken.yaml"),
    "id: 12345\nversion: bad\nscope: nope\n",
  );
  process.env.PAPERCLIP_SKILLS_DIR = tmpRoot;
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  delete process.env.PAPERCLIP_SKILLS_DIR;
});

describe("loadSkillManifests", () => {
  it("loads valid manifests across scopes and skips invalid files", async () => {
    const log = { info: () => undefined, warn: () => undefined };
    const manifests = await loadSkillManifests(log);
    const ids = manifests.map((m) => m.id).sort();
    expect(ids).toContain("demo.skill");
    expect(ids).toContain("company.secret");
    // Invalid file is filtered, not thrown.
    expect(ids).not.toContain("12345");
  });
});
