-- Issue #166: public.get_user_summary is SECURITY DEFINER with tenancy bound
-- to the caller-supplied p_user_id, and no migration ever limited EXECUTE on
-- it — so any client role holding the publishable key could invoke it over
-- PostgREST with an arbitrary user id.
--
-- Revoke client EXECUTE. This does not touch the server-side callers
-- (apps/api/src/routes/summary.ts, bootstrap.ts): the API reaches the
-- function over a direct postgres-role connection (DATABASE_URL), never as
-- anon/authenticated. The function body is intentionally unchanged —
-- rebinding tenancy to auth.uid() would break those callers, whose getDb()
-- sessions carry no JWT claims.
revoke execute on function public.get_user_summary(uuid, text, timestamptz)
  from public, anon, authenticated;
