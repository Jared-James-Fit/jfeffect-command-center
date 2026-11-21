-- Rollback for 20270430100000_crew_caption_readability.sql: puts every caption it rewrote back to the
-- text it had before, only while the caption is still the one the migration wrote (so a later edit by
-- the coach stays his). Run as the service role.

UPDATE public.community_posts p
   SET caption = b.before,
       series_data = CASE
         WHEN p.series_data ? 'deck' AND p.series_data->'deck'->>'caption' = b.after
           THEN jsonb_set(p.series_data, '{deck,caption}', to_jsonb(b.before))
         ELSE p.series_data END
  FROM public.community_caption_readability_backup b
 WHERE b.kind = 'post' AND b.target_id = p.id AND p.caption = b.after;

UPDATE public.community_series_items i
   SET data = jsonb_set(i.data, '{deck,caption}', to_jsonb(b.before))
  FROM public.community_caption_readability_backup b
 WHERE b.kind = 'item' AND b.target_id = i.id AND i.data->'deck'->>'caption' = b.after;
