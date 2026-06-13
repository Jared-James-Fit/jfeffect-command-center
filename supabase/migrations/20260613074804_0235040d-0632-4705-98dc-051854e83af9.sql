-- Migration B: Source Block keys + template payload revision (additive)

ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS source_template_block_key text,
  ADD COLUMN IF NOT EXISTS source_template_schema_version integer;

CREATE INDEX IF NOT EXISTS idx_pl_blocks_source_template_block_key
  ON public.pl_blocks (source_template_block_key)
  WHERE source_template_block_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pl_blocks_source_template_combined
  ON public.pl_blocks (source_template_id, source_template_block_key)
  WHERE source_template_id IS NOT NULL;

ALTER TABLE public.pl_templates
  ADD COLUMN IF NOT EXISTS payload_revision bigint NOT NULL DEFAULT 0;

-- Trigger: increment payload_revision atomically when payload changes.
CREATE OR REPLACE FUNCTION public.tg_pl_templates_bump_payload_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.payload IS DISTINCT FROM OLD.payload THEN
    NEW.payload_revision := COALESCE(OLD.payload_revision, 0) + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pl_templates_payload_revision ON public.pl_templates;
CREATE TRIGGER tg_pl_templates_payload_revision
  BEFORE UPDATE ON public.pl_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_templates_bump_payload_revision();
