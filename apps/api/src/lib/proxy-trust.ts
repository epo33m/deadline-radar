/**
 * Client-IP derivation with an explicit proxy trust model (Finding #9).
 *
 * Threat: `X-Forwarded-For` / `X-Real-IP` are client-controlled bytes. They
 * must only influence rate-limit identity when the request verifiably came
 * through a trusted reverse proxy.
 *
 * Trust rules, in order:
 * 1. `TRUST_PROXY` unset/"false" (or ambiguous) → forwarded headers are
 *    IGNORED. Identity is the direct TCP peer when the server exposes it,
 *    else the shared `"local"` bucket (previous behavior).
 * 2. `TRUST_PROXY=true` + `TRUSTED_PROXIES` (CIDR/IP list) + known peer →
 *    the chain is trusted only if the direct peer is listed; the client is
 *    the rightmost chain entry that is NOT a trusted proxy. An unlisted
 *    peer means a direct connection: its address is the identity and the
 *    chain is ignored.
 * 3. `TRUST_PROXY=true` without peer info or without `TRUSTED_PROXIES` →
 *    FAIL-CLOSED: identity is the peer when known, else the shared `"local"`
 *    bucket. The legacy leftmost-XFF behavior remains available only behind
 *    an explicit opt-in (`TRUST_PROXY_LEGACY=1`), because directly exposed
 *    it lets a client rotate XFF and escape the rate-limit bucket
 *    (Finding #123: request/legacy-xff-leftmost-spoof-rate-limit-bypass).
 *
 * The RFC 7239 `Forwarded` header is never read (ignoring it is safe).
 */
import { Elysia } from "elysia";

function warnOnce(message: string): void {
  if ((warnOnce as { done?: boolean }).done) return;
  (warnOnce as { done?: boolean }).done = true;
  console.warn(message);
}

/** Strict opt-in: only "true"/"1" enable forwarded-header trust. */
export function isProxyTrustEnabled(): boolean {
  const raw = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (raw === "" || raw === "false" || raw === "0" || raw === "no") {
    return false;
  }
  if (raw === "true" || raw === "1") return true;
  warnOnce(
    `[proxy] ambiguous TRUST_PROXY=${JSON.stringify(process.env.TRUST_PROXY)} — ` +
      "forwarded headers will NOT be trusted (fail-safe).",
  );
  return false;
}

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  return host;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const byte = Number(part);
    if (byte < 0 || byte > 255) return null;
    value = value * 256 + byte;
  }
  return value;
}

type TrustedPattern =
  | { kind: "exact"; host: string }
  | { kind: "cidr"; base: number; bits: number };

function parseTrustedPattern(entry: string): TrustedPattern | null {
  const text = normalizeHost(entry);
  if (!text) return null;
  const slash = text.indexOf("/");
  if (slash < 0) return { kind: "exact", host: text };
  const base = ipv4ToInt(text.slice(0, slash));
  const bits = Number(text.slice(slash + 1));
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return null;
  }
  return { kind: "cidr", base, bits };
}

/** Parsed `TRUSTED_PROXIES` (comma-separated IPs/CIDRs). Invalid entries are skipped with a warning. */
export function trustedProxyPatterns(): TrustedPattern[] {
  const raw = process.env.TRUSTED_PROXIES ?? "";
  if (!raw.trim()) return [];
  const patterns: TrustedPattern[] = [];
  for (const entry of raw.split(",")) {
    if (!entry.trim()) continue;
    const parsed = parseTrustedPattern(entry);
    if (!parsed) {
      warnOnce(
        `[proxy] ignoring invalid TRUSTED_PROXIES entry ${JSON.stringify(entry)}`,
      );
      continue;
    }
    patterns.push(parsed);
  }
  return patterns;
}

export function isTrustedProxy(address: string): boolean {
  const host = normalizeHost(address);
  for (const pattern of trustedProxyPatterns()) {
    if (pattern.kind === "exact") {
      if (host === pattern.host) return true;
      continue;
    }
    const value = ipv4ToInt(host);
    if (value === null) continue;
    const shift = 32 - pattern.bits;
    if (shift === 32) {
      if (value === pattern.base) return true;
    } else if ((value >>> shift) === (pattern.base >>> shift)) {
      return true;
    }
  }
  return false;
}

function forwardedEntries(request: Request): string[] {
  const raw = request.headers.get("x-forwarded-for");
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Derive the rate-limit/audit client identity for a request.
 * `peerAddress` is the direct TCP peer (Elysia `server.requestIP`), or null
 * when unavailable (e.g. in tests). Never returns an empty string.
 */
export function resolveClientIp(
  request: Request,
  peerAddress: string | null = null,
): string {
  const peer =
    typeof peerAddress === "string" && peerAddress.trim().length > 0
      ? peerAddress.trim()
      : null;

  if (!isProxyTrustEnabled()) {
    return peer ?? "local";
  }

  const chain = forwardedEntries(request);
  const allowList = trustedProxyPatterns();

  if (peer !== null && allowList.length > 0) {
    if (!isTrustedProxy(peer)) {
      // Direct connection from an unlisted address: ignore the chain.
      return peer;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (!isTrustedProxy(chain[i])) return chain[i];
    }
    return chain[0] ?? peer;
  }

  // Legacy path (no peer info or no allow-list configured): spoofable when
  // directly exposed, so it requires an explicit opt-in.
  const legacyRaw = (process.env.TRUST_PROXY_LEGACY ?? "").trim().toLowerCase();
  const legacy = legacyRaw === "1" || legacyRaw === "true";
  if (legacy) {
    if (chain.length > 0) return chain[0];
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  return peer ?? "local";
}

/** Direct TCP peer via a Bun/Elysia server handle; null when unavailable. */
export function peerAddressOf(
  server: unknown,
  request: Request,
): string | null {
  try {
    const candidate = (
      server as {
        requestIP?: (req: Request) => { address?: unknown } | null;
      } | null
    )?.requestIP?.(request);
    const address = candidate?.address;
    return typeof address === "string" && address.length > 0 ? address : null;
  } catch {
    return null;
  }
}

/**
 * #142: the direct peer address of an in-flight request.
 *
 * The peer is only reachable from the Elysia context, but the auth-audit writers
 * are plain functions that receive a bare `Request`. Rather than thread the
 * server handle through every audit call site (easy to forget, and a forgotten
 * site silently degrades to "unknown"), the global derive below records it once
 * per request and the audit writers read it from here. A `WeakMap` keeps it
 * scoped to the request's lifetime with no cleanup.
 */
const peerAddresses = new WeakMap<Request, string | null>();

/** Record the direct peer for this request. Called once per request. */
export function rememberPeerAddress(request: Request, peer: string | null): void {
  peerAddresses.set(request, peer);
}

/** The remembered peer, or null when the request never went through the derive. */
export function knownPeerAddress(request: Request): string | null {
  return peerAddresses.get(request) ?? null;
}

/**
 * #142: the client IP to record on an auth-audit row.
 *
 * Same derivation the rate limiter and the auth-abuse throttle enforce, so an
 * audit row can never disagree with the identity those two use: with
 * `TRUST_PROXY` unset, `X-Forwarded-For` / `X-Real-IP` are client-controlled
 * bytes and are ignored.
 *
 * `resolveClientIp` returns the shared `"local"` bucket when nothing is
 * knowable; an audit row records NULL for "unknown" rather than persisting a
 * bucket name that reads like an address.
 *
 * Lives here, next to `resolveClientIp`, because this module is the single
 * source of truth for the policy and is never replaced by a test double.
 */
export function auditClientIp(
  request: Request | undefined,
  peerAddress?: string | null,
): string | null {
  if (!request) return null;
  const peer =
    peerAddress !== undefined ? peerAddress : knownPeerAddress(request);
  const resolved = resolveClientIp(request, peer);
  return resolved === "local" ? null : resolved;
}

/**
 * Remembers each request's direct peer so request-scoped helpers can derive a
 * trusted client IP without the server handle. Registered app-wide, next to
 * `requestIdPlugin`.
 */
export const peerAddressPlugin = new Elysia({ name: "peer-address" }).derive(
  { as: "global" },
  ({ request, server }) => {
    rememberPeerAddress(request, peerAddressOf(server, request));
  },
);
