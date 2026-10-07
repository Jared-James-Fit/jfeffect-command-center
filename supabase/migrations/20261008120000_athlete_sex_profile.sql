-- Athlete sex, asked once and stored once.
--
-- clients.sex is the source of truth: 'male' | 'female' | 'unspecified'
-- ("prefer not to say" is an answer, so the app stops asking). NULL means
-- never asked. It feeds powerlifting standards/divisions, analytics and the
-- nutrition form's pre-filled default.
--
-- app_members.biological_sex (the macro calculator's field, male/female only)
-- stays in sync both ways, so whichever screen the athlete answers on, every
-- feature sees the same value.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS sex_updated_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.clients
    ADD CONSTRAINT clients_sex_check
    CHECK (sex IS NULL OR sex IN ('male', 'female', 'unspecified'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.clients.sex IS
  'male | female | unspecified (prefer not to say). NULL = not asked yet. Synced with app_members.biological_sex.';

-- Backfill from what's already on file.
UPDATE public.clients c
SET sex = m.biological_sex, sex_updated_at = now()
FROM public.app_members m
WHERE c.sex IS NULL
  AND c.user_id IS NOT NULL
  AND m.user_id = c.user_id
  AND m.biological_sex IN ('male', 'female');

UPDATE public.clients c
SET sex = lower(pa.sex), sex_updated_at = now()
FROM public.powerlifting_athletes pa
WHERE c.sex IS NULL
  AND pa.client_id = c.id
  AND lower(pa.sex) IN ('male', 'female');

-- Stamp when the answer changes.
CREATE OR REPLACE FUNCTION public.clients_stamp_sex()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.sex IS DISTINCT FROM OLD.sex THEN
    NEW.sex_updated_at := CASE WHEN NEW.sex IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_stamp_sex_trg ON public.clients;
CREATE TRIGGER clients_stamp_sex_trg
  BEFORE INSERT OR UPDATE OF sex ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_stamp_sex();

-- clients → app_members. The member column only holds male/female, so
-- "prefer not to say" (or a cleared answer) clears it rather than leaving an
-- old value behind.
CREATE OR REPLACE FUNCTION public.clients_sync_sex_to_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_members
  SET biological_sex = CASE WHEN NEW.sex IN ('male', 'female') THEN NEW.sex END
  WHERE user_id = NEW.user_id
    AND biological_sex IS DISTINCT FROM (CASE WHEN NEW.sex IN ('male', 'female') THEN NEW.sex END);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS clients_sync_sex_to_member_trg ON public.clients;
CREATE TRIGGER clients_sync_sex_to_member_trg
  AFTER UPDATE OF sex ON public.clients
  FOR EACH ROW
  WHEN (NEW.sex IS DISTINCT FROM OLD.sex AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.clients_sync_sex_to_member();

-- app_members → clients (an answer in the macro calculator counts too).
CREATE OR REPLACE FUNCTION public.members_sync_sex_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.clients
  SET sex = NEW.biological_sex
  WHERE user_id = NEW.user_id
    AND sex IS DISTINCT FROM NEW.biological_sex;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS members_sync_sex_to_client_trg ON public.app_members;
CREATE TRIGGER members_sync_sex_to_client_trg
  AFTER INSERT OR UPDATE OF biological_sex ON public.app_members
  FOR EACH ROW
  WHEN (NEW.biological_sex IS NOT NULL AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.members_sync_sex_to_client();

REVOKE ALL ON FUNCTION public.clients_stamp_sex() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clients_sync_sex_to_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.members_sync_sex_to_client() FROM PUBLIC, anon, authenticated;
