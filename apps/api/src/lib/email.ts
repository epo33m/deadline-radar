import { createHash } from "node:crypto";
import { urgencyLabel } from "@deadline-radar/domain";
import { Resend } from "resend";

import { env } from "../env";
import { backoffDelayMs, isAbortError, sleep } from "./net";

export type ReminderEmailPayload = {
  to: string;
  taskTitle: string;
  daysBefore: number;
  deadlineIso: string;
  /** Recipient profile timezone (IANA) used for deadline rendering (F-07). */
  timeZone: string;
  /**
   * Delivery row this email belongs to. Required so the idempotency key can
   * bind the provider-side dedup to exactly one delivery. Concurrent cron runs
   * computing the same payload produce the same key and Resend delivers once.
   */
  deliveryId: string;
  /** RF-11: scheduler catch-up label. Frozen with the rest of the snapshot so
   * retries rebuild the same body (and idempotency key). */
  late?: boolean;
};

/** Exact POST /emails body fields that determine the request. */
export type ReminderEmailBody = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

/** Deterministic serialization: fixed key order, so equal payloads hash equal. */
function canonicalEmailBody(body: ReminderEmailBody): string {
  return JSON.stringify({
    from: body.from,
    to: body.to,
    subject: body.subject,
    text: body.text,
  });
}

/**
 * Deterministic idempotency key for one delivery attempt.
 * Same delivery + same email body → same key (provider dedups).
 * Changed body (e.g. task edited between attempts) → new key, otherwise
 * Resend would reject the retry with `invalid_idempotent_request`.
 * Format `reminder-delivery-<uuid>-<12 hex>` stays well under the 256-char
 * Resend limit. The hash covers the full body; Resend already receives this
 * body in plaintext, so the key reveals nothing beyond the request itself.
 */
export function buildReminderIdempotencyKey(input: {
  deliveryId: string;
  body: ReminderEmailBody;
  /**
   * RF-02 rotation nonce. When the provider terminally rejects a key, the
   * caller re-derives with a nonce so the retry is a distinct request instead
   * of failing forever on the same key. Omitted for the normal key.
   */
  nonce?: string;
}): string {
  const digest = createHash("sha256")
    .update(canonicalEmailBody(input.body) + (input.nonce ?? ""), "utf8")
    .digest("hex")
    .slice(0, 12);
  return `reminder-delivery-${input.deliveryId}-${digest}`;
}

/** Provider failure that preserves the Resend error identity for mapping. */
export class ReminderEmailError extends Error {
  readonly resendName?: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    options?: { resendName?: string; statusCode?: number },
  ) {
    super(message);
    this.name = "ReminderEmailError";
    this.resendName = options?.resendName;
    this.statusCode = options?.statusCode;
  }
}

/** Per-attempt timeout and retry budget for reminder delivery. */
export const REMINDER_EMAIL_TIMEOUT_MS = 10_000;
export const REMINDER_EMAIL_MAX_ATTEMPTS = 3;
const REMINDER_EMAIL_BASE_DELAY_MS = 500;
const REMINDER_EMAIL_MAX_DELAY_MS = 10_000;
/** Upper bound for honoring a provider `Retry-After` response header. */
const REMINDER_EMAIL_RETRY_AFTER_CAP_MS = 30_000;

export type SendReminderEmailOptions = {
  idempotencyKey?: string;
  /** Per-attempt timeout in ms. Defaults to REMINDER_EMAIL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Total attempts including the first try. Defaults to 3. */
  maxAttempts?: number;
  /** Base backoff delay in ms (test hook). Defaults to 500. */
  baseDelayMs?: number;
};

function parseRetryAfterMs(
  headers: Record<string, string> | null | undefined,
): number | null {
  if (!headers) return null;
  const raw = headers["retry-after"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, REMINDER_EMAIL_RETRY_AFTER_CAP_MS);
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) {
      return Math.min(delta, REMINDER_EMAIL_RETRY_AFTER_CAP_MS);
    }
  }
  return null;
}

/**
 * True for provider answers that must never be retried: another run is
 * delivering under the same key (the caller leaves the delivery pending),
 * key/payload problems, and non-transient 4xx.
 */
function isNonRetryableReminderError(error: ReminderEmailError): boolean {
  if (isConcurrentIdempotentRequest(error)) return true;
  if (isTerminalIdempotentError(error)) return true;
  return (
    typeof error.statusCode === "number" &&
    error.statusCode < 500 &&
    error.statusCode !== 429
  );
}

/**
 * True when Resend reports another in-flight request for the same
 * idempotency key. The email is being delivered elsewhere — the caller must
 * leave the delivery pending, NOT mark it failed. Retrying later with the
 * same key returns the original response without resending (24h window).
 */
export function isConcurrentIdempotentRequest(error: unknown): boolean {
  return (
    error instanceof ReminderEmailError &&
    error.resendName === "concurrent_idempotent_requests"
  );
}

/** True for key/payload problems where retrying with the same key is useless. */
export function isTerminalIdempotentError(error: unknown): boolean {
  return (
    error instanceof ReminderEmailError &&
    (error.resendName === "invalid_idempotent_request" ||
      error.resendName === "invalid_idempotency_key")
  );
}

/**
 * RF-02: rate-limit class. Resend surfaces throttling either as an HTTP 429
 * or as the named errors `rate_limited` / `rate_limit_exceeded`, and the
 * named form may arrive WITHOUT a numeric statusCode. Only this class honors
 * the provider's `Retry-After` hint instead of generic backoff.
 */
export function isRateLimitedReminderError(error: ReminderEmailError): boolean {
  return (
    error.statusCode === 429 ||
    error.resendName === "rate_limited" ||
    error.resendName === "rate_limit_exceeded"
  );
}

/**
 * Render the deadline wall-clock in the recipient's timezone with an
 * explicit zone label (F-07). Falls back to the raw ISO value for
 * unparseable input and to UTC rendering for unknown timezone strings —
 * a label must never break a send.
 */
export function formatDeadlineForEmail(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // NB: timeZoneName cannot be combined with dateStyle/timeStyle, so the
  // parts are spelled out explicitly.
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en", options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", {
      ...options,
      timeZone: "UTC",
    }).format(date);
  }
}

/** Max task-title characters carried in the email subject line. */
export const MAX_SUBJECT_TITLE_LENGTH = 120;

/**
 * SEC-004: fold a user-controlled task title into a single safe subject
 * fragment. CR/LF runs become one space (header-injection defense), the
 * result is trimmed, and over-long titles are cut to `maxLength` with an
 * ellipsis. The full title is still delivered in the plain-text body.
 */
export function sanitizeEmailSubjectLine(
  title: string,
  maxLength: number = MAX_SUBJECT_TITLE_LENGTH,
): string {
  const singleLine = title.replace(/[\r\n]+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Build the exact POST /emails body for a reminder. Exported so the caller can
 * derive the idempotency key (and freeze it) without duplicating rendering.
 */
export function buildReminderEmailBody(
  payload: ReminderEmailPayload,
): ReminderEmailBody {
  const label = urgencyLabel(payload.daysBefore);
  const lateTag = payload.late ? " [LATE]" : "";
  return {
    from: env.resendFromEmail,
    to: payload.to,
    subject: `[${label}]${lateTag} Reminder: ${sanitizeEmailSubjectLine(payload.taskTitle)}`,
    text: [
      `Reminder (${label})${lateTag}`,
      "",
      `Task: ${payload.taskTitle}`,
      `Deadline: ${formatDeadlineForEmail(payload.deadlineIso, payload.timeZone)}`,
      ...(payload.late
        ? ["", "This reminder was delivered late because the scheduler was offline."]
        : []),
      "",
      "— Deadline Radar",
    ].join("\n"),
  };
}

export async function sendReminderEmail(
  payload: ReminderEmailPayload,
  opts?: SendReminderEmailOptions,
): Promise<void> {
  const apiKey = env.resendApiKey();
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  const resend = new Resend(apiKey);
  const body = buildReminderEmailBody(payload);

  const idempotencyKey =
    opts?.idempotencyKey ??
    buildReminderIdempotencyKey({ deliveryId: payload.deliveryId, body });

  // Retries are safe here: every attempt carries the same deterministic
  // provider idempotency key (delivery + full body), so Resend dedups
  // redeliveries server-side instead of sending twice.
  const timeoutMs = opts?.timeoutMs ?? REMINDER_EMAIL_TIMEOUT_MS;
  const attempts = Math.max(1, Math.floor(opts?.maxAttempts ?? REMINDER_EMAIL_MAX_ATTEMPTS));
  const baseDelayMs = opts?.baseDelayMs ?? REMINDER_EMAIL_BASE_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // The Resend SDK converts fetch rejections (including our abort) into
    // an `{ error }` payload, so keep the signal to attribute timeouts.
    const signal = AbortSignal.timeout(timeoutMs);
    let result: {
      error: unknown;
      headers?: Record<string, string> | null;
    };
    try {
      result = await resend.emails.send(body, {
        idempotencyKey,
        signal,
      } as unknown as Parameters<typeof resend.emails.send>[1]);
    } catch (error) {
      // Thrown = no provider answer received (network/timeout/abort):
      // transient by definition, safe to retry while attempts remain.
      lastError = isAbortError(error) || signal.aborted
        ? new ReminderEmailError(
            `Reminder email send timed out after ${timeoutMs}ms`,
          )
        : new ReminderEmailError(
            error instanceof Error && error.message.length > 0
              ? error.message
              : "Failed to send reminder email",
          );
      if (attempt >= attempts) throw lastError;
      await sleep(backoffDelayMs(attempt, baseDelayMs, REMINDER_EMAIL_MAX_DELAY_MS));
      continue;
    }

    if (!result.error) return;

    const shape = result.error as {
      name?: unknown;
      message?: unknown;
      statusCode?: unknown;
    };
    // Our own abort surfaces as the SDK's generic fetch-failure payload;
    // label it as a timeout for operability (still retryable below).
    const timedOut =
      signal.aborted &&
      shape.name === "application_error" &&
      typeof shape.statusCode !== "number";
    const mapped = new ReminderEmailError(
      timedOut
        ? `Reminder email send timed out after ${timeoutMs}ms`
        : typeof shape.message === "string" && shape.message.length > 0
          ? shape.message
          : "Failed to send reminder email",
      {
        resendName:
          typeof shape.name === "string" ? shape.name : undefined,
        statusCode:
          typeof shape.statusCode === "number" ? shape.statusCode : undefined,
      },
    );
    lastError = mapped;
    if (attempt >= attempts || isNonRetryableReminderError(mapped)) {
      throw mapped;
    }
    const headers = (result as { headers?: Record<string, string> | null })
      .headers;
    const retryAfterMs = isRateLimitedReminderError(mapped)
      ? parseRetryAfterMs(headers)
      : null;
    await sleep(
      retryAfterMs ?? backoffDelayMs(attempt, baseDelayMs, REMINDER_EMAIL_MAX_DELAY_MS),
    );
  }
  throw lastError;
}
