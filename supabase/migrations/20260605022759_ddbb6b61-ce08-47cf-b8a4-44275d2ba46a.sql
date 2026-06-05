
-- Server-side enforcement: block purchase activation/service-start when the offer
-- requires a signed-before-service agreement and no verified agreement exists.

-- Optional, audited per-purchase override (admin can bypass with reason).
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS agreement_block_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_block_override_reason text,
  ADD COLUMN IF NOT EXISTS agreement_block_override_by uuid,
  ADD COLUMN IF NOT EXISTS agreement_block_override_at timestamptz;

CREATE OR REPLACE FUNCTION public.enforce_purchase_agreement_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req boolean;
  before_service boolean;
  has_verified boolean;
  start_active boolean;
  status_active boolean;
BEGIN
  -- Skip if override is set on this row.
  IF COALESCE(NEW.agreement_block_override, false) THEN
    RETURN NEW;
  END IF;

  -- Resolve offer flags (no offer = nothing to enforce).
  IF NEW.offer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.requires_agreement, o.agreement_before_service
    INTO req, before_service
    FROM public.offers o WHERE o.id = NEW.offer_id;

  IF NOT COALESCE(req, false) OR NOT COALESCE(before_service, false) THEN
    RETURN NEW;
  END IF;

  -- Detect a service-start transition:
  --  (a) status moving to 'Active' (from anything else, or new row)
  --  (b) term_start_date moving to today/past (from null/future)
  status_active := (NEW.status = 'Active') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status);
  start_active  := (NEW.term_start_date IS NOT NULL AND NEW.term_start_date <= CURRENT_DATE)
                   AND (TG_OP = 'INSERT' OR OLD.term_start_date IS DISTINCT FROM NEW.term_start_date);

  IF NOT (status_active OR start_active) THEN
    RETURN NEW;
  END IF;

  -- Look for a verified agreement linked to this purchase.
  SELECT EXISTS (
    SELECT 1 FROM public.agreements a
     WHERE a.purchase_record_id = NEW.id
       AND (
         a.status = 'Verified'
         OR a.verification_status IN ('Manually Verified', 'Auto-Matched')
       )
  ) INTO has_verified;

  IF NOT has_verified THEN
    RAISE EXCEPTION 'Agreement required: this purchase cannot start service until a signed agreement is verified for purchase % (offer %).', NEW.id, NEW.offer_id
      USING ERRCODE = 'check_violation',
            HINT = 'Verify the linked agreement or set agreement_block_override=true with a reason to bypass.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_purchase_agreement_block ON public.purchase_records;
CREATE TRIGGER trg_enforce_purchase_agreement_block
  BEFORE INSERT OR UPDATE OF status, term_start_date, agreement_block_override
  ON public.purchase_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_purchase_agreement_block();

-- Stamp override metadata automatically when override flips to true.
CREATE OR REPLACE FUNCTION public.stamp_agreement_block_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.agreement_block_override IS TRUE
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.agreement_block_override, false) = false) THEN
    NEW.agreement_block_override_at := COALESCE(NEW.agreement_block_override_at, now());
    NEW.agreement_block_override_by := COALESCE(NEW.agreement_block_override_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_agreement_block_override ON public.purchase_records;
CREATE TRIGGER trg_stamp_agreement_block_override
  BEFORE INSERT OR UPDATE OF agreement_block_override
  ON public.purchase_records
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_agreement_block_override();
