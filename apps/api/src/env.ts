import { assertReminderCutoffConfigured } from "./lib/reminder-cutoff";
import { assertResendConfigured } from "./lib/resend-config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Fail-fast production configuration validation (I-6).
 * Called at API boot and unit-tested. Only ever emits the missing variable
 * name — never a secret value — and only constrains NODE_ENV=production so
 * that local development and CI can boot without secrets.
 */
export function assertStartupConfig(): void {
  if (process.env.NODE_ENV !== "production") return;

  if (!process.env.CRON_SECRET) {
    throw new Error(
      "CRON_SECRET is required when NODE_ENV=production: the cron endpoint would otherwise boot without authentication.",
    );
  }
  if (!process.env.AUTH_BRIDGE_SECRET) {
    throw new Error(
      "AUTH_BRIDGE_SECRET is required when NODE_ENV=production (Next.js to API auth bridge)",
    );
  }
  if (!process.env.REDIS_URL) {
    throw new Error(
      "REDIS_URL is required when NODE_ENV=production: rate limiting and login throttling fall back to process-local memory without it, granting N× the configured budget behind N replicas (SEC-007).",
    );
  }

  // RF-11: the F-03 burst guard silently degrades without a valid
  // REMINDER_CUTOFF_ISO — refuse to boot when it's missing or invalid.
  assertReminderCutoffConfigured();

  // RF-13: the reminder pipeline silently misbehaves (sandbox sender,
  // fail-every-delivery) without valid Resend config — refuse to boot.
  assertResendConfigured();
}

export const env = {
  port: Number(process.env.API_PORT ?? 4025),
  databaseUrl: () => required("DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseAnonKey: () => required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Optional legacy HS256 secret; asymmetric ES256 uses JWKS. */
  supabaseJwtSecret: () => process.env.SUPABASE_JWT_SECRET,
  resendApiKey: () => process.env.RESEND_API_KEY,
  resendFromEmail:
    process.env.RESEND_FROM_EMAIL ??
    "Deadline Radar <onboarding@resend.dev>",
  cronSecret: () => process.env.CRON_SECRET,
  /** Shared secret for Next→API auth bridge token JSON (never "1"). */
  authBridgeSecret: () => process.env.AUTH_BRIDGE_SECRET,
  redisUrl: () => process.env.REDIS_URL,
  webOrigin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get isTest() {
    return process.env.NODE_ENV === "test";
  },
  /** RF-12: per-run scheduler caps. Lenient by design (RF-13 rules): a bad
   * perf knob must never fail boot — warn once and fall back to the caller's
   * default. The evaluator clamps maxRunDurationMs below the lock horizon. */
  maxTasksPerRun: () =>
    lenientPositiveInt("MAX_TASKS_PER_RUN", "RF-12 scheduler task cap"),
  maxRunDurationMs: () =>
    lenientPositiveInt("MAX_RUN_DURATION_MS", "RF-12 scheduler run deadline"),
  /** RF-14: expected interval between scheduler runs; the /health/cron gate
   * declares the scheduler unhealthy after 2× this. Lenient, default 1h. */
  runIntervalMs: () =>
    lenientPositiveInt("REMINDER_RUN_INTERVAL_MS", "RF-14 scheduler run interval") ??
    3_600_000,
};

const warned = new Set<string>();

function lenientPositiveInt(name: string, label: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    warnOnce(name, `${label} must be a positive integer, got "${raw}"`);
    return undefined;
  }
  return parsed;
}

function warnOnce(name: string, message: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[env] ${message}; using default.`);
}

/** Prefer SUPABASE_URL; fall back to NEXT_PUBLIC_ for local monorepo envs. */
export function resolveSupabaseUrl(): string {
  return (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    required("SUPABASE_URL")
  );
}

export function resolveSupabaseAnonKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    required("SUPABASE_ANON_KEY")
  );
}
