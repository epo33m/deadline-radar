import { createClient } from "@supabase/supabase-js";

import { resolveSupabaseAnonKey, resolveSupabaseUrl, env } from "../env";

export function createAnonClient() {
  return createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function createServiceClient() {
  return createClient(
    resolveSupabaseUrl(),
    env.supabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export function createUserClient(accessToken: string) {
  return createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
