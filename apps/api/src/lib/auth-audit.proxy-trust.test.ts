/**
 * #142: auth-audit client IPs must come from the shared proxy-trust
 * derivation.
 *
 * The bug: `auth-audit.ts` and `authorization/audit.ts` each read
 * `X-Forwarded-For` (leftmost entry) / `X-Real-IP` unconditionally. Those are
 * client-controlled bytes, so audit rows — the record an operator reads after an
 * incident — could be poisoned with any address the caller liked, while the rate
 * limiter and the auth-abuse throttle (which both go through `proxy-trust`)
 * ignored the very same headers.
 *
 * These cases assert the audit derivation agrees with `resolveClientIp` rather
 * than restating the expected address, so the two consumers cannot drift.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  auditClientIp,
  rememberPeerAddress,
  resolveClientIp,
} from "./proxy-trust";
import { recordRoleChange } from "./authorization/audit";

type InsertedRow = Record<string, unknown>;

/*
 * Scope note: these cases assert the policy function (`auditClientIp`, in
 * `proxy-trust`, which no test file mocks) rather than `recordAuthEvent` end to
 * end. Ten other api test files replace `auth-audit` with a no-op factory, and
 * bun shares one module registry across files, so whichever of them loads first
 * decides what `recordAuthEvent` is for the rest of the suite — asserting
 * through it would be order-dependent. `recordAuthEvent` and the in-transaction
 * role-change writer both call exactly this function (typechecked), and the
 * role-change writer is covered end to end below because it builds its row
 * through an injected executor.
 */

const savedTrustProxy = process.env.TRUST_PROXY;
const savedTrustedProxies = process.env.TRUSTED_PROXIES;
const savedTrustProxyLegacy = process.env.TRUST_PROXY_LEGACY;

function setProxyEnv(
  trustProxy?: string,
  trustedProxies?: string,
  trustProxyLegacy?: string,
): void {
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;
  if (trustedProxies === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = trustedProxies;
  if (trustProxyLegacy === undefined) delete process.env.TRUST_PROXY_LEGACY;
  else process.env.TRUST_PROXY_LEGACY = trustProxyLegacy;
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/auth/login", { headers });
}

const SPOOFED = { "x-forwarded-for": "6.6.6.6", "x-real-ip": "5.5.5.5" };

beforeEach(() => {
  setProxyEnv(undefined);
});

afterEach(() => {
  if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = savedTrustProxy;
  if (savedTrustedProxies === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = savedTrustedProxies;
  if (savedTrustProxyLegacy === undefined) delete process.env.TRUST_PROXY_LEGACY;
  else process.env.TRUST_PROXY_LEGACY = savedTrustProxyLegacy;
});

describe("#142 — auth-audit IP derivation honours the proxy trust model", () => {
  test("AC1: with TRUST_PROXY unset a spoofed X-Forwarded-For is ignored", () => {
    setProxyEnv(undefined);

    // Untrusted mode ignores the headers entirely and uses the real peer.
    expect(auditClientIp(requestWith(SPOOFED), "10.0.0.7")).toBe("10.0.0.7");
    expect(auditClientIp(requestWith(SPOOFED), "10.0.0.7")).not.toBe("6.6.6.6");
  });

  test("AC1: with no peer known the spoofed headers are dropped, not recorded", () => {
    setProxyEnv(undefined);

    // NULL records "unknown"; it must never carry a spoofed header, and never
    // the shared rate-limit bucket name either.
    expect(auditClientIp(requestWith(SPOOFED), null)).toBeNull();
    expect(auditClientIp(requestWith(SPOOFED), undefined)).toBeNull();
  });

  test("AC2: with TRUST_PROXY set the audit IP equals the rate-limit derivation", () => {
    setProxyEnv("true", "10.0.0.0/8");
    const request = requestWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.3" });

    // Asserted against the shared function rather than a copied literal: if the
    // audit and rate-limit consumers ever diverge, this fails.
    expect(auditClientIp(request, "10.0.0.3")).toBe(
      resolveClientIp(request, "10.0.0.3"),
    );
    expect(auditClientIp(request, "10.0.0.3")).toBe("203.0.113.7");
  });

  test("AC2: a direct connection from an unlisted address uses the peer, ignoring the chain", () => {
    setProxyEnv("true", "10.0.0.0/8");
    const request = requestWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.3" });

    expect(auditClientIp(request, "198.51.100.9")).toBe("198.51.100.9");
  });

  test("TRUST_PROXY_LEGACY keeps the historical leftmost-XFF behavior", () => {
    // Legacy only relaxes the peer/allow-list requirement (proxy-trust rule 3),
    // so TRUST_PROXY still has to be on.
    setProxyEnv("true", undefined, "1");
    const request = requestWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.3" });

    expect(auditClientIp(request, null)).toBe("203.0.113.7");
  });

  test("the shared 'local' bucket is stored as NULL, not as a fake address", () => {
    setProxyEnv(undefined);
    expect(auditClientIp(requestWith({}), null)).toBeNull();
  });

  test("the peer recorded by the global derive is used when none is passed", () => {
    // The derive (peerAddressPlugin) populates this; audit call sites therefore
    // do not need the server handle to get a TRUST_PROXY-aware IP.
    setProxyEnv(undefined);
    const request = requestWith(SPOOFED);
    rememberPeerAddress(request, "10.0.0.7");

    expect(auditClientIp(request)).toBe("10.0.0.7");
  });

  test("the in-transaction role-change writer derives the same way", async () => {
    // This path had its own copy of the spoofable derivation and writes the
    // same auth_audit_events rows.
    setProxyEnv(undefined);
    const inserted: InsertedRow[] = [];
    const tx = {
      insert: () => ({
        values: async (row: InsertedRow) => {
          inserted.push(row);
          return [];
        },
      }),
    };

    await recordRoleChange(
      {
        event: "role.assigned",
        actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        roleSlug: "admin",
        request: requestWith(SPOOFED),
        peerAddress: "10.0.0.7",
      },
      tx,
    );

    expect(inserted[0]!.ip).toBe("10.0.0.7");
    expect(inserted[0]!.ip).not.toBe("6.6.6.6");
  });
});
