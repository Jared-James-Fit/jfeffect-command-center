-- Account headshots (Nov 26 2026): a coaching client's private account photo, taken
-- live with the app's camera, checked on the device (face position, light, sharpness,
-- a blink and a head turn where the device can run the face model) and again on the
-- server (the capture session, timing, the evidence frames, duplicates), then accepted
-- by their coach or an admin. Separate from the Crew profile picture, which stays any
-- picture anyone likes (community_profiles.avatar_path, never touched here).
--
--   account_headshots          one row per capture: a single-use session the server
--                              issues (status 'capturing', a short expiry, the challenge
--                              order), then the submission ('pending'), then the
--                              decision ('accepted' / 'declined'), 'superseded' by a
--                              newer one, 'expired' or 'failed' (server checks).
--   account_headshot_requests  one per client: the outstanding requirement (a new
--                              client's onboarding, a staff retake request, a declined
--                              submission), its private reason and its reminder state.
--   account_headshot_events    the audit record, append-only, staff read.
--   photo_reminder_state       the person's own Crew-photo reminder dismissal.
--
-- Every write is the server's (service role, after its own checks); staff read their
-- own clients' rows (RLS), clients read nothing directly (their status comes from a
-- server function that never returns a reason or who asked). The display copy of an
-- accepted headshot is written to the avatars bucket and clients.profile_picture_url
-- by the server; the guard below stops anyone else writing the account photo columns.
-- Photos already on file are grandfathered: nothing here asks anyone for a new one.

/* ------------------------------------------------------------------ */
/* Tables                                                              */

CREATE TABLE IF NOT EXISTS public.account_headshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- who held the camera: the client's own login, or the coach for a coach-assisted photo
  user_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('guided', 'live', 'coach_assisted')),
  status text NOT NULL DEFAULT 'capturing'
    CHECK (status IN ('capturing', 'pending', 'accepted', 'declined', 'superseded', 'expired', 'failed')),
  challenge jsonb NOT NULL DEFAULT '[]'::jsonb,
  consent_version text,
  consent_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  photo_path text,
  evidence_path text,
  photo_sha256 text,
  evidence_sha256 text,
  dhash text,
  device_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  server_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags text[] NOT NULL DEFAULT '{}',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  display_path text,
  files_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_headshots_client_idx ON public.account_headshots (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_headshots_pending_idx ON public.account_headshots (submitted_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_headshots_dhash_idx ON public.account_headshots (dhash) WHERE dhash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_headshots_evidence_once ON public.account_headshots (evidence_sha256) WHERE evidence_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_headshots_photo_once ON public.account_headshots (photo_sha256) WHERE photo_sha256 IS NOT NULL;
-- one submission waiting per client
CREATE UNIQUE INDEX IF NOT EXISTS account_headshots_one_pending ON public.account_headshots (client_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.account_headshot_requests (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('onboarding', 'manual', 'review')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  -- private: staff only, never shown to the client
  reason text,
  resolved_at timestamptz,
  resolved_headshot_id uuid,
  cancelled_at timestamptz,
  reminders_sent integer NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_headshot_requests_open_idx ON public.account_headshot_requests (opened_at)
  WHERE resolved_at IS NULL AND cancelled_at IS NULL;

-- the audit record: outlives the client row on purpose (no foreign key)
CREATE TABLE IF NOT EXISTS public.account_headshot_events (
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL,
  headshot_id uuid,
  actor uuid,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_headshot_events_client_idx ON public.account_headshot_events (client_id, at DESC);

CREATE OR REPLACE FUNCTION public.tg_account_headshot_events_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('jf.allow_history_delete', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION 'The headshot record is append-only.' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS account_headshot_events_keep ON public.account_headshot_events;
CREATE TRIGGER account_headshot_events_keep BEFORE UPDATE OR DELETE ON public.account_headshot_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_account_headshot_events_keep();

CREATE TABLE IF NOT EXISTS public.photo_reminder_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  crew_dismissed_at timestamptz,
  crew_dismiss_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_account_headshots_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS account_headshots_touch ON public.account_headshots;
CREATE TRIGGER account_headshots_touch BEFORE UPDATE ON public.account_headshots
  FOR EACH ROW EXECUTE FUNCTION public.tg_account_headshots_touch();
DROP TRIGGER IF EXISTS account_headshot_requests_touch ON public.account_headshot_requests;
CREATE TRIGGER account_headshot_requests_touch BEFORE UPDATE ON public.account_headshot_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_account_headshots_touch();

/* ------------------------------------------------------------------ */
/* RLS: staff read their own clients' rows; the server writes          */

ALTER TABLE public.account_headshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_headshot_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_headshot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_reminder_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read account headshots" ON public.account_headshots;
CREATE POLICY "Staff read account headshots" ON public.account_headshots FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff read account headshot requests" ON public.account_headshot_requests;
CREATE POLICY "Staff read account headshot requests" ON public.account_headshot_requests FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff read account headshot events" ON public.account_headshot_events;
CREATE POLICY "Staff read account headshot events" ON public.account_headshot_events FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Own photo reminder state" ON public.photo_reminder_state;
CREATE POLICY "Own photo reminder state" ON public.photo_reminder_state FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.account_headshots, public.account_headshot_requests,
  public.account_headshot_events, public.photo_reminder_state FROM anon, authenticated;

/* ------------------------------------------------------------------ */
/* The private bucket: pending photos and the evidence frames          */

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('account-headshots', 'account-headshots', false, 3145728, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

-- A client's upload is allowed only into the open capture session the server issued
-- them, at its two names, before it expires (upsert is off, so nothing is overwritten).
CREATE OR REPLACE FUNCTION public.account_headshot_upload_ok(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_headshots h
     WHERE h.status = 'capturing'
       AND h.expires_at > now()
       AND h.user_id = auth.uid()
       AND _name IN (h.client_id::text || '/' || h.id::text || '/photo.jpg',
                     h.client_id::text || '/' || h.id::text || '/evidence.png')
  )
$$;

-- Reading straight from the bucket: the admin and the client's own coach. Everyone
-- else (the client included) gets a signed link from the server, for their own photo.
CREATE OR REPLACE FUNCTION public.account_headshot_read_ok(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folder text := split_part(_name, '/', 1);
BEGIN
  IF v_folder !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  RETURN public.has_role(auth.uid(), 'admin'::app_role)
      OR v_folder::uuid IN (SELECT public.coached_client_ids());
END $$;

REVOKE ALL ON FUNCTION public.account_headshot_upload_ok(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.account_headshot_read_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_headshot_upload_ok(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_headshot_read_ok(text) TO authenticated;

DROP POLICY IF EXISTS "Account headshot upload into own session" ON storage.objects;
CREATE POLICY "Account headshot upload into own session" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'account-headshots' AND public.account_headshot_upload_ok(name));
DROP POLICY IF EXISTS "Account headshot staff read" ON storage.objects;
CREATE POLICY "Account headshot staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'account-headshots' AND public.account_headshot_read_ok(name));

/* ------------------------------------------------------------------ */
/* Account photos in the avatars bucket: a coaching client's is the     */
/* admin's and their own coach's to see, never every coach's            */

CREATE OR REPLACE FUNCTION public.avatar_staff_can_read(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_folder text := (storage.foldername(_name))[1];
  v_client uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF public.has_role(v_uid, 'admin'::app_role) THEN RETURN true; END IF;
  IF NOT (public.is_coach_or_admin(v_uid) OR public.is_admin_viewer()) THEN RETURN false; END IF;
  SELECT c.id INTO v_client FROM public.clients c
   WHERE c.user_id::text = v_folder AND c.service_tier = 'coaching'
   LIMIT 1;
  -- not a coaching client's folder (a teammate's photo, a member's): as before
  IF v_client IS NULL THEN RETURN true; END IF;
  RETURN public.is_coach_or_admin(v_uid) AND v_client IN (SELECT public.coached_client_ids());
END $$;
REVOKE ALL ON FUNCTION public.avatar_staff_can_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_staff_can_read(text) TO authenticated;

DROP POLICY IF EXISTS "Read own, shared or staff avatars" ON storage.objects;
CREATE POLICY "Read own, shared or staff avatars" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      (storage.foldername(name))[1] = (SELECT (auth.uid())::text)
      OR public.avatar_is_shared(name)
      OR public.avatar_staff_can_read(name)
    )
  );

/* ------------------------------------------------------------------ */
/* Nobody but the server writes the account photo columns              */

CREATE OR REPLACE FUNCTION public.guard_clients_headshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- the server (service role, Supabase Auth's own triggers) has no signed-in user
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.profile_picture_url IS DISTINCT FROM OLD.profile_picture_url
     OR NEW.profile_picture_source IS DISTINCT FROM OLD.profile_picture_source
     OR NEW.profile_picture_updated_by IS DISTINCT FROM OLD.profile_picture_updated_by
     OR NEW.profile_picture_needs_update IS DISTINCT FROM OLD.profile_picture_needs_update
     OR NEW.profile_picture_needs_update_at IS DISTINCT FROM OLD.profile_picture_needs_update_at
     OR NEW.profile_picture_needs_update_reason IS DISTINCT FROM OLD.profile_picture_needs_update_reason
  THEN
    RAISE EXCEPTION 'The account headshot changes only through the headshot camera and a review.'
      USING ERRCODE = '42501', HINT = 'account_headshot';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_clients_headshot ON public.clients;
CREATE TRIGGER guard_clients_headshot BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_clients_headshot();

/* ------------------------------------------------------------------ */
/* What was already on file                                            */

-- an update the coach had already asked for carries over as an open request (its words
-- become the private reason; the client now sees the standard wording)
INSERT INTO public.account_headshot_requests (client_id, kind, opened_at, reason)
SELECT c.id, 'manual', COALESCE(c.profile_picture_needs_update_at, now()), c.profile_picture_needs_update_reason
  FROM public.clients c
 WHERE c.profile_picture_needs_update
ON CONFLICT (client_id) DO NOTHING;

-- the reminder settings (the admin changes them in Settings); a client made from now on
-- is asked for a headshot as part of onboarding, nobody already here is
INSERT INTO public.app_settings (key, value)
VALUES ('photo_reminders', jsonb_build_object(
  'headshot', jsonb_build_object('enabled', true, 'follow_up_days', jsonb_build_array(3, 7, 14), 'repeat_days', 14,
                                 'required_since', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  'crew', jsonb_build_object('enabled', true, 'first_days', 7, 'second_days', 14, 'repeat_days', 30),
  'evidence_retention_days', 30
)::text)
ON CONFLICT (key) DO NOTHING;

/* ------------------------------------------------------------------ */
/* Privacy Policy: a draft that says what's collected, who sees it,    */
/* how long it's kept (published by the owner in Admin → Legal)         */

DO $do$
DECLARE
  v_doc  uuid;
  v_base public.legal_document_versions%ROWTYPE;
  v_next integer;
  v_body text;
  v_date constant text := 'November 26, 2026';
  v_section constant text := $section$Account headshots and profile pictures
Coaching clients are asked for an account headshot so their coach can recognize them and so we can keep accounts secure. It's taken live with the app's camera (a photo from your library isn't accepted). While you take it, the app checks on your device that one face is in the frame, centered, sharp and well lit, and asks you to blink and turn your head slightly so we can tell a live person from a printed or on-screen photo. This runs on your phone: no face template, faceprint or other biometric identifier is created or stored, and nothing about your face is sent to an AI service. These checks reduce simple spoofing but don't prove who you are; your coach or a JF Effect admin reviews every new headshot.
We keep your accepted headshot, plus a few small still frames from the capture and the checks' results for review. The frames are deleted within 30 days of the review. Only your assigned coach and JF Effect admins can see your headshot and its frames; other members and the Crew never do. If you'd rather not use the automatic checks, you can take the photo without them or ask your coach to take it with you in person. A headshot already on file before November 26, 2026 stays as it is.
Your Crew profile picture is separate: it's optional, can be any picture you like, and is shown to other members as part of your Crew profile. We never put your account headshot on your Crew profile.
$section$;
BEGIN
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'privacy-policy';
  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_document_versions
     WHERE document_id = v_doc AND body LIKE '%no face template, faceprint or other biometric identifier%'
  ) THEN
    -- from the newest version (a draft waiting to be published keeps its changes), else nothing
    SELECT v.* INTO v_base
      FROM public.legal_document_versions v
     WHERE v.document_id = v_doc AND v.status IN ('published', 'draft')
     ORDER BY v.version_number DESC
     LIMIT 1;
    IF v_base.id IS NOT NULL THEN
      v_body := rtrim(v_base.body) || E'\n\n' || v_section;
      IF v_body ~* 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}' THEN
        v_body := regexp_replace(v_body, 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}', 'Last updated: ' || v_date, 'i');
      END IF;
      SELECT coalesce(max(version_number), 0) + 1 INTO v_next
        FROM public.legal_document_versions WHERE document_id = v_doc;
      INSERT INTO public.legal_document_versions
        (document_id, version_number, status, title, summary, body, signature_method,
         requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
      VALUES
        (v_doc, v_next, 'draft', v_base.title,
         'Adds how account headshots are taken, checked, seen and kept, and that the Crew profile picture is separate.',
         v_body, v_base.signature_method,
         false, v_base.reacceptance_audience, DATE '2026-11-26', true,
         'Written from the code on Nov 26 2026 (src/lib/headshots, src/components/headshots): live capture only, on-device face checks with no biometric template stored, coach / admin review, evidence frames deleted within 30 days. No one is asked to accept again. Read it, then publish.');
    END IF;
  END IF;
END $do$;
