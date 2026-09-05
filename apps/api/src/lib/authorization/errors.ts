import { AUTH_ERRORS } from "../auth-errors";

export const AUTHZ_ERRORS = {
  unauthorized: AUTH_ERRORS.unauthorized,
  forbidden: "Forbidden",
  notFound: "Not found",
} as const;

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: AUTHZ_ERRORS.unauthorized }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: AUTHZ_ERRORS.forbidden }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
