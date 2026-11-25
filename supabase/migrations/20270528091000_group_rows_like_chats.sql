-- Group chat rows read like 1:1 rows (Nov 25 2026).
--
-- A member-made chat's latest message now says what was sent ('attachments',
-- so a row reads "Marc: 📷 Photo" or "🎤 Voice memo" instead of "Sent an
-- attachment"), and its picture can show up to four of the others in it.
-- Nothing else changes: same people, same order, same unread rule.

CREATE OR REPLACE FUNCTION public.chat_crew_threads()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(t ORDER BY t->>'last_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'group_id', g.id,
      'name', g.name,
      'status', st.v,
      'is_owner', g.created_by = auth.uid(),
      'invited_by', CASE WHEN st.v = 'invited' THEN public.community_author(me.invited_by)->>'name' END,
      'faces', coalesce((SELECT jsonb_agg(f.a) FROM (
                 SELECT public.community_author(m.user_id) AS a FROM public.chat_group_members m
                  WHERE m.group_id = g.id AND m.status = 'joined' AND m.user_id <> auth.uid()
                  ORDER BY m.joined_at NULLS LAST LIMIT 4) f), '[]'::jsonb),
      'joined', (SELECT count(*) FROM public.chat_group_members m WHERE m.group_id = g.id AND m.status = 'joined'),
      'invited', (SELECT count(*) FROM public.chat_group_members m WHERE m.group_id = g.id AND m.status = 'invited'
                    AND m.invited_at > now() - make_interval(days => public.chat_crew_invite_days())),
      'last', lm.j,
      'last_at', coalesce(lm.at, g.created_at),
      'read_at', CASE WHEN pr.read_at IS NULL THEN me.last_read_at ELSE greatest(me.last_read_at, pr.read_at) END
    ) AS t
    FROM public.chat_groups g
    JOIN public.chat_group_members me ON me.group_id = g.id AND me.user_id = auth.uid()
    CROSS JOIN LATERAL (SELECT public.chat_crew_status(g.id, auth.uid()) AS v) st
    LEFT JOIN public.chat_request_reads pr ON pr.group_id = g.id AND pr.user_id = auth.uid()
    LEFT JOIN LATERAL (
      SELECT m.created_at AS at,
             jsonb_build_object('body', m.body, 'created_at', m.created_at, 'sender_id', m.sender_id,
                                'sender_name', public.community_author(m.sender_id)->>'name',
                                'card', m.attachments @> '[{"kind":"community_post"}]'::jsonb,
                                'media', jsonb_typeof(m.attachments) = 'array' AND jsonb_array_length(m.attachments) > 0,
                                'attachments', CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) AS j
        FROM public.group_messages m
       WHERE m.group_id = g.id AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1) lm ON true
    WHERE g.kind = 'crew' AND st.v IS NOT NULL AND public.chat_community_ok(auth.uid())
  ) s
$function$;
