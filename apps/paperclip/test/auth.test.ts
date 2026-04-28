/**
 * Tests for the Supabase JWT verifier.
 *
 * We exercise verifyBearer with an HS256 token round-tripped through the
 * same secret, plus a tampered-signature negative test.
 */

import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-do-not-use-in-real-life-it-is-public-here";

async function makeToken(
  claims: Record<string, unknown>,
  secret = SECRET,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

describe("verifyBearer", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
    vi.resetModules();
  });

  it("verifies a token signed with the configured secret", async () => {
    const { verifyBearer } = await import("../src/auth.js");
    const token = await makeToken({ sub: "u-1", email: "alice@example.com" });
    const claims = await verifyBearer(token);
    expect(claims.sub).toBe("u-1");
    expect(claims.email).toBe("alice@example.com");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const { verifyBearer } = await import("../src/auth.js");
    const token = await makeToken({ sub: "u-1" }, "the-attackers-secret");
    await expect(verifyBearer(token)).rejects.toThrow();
  });

  it("rejects when secret is not configured", async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    vi.resetModules();
    const { verifyBearer } = await import("../src/auth.js");
    await expect(verifyBearer("anything")).rejects.toThrow(/SUPABASE_JWT_SECRET/);
  });
});
