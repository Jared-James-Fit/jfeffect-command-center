-- Member-built workouts live in one "My workouts" block per member athlete
-- (same pattern as the at-home backup session container). One container per
-- athlete, enforced here so two devices can't create two.
CREATE UNIQUE INDEX IF NOT EXISTS pl_blocks_member_workouts_container_unique
  ON public.pl_blocks (client_id, source_template_block_key)
  WHERE source_template_block_key = 'member_workouts_v1';
