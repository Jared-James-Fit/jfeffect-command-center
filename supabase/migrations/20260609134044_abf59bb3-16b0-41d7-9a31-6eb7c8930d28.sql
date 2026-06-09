
ALTER TABLE public.pl_client_maxes
  ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES public.pl_blocks(id) ON DELETE CASCADE;

ALTER TABLE public.pl_client_maxes
  DROP CONSTRAINT IF EXISTS pl_client_maxes_client_id_lift_key;

CREATE UNIQUE INDEX IF NOT EXISTS pl_client_maxes_client_lift_global_uq
  ON public.pl_client_maxes (client_id, lift) WHERE block_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pl_client_maxes_client_block_lift_uq
  ON public.pl_client_maxes (client_id, block_id, lift) WHERE block_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pl_client_maxes_block_idx
  ON public.pl_client_maxes (block_id) WHERE block_id IS NOT NULL;
