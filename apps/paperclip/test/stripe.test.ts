/**
 * Tests for Stripe-Signature parsing + HMAC verification. We don't exercise
 * the recordStripeEvent path here — that needs a Postgres connection and
 * lives in the integration test layer.
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  StripeSignatureError,
  parseStripeSignature,
  verifyStripeSignature,
} from "../src/stripe.js";

const SECRET = "whsec_test_super_secret";

function signed(body: string, secret = SECRET, atUnix?: number) {
  const t = atUnix ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { header: `t=${t},v1=${v1}`, t };
}

describe("parseStripeSignature", () => {
  it("parses a typical header", () => {
    const r = parseStripeSignature("t=1700000000,v1=abc,v0=def");
    expect(r.timestamp).toBe(1700000000);
    expect(r.v1Sigs).toEqual(["abc"]);
  });

  it("collects multiple v1 entries", () => {
    const r = parseStripeSignature("t=1,v1=aa,v1=bb");
    expect(r.v1Sigs).toEqual(["aa", "bb"]);
  });

  it("rejects malformed", () => {
    expect(() => parseStripeSignature("nope")).toThrow(StripeSignatureError);
    expect(() => parseStripeSignature("v1=aa")).toThrow(StripeSignatureError);
    expect(() => parseStripeSignature("t=1700000000")).toThrow(StripeSignatureError);
  });
});

describe("verifyStripeSignature", () => {
  it("accepts a freshly signed payload", () => {
    const body = '{"id":"evt_1","type":"customer.created"}';
    const { header } = signed(body);
    expect(verifyStripeSignature(body, header, SECRET)).toBe(true);
  });

  it("rejects a body that doesn't match the signature", () => {
    const body = '{"id":"evt_1","type":"customer.created"}';
    const { header } = signed(body);
    expect(() =>
      verifyStripeSignature('{"id":"evt_1","tampered":true}', header, SECRET),
    ).toThrow(StripeSignatureError);
  });

  it("rejects a wrong secret", () => {
    const body = '{"id":"evt_1"}';
    const { header } = signed(body);
    expect(() => verifyStripeSignature(body, header, "wrong-secret")).toThrow(
      StripeSignatureError,
    );
  });

  it("rejects an old timestamp (replay outside tolerance)", () => {
    const body = '{"id":"evt_1"}';
    const old = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min old
    const { header } = signed(body, SECRET, old);
    expect(() => verifyStripeSignature(body, header, SECRET)).toThrow(
      /tolerance/,
    );
  });
});
