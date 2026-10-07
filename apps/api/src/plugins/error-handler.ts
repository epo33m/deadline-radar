import { Elysia } from "elysia";
import * as Sentry from "@sentry/bun";

import {
  ApiError,
  API_ERROR_CODES,
  toErrorBody,
  normalizeRequestId,
  extractClientRequestId,
  requestIdPlugin,
} from "../lib/api";
import { ForbiddenFieldError } from "../lib/authorization/field-policy";
import { isTransientConnectionError } from "../lib/process-guard";

function requestIdFromContext(ctx: {
  requestId?: string;
  request: Request;
}): string {
  if (typeof ctx.requestId === "string" && ctx.requestId.length > 0) {
    return ctx.requestId;
  }
  return normalizeRequestId(extractClientRequestId(ctx.request));
}

/**
 * Detect an Elysia file-size validation failure (#138).
 * `t.File({ maxSize })` violations surface as `code: "VALIDATION"` with the
 * file schema (carrying `maxSize`) at `valueError`. Wrong-MIME failures use
 * `INVALID_FILE_TYPE` and must stay 400 — only size maps to 413.
 */
function isFileSizeValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  // Only the failing property's own schema counts: the upload route always
  // declares `file.maxSize`, so inspecting the route schema would misclassify
  // unrelated failures (e.g. notes maxLength) as 413.
  const valueError = record["valueError"] as
    | { path?: unknown; schema?: unknown }
    | undefined;
  const schema = valueError?.schema as { maxSize?: unknown } | undefined;
  return !!schema && typeof schema.maxSize !== "undefined";
}

/**
 * Maps all failures to the stable API error envelope.
 * Never leaks stack traces, SQL, or provider internals.
 */
export const errorHandlerPlugin = new Elysia({
  name: "error-handler",
})
  .use(requestIdPlugin)
  .onError({ as: "global" }, ({ error, set, request, requestId }) => {
  const rid = requestIdFromContext({ requestId, request });
  set.headers["X-Request-Id"] = rid;
  set.headers["content-type"] = "application/json";

  if (error instanceof ApiError) {
    set.status = error.status;
    // 5xx only: routine 4xx (validation, authz, rate limits) stay out of Sentry.
    if (error.status >= 500) Sentry.captureException(error);
    return toErrorBody(error, rid);
  }

  if (error instanceof ForbiddenFieldError) {
    set.status = 400;
    return toErrorBody(
      ApiError.validation("Forbidden fields in request body", [
        {
          field: error.fields.join(","),
          message: "These fields cannot be set by the client",
        },
      ]),
      rid,
    );
  }

  // #138: Bun/Elysia surface oversized bodies without our ApiError.
  // A 413 status, or a VALIDATION failure against a `t.File({ maxSize })`
  // schema, must use the standard 413 envelope (not 400/422).
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (((error as { code?: string }).code === "VALIDATION" &&
      isFileSizeValidationError(error)) ||
      (error as { status?: number }).status === 413)
  ) {
    set.status = 413;
    return toErrorBody(ApiError.payloadTooLarge(), rid);
  }

  // Elysia validation (TypeBox)
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ((error as { code?: string }).code === "VALIDATION" ||
      (error as { code?: string }).code === "INVALID_FILE_TYPE")
  ) {
    set.status = 400;
    return toErrorBody(
      ApiError.validation("Request validation failed", [
        {
          message:
            typeof (error as { message?: string }).message === "string"
              ? (error as { message: string }).message
              : "Invalid request",
        },
      ]),
      rid,
    );
  }

  // Elysia route miss
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "NOT_FOUND"
  ) {
    set.status = 404;
    return toErrorBody(ApiError.notFound(), rid);
  }

  // PostgreSQL foreign key violation (23503)
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ((error as { code?: string | number }).code === "23503" ||
      (error as { code?: string | number }).code === 23503)
  ) {
    set.status = 400;
    return toErrorBody(
      ApiError.validation(
        "Invalid referenced resource or cross-owner violation",
        [{ message: "Referenced resource does not exist or owner mismatch" }],
      ),
      rid,
    );
  }

  // Thrown Response (legacy auth helpers) — rewrite body when possible
  if (error instanceof Response) {
    set.status = error.status;
    const status = error.status;
    const code =
      status === 401
        ? API_ERROR_CODES.UNAUTHORIZED
        : status === 403
          ? API_ERROR_CODES.FORBIDDEN
          : status === 404
            ? API_ERROR_CODES.NOT_FOUND
            : status === 429
              ? API_ERROR_CODES.RATE_LIMITED
              : API_ERROR_CODES.INTERNAL;
    return toErrorBody(
      new ApiError({
        status,
        code,
        message:
          status === 401
            ? "Authentication required."
            : status === 403
              ? "Forbidden"
              : status === 404
                ? "Not found"
                : status === 429
                  ? "Too many requests. Slow down and try again."
                  : "Request failed",
      }),
      rid,
    );
  }

  // Issue #89: transient connection failures (socket ETIMEDOUT, dropped
  // pool connections, Supabase-side stalls) degrade to a per-request 500.
  // The envelope is the same generic internal error — no SQL or provider
  // internals leak — only the log tag distinguishes the cause.
  if (isTransientConnectionError(error)) {
    console.error(
      "[api] transient db/connection error",
      rid,
      error instanceof Error ? error.message : error,
    );
    Sentry.captureException(error);
    set.status = 500;
    return toErrorBody(ApiError.internal(), rid);
  }

  console.error("[api] unhandled error", rid, error);
  Sentry.captureException(error);
  set.status = 500;
  return toErrorBody(ApiError.internal(), rid);
});
