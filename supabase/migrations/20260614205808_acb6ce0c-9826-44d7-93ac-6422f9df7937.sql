-- =========================================================================
-- Phase 1: Program Library ownership, sharing, submissions
-- =========================================================================

-- 1. Extend pl_templates with ownership + visibility ---------------------
ALTER TABLE public.pl_templates
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE public.pl_templates
  DROP CONSTRAINT IF EXISTS pl_templates_owner_role_check;
ALTER TABLE public.pl_templates
  ADD CONSTRAINT pl_templates_owner_role_check
    CHECK (owner_role IN ('admin','coach'));

ALTER TABLE public.pl_templates
  DROP CONSTRAINT IF EXISTS pl_templates_visibility_check;
ALTER TABLE public.pl_templates
  ADD CONSTRAINT pl_templates_visibility_check
    CHECK (visibility IN ('private','team'));

-- Backfill: existing templates become admin-owned, team-visible
-- (matches current behavior where every active coach can see them).
UPDATE public.pl_templates
   SET owner_user_id = COALESCE(owner_user_id, created_by),
       owner_role = 'admin',
       visibility = 'team'
 WHERE visibility = 'private';

CREATE INDEX IF NOT EXISTS idx_pl_templates_owner ON public.pl_templates(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_pl_templates_visibility ON public.pl_templates(visibility);

-- 2. pl_template_shares --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pl_template_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.pl_templates(id) ON DELETE CASCADE,
  destination text NOT NULL CHECK (destination IN (
    'team','coach','team_submission','membership_submission','public_submission'
  )),
  target_coach_id uuid REFERENCES public.coaches(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'read' CHECK (permission IN ('read','duplicate')),
  status text NOT NULL DEFAULT 'shared' CHECK (status IN (
    'shared','pending','changes_requested','approved','rejected','removed'
  )),
  shared_version bigint,
  notes text,
  review_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_template_shares TO authenticated;
GRANT ALL ON public.pl_template_shares TO service_role;

CREATE INDEX IF NOT EXISTS idx_pl_template_shares_template ON public.pl_template_shares(template_id);
CREATE INDEX IF NOT EXISTS idx_pl_template_shares_dest ON public.pl_template_shares(destination, status);
CREATE INDEX IF NOT EXISTS idx_pl_template_shares_target_coach ON public.pl_template_shares(target_coach_id);

-- One active share per (template, destination, target_coach_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pl_template_shares_active
  ON public.pl_template_shares(template_id, destination, COALESCE(target_coach_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status NOT IN ('removed','rejected');

-- Coach destinations must have a target_coach_id; others must not.
ALTER TABLE public.pl_template_shares
  DROP CONSTRAINT IF EXISTS pl_template_shares_target_check;
ALTER TABLE public.pl_template_shares
  ADD CONSTRAINT pl_template_shares_target_check
    CHECK (
      (destination = 'coach' AND target_coach_id IS NOT NULL)
      OR (destination <> 'coach' AND target_coach_id IS NULL)
    );

CREATE TRIGGER tg_pl_template_shares_updated
  BEFORE UPDATE ON public.pl_template_shares
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. pl_template_distribution_events (append-only) -----------------------
CREATE TABLE IF NOT EXISTS public.pl_template_distribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.pl_templates(id) ON DELETE CASCADE,
  share_id uuid REFERENCES public.pl_template_shares(id) ON DELETE SET NULL,
  destination text NOT NULL,
  target_coach_id uuid,
  version bigint,
  action text NOT NULL,
  previous_status text,
  new_status text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pl_template_distribution_events TO authenticated;
GRANT ALL ON public.pl_template_distribution_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_pl_tde_template ON public.pl_template_distribution_events(template_id, created_at DESC);

-- 4. RLS -----------------------------------------------------------------

-- Helper: is the caller the owner of a template?
CREATE OR REPLACE FUNCTION public.is_pl_template_owner(_template_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pl_templates t
    WHERE t.id = _template_id AND t.owner_user_id = _user_id
  )
$$;

-- Helper: is the caller a coach that has been shared this template?
CREATE OR REPLACE FUNCTION public.coach_has_template_share(_template_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pl_template_shares s
      JOIN public.coaches c ON c.id = s.target_coach_id
     WHERE s.template_id = _template_id
       AND s.destination = 'coach'
       AND s.status NOT IN ('removed','rejected')
       AND c.user_id = _user_id
       AND c.archived = false
       AND c.status = 'Active'
  )
$$;

-- Helper: is the caller an active coach?
CREATE OR REPLACE FUNCTION public.is_active_coach(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches c
    WHERE c.user_id = _user_id AND c.archived = false AND c.status = 'Active'
  )
$$;

-- Rewrite pl_templates policies
DROP POLICY IF EXISTS "Admin manage pl_templates" ON public.pl_templates;
DROP POLICY IF EXISTS "Coach read pl_templates" ON public.pl_templates;

CREATE POLICY "Admin all on pl_templates" ON public.pl_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Owner manage own pl_templates" ON public.pl_templates
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Coach read team or shared pl_templates" ON public.pl_templates
  FOR SELECT TO authenticated
  USING (
    archived = false
    AND public.is_active_coach(auth.uid())
    AND (
      visibility = 'team'
      OR public.coach_has_template_share(id, auth.uid())
    )
  );

-- pl_template_shares RLS
ALTER TABLE public.pl_template_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin all on pl_template_shares" ON public.pl_template_shares
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Owner read own template shares" ON public.pl_template_shares
  FOR SELECT TO authenticated
  USING (public.is_pl_template_owner(template_id, auth.uid()));

CREATE POLICY "Owner create shares for own templates" ON public.pl_template_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_pl_template_owner(template_id, auth.uid())
    AND destination IN ('team_submission','membership_submission','public_submission')
    AND status IN ('pending')
  );

CREATE POLICY "Owner update own pending submissions" ON public.pl_template_shares
  FOR UPDATE TO authenticated
  USING (
    public.is_pl_template_owner(template_id, auth.uid())
    AND status IN ('pending','changes_requested')
  )
  WITH CHECK (public.is_pl_template_owner(template_id, auth.uid()));

CREATE POLICY "Coach read shares targeting self" ON public.pl_template_shares
  FOR SELECT TO authenticated
  USING (
    destination = 'coach'
    AND EXISTS (
      SELECT 1 FROM public.coaches c
      WHERE c.id = target_coach_id AND c.user_id = auth.uid()
    )
  );

-- pl_template_distribution_events RLS
ALTER TABLE public.pl_template_distribution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin all on pl_template_distribution_events" ON public.pl_template_distribution_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Owner read own template events" ON public.pl_template_distribution_events
  FOR SELECT TO authenticated
  USING (public.is_pl_template_owner(template_id, auth.uid()));

CREATE POLICY "Authenticated insert own template events" ON public.pl_template_distribution_events
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_pl_template_owner(template_id, auth.uid())
    )
  );

-- 5. Auto-log distribution events on share changes -----------------------
CREATE OR REPLACE FUNCTION public.tg_pl_template_shares_log_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action text;
  v_prev text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'share_created';
    v_prev := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'status_changed_to_' || NEW.status;
      v_prev := OLD.status;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.pl_template_distribution_events (
    template_id, share_id, destination, target_coach_id, version,
    action, previous_status, new_status, actor_user_id, notes
  ) VALUES (
    NEW.template_id, NEW.id, NEW.destination, NEW.target_coach_id, NEW.shared_version,
    v_action, v_prev, NEW.status,
    COALESCE(auth.uid(), NEW.reviewed_by, NEW.created_by),
    COALESCE(NEW.review_notes, NEW.notes)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pl_template_shares_log_event ON public.pl_template_shares;
CREATE TRIGGER tg_pl_template_shares_log_event
  AFTER INSERT OR UPDATE ON public.pl_template_shares
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_template_shares_log_event();