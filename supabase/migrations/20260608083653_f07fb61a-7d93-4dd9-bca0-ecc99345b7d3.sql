
-- Add missing foreign keys so PostgREST embeds (clients:clients(...)) resolve.
ALTER TABLE public.pl_blocks
  ADD CONSTRAINT pl_blocks_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.pl_preps
  ADD CONSTRAINT pl_preps_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
