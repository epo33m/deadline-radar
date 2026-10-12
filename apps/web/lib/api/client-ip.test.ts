/**
 * #160: the web tier forwarded no `x-forwarded-for`, so the API's per-client
 * rate limits resolved every caller to the same Next-server peer and one
 * anonymous caller could hold login closed for everyone.
 *
 * Two properties are worth pinning separately, and both fail silently:
 *
 *  - the gate. Forwarding is only safe once the owner has confirmed the edge
 *    OVERWRITES the header. An appending edge would hand the caller an
 *    attacker-chosen bucket, so anything but the literal "true" must stay off.
 *  - the value. It is forwarded verbatim on purpose: this tier does not get to
 *    second-guess the API's trust decision. A test that "helpfully" asserted a
 *    sanitised single-IP value would be asserting behaviour nobody wrote.
 */
import { describe, expect, test } from "bun:test";

import { inboundClientFor, isClientIpForwardingEnabled } from "./client-ip";

function headers(xff?: string): Headers {
  const init: Record<string, string> = {};
  if (xff !== undefined) init["x-forwarded-for"] = xff;
  return new Headers(init);
}

function env(value?: string): NodeJS.ProcessEnv {
  // Cast like origin.test.ts: this repo's ProcessEnv requires NODE_ENV, and
  // these tests vary only the one variable under test.
  return (value === undefined ? {} : { WEB_FORWARD_CLIENT_IP: value }) as NodeJS.ProcessEnv;
}

describe("isClientIpForwardingEnabled", () => {
  test("only the literal \"true\" enables forwarding", () => {
    expect(isClientIpForwardingEnabled(env("true"))).toBe(true);
  });

  test("every other value fails safe to off", () => {
    // An unset, misspelled, or truthy-looking value must not turn the gate on:
    // the gate is an assertion about edge behaviour, not a convenience flag.
    for (const value of ["1", "TRUE", "True", "yes", "on", "true ", "", "false"]) {
      expect(isClientIpForwardingEnabled(env(value)), value).toBe(false);
    }
    expect(isClientIpForwardingEnabled(env())).toBe(false);
  });
});

describe("inboundClientFor", () => {
  test("returns the inbound header verbatim when forwarding is enabled", () => {
    expect(inboundClientFor(headers("203.0.113.9"), env("true"))).toBe(
      "203.0.113.9",
    );
  });

  test("returns null when the header is absent", () => {
    expect(inboundClientFor(headers(), env("true"))).toBeNull();
  });

  test("returns null — header or not — while the gate is off", () => {
    expect(inboundClientFor(headers("203.0.113.9"), env())).toBeNull();
    expect(inboundClientFor(headers("203.0.113.9"), env("false"))).toBeNull();
  });

  test("does not sanitise a multi-entry chain", () => {
    // Documented, not endorsed: this is what an edge that APPENDS produces.
    // Forwarding it under such an edge would let a caller rotate the identity
    // the API resolves, which is why the gate is the owner's assertion that
    // the edge overwrites instead. See client-ip.ts.
    const chain = "203.0.113.9, 198.51.100.4";
    expect(inboundClientFor(headers(chain), env("true"))).toBe(chain);
  });

  test("reads case-insensitively, as HTTP headers require", () => {
    const upper = new Headers({ "X-Forwarded-For": "203.0.113.9" });
    expect(inboundClientFor(upper, env("true"))).toBe("203.0.113.9");
  });
});