/**
 * Client address forwarded to the API so its per-client abuse controls can
 * distinguish callers.
 *
 * #160: every web-tier -> API call site built its own upstream header set and
 * none of them carried `x-forwarded-for`. With the chain empty, the API's
 * `resolveClientIp` returns the direct peer — the Next server — under BOTH
 * trust postures (headers ignored when `TRUST_PROXY` is unset, and
 * `chain[0] ?? peer` when it is not), so the rate-limit key collapsed to one
 * shared bucket per scope and an anonymous caller spending 20 requests/minute
 * on `POST /api/auth/login` held login closed for every other user.
 *
 * Three conditions must ALL hold for forwarding to be correct. Enabling it
 * without the third is worse than leaving it off:
 *
 *  1. This gate (`WEB_FORWARD_CLIENT_IP=true`) is the owner's assertion that the
 *     platform edge OVERWRITES `x-forwarded-for` rather than appending to a
 *     client-supplied one. Under an appending edge the API — which trusts the
 *     whole chain once `TRUST_PROXY=true` and the Next egress is in
 *     `TRUSTED_PROXIES` — resolves the rightmost non-trusted entry, which the
 *     attacker chose: an attacker-owned bucket instead of a shared one.
 *  2. The API must run `TRUST_PROXY=true` + `TRUSTED_PROXIES`. Without them the
 *     header is silently ignored (`apps/api/src/lib/proxy-trust.ts:147`) and
 *     this change is inert, not harmful.
 *  3. The value is forwarded verbatim; sanitising it here is not possible and
 *     is not attempted. The API owns the trust decision and must not be second-
 *     guessed by the tier.
 *
 * Appending this tier's own observed peer is NOT an alternative fallback: the
 * API scans right-to-left, skips an appended peer because it is a trusted
 * proxy, and returns the same rightmost attacker-supplied entry. Next 16
 * removed `request.ip` (`NextRequest` exposes only cookies/nextUrl/url), so the
 * peer is not obtainable here in any case. If the edge cannot be shown to
 * sanitise the header, the correct state is gate-off plus the documented
 * deployment limitation, not a forwarded value.
 */

/**
 * Strict opt-in: only the literal string "true" enables forwarding, so an
 * unset, misspelled, or truthy-looking value (`1`, `yes`, `TRUE`) leaves the
 * tier in the fail-safe off state.
 */
export function isClientIpForwardingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.WEB_FORWARD_CLIENT_IP === "true";
}

/**
 * The `x-forwarded-for` value to send upstream, or `null` to send nothing.
 *
 * Accepts `Headers` rather than `Request` so the Server Action path can pass
 * the `next/headers` store directly instead of synthesising a `Request`.
 */
export function inboundClientFor(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isClientIpForwardingEnabled(env)) return null;
  const raw = headers.get("x-forwarded-for");
  if (!raw) return null;
  return raw;
}