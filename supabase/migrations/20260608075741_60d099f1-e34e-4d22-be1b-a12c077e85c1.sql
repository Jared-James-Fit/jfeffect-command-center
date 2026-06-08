
ALTER TABLE public.pl_preps
  ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES public.pl_templates(id) ON DELETE SET NULL;

ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES public.pl_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pl_preps_source_template_id_idx ON public.pl_preps(source_template_id);
CREATE INDEX IF NOT EXISTS pl_blocks_source_template_id_idx ON public.pl_blocks(source_template_id);
