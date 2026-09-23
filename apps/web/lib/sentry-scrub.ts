/**
 * Sentry PII scrubber (audit item 7) — shared by server/edge/client configs.
 * Mirrors apps/api/src/lib/sentry.ts: emails, tokens, cookies, passwords and
 * auth headers never leave the browser/process. Pure + unit-tested.
 */

const SENSITIVE_KEY_PARTS = [
  "password",
  "email",
  "token",
  "secret",
  "cookie",
  "authorization",
  "set-cookie",
  "apikey",
  "api_key",
  "query_string",
  "querystring",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/=]+/g;
const SENSITIVE_QUERY_PARAM_RE =
  /([?&](?:token|code|token_hash|secret|key|api_key)=)[^&\s]*/gi;

function scrubString(value: string): string {
  return value
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(SENSITIVE_QUERY_PARAM_RE, "$1[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED]");
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? "[REDACTED]"
        : scrubValue(entry, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubSentryEvent(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  return scrubValue(event) as Record<string, unknown>;
}

export const sentryBeforeSend = (
  event: Record<string, unknown>,
): Record<string, unknown> | null => scrubSentryEvent(event);
