ALTER TABLE public.pl_template_shares DROP CONSTRAINT IF EXISTS pl_template_shares_destination_check;
ALTER TABLE public.pl_template_shares ADD CONSTRAINT pl_template_shares_destination_check
  CHECK (destination = ANY (ARRAY['team'::text, 'coach'::text, 'team_submission'::text, 'membership_submission'::text, 'public_submission'::text, 'membership'::text]));