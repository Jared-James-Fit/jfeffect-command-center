
-- =====================================================================
-- CRM FOUNDATION: lifecycle on clients, link applications, activity log
-- Uses existing `clients` table as the single CRM source of truth.
-- No new contacts table is created.
-- =====================================================================

-- 1. Lifecycle / CRM fields on clients ---------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS lifecycle_stage text,
  ADD COLUMN IF NOT EXISTS lead_score smallint,
  ADD COLUMN IF NOT EXISTS lead_temperature text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS recommended_offer text,
  ADD COLUMN IF NOT EXISTS call_booked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS converted_to_client_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS normalized_email text
    GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  ADD COLUMN IF NOT EXISTS normalized_phone text
    GENERATED ALWAYS AS (regexp_replace(coalesce(phone,''),'[^0-9]','','g')) STORED;

-- Allowed lifecycle values (text, not enum, to stay flexible)
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_lifecycle_stage_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_lifecycle_stage_check
  CHECK (lifecycle_stage IS NULL OR lifecycle_stage IN (
    'lead','applicant','call_booked','qualified','follow_up',
    'won','active_client','paused','lost','disqualified'
  ));

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_lead_temperature_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_lead_temperature_check
  CHECK (lead_temperature IS NULL OR lead_temperature IN ('hot','warm','cold'));

CREATE INDEX IF NOT EXISTS idx_clients_normalized_email ON public.clients(normalized_email);
CREATE INDEX IF NOT EXISTS idx_clients_normalized_phone ON public.clients(normalized_phone)
  WHERE normalized_phone <> '';
CREATE INDEX IF NOT EXISTS idx_clients_lifecycle_stage ON public.clients(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_clients_next_follow_up_at ON public.clients(next_follow_up_at);

-- 2. Backfill: existing active clients stay active ---------------------
-- Only stamp lifecycle when we are confident; leave the rest NULL for review.
UPDATE public.clients
   SET lifecycle_stage = 'active_client'
 WHERE lifecycle_stage IS NULL
   AND archived = false
   AND coalesce(status,'') = 'Active'
   AND user_id IS NOT NULL;

-- 3. Link coaching_applications -> clients -----------------------------
ALTER TABLE public.coaching_applications
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_applications_client_id
  ON public.coaching_applications(client_id);

-- 4. Shared CRM activity timeline --------------------------------------
CREATE TABLE IF NOT EXISTS public.client_crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  appointment_id uuid,
  application_id uuid REFERENCES public.coaching_applications(id) ON DELETE SET NULL,
  actor_user_id uuid,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_crm_activities TO authenticated;
GRANT ALL ON public.client_crm_activities TO service_role;

ALTER TABLE public.client_crm_activities ENABLE ROW LEVEL SECURITY;

-- Admins and assigned coaches can read
CREATE POLICY "crm_activities_read"
  ON public.client_crm_activities FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach(client_id)
  );

-- Admins and assigned coaches can write
CREATE POLICY "crm_activities_write"
  ON public.client_crm_activities FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach(client_id)
  );

CREATE POLICY "crm_activities_update"
  ON public.client_crm_activities FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "crm_activities_delete"
  ON public.client_crm_activities FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_crm_activities_dedupe
  ON public.client_crm_activities(client_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_crm_activities_client_created
  ON public.client_crm_activities(client_id, created_at DESC);
