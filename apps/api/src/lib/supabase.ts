import { createClient } from "@supabase/supabase-js";

import { resolveSupabaseAnonKey, resolveSupabaseUrl, env } from "../env";
import { fetchWithTimeout } from "./net";

/**
 * Outbound timeouts for Supabase HTTP (Finding #8). Auth clients carry
 * short-lived JSON calls; the service client carries storage transfers
 * (up to 10 MiB uploads), so it gets a longer bound. No automatic retry
 * here: auth flows include session-creating mutations and single-use
 * OTP/code exchanges where a blind retry is unsafe — callers that need
 * retries (idempotent storage ops, Resend) add them explicitly.
 */
export const SUPABASE_AUTH_TIMEOUT_MS = 10_000;
export const SUPABASE_STORAGE_TIMEOUT_MS = 20_000;

function timeoutEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Overridable for tests (`SUPABASE_AUTH_TIMEOUT_MS`). */
export function supabaseAuthTimeoutMs(): number {
  return timeoutEnv("SUPABASE_AUTH_TIMEOUT_MS", SUPABASE_AUTH_TIMEOUT_MS);
}

/** Overridable for tests (`SUPABASE_STORAGE_TIMEOUT_MS`). */
export function supabaseStorageTimeoutMs(): number {
  return timeoutEnv(
    "SUPABASE_STORAGE_TIMEOUT_MS",
    SUPABASE_STORAGE_TIMEOUT_MS,
  );
}

function timeoutFetch(timeoutMs: number): typeof fetch {
  const timed = (url: string | URL | Request, init?: RequestInit) =>
    fetchWithTimeout(url, init ?? {}, timeoutMs);
  // The SDK only ever calls fetch(url, init); statics on the lib-dom fetch
  // type (e.g. `preconnect`) are never used, so this cast is safe.
  return timed as unknown as typeof fetch;
}

function authClientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: timeoutFetch(supabaseAuthTimeoutMs()),
    },
  } as const;
}

export function createAnonClient() {
  return createClient(
    resolveSupabaseUrl(),
    resolveSupabaseAnonKey(),
    authClientOptions(),
  );
}

export function createServiceClient() {
  return createClient(resolveSupabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: timeoutFetch(supabaseStorageTimeoutMs()),
    },
  });
}

export function createUserClient(accessToken: string) {
  return createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: timeoutFetch(SUPABASE_AUTH_TIMEOUT_MS),
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
