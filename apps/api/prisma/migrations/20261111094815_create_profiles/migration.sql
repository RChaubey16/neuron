-- Prisma Migrate's shadow database (used by `migrate dev`) has no Supabase
-- `auth` schema. Create a minimal stand-in there so the trigger below can
-- be attached. On Supabase, auth.users already exists and this block does
-- nothing.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- Only NestJS (as the table owner) reads this table. RLS with no policies
-- blocks the Supabase Data API roles (anon, authenticated).
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;

-- Delete the profile when its Supabase user is deleted. This replaces an
-- ON DELETE CASCADE foreign key, which Prisma cannot introspect across
-- schemas. SECURITY DEFINER runs it as the table owner, because Supabase
-- deletes users as `supabase_auth_admin`, which has no access to profiles.
CREATE FUNCTION public.delete_profile_of_deleted_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

-- Trigger functions cannot be called directly, but keep the function
-- private anyway (Supabase grants EXECUTE on new public functions).
REVOKE EXECUTE ON FUNCTION public.delete_profile_of_deleted_user() FROM PUBLIC;
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.delete_profile_of_deleted_user() FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;

CREATE TRIGGER on_auth_user_deleted_delete_profile
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.delete_profile_of_deleted_user();
