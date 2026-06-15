-- Auto-approve admin-owned program template submissions so admin-owned
-- programs never sit in the approval queue. The publish flow for
-- admin-owned templates is direct (see publishLibraryListing), so any
-- "*_submission" row for an admin template is misleading.

CREATE OR REPLACE FUNCTION public.tg_pl_shares_autoapprove_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_role text;
BEGIN
  IF NEW.destination IN ('team_submission','membership_submission','public_submission')
     AND NEW.status IN ('pending','changes_requested') THEN
    SELECT owner_role INTO v_owner_role
    FROM public.pl_templates
    WHERE id = NEW.template_id;
    IF v_owner_role = 'admin' THEN
      NEW.status := 'approved';
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
      NEW.review_notes := COALESCE(NEW.review_notes, 'Auto-approved: admin-owned program');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pl_shares_autoapprove_admin ON public.pl_template_shares;
CREATE TRIGGER tg_pl_shares_autoapprove_admin
  BEFORE INSERT OR UPDATE OF status ON public.pl_template_shares
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_shares_autoapprove_admin();

-- Backfill: resolve any existing admin-owned pending submissions.
UPDATE public.pl_template_shares s
SET status = 'approved',
    reviewed_at = COALESCE(s.reviewed_at, now()),
    review_notes = COALESCE(s.review_notes, 'Auto-approved: admin-owned program (backfill)')
FROM public.pl_templates t
WHERE t.id = s.template_id
  AND t.owner_role = 'admin'
  AND s.destination IN ('team_submission','membership_submission','public_submission')
  AND s.status IN ('pending','changes_requested');