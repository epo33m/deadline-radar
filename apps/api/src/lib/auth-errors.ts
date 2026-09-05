/** Generic auth client messages — avoid account enumeration and secret leakage. */

export const AUTH_ERRORS = {
  invalidCredentials: "Invalid credentials.",
  invalidDetails: "Invalid request details.",
  unableToComplete: "Unable to complete request. Please try again.",
  unauthorized: "Unauthorized",
  rateLimited: "Too many requests. Slow down and try again.",
  sessionExpired: "Session expired. Please sign in again.",
  invalidReset: "Invalid or expired reset session. Request a new reset link.",
  registrationFailed: "Unable to complete registration. Please try again.",
} as const;

export function logAuthProviderError(
  context: string,
  error: { message?: string } | null | undefined,
): void {
  if (!error?.message) return;
  console.warn(`[auth] ${context}:`, error.message);
}
