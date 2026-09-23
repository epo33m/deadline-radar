-- L-5: Profile Email Immutability and Transaction-Local Auth Synchronization Guard
-- 1. Sets transaction-local marker 'app.in_auth_sync' = 'true' within handle_user_email_change()
-- 2. Enforces compound guard (app.in_auth_sync = 'true' AND pg_trigger_depth() > 1) in enforce_profile_email_immutable()
-- 3. Updates profiles.updated_at on email synchronization

CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    -- Transaction-local trusted sync marker (discarded at COMMIT/ROLLBACK)
    PERFORM set_config('app.in_auth_sync', 'true', true);

    UPDATE public.profiles
    SET
      email = NEW.email,
      updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_profile_email_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Permitted ONLY if called from a parent trigger (depth > 1) AND trusted sync marker is active
  IF current_setting('app.in_auth_sync', true) = 'true'
     AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Block any other update attempting to alter profiles.email directly
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Direct modification of profiles.email is forbidden. Use auth email change workflow.';
  END IF;

  RETURN NEW;
END;
$$;
