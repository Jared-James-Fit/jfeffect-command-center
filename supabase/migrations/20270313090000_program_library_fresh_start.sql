-- Program library: a fresh start (Nov 13 2026).
--
-- The coach asked for a clean library to build new programs into, for coaching
-- and for the membership app: "remove workout programs that aren't being used
-- in client programs".
--
-- * Coaching templates (pl_templates): every template is removed except the 10
--   behind a program a client is on now (an active client's block from it ends
--   today or later, and they trained it in the last 6 weeks or it hasn't
--   started yet). A client's program is a copy, so removing a template never
--   touches anyone's program or logs: pl_blocks / pl_preps.source_template_id
--   is ON DELETE SET NULL.
-- * Membership library (member_plans): all 40 listings go. No member is on one
--   (the only account that started one, the coach's exercise-tutorials login,
--   never logged a workout; member_set_logs and member_workout_completions are
--   empty). Its program stays on its calendar.
-- * The 10 kept templates leave the membership library too: their membership
--   share rows and the old "membership-app" tag go, so nothing re-lists them
--   (listMembershipLibrary re-creates a listing for any live membership share).
--
-- Both lists are the exact ids read on Nov 13 2026, and each delete re-checks
-- that the row is still unused, so a template assigned (or a plan started)
-- since then stays. Every removed row, and every row its delete cascades to,
-- is copied into program_library_cleanup_backup first (closed to clients and
-- staff alike; the service role can restore from it).

CREATE TABLE IF NOT EXISTS public.program_library_cleanup_backup (
  id bigserial PRIMARY KEY,
  source_table text NOT NULL,
  row_id text,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_library_cleanup_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_library_cleanup_backup FROM anon, authenticated;

DO $$
DECLARE
  tpl_ids uuid[] := ARRAY[
    'e3904a54-9143-59d7-a9ab-99036234f1f7','b33c32b4-e175-404e-a6cc-b7a11be32857','3b82beb7-b20b-45e1-944f-28861c14a71b',
    '7ace756a-eda9-46d6-8cb1-6821f6d6e98b','f4d5d7e7-fe25-4841-91a2-2b57a46c1e30','e46346c6-e7f7-4367-a8ac-2797bf711105',
    '225136d0-1bc1-4bf5-8572-efdbbc870103','9bbda6c3-97f7-466d-a7c5-e1f14c51bcaa','f81200d8-18bb-4e39-9fb6-619c51092b14',
    'ed9a765f-b078-44ed-8a30-8b938c0057b4','d44e720d-ef68-4039-830a-2a418fd46e8e','05cad874-46e2-4e82-9c6d-bc3e6e029d08',
    'a2a28487-add2-42df-8c6a-7c0459eae2e7','cac4f8c7-1645-503c-9b34-b6500bf931f3','1bcf25ea-2624-468a-9398-7f46423d6f39',
    '51d7b4df-0e3b-44bf-b7fc-a67010527afd','78aff8ab-f8bb-40c2-a6a3-3d28402a17f4','2dfa1c85-9f72-4aa3-93b2-420ffb4d2360',
    '376cc386-17aa-43d0-b5e2-29b82f9eee11','12b3cbe1-0bf1-4d9d-a611-bb580c84a17a','e463422e-743c-427e-a93e-5650a455a418',
    'daf760dd-2cbc-4a2d-99cb-dbf5163e0d9d','8471c844-578e-4d48-868c-22bd8c034dc9','842befbe-27d8-4eed-9286-5cfec29e9aed',
    '70ff6e5b-2f0e-4820-8bab-8eaa66fe8ac2','bc1cfeda-3cd0-4d6f-a6c7-76676a0c7236','480a2e31-8d87-4f8b-b434-0e34f2b04737',
    'fa77d155-e8a2-4982-86ea-b8eeb4d9ad49','3b6c813e-640b-4b89-a732-a6e8f4767edd','f5a7f823-8bad-4df3-b668-1c89299fa331',
    '37a176eb-df4f-47aa-abd7-020f7ddefe39','cea9b255-7a83-4feb-a32f-80bbf2616e6f','9d019ff4-4a96-47f6-ba71-fbdeea9ef9ba',
    'c9dae955-bccb-429f-8f10-3bf2888e6f85','e7a89539-44fc-48f7-839c-2bfdcc6640a1','21567e9a-4636-4fe0-8798-6162ba3b19dc',
    '97058d41-b46b-4fd5-a098-6665371315c8','711572e8-9e4b-4397-b627-460eeb58fcd3','1fa1a1ed-f2b6-48d2-a7c0-4681feaa1be3',
    'e540dd49-8023-43ef-90f6-c20a410f2567','89b4f84a-931c-4d09-90f0-80576bdeca0d','e18e1e59-17e5-46c6-9093-d44cb86c9991',
    '9d6d3a55-5424-4b13-b47a-57959658d1c3','2e1878f5-aecd-419f-b1e3-7386428e67d6','c9b575df-ca0e-4aa4-9f9d-e1fb3af127ce',
    '9350e75c-cab1-493e-927b-7fb422a98372','95081a6d-c7a5-44db-b491-3748357bc600','e20c97b8-4276-5c28-b644-547787a8f4dc',
    '91af1d6d-a8c4-475e-b0d7-bf5e1f3e99ef','2284422c-0343-4751-9de0-e536eeae5e92','a0e1cad2-54a9-4054-9885-b687a0bb47e4',
    '9ad41511-11f4-588f-adad-310539b00594','d49a888c-5cb2-49aa-a304-1ca54e8bc83a','b88c600a-8a76-4b53-85c0-4a12044a4068',
    '45b5dfa5-e7dd-49b3-a4de-258496a79404','5fd8e5a2-df16-4a0c-9cb2-483d4795c1fa','79933e0e-909c-4db3-af22-81510e32b8a4',
    '6f494b1c-58ed-4c2f-a28e-5b20390078b5','5091e194-4db6-4334-a216-7eb6554d34fb','0e1ff806-d421-470f-8c71-da084ed31df7',
    '0726d172-002f-4ede-aa17-7e994826f94b','67afbbac-221d-43f4-b214-a19d83d727e6','6993ce65-58a0-4605-9fd9-eae55e940cd9',
    'f21fab77-dc34-475e-b147-35d02bb3f86a','5a28a021-36e2-4c1a-a1c8-4944e54e5b04','a9cb77a7-a042-4cf4-90aa-15657c330c80',
    '93d322dc-d79e-4338-aba1-cd6a7a2db222','abafd9c0-fdb2-4ad9-b23e-f03a61155f86','b4761ed6-d99c-4091-b063-c7a7f87ad6c2',
    '598f0a90-0feb-414f-96c7-c5af87385456','4e08d1f1-0f7f-4cbf-b55c-d62121af4ebe','f8444cfe-c031-4c0e-bc2d-fa9ca5b97a36',
    'b8c21f41-afef-471e-b47d-cff7f455a2bc','8fdfaa5f-c816-4016-927f-c78c113ed992','7bc48cd0-cd4d-459d-a19c-a2fe03a729b4',
    'ff0aff35-9c30-46ae-a1f1-ef1b8d7dedb1','102d9c0c-b9e3-4e13-8345-601d375a134c','e05c3dde-d55a-4f99-a785-93d04e2e69f3'
  ]::uuid[];
  plan_ids uuid[] := ARRAY[
    '0256e3ae-2cbe-4dfb-8549-e457478e99e1','205c0d98-1be1-4986-aa82-98b117fcfa2b','d94ba24d-28af-4cd1-8509-7a9aaa3d8d63',
    'a6eaf198-c703-4ad1-9caa-cc2a7988bc40','0af10f93-3237-41a0-b13a-d66e25c04360','7e698df1-0dff-416b-9014-8e0f3f9514e4',
    '6a681a4a-5623-4b10-a25b-881f0d908569','e9a9dc62-ca42-4a9f-9d0c-914ec38b9e4f','35274c26-ce51-410a-b24e-e47aec26d464',
    '0f32dfee-42ce-44a0-b2ab-676bd166aef0','a739304e-97de-41a3-8a84-3886137c49cf','e3636614-245d-4ee8-883c-86387a7db8e1',
    'd5610e6c-2955-467d-9520-f7c40729b371','457e08dc-6f3a-4938-894b-b0bbec7b306c','f5798b74-93b8-4041-8db6-81842a3bafb8',
    'd98a4d37-a80d-41cd-a2dd-d9ed83bb6330','4b692994-f825-436d-9c41-93fcc0c4f1de','167ce9a1-a671-400a-92c3-a398e96c821b',
    '7f219bd7-28ad-471b-ae6e-26410ca3fb93','8baaf03a-9fcc-4f97-9bb1-8703391a2685','6c3ceaed-fefc-4f0c-97ad-9e3888195276',
    'd516ba6e-bf39-47da-8e7e-1769a30df2fa','b80e79eb-1ebb-43dd-92ac-8b201533c615','b5da4ba8-7774-4341-b53c-c485065a17ba',
    'cdbb3986-8132-4e29-ad2f-5c05b702f3e9','b40653cb-e657-4dd1-8d9b-314a458825ad','930e9b03-5322-4b7a-a540-3648e4cc2626',
    '4f7e6dd1-bc84-49a5-bd03-7198ddf9c1f2','d7e59c06-c301-436f-8c12-4f5c8d3df8f9','7c9b1c74-8067-47ec-9290-da54f9375e2b',
    'bbc7aa81-5277-43fd-99e4-e4fa5e76eb80','c094bdca-c2bd-457d-ba3f-b067c752aa61','6e59882f-b40b-4735-b47a-6ea0fbe29fa0',
    '0c9126ae-303f-45c5-8a5a-aabb3fb3886c','de3805c6-c7c0-4102-a6e9-677af9647acb','29006b46-b9b8-46bf-ba0b-7d3b5b159e94',
    '1891b458-c889-444b-8c0c-77bb9b967910','f080f777-884e-43e4-b276-0486fe210f1b','68182f2a-bba7-4cc5-9e27-612e56a8cdf6',
    'ca57f560-011e-404b-97a0-c67869fdec9a'
  ]::uuid[];
  del_tpl uuid[];
  del_plan uuid[];
BEGIN
  -- Templates still unused right now (the same rule the list was read with).
  SELECT coalesce(array_agg(t.id), '{}') INTO del_tpl
  FROM public.pl_templates t
  WHERE t.id = ANY (tpl_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.pl_blocks b
      JOIN public.clients c ON c.id = b.client_id
      WHERE b.source_template_id = t.id
        AND NOT b.archived
        AND NOT c.archived
        AND coalesce(c.status, '') NOT IN ('Deactivated', 'Archived', 'Deleted')
        AND b.end_date >= current_date
        AND (
          -- their program from it hasn't started yet
          NOT EXISTS (
            SELECT 1 FROM public.pl_blocks b3
            WHERE b3.source_template_id = t.id
              AND b3.client_id = b.client_id
              AND NOT b3.archived
              AND b3.start_date < current_date
          )
          -- or they've trained it in the last 6 weeks
          OR EXISTS (
            SELECT 1
            FROM public.pl_blocks b2
            JOIN public.pl_weeks w ON w.block_id = b2.id
            JOIN public.pl_days d ON d.week_id = w.id
            JOIN public.pl_day_completions dc ON dc.day_id = d.id
            WHERE b2.source_template_id = t.id
              AND b2.client_id = b.client_id
              AND dc.completed_at >= now() - interval '42 days'
          )
        )
    );

  -- Membership listings nobody has trained from.
  SELECT coalesce(array_agg(m.id), '{}') INTO del_plan
  FROM public.member_plans m
  WHERE m.id = ANY (plan_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.member_plan_enrollments e
      WHERE e.plan_id = m.id AND coalesce(e.workouts_completed, 0) > 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.pl_blocks b
      JOIN public.clients c ON c.id = b.client_id AND c.service_tier = 'self_serve'
      JOIN public.pl_weeks w ON w.block_id = b.id
      JOIN public.pl_days d ON d.week_id = w.id
      JOIN public.pl_day_completions dc ON dc.day_id = d.id
      WHERE m.source_template_id IS NOT NULL
        AND b.source_template_id = m.source_template_id
        AND dc.completed_at >= now() - interval '42 days'
    );

  -- Back up everything about to go (the rows and what their deletes cascade to).
  INSERT INTO public.program_library_cleanup_backup (source_table, row_id, row_data)
  SELECT 'member_plans', m.id::text, to_jsonb(m) FROM public.member_plans m WHERE m.id = ANY (del_plan)
  UNION ALL SELECT 'member_plan_enrollments', x.id::text, to_jsonb(x) FROM public.member_plan_enrollments x WHERE x.plan_id = ANY (del_plan)
  UNION ALL SELECT 'member_plan_saved', NULL, to_jsonb(x) FROM public.member_plan_saved x WHERE x.plan_id = ANY (del_plan)
  UNION ALL SELECT 'member_plan_events', x.id::text, to_jsonb(x) FROM public.member_plan_events x WHERE x.plan_id = ANY (del_plan)
  UNION ALL SELECT 'member_plan_audit', x.id::text, to_jsonb(x) FROM public.member_plan_audit x WHERE x.plan_id = ANY (del_plan)
  UNION ALL SELECT 'featured_member_items', x.id::text, to_jsonb(x) FROM public.featured_member_items x WHERE x.plan_id = ANY (del_plan)
  UNION ALL SELECT 'pl_templates', t.id::text, to_jsonb(t) FROM public.pl_templates t WHERE t.id = ANY (del_tpl)
  UNION ALL SELECT 'pl_template_shares', s.id::text, to_jsonb(s) FROM public.pl_template_shares s
    WHERE s.template_id = ANY (del_tpl) OR s.destination IN ('membership', 'membership_submission')
  UNION ALL SELECT 'pl_assignment_operations', x.id::text, to_jsonb(x) FROM public.pl_assignment_operations x WHERE x.template_id = ANY (del_tpl)
  UNION ALL SELECT 'pl_template_distribution_events', x.id::text, to_jsonb(x) FROM public.pl_template_distribution_events x WHERE x.template_id = ANY (del_tpl)
  UNION ALL SELECT 'pl_template_operations', x.id::text, to_jsonb(x) FROM public.pl_template_operations x WHERE x.template_id = ANY (del_tpl)
  UNION ALL SELECT 'pl_program_versions', x.id::text, to_jsonb(x) FROM public.pl_program_versions x WHERE x.template_id = ANY (del_tpl)
  UNION ALL SELECT 'program_ai_edits', x.id::text, to_jsonb(x) FROM public.program_ai_edits x WHERE x.template_id = ANY (del_tpl)
  UNION ALL SELECT 'pl_blocks.source_template_id', b.id::text, jsonb_build_object('id', b.id, 'source_template_id', b.source_template_id)
    FROM public.pl_blocks b WHERE b.source_template_id = ANY (del_tpl)
  UNION ALL SELECT 'pl_preps.source_template_id', p.id::text, jsonb_build_object('id', p.id, 'source_template_id', p.source_template_id)
    FROM public.pl_preps p WHERE p.source_template_id = ANY (del_tpl)
  UNION ALL SELECT 'pl_templates.tags', t.id::text, jsonb_build_object('id', t.id, 'tags', t.tags)
    FROM public.pl_templates t
    WHERE NOT (t.id = ANY (del_tpl))
      AND EXISTS (
        SELECT 1 FROM unnest(t.tags) AS x
        WHERE lower(trim(x)) IN ('membership-app', 'membership', 'member-program')
      );

  DELETE FROM public.member_plans WHERE id = ANY (del_plan);
  DELETE FROM public.pl_templates WHERE id = ANY (del_tpl);

  -- What's left starts outside the membership app: listing it again is one tap.
  DELETE FROM public.pl_template_shares WHERE destination IN ('membership', 'membership_submission');
  UPDATE public.pl_templates
     SET tags = ARRAY(
       SELECT x FROM unnest(tags) AS x
       WHERE lower(trim(x)) NOT IN ('membership-app', 'membership', 'member-program')
     )
   WHERE EXISTS (
     SELECT 1 FROM unnest(tags) AS x
     WHERE lower(trim(x)) IN ('membership-app', 'membership', 'member-program')
   );
END $$;
