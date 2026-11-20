/**
 * Workout film: posts a finished workout's set videos to Crew as the
 * session's one post, a clip per slide with its own caption (workout-film.ts).
 *
 *   auto: true   called by the app once the workout is done and its clips
 *                have landed; does nothing when the athlete picked Coach only
 *                (community_profiles.auto_post_film = false), took the
 *                session's post out of Crew, or it's already up to date.
 *   auto: false  "Share to Crew": posts (or brings back) the film now.
 *
 * Their coach gets every clip either way: each set video is already its own
 * message in the coach chat (set_video_attach), with its set details.
 *
 * Each slide names its set the way the workout does ("Top set", "Backoff 2",
 * "Set 3": the database's pl_day_set_names, the same names the coach chat
 * uses), and the post's own caption is the database's film_caption of the
 * slides: the best set of each main lift filmed, no emoji.
 *
 * Only the athlete (the workout's own login) can post it, never a coach
 * viewing as them. The clips are copied from their coach chat's storage into
 * their own community-media folder, so the set video in the chat never
 * changes, and each copy is recorded as checked (media_video_checks) from the
 * set video's own check, so the post's video guard passes it. A clip over a
 * workout post's 90 seconds or 50 MB stays out, and so does an eleventh.
 *
 * Each slide is made from the set video's 720p feed copy when the phone made
 * one (filmFile; an iPhone's 4K original is ~5× what the feed needs), else
 * the original. A copy that lands after the film is up swaps in on the next
 * post (its film path differs, filmPaths), and the film files the post no
 * longer shows are removed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FilmPostResult } from "@/lib/workout-film.server";

export type { FilmPostResult } from "@/lib/workout-film.server";

const Input = z.object({ completionId: z.string().uuid(), auto: z.boolean() });

export const postWorkoutFilmFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<FilmPostResult> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildWorkoutFilm } = await import("@/lib/workout-film.server");
    const user = supabase as any;
    return buildWorkoutFilm(supabaseAdmin as any, userId, data, async () => {
      const [{ data: crew }, { data: autoOn }] = await Promise.all([
        user.rpc("can_view_community"),
        user.rpc("community_auto_post_film"),
      ]);
      return { crew, autoOn };
    });
  });
