/**
 * Finding #8 tests for Resend delivery hardening.
 * `sendReminderEmail` builds a real `Resend` client, which uses the global
 * fetch — tests stub `globalThis.fetch` with scripted behaviors.
 *
 * - B: transient failures retry (same provider idempotency key) then succeed.
 * - C: permanent errors are attempted exactly once.
 * - D: the idempotency key is identical across retries (no duplicate sends).
 * - E: repeated transient failures stop at the attempt budget.
 * - A: a hanging provider aborts within the configured timeout.
 */
process.env.RESEND_API_KEY ??= "re_test_key";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  MAX_SUBJECT_TITLE_LENGTH,
  ReminderEmailError,
  buildReminderEmailBody,
  buildReminderIdempotencyKey,
  formatDeadlineForEmail,
  isConcurrentIdempotentRequest,
  sanitizeEmailSubjectLine,
  sendReminderEmail,
} from "./email";

const originalFetch = globalThis.fetch;

type FetchStub = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

let fetchCalls: Array<{ url: unknown; init?: RequestInit }> = [];
let fetchBehavior: FetchStub = async () => {
  throw new Error("fetch stub not configured");
};

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const PAYLOAD = {
  to: "user@example.com",
  taskTitle: "Task",
  daysBefore: 1,
  deadlineIso: "2026-10-01T00:00:00.000Z",
  timeZone: "UTC",
  deliveryId: "dlv-1",
};

function idempotencyKeys(): Array<string | null> {
  return fetchCalls.map((call) => {
    const headers = new Headers(call.init?.headers);
    return headers.get("Idempotency-Key");
  });
}

beforeEach(() => {
  fetchCalls = [];
  fetchBehavior = async () => {
    throw new Error("fetch stub not configured");
  };
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    fetchCalls.push({ url, init });
    return fetchBehavior(url, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("finding #8 — resend delivery", () => {
  test("B. transient 500s retry with the same key, then succeed", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse(500, {
          name: "application_error",
          message: "boom",
        });
      }
      return jsonResponse(200, { id: "em_ok" });
    };

    await sendReminderEmail(PAYLOAD, { baseDelayMs: 1 });
    expect(calls).toBe(3);
    const keys = idempotencyKeys();
    expect(keys.length).toBe(3);
    expect(keys[0]).toMatch(/^reminder-delivery-dlv-1-/);
    expect(new Set(keys).size).toBe(1);
  });

  test("B2. thrown network failures retry, then succeed", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      if (calls < 3) throw new Error("fetch failed: socket hang up");
      return jsonResponse(200, { id: "em_ok" });
    };

    await sendReminderEmail(PAYLOAD, { baseDelayMs: 1 });
    expect(calls).toBe(3);
  });

  test("C. permanent 400 is attempted exactly once", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      // Real Resend error bodies carry statusCode (see ErrorResponse type).
      return jsonResponse(400, {
        name: "validation_error",
        message: "bad",
        statusCode: 400,
      });
    };

    let error: unknown;
    try {
      await sendReminderEmail(PAYLOAD, { baseDelayMs: 1 });
    } catch (e) {
      error = e;
    }
    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(ReminderEmailError);
  });

  test("C2. terminal idempotency errors are not retried", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      return jsonResponse(400, {
        name: "invalid_idempotent_request",
        message: "key reused",
      });
    };

    let error: unknown;
    try {
      await sendReminderEmail(PAYLOAD, { baseDelayMs: 1 });
    } catch (e) {
      error = e;
    }
    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(ReminderEmailError);
  });

  test("concurrent in-flight key propagates immediately without retry", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      return jsonResponse(409, {
        name: "concurrent_idempotent_requests",
        message: "in flight",
      });
    };

    let error: unknown;
    try {
      await sendReminderEmail(PAYLOAD, { baseDelayMs: 1 });
    } catch (e) {
      error = e;
    }
    expect(calls).toBe(1);
    expect(isConcurrentIdempotentRequest(error)).toBe(true);
  });

  test("E. repeated 500s stop at the attempt budget", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      return jsonResponse(500, { name: "application_error", message: "down" });
    };

    let error: unknown;
    try {
      await sendReminderEmail(PAYLOAD, {
        baseDelayMs: 1,
        maxAttempts: 4,
      });
    } catch (e) {
      error = e;
    }
    expect(calls).toBe(4);
    expect(error).toBeInstanceOf(ReminderEmailError);
  });

  test("429 with Retry-After: 0 is honored without a real wait", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          429,
          { name: "rate_limit_exceeded", message: "slow down" },
          { "retry-after": "0" },
        );
      }
      return jsonResponse(200, { id: "em_ok" });
    };

    await sendReminderEmail(PAYLOAD, { baseDelayMs: 5000 });
    expect(calls).toBe(2);
  });

  test("RF-02: an explicit idempotency key is reused verbatim across retries", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse(500, { name: "application_error", message: "boom" });
      }
      return jsonResponse(200, { id: "em_ok" });
    };

    await sendReminderEmail(PAYLOAD, {
      baseDelayMs: 1,
      idempotencyKey: "reminder-delivery-dlv-1-frozen",
    });

    expect(calls).toBe(3);
    expect(idempotencyKeys()).toEqual([
      "reminder-delivery-dlv-1-frozen",
      "reminder-delivery-dlv-1-frozen",
      "reminder-delivery-dlv-1-frozen",
    ]);
  });

  test("RF-02: rate_limited without statusCode honors Retry-After (no backoff wait)", async () => {
    let calls = 0;
    fetchBehavior = async () => {
      calls += 1;
      if (calls === 1) {
        // Resend's named rate-limit error: no numeric statusCode here, so the
        // retry decision must key off the name, not `statusCode === 429`.
        return jsonResponse(
          429,
          { name: "rate_limited", message: "slow down" },
          { "retry-after": "0" },
        );
      }
      return jsonResponse(200, { id: "em_ok" });
    };

    const started = Date.now();
    // baseDelayMs is huge: only an honored Retry-After keeps this fast.
    await sendReminderEmail(PAYLOAD, { baseDelayMs: 5000 });

    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("RF-02: a rotation nonce changes the key but stays deterministic", () => {
    const body = {
      from: "Deadline Radar <onboarding@resend.dev>",
      to: "user@example.com",
      subject: "[H-1] Reminder: Task",
      text: "hello",
    };
    const base = buildReminderIdempotencyKey({ deliveryId: "dlv-1", body });
    const rotated = buildReminderIdempotencyKey({
      deliveryId: "dlv-1",
      body,
      nonce: "1-abc",
    });

    expect(rotated).not.toBe(base);
    expect(rotated.startsWith("reminder-delivery-dlv-1-")).toBe(true);
    expect(
      buildReminderIdempotencyKey({
        deliveryId: "dlv-1",
        body,
        nonce: "1-abc",
      }),
    ).toBe(rotated);
  });

  test("A. hanging provider aborts within the configured timeout", async () => {
    // Mirror real fetch semantics: reject when the abort signal fires.
    fetchBehavior = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("This operation was aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      });
    const started = Date.now();
    let error: unknown;
    try {
      await sendReminderEmail(PAYLOAD, {
        timeoutMs: 120,
        maxAttempts: 1,
        baseDelayMs: 1,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ReminderEmailError);
    expect(String((error as Error).message)).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("SEC-004 — subject-line sanitization", () => {
  test("CR/LF runs fold to one space (header-injection defense)", () => {
    expect(sanitizeEmailSubjectLine("A\r\nBcc: victim@x")).toBe("A Bcc: victim@x");
    expect(sanitizeEmailSubjectLine("Line1\nLine2\rLine3")).toBe(
      "Line1 Line2 Line3",
    );
  });

  test("over-long titles truncate to 120 chars with an ellipsis", () => {
    const long = "t".repeat(200);
    const out = sanitizeEmailSubjectLine(long);
    expect(out).toBe(`${"t".repeat(MAX_SUBJECT_TITLE_LENGTH)}…`);
    expect(MAX_SUBJECT_TITLE_LENGTH).toBe(120);
  });

  test("normal titles pass through untouched", () => {
    expect(sanitizeEmailSubjectLine("Finish math homework")).toBe(
      "Finish math homework",
    );
  });

  test("sendReminderEmail emits a single-line subject, full title in body", async () => {
    fetchBehavior = async () => jsonResponse(200, { id: "em_ok" });
    await sendReminderEmail(
      { ...PAYLOAD, taskTitle: "Evil\r\nBcc: victim@x" },
      { baseDelayMs: 1 },
    );
    expect(fetchCalls.length).toBeGreaterThan(0);
    const sent = JSON.parse(String(fetchCalls[0].init?.body)) as {
      subject: string;
      text: string;
    };
    expect(sent.subject).toBe("[H-1] Reminder: Evil Bcc: victim@x");
    expect(sent.subject).not.toContain("\r");
    expect(sent.subject).not.toContain("\n");
  });
});

describe("RF-11 — late labeling", () => {
  const base = {
    to: "user@example.com",
    taskTitle: "Task",
    daysBefore: 1,
    deadlineIso: "2026-09-11T15:59:00.000Z",
    timeZone: "UTC",
    deliveryId: "dlv-1",
  };

  test("on-time reminder has no late tag", () => {
    const body = buildReminderEmailBody(base);
    expect(body.subject).toBe("[H-1] Reminder: Task");
    expect(body.text).not.toContain("LATE");
  });

  test("late reminder tags subject and body", () => {
    const body = buildReminderEmailBody({ ...base, late: true });
    expect(body.subject).toBe("[H-1] [LATE] Reminder: Task");
    expect(body.text).toContain("Reminder (H-1) [LATE]");
    expect(body.text).toContain("delivered late");
  });
});

describe("F-07 — deadline rendered in the recipient timezone", () => {
  test("Makassar profile sees local day/time with GMT+8, not UTC", () => {
    // Deadline Friday 2026-09-11 23:59 Asia/Makassar = 15:59 UTC.
    const out = formatDeadlineForEmail(
      "2026-09-11T15:59:00.000Z",
      "Asia/Makassar",
    );
    expect(out).toContain("September 11, 2026");
    expect(out).toContain("11:59 PM");
    expect(out).toContain("GMT+8");
    expect(out).not.toContain("(UTC)");
    expect(out).not.toContain("3:59 PM");
  });

  test("UTC profile keeps UTC rendering", () => {
    const out = formatDeadlineForEmail("2026-09-11T15:59:00.000Z", "UTC");
    expect(out).toContain("3:59 PM");
    expect(out).toContain("UTC");
  });

  test("unknown timezone falls back to UTC without throwing", () => {
    const out = formatDeadlineForEmail(
      "2026-09-11T15:59:00.000Z",
      "Not/AZone",
    );
    expect(out).toContain("3:59 PM");
    expect(out).toContain("UTC");
  });

  test("sent body carries the profile-timezone rendering", async () => {
    fetchBehavior = async () => jsonResponse(200, { id: "em_ok" });
    await sendReminderEmail(
      {
        ...PAYLOAD,
        deadlineIso: "2026-09-11T15:59:00.000Z",
        timeZone: "Asia/Makassar",
      },
      { baseDelayMs: 1 },
    );
    const sent = JSON.parse(String(fetchCalls[0].init?.body)) as {
      text: string;
    };
    expect(sent.text).toContain("11:59 PM");
    expect(sent.text).not.toContain("(UTC)");
  });
});
