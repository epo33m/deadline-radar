/**
 * Finding #9 unit tests: proxy trust model + account throttling.
 * Pure-function tests for `proxy-trust` and the account abuse buckets.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  isProxyTrustEnabled,
  isTrustedProxy,
  resolveClientIp,
} from "./proxy-trust";
import {
  accountAttemptKey,
  clearAccountFailures,
  getAccountDelayMs,
  recordAccountFailure,
  resetAccountAttemptStore,
} from "./auth-abuse";

const savedTrustProxy = process.env.TRUST_PROXY;
const savedTrustedProxies = process.env.TRUSTED_PROXIES;

function setProxyEnv(trustProxy?: string, trustedProxies?: string) {
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;
  if (trustedProxies === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = trustedProxies;
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/auth/login", { headers });
}

beforeEach(() => {
  resetAccountAttemptStore();
});

afterEach(() => {
  if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = savedTrustProxy;
  if (savedTrustedProxies === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = savedTrustedProxies;
});

describe("finding #9 — proxy trust model", () => {
  test("A. untrusted mode ignores X-Forwarded-For / X-Real-IP / Forwarded", () => {
    setProxyEnv(undefined);
    const request = requestWith({
      "x-forwarded-for": "9.9.9.9",
      "x-real-ip": "8.8.8.8",
      forwarded: "for=7.7.7.7",
    });
    expect(resolveClientIp(request, null)).toBe("local");
    expect(resolveClientIp(request, "10.1.2.3")).toBe("10.1.2.3");
  });

  test("F. ambiguous TRUST_PROXY fails safe to untrusted", () => {
    setProxyEnv("maybe");
    expect(isProxyTrustEnabled()).toBe(false);
    expect(
      resolveClientIp(requestWith({ "x-forwarded-for": "9.9.9.9" }), null),
    ).toBe("local");
    setProxyEnv("TRUE");
    expect(isProxyTrustEnabled()).toBe(true);
    setProxyEnv("0");
    expect(isProxyTrustEnabled()).toBe(false);
  });

  test("B. trusted legacy mode uses the leftmost entry", () => {
    setProxyEnv("true");
    expect(
      resolveClientIp(
        requestWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }),
        null,
      ),
    ).toBe("1.1.1.1");
  });

  test("B. peer-aware mode takes the rightmost untrusted entry", () => {
    setProxyEnv("true", "10.0.0.0/8, 192.168.1.1");
    expect(
      resolveClientIp(
        requestWith({ "x-forwarded-for": "203.0.113.7, 10.4.5.6" }),
        "10.9.9.9",
      ),
    ).toBe("203.0.113.7");
  });

  test("B. unlisted peer ignores the whole spoofed chain", () => {
    setProxyEnv("true", "10.0.0.0/8");
    expect(
      resolveClientIp(
        requestWith({ "x-forwarded-for": "203.0.113.7, 10.4.5.6" }),
        "198.51.100.9",
      ),
    ).toBe("198.51.100.9");
  });

  test("trusted proxy matching covers exact, CIDR, and invalid entries", () => {
    setProxyEnv("true", "10.0.0.0/8, 192.168.1.1, not-an-ip");
    expect(isTrustedProxy("10.4.5.6")).toBe(true);
    expect(isTrustedProxy("11.0.0.1")).toBe(false);
    expect(isTrustedProxy("192.168.1.1")).toBe(true);
    expect(isTrustedProxy("192.168.1.2")).toBe(false);
  });
});

describe("finding #9 — account-level throttling", () => {
  test("account bucket triggers after 10 failures regardless of IP", async () => {
    const key = accountAttemptKey("Victim@Example.com");
    for (let i = 0; i < 9; i += 1) {
      expect(await recordAccountFailure(key)).toBe(0);
    }
    expect(await getAccountDelayMs(key)).toBe(0);
    expect(await recordAccountFailure(key)).toBeGreaterThan(0);
    expect(await getAccountDelayMs(key)).toBeGreaterThan(0);
  });

  test("account key normalizes email (case/whitespace)", () => {
    expect(accountAttemptKey("A@X.com")).toBe(accountAttemptKey(" a@x.com "));
  });

  test("success clears the account bucket", async () => {
    const key = accountAttemptKey("a@x.com");
    for (let i = 0; i < 10; i += 1) await recordAccountFailure(key);
    expect(await getAccountDelayMs(key)).toBeGreaterThan(0);
    await clearAccountFailures(key);
    expect(await getAccountDelayMs(key)).toBe(0);
  });
});
