-- ============================================================================
-- verify-prod.sql — Deadline Radar production verification (READ-ONLY)
-- Tempel seluruh file ini ke Supabase Dashboard → SQL editor → Run.
-- Tidak menulis apa pun: hanya SELECT ke katalog Postgres.
--
-- Hasil yang diharapkan (kontrak saat ini):
--   §1: 12 tabel public, semuanya rowsecurity = true
--   §2: 17 policy publik sesuai daftar (0 policy = tolak total:
--       audit/rbac/idempotency/reminder_runs)
--   §3: bucket attachments public = false
--   §4: fungsi SECURITY DEFINER yang dikenal (4–5, semua pin search_path)
--   §5: versi migrasi == jumlah file di supabase/migrations/ (bandingkan manual)
--   §7: trigger kuota SEC-003 ada + enabled (task 200, thresholds 10)
-- Runbook migrasi (di laptop/CI, BUKAN di SQL editor):
--   1. isi DATABASE_URL project prod di env lokal (jangan commit)
--   2. bun run db:migrate        # terapkan yang pending (Supabase CLI)
--   3. bun run db:verify         # pastikan nol pending
--   4. tempel file ini di SQL editor, cocokkan dengan ekspektasi di atas
-- ============================================================================

-- §1 — RLS aktif per tabel ---------------------------------------------------
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'auth_audit_events', 'roles', 'role_capabilities',
    'user_roles', 'courses', 'idempotency_keys', 'tasks',
    'reminder_runs', 'reminder_thresholds', 'notification_deliveries',
    'attachments'
  )
ORDER BY tablename;

-- §1b — Gate fail-closed RLS (harus 12; tabel hilang / non-RLS → error) --------
DO $$
DECLARE
  v_expected integer := 12;
  v_actual   integer;
BEGIN
  SELECT count(*)
    INTO v_actual
    FROM pg_tables t
   WHERE t.schemaname = 'public'
     AND t.tablename IN (
       'profiles', 'auth_audit_events', 'roles', 'role_capabilities',
       'user_roles', 'courses', 'idempotency_keys', 'tasks',
       'reminder_runs', 'reminder_thresholds', 'notification_deliveries',
       'attachments'
     )
     AND t.rowsecurity;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION
      'RLS verification FAILED: expected % RLS-enabled tables (public), found %',
      v_expected, v_actual;
  END IF;
END
$$;

-- §2 — Daftar policy (USING = qual, WITH CHECK = with_check) -----------------
SELECT tablename, policyname, cmd, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- §2b — Gate fail-closed policy (harus 17 policy publik) -----------------------
DO $$
DECLARE
  v_expected integer := 17;
  v_actual   integer;
BEGIN
  SELECT count(*)
    INTO v_actual
    FROM pg_policies
   WHERE schemaname = 'public';
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION
      'RLS policy verification FAILED: expected % public policies, found %',
      v_expected, v_actual;
  END IF;
END
$$;

-- §3 — Bucket attachments harus private --------------------------------------
SELECT id, public AS is_public FROM storage.buckets WHERE id = 'attachments';
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- §4 — Fungsi SECURITY DEFINER (audit satu per satu bila ada yang baru) ------
SELECT n.nspname AS schema, p.proname AS function
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef AND n.nspname = 'public'
ORDER BY function;

-- §5 — Riwayat migrasi terapan (bandingkan dengan supabase/migrations/) ------
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

-- §6 — Grant eksplisit ke anon/authenticated (informatif) ---------------------
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('anon', 'authenticated') AND table_schema = 'public'
ORDER BY table_name, grantee, privilege_type;

-- §7 — Kuota SEC-003 / C4: trigger backstop harus ada + enabled ----------------
-- Ekspektasi: 2 baris (BEFORE INSERT, enabled=O) + 2 fungsi INVOKER.
-- Tanpa ini, direct PostgREST INSERT tak terbatas (tasks/thresholds).
SELECT tgrelid::regclass AS table_name, tgname AS trigger_name,
       tgenabled AS enabled
FROM pg_trigger
WHERE tgname IN ('task_quota_before_insert', 'threshold_quota_before_insert')
  AND NOT tgisinternal
ORDER BY trigger_name;
SELECT routine_name AS function, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('enforce_task_quota', 'enforce_threshold_quota')
ORDER BY routine_name;
