import { ApiError } from "../api/errors";
import { AUTH_ERRORS } from "../auth-errors";

export const AUTHZ_ERRORS = {
  unauthorized: AUTH_ERRORS.unauthorized,
  forbidden: "Forbidden",
  notFound: "Not found",
} as const;

/** Prefer throwing ApiError so the global error handler formats the envelope. */
export function unauthorizedResponse(): never {
  throw ApiError.unauthorized(AUTHZ_ERRORS.unauthorized);
}

export function forbiddenResponse(): never {
  throw ApiError.forbidden(AUTHZ_ERRORS.forbidden);
}
