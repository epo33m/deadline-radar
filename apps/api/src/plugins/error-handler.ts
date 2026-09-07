import { Elysia } from "elysia";

import {
  ApiError,
  API_ERROR_CODES,
  toErrorBody,
  normalizeRequestId,
  extractClientRequestId,
  requestIdPlugin,
} from "../lib/api";
import { ForbiddenFieldError } from "../lib/authorization/field-policy";

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

  // Elysia validation (TypeBox)
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "VALIDATION"
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

  console.error("[api] unhandled error", rid, error);
  set.status = 500;
  return toErrorBody(ApiError.internal(), rid);
});
