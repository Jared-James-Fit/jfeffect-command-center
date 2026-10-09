-- Community post points: earning, anti-spam limits, take-backs, comments,
-- badges and league totals. October 2026, league timezone America/Winnipeg.
-- Week 1 = Mon Oct 5 – Sun Oct 11, week 2 = Mon Oct 12 – Sun Oct 18.

do $$
declare
  ava uuid := t_client('Ava');
  ben uuid := t_client('Ben');
  coach uuid := t_client('Coach');
  c uuid; p uuid; p2 uuid; lock_comp uuid; lock_post uuid; s record; st jsonb;
begin
  insert into community_coaches values (t_uid(coach));

  -- 1. A community post of a finished workout earns once.
  c := t_done(ava, wpg('2026-10-05 09:00'));
  p := t_post(ava, c, wpg('2026-10-05 10:00'));
  perform t_assert(t_events(ava, 'community_post') = 1, 'post of a finished workout earns');
  perform t_assert((select xp from athlete_xp_events where client_id = ava and event_type = 'community_post') = 40, 'Logging Level +40 XP');

  -- 2. A second post the same day doesn't earn again.
  c := t_done(ava, wpg('2026-10-05 17:00'));
  perform t_post(ava, c, wpg('2026-10-05 18:00'));
  perform t_assert(t_events(ava, 'community_post') = 1, '1 a day: second same-day post earns nothing');

  -- 3. Late evening stays on the league day (Winnipeg, not UTC).
  c := t_done(ava, wpg('2026-10-06 22:30'));
  perform t_post(ava, c, wpg('2026-10-06 23:30'));
  c := t_done(ava, wpg('2026-10-07 08:00'));
  perform t_post(ava, c, wpg('2026-10-07 08:30'));
  perform t_assert(t_events(ava, 'community_post') = 3, 'separate league days earn separately (11:30pm counts for that day)');

  -- 4. Next week.
  c := t_done(ava, wpg('2026-10-13 07:00'));
  perform t_post(ava, c, wpg('2026-10-13 07:30'));
  perform t_assert(t_events(ava, 'community_post') = 4, 'week 2 post earns');

  -- 5. Lock-in: posting before the workout is finished earns nothing until it's done.
  insert into pl_day_completions(day_id, client_id, completed_at) values (gen_random_uuid(), ben, null) returning id into lock_comp;
  lock_post := t_post(ben, lock_comp, wpg('2026-10-14 06:00'));
  perform t_assert(t_events(ben, 'community_post') = 0, 'lock-in post of an unfinished session earns nothing');
  update pl_day_completions set completed_at = wpg('2026-10-14 07:15') where id = lock_comp;
  perform t_assert(t_events(ben, 'community_post') = 1, 'lock-in post earns once the workout is completed');
  update pl_day_completions set completed_at = null where id = lock_comp;
  perform t_assert(t_events(ben, 'community_post') = 0, 'un-completing the workout takes the points back');
  update pl_day_completions set completed_at = wpg('2026-10-14 07:15') where id = lock_comp;

  -- 6. Old workouts can't be drip-fed for points.
  c := t_done(ben, wpg('2026-09-20 09:00'));
  perform t_post(ben, c, wpg('2026-10-15 09:00'));
  perform t_assert(t_events(ben, 'community_post') = 1, 'workout older than 7 days earns nothing');

  -- 7. Only posts the community can see.
  c := t_done(ben, wpg('2026-10-16 09:00'));
  p := t_post(ben, c, wpg('2026-10-16 10:00'), 'private');
  c := t_done(ben, wpg('2026-10-16 11:00'));
  p2 := t_post(ben, c, wpg('2026-10-16 12:00'), 'coach');
  perform t_assert(t_events(ben, 'community_post') = 1, 'private and coach-only posts earn nothing');
  update community_posts set visibility = 'community' where id = p;
  perform t_assert(t_events(ben, 'community_post') = 2, 'switching to Community earns');
  update community_posts set archived_from = visibility, visibility = 'private', archived_at = now() where id = p;
  perform t_assert(t_events(ben, 'community_post') = 1, 'archiving takes the points back');
  update community_posts set visibility = archived_from, archived_from = null, archived_at = null where id = p;
  perform t_assert(t_events(ben, 'community_post') = 2, 'restoring re-earns');

  -- 8. Deleting (author or coach moderation) takes the points back.
  c := t_done(ben, wpg('2026-10-17 09:00'));
  p := t_post(ben, c, wpg('2026-10-17 10:00'));
  perform t_assert(t_events(ben, 'community_post') = 3, 'Oct 17 post earns');
  delete from community_posts where id = p;
  perform t_assert(t_events(ben, 'community_post') = 2, 'deleted post loses its points');

  -- 9. Delete the post that holds the day's event while another qualifies: the day stays earned.
  c := t_done(ava, wpg('2026-10-20 07:00'));
  p := t_post(ava, c, wpg('2026-10-20 08:00'));
  c := t_done(ava, wpg('2026-10-20 08:30'));
  p2 := t_post(ava, c, wpg('2026-10-20 09:00'));
  delete from community_posts where id = p;
  perform t_assert((select source_id from athlete_xp_events where client_id = ava and source_key = 'community_post:2026-10-20') = p2,
    'day event moves to the remaining eligible post');

  -- 10. Comments: once per post, never your own, never the coach's.
  p := (select id from community_posts where client_id = ava and created_at = wpg('2026-10-05 10:00'));
  insert into community_comments(post_id, author_user_id, body, created_at) values (p, t_uid(ben), 'Strong!', wpg('2026-10-05 12:00'));
  insert into community_comments(post_id, author_user_id, body, created_at) values (p, t_uid(ben), 'Again!', wpg('2026-10-05 13:00'));
  perform t_assert(t_events(ben, 'community_comment') = 1, 'many comments on one post earn once');
  insert into community_comments(post_id, author_user_id, body) values (p, t_uid(ava), 'thanks');
  perform t_assert(t_events(ava, 'community_comment') = 0, 'commenting on your own post earns nothing');
  insert into community_comments(post_id, author_user_id, body) values (p, t_uid(coach), 'Great work');
  perform t_assert(t_events(coach, 'community_comment') = 0, 'coach comments earn nothing');
  delete from community_comments where post_id = p and author_user_id = t_uid(ben) and body = 'Strong!';
  perform t_assert(t_events(ben, 'community_comment') = 1, 'deleting one of two comments keeps the event');
  delete from community_comments where post_id = p and author_user_id = t_uid(ben);
  perform t_assert(t_events(ben, 'community_comment') = 0, 'deleting all your comments takes it back');
  insert into community_comments(post_id, author_user_id, body) values (p, t_uid(ben), 'Back again');

  -- 11. League: +15 per scoring post, max 2 a week, in the total.
  select * into s from league_month_scores('2026-10-01', wpg('2026-10-31 12:00')) where client_id = ava;
  -- Ava: week 1 has 3 posting days (capped at 2), week 2 has 1, Oct 20 (week 3) has 1 → 4.
  perform t_assert(s.community_posts = 4, 'weekly cap: 3 posting days in a week count as 2 (got ' || s.community_posts || ')');
  perform t_assert(s.community_points = 60, 'community points = 4 × 15');
  perform t_assert(s.total_points = s.workout_points + s.logging_points + s.bodyweight_points + s.improvement_points + s.community_points + s.match_points,
    'community points are part of the total');
  select * into s from league_month_scores('2026-10-01', wpg('2026-10-13 12:00')) where client_id = ava;
  perform t_assert(s.community_points = 45, 'mid-month: only posts so far count');
  select * into s from league_month_scores('2026-09-01', wpg('2026-10-31 12:00')) where client_id = ava;
  perform t_assert(s.community_points = 0, 'September untouched');

  -- 12. Badges via the real achievement sync.
  perform sync_athlete_achievements(ava);
  perform sync_athlete_achievements(ben);
  perform t_assert(exists (select 1 from athlete_achievements where client_id = ava and badge_key = 'first_post'), 'Ava earns Posted Up');
  perform t_assert(not exists (select 1 from athlete_achievements where client_id = ava and badge_key = 'posts_10'), 'Ava not yet Crew Regular');
  perform t_assert(exists (select 1 from athlete_achievements where client_id = ben and badge_key = 'first_comment'), 'Ben earns Hype Squad');

  -- 13. Share-screen status for the signed-in athlete.
  delete from auth_ctx; insert into auth_ctx values (t_uid(ava));
  st := community_post_points_status();
  perform t_assert((st->>'points')::int = 15 and (st->>'week_cap')::int = 2, 'status reports +15 and the weekly cap');
  perform t_assert(not (st->>'today_earned')::boolean, 'nothing posted today yet');
  c := t_done(ava, now());
  perform t_post(ava, c, now());
  st := community_post_points_status();
  perform t_assert((st->>'today_earned')::boolean and (st->>'week_count')::int >= 1, 'status sees today''s post');
  delete from auth_ctx; insert into auth_ctx values (gen_random_uuid());
  perform t_assert(community_post_points_status() is null, 'no client account → no status');

  -- 14. The league screen returns the new trailing columns.
  delete from auth_ctx; insert into auth_ctx values (t_uid(ava));
  perform t_assert((select community_points from get_performance_league('2026-10-01'::date, null::uuid) where is_me) is not null,
    'get_performance_league returns community_points');
end $$;
