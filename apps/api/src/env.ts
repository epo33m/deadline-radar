function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
  /** Only trust X-Forwarded-For / X-Real-IP when behind a known reverse proxy. */
  trustProxy: () => process.env.TRUST_PROXY === "true",
  webOrigin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
};

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
