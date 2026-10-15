-- Same flaw as the messages guards (20261129090000): this guard compared
-- NEW.submission_id, which fillout_submissions doesn't have (the column is
-- fillout_submission_id), so any non-staff update errored. Only staff update
-- this table today (they skip the guard), so nothing user-facing broke yet.
CREATE OR REPLACE FUNCTION public.protect_fillout_submissions_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.response_json IS DISTINCT FROM OLD.response_json
     OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload
     OR NEW.fillout_submission_id IS DISTINCT FROM OLD.fillout_submission_id
     OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted fillout_submissions columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
