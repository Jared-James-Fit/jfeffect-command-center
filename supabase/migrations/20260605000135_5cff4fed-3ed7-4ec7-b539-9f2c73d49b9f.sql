
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS signing_method text,
  ADD COLUMN IF NOT EXISTS signed_in_person boolean NOT NULL DEFAULT false;

ALTER TABLE public.agreement_templates
  ADD COLUMN IF NOT EXISTS times_sent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS times_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_agreement_bump_template_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.template_id IS NOT NULL THEN
      UPDATE public.agreement_templates
        SET times_sent = times_sent + 1,
            last_used_at = now()
      WHERE id = NEW.template_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.template_id IS NOT NULL
       AND NEW.status IN ('Signed','Completed','Verified')
       AND COALESCE(OLD.status, '') NOT IN ('Signed','Completed','Verified') THEN
      UPDATE public.agreement_templates
        SET times_completed = times_completed + 1
      WHERE id = NEW.template_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agreement_bump_template_stats_ins ON public.agreements;
CREATE TRIGGER trg_agreement_bump_template_stats_ins
AFTER INSERT ON public.agreements
FOR EACH ROW EXECUTE FUNCTION public.tg_agreement_bump_template_stats();

DROP TRIGGER IF EXISTS trg_agreement_bump_template_stats_upd ON public.agreements;
CREATE TRIGGER trg_agreement_bump_template_stats_upd
AFTER UPDATE OF status ON public.agreements
FOR EACH ROW EXECUTE FUNCTION public.tg_agreement_bump_template_stats();
