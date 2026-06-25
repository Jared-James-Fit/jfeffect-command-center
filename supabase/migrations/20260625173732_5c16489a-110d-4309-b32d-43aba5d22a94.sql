DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'media_content_records','media_content_comments','media_content_review_events',
    'media_drafts','media_draft_versions','media_campaigns','media_pages',
    'media_quick_notes','media_testimonials','media_templates',
    'media_performance_entries','media_resources','media_resource_folders','media_resource_comments',
    'task_subtasks','task_comments'
  ]) LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END;
  END LOOP;
END $$;