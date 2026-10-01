/** Canonical auth client messages aligned with the Error Handling Copy System. */

export const AUTH_ERRORS = {
  invalidCredentials: "The email or password doesn't match our records.",
  invalidDetails: "Some fields need your attention before you can continue.",
  unableToComplete: "Something went wrong while processing your request. Please try again.",
  unauthorized: "You don't have permission to perform this action.",
  rateLimited: "Please wait a moment before trying again.",
  sessionExpired: "Sign in again to continue.",
  invalidReset: "This password reset link is no longer valid. Request a new one to continue.",
  registrationFailed: "We couldn't create this account. Please try again.",
  accountAlreadyExists: "An account with this email already exists.",
  invalidCurrentPassword: "The password you entered is incorrect.",
  emailUnavailable: "An account with this email already exists.",
} as const;

export function logAuthProviderError(
  context: string,
  error: { message?: string } | null | undefined,
): void {
  if (!error?.message) return;
  console.warn(`[auth] ${context}:`, error.message);
}

