import { Elysia, t } from "elysia";
import * as Sentry from "@sentry/bun";
import { z } from "zod";

import { env } from "../env";
import { runEvaluateReminders } from "../services/run-evaluate";
import { ApiError } from "../lib/api/errors";
import { timingSafeEqualString } from "../lib/auth-bridge";
import { apiDoc, envelope } from "../lib/api";
import { purgeExpiredIdempotencyKeys } from "../lib/api/idempotency";
import { purgeExpiredAuthAuditEvents } from "../lib/auth-audit-retention";
import { isSystemicReminderFailure } from "../lib/reminder-alert";

function authorizeCron(request: Request): void {
  const secret = env.cronSecret();
  // Always require CRON_SECRET except in automated tests.
  if (!secret) {
    if (env.isTest) return;
    throw ApiError.unauthorized("Cron secret not configured");
  }
  const header = request.headers.get("authorization");
  // Constant-time compare (Finding #11): same generic 401 for missing,
  // malformed, or wrong secrets; nothing secret is logged.
  if (!header || !timingSafeEqualString(header, `Bearer ${secret}`)) {
    throw ApiError.unauthorized();
  }
}

function parseSimulatedNow(raw: unknown): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw ApiError.validation("Invalid simulated_now parameter", [
      { field: "simulated_now", message: "Must be a valid ISO-8601 string" },
    ]);
  }
  const parsed = z.string().datetime({ offset: true }).safeParse(raw);
  if (!parsed.success) {
    throw ApiError.validation("Invalid simulated_now parameter", [
      { field: "simulated_now", message: "Must be a valid ISO-8601 string" },
    ]);
  }
  const d = new Date(parsed.data);
  if (Number.isNaN(d.getTime())) {
    throw ApiError.validation("Invalid simulated_now parameter", [
      { field: "simulated_now", message: "Must be a valid ISO-8601 string" },
    ]);
  }
  return d;
}

export const cronRoutes = new Elysia({ prefix: "/api/v1/cron" }).get(
  "/evaluate-reminders",
  async ({ request, query }) => {
    authorizeCron(request);

    // Deterministic clock override: enabled only in non-production environments.
    // In production, real server time (undefined -> new Date()) is always enforced.
    const rawSimulated = query?.simulated_now ?? query?.simulatedNow;
    const simulatedNow = env.isProduction ? undefined : parseSimulatedNow(rawSimulated);

    await purgeExpiredIdempotencyKeys().catch((error) => {
      console.error(
        "[cron] purgeExpiredIdempotencyKeys failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    });
    await purgeExpiredAuthAuditEvents().catch((error) => {
      console.error(
        "[cron] purgeExpiredAuthAuditEvents failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    });
    const startedAt = Date.now();
    // RF-12: cron runs bounded — MAX_TASKS_PER_RUN / MAX_RUN_DURATION_MS keep a
    // single invocation inside the host timeout; a truncated run records it on
    // the ledger and the next scheduled run mops up the remainder. Passing the
    // env values explicitly so the cron surface stays explicit about its bounds.
    // I-01: the 200 {ok:true} contract holds even when the run aborts
    // mid-batch (batch/infra failure). The service already finalized the
    // ledger as error before rethrowing, so the catch below only converts the
    // transport outcome — the hard alert still fires out-of-band via Sentry
    // (never silenced as success). Scoped narrowly around the service call so
    // auth/validation ApiErrors above still map to 401/400.
    let result: Awaited<ReturnType<typeof runEvaluateReminders>>;
    try {
      result = await runEvaluateReminders(simulatedNow, {
        maxTasksPerRun: env.maxTasksPerRun(),
        maxRunDurationMs: env.maxRunDurationMs(),
      });
    } catch (error) {
      console.error(
        "[cron] evaluate-reminders failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      Sentry.captureException(error);
      return { ok: true };
    }
    const durationMs = Date.now() - startedAt;
    // F-06: the response contract stays `200 {ok:true}` (SEC-008) — a total
    // delivery blackout is signaled out-of-band instead. No-op without
    // SENTRY_DSN, same as the existing 5xx capture; context is counts-only
    // (no PII), safe under the beforeSend scrub.
    // RF-04: a single-flight skip is a normal no-op, not an incident.
    // NEW-01: a lock-unavailable abort (DB could not grant single-flight) is
    // an infrastructure signal — alert out-of-band, keep the 200 contract.
    // I-01: a run that contained row-level DB failures is neither clean
    // "ok" nor a "blackout" — it completed with a ledger error. The outcome
    // stays in the log/Sentry (never in the HTTP body per SEC-008).
    const outcome = result.skipped
      ? "skipped"
      : result.lockUnavailable
        ? "lock-unavailable"
        : isSystemicReminderFailure(result)
          ? "blackout"
          : result.rowErrors > 0
            ? "partial"
            : "ok";
    if (outcome === "lock-unavailable") {
      Sentry.withScope((scope) => {
        scope.setLevel("warning");
        scope.setExtras({ runId: result.runId, durationMs });
        Sentry.captureMessage(
          "reminder run lock unavailable: single-flight not granted (DB?)",
        );
      });
    }
    if (outcome === "blackout") {
      Sentry.withScope((scope) => {
        scope.setLevel("error");
        scope.setExtras({
          runId: result.runId,
          evaluatedTasks: result.evaluatedTasks,
          created: result.created,
          retried: result.retried,
          emailsSent: result.emailsSent,
          emailsFailed: result.emailsFailed,
          emailsPoisoned: result.emailsPoisoned,
          emailsSkippedQuota: result.emailsSkippedQuota,
          truncated: result.truncated,
          durationMs,
        });
        Sentry.captureMessage("reminder delivery blackout: all attempted sends failed");
      });
    }
    // RF-14: a run capped by MAX_TASKS_PER_RUN / MAX_RUN_DURATION_MS is a
    // capacity signal, not an error — but it's silent in normal ops unless a
    // human reads the log queue. Warn proactively so a tenant at the cap gets
    // attention before reminders start lagging. Suppressed when the blackout
    // alert already fired (its extras already carry `truncated`). No-op
    // without SENTRY_DSN.
    if (result.truncated && outcome !== "blackout") {
      Sentry.withScope((scope) => {
        scope.setLevel("warning");
        scope.setExtras({
          runId: result.runId,
          evaluatedTasks: result.evaluatedTasks,
          created: result.created,
          retried: result.retried,
          emailsSent: result.emailsSent,
          emailsFailed: result.emailsFailed,
          truncated: true,
          durationMs,
        });
        Sentry.captureMessage("reminder run truncated: per-run caps reached before full scan");
      });
    }
    // I-01: a partial run (contained row errors, ledger error) warns
    // out-of-band like the truncation signal — counts only, no PII, same as
    // the existing blackout/truncation alerts. No-op without SENTRY_DSN.
    if (outcome === "partial") {
      Sentry.withScope((scope) => {
        scope.setLevel("warning");
        scope.setExtras({
          runId: result.runId,
          rowErrors: result.rowErrors,
          evaluatedTasks: result.evaluatedTasks,
          emailsSent: result.emailsSent,
          emailsFailed: result.emailsFailed,
          durationMs,
        });
        Sentry.captureMessage(
          "reminder run partial: row-level DB failures contained, batch completed",
        );
      });
    }
    // SEC-008 (least-info): the scheduler only needs success/failure.
    // Volume metrics stay in the server log, never in the HTTP response.
    // runId correlates the log line with the reminder_runs ledger row (F-04).
    console.log(
      "[cron] evaluate-reminders finished:",
      JSON.stringify({
        runId: result.runId,
        outcome,
        durationMs,
        truncated: result.truncated,
        evaluatedTasks: result.evaluatedTasks,
        created: result.created,
        retried: result.retried,
        emailsSent: result.emailsSent,
        emailsFailed: result.emailsFailed,
        emailsPoisoned: result.emailsPoisoned,
        emailsSkippedQuota: result.emailsSkippedQuota,
        rowErrors: result.rowErrors,
      }),
    );
    return { ok: true };
  },
  {
    query: t.Object({
      simulated_now: t.Optional(t.String()),
      simulatedNow: t.Optional(t.String()),
    }),
    detail: {
      tags: ["Cron"],
      summary: "Evaluate reminder thresholds and send notifications",
      description:
        "Server-only scheduler entrypoint. Requires " +
        "`Authorization: Bearer <CRON_SECRET>`. Also purges expired " +
        "idempotency keys and (when AUTH_AUDIT_RETENTION_DAYS is set) " +
        "expired auth audit events. Supports optional `simulated_now` (ISO-8601) in non-production environments.",
      security: [{ cronSecret: [] }],
      ...apiDoc({
        ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
        errors: [400, 401, 429],
      }),
    },
  },
);
