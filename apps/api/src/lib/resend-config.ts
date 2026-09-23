/**
 * RF-13: fail-closed production configuration for Resend delivery.
 *
 * The reminder pipeline silently misbehaves in production when the Resend
 * sender configuration is wrong:
 *  - missing/malformed RESEND_API_KEY   → every delivery fails, run after
 *    run (loud blackout alerts, but the deployment is broken on arrival);
 *  - missing/invalid RESEND_FROM_EMAIL  → falls back to the sandbox sender
 *    `<…>@resend.dev` (silent, deliverability + trust damage).
 *
 * Production therefore refuses to boot without a valid pair; development/test
 * stay untouched so local work and CI can boot without secrets. The sandbox
 * domain itself is warned about, not thrown on, so a legitimate transition
 * sender stays bootable while the owner is reminded to switch.
 */

export const RESEND_API_KEY_ENV = "RESEND_API_KEY";
export const RESEND_FROM_EMAIL_ENV = "RESEND_FROM_EMAIL";

export function isResendApiKeyShape(value: string): boolean {
  return /^re_[A-Za-z0-9_-]+$/.test(value);
}

/** Accepts the forms `Name <local@domain>` and bare `local@domain`. */
export function extractEmailFromHeader(value: string): string | null {
  const match = /<([^\s<>]+)>/.exec(value) ?? [null, value.trim()];
  const email = (match[1] ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isSandboxFromEmail(value: string): boolean {
  const email = extractEmailFromHeader(value);
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domain === "resend.dev" || domain.endsWith(".resend.dev");
}

/**
 * Returns a human-readable problem, or null when both Resend env values are
 * valid. Pure so it is unit-testable without touching process.env.
 */
export function resendConfigProblem(
  envSnapshot: {
    apiKey?: string;
    fromEmail?: string;
  },
): string | null {
  const { apiKey, fromEmail } = envSnapshot;

  if (!apiKey || apiKey.trim() === "") {
    return `${RESEND_API_KEY_ENV} is required when NODE_ENV=production: without it every email delivery fails at send time.`;
  }
  if (!isResendApiKeyShape(apiKey.trim())) {
    return `${RESEND_API_KEY_ENV} must look like a Resend key (starts with "re_") when NODE_ENV=production.`;
  }

  if (!fromEmail || fromEmail.trim() === "") {
    return `${RESEND_FROM_EMAIL_ENV} is required when NODE_ENV=production: without it reminders silently come from the sandbox sender.`;
  }
  if (!extractEmailFromHeader(fromEmail)) {
    return `${RESEND_FROM_EMAIL_ENV} must be a valid address (e.g. "Deadline Radar <reminders@yourdomain.com>") when NODE_ENV=production.`;
  }

  return null;
}

export function assertResendConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;

  const problem = resendConfigProblem({
    apiKey: process.env[RESEND_API_KEY_ENV],
    fromEmail: process.env[RESEND_FROM_EMAIL_ENV],
  });
  if (problem) throw new Error(problem);

  if (process.env[RESEND_FROM_EMAIL_ENV] && isSandboxFromEmail(process.env[RESEND_FROM_EMAIL_ENV])) {
    console.warn(
      `[env] ${RESEND_FROM_EMAIL_ENV} uses the Resend sandbox domain (resend.dev). Reminders will refuse/land in preview — switch to a verified domain before launch.`,
    );
  }
}