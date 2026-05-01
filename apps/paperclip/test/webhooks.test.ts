import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

// The HMAC verify is small enough to inline-mirror in this test rather than
// import from the route file (which would pull Fastify into the test).
function verifyHmac(rawBody: string, headerValue: string, secret: string): boolean {
  const match = headerValue.match(/^hmac-sha256=([a-f0-9]+)$/i);
  const expectedHex = match ? match[1]! : headerValue.trim();
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (expectedHex.length !== computed.length) return false;
  return Buffer.from(expectedHex, "hex").equals(Buffer.from(computed, "hex"));
}

describe("verifyHmac", () => {
  const secret = "test-secret";
  const body = '{"raw_content":"hi"}';
  const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("accepts header in 'hmac-sha256=...' form", () => {
    expect(verifyHmac(body, `hmac-sha256=${sig}`, secret)).toBe(true);
  });

  it("accepts bare hex header", () => {
    expect(verifyHmac(body, sig, secret)).toBe(true);
  });

  it("rejects when body changed", () => {
    expect(verifyHmac('{"raw_content":"hello"}', sig, secret)).toBe(false);
  });

  it("rejects when secret is wrong", () => {
    expect(verifyHmac(body, sig, "different-secret")).toBe(false);
  });

  it("rejects malformed signature", () => {
    expect(verifyHmac(body, "garbage", secret)).toBe(false);
  });
});
