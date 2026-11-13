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
import {
  filmFile,
  filmLabels,
  filmPaths,
  filmCaptionFor,
  filmSetValues,
  filmUpToDate,
  isFilmPath,
  pickFilmClips,
  FILM_MAX_SLIDES,
  type FilmSetValues,
  type FilmSlide,
} from "@/lib/workout-film";

const Input = z.object({ completionId: z.string().uuid(), auto: z.boolean() });

export type FilmPostResult = {
  status: "posted" | "up_to_date" | "no_clips" | "off" | "hidden" | "no_crew";
  postId?: string;
  /** Clips on the post. */
  clips: number;
  /** Clips left out (too long or too big for a workout post, or past ten). */
  skipped: number;
};

const SRC_BUCKET = "message-attachments";
const DST_BUCKET = "community-media";

type Slide = { path: string; thumb: string | null; type: "image" | "video"; width: number | null; height: number | null };

/** Copy a stored file into the athlete's community folder (the copy, or the bytes when the storage can't copy across buckets). */
async function copyInto(admin: any, from: string, to: string): Promise<boolean> {
  const { error } = await admin.storage.from(SRC_BUCKET).copy(from, to, { destinationBucket: DST_BUCKET });
  if (!error) return true;
  // already there from an earlier post of this film
  if (/exist|duplicate/i.test(String(error.message ?? ""))) return true;
  const { data: blob, error: dlErr } = await admin.storage.from(SRC_BUCKET).download(from);
  if (dlErr || !blob) return false;
  const { error: upErr } = await admin.storage
    .from(DST_BUCKET)
    .upload(to, blob, { contentType: blob.type || undefined, upsert: true, cacheControl: "31536000" });
  return !upErr;
}

/** A new film post hides weights when their last workout post did. */
async function lastHideLoads(admin: any, clientId: string): Promise<boolean> {
  const { data: last } = await admin
    .from("community_posts")
    .select("hide_loads")
    .eq("client_id", clientId)
    .eq("kind", "workout")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !!last?.hide_loads;
}

export const postWorkoutFilmFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<FilmPostResult> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const user = supabase as any;

    // The workout, and that it's this login's own.
    const { data: comp } = await admin
      .from("pl_day_completions")
      .select("id, client_id, day_id, completed_at")
      .eq("id", data.completionId)
      .maybeSingle();
    if (!comp?.completed_at) throw new Error("Finish the workout first.");
    const { data: client } = await admin.from("clients").select("id, user_id").eq("id", comp.client_id).maybeSingle();
    if (!client || client.user_id !== userId) throw new Error("Only you can post your film.");

    const [{ data: crew }, { data: autoOn }] = await Promise.all([
      user.rpc("can_view_community"),
      user.rpc("community_auto_post_film"),
    ]);
    if (crew === false) return { status: "no_crew", clips: 0, skipped: 0 };
    if (data.auto && autoOn === false) return { status: "off", clips: 0, skipped: 0 };

    // The workout's clips (their own, on a logged set).
    const { data: vids } = await admin
      .from("pl_set_videos")
      .select(
        "id, row_id, result_id, set_index, exercise_name, label, storage_path, thumbnail_path, duration_s, width, height, size_bytes, mime, created_at, feed_path, feed_width, feed_height, feed_duration_s, feed_size_bytes",
      )
      .eq("client_id", comp.client_id)
      .eq("day_id", comp.day_id)
      .eq("uploaded_by", userId)
      .is("deleted_at", null);
    const all = ((vids ?? []) as any[]).filter((v) => v.result_id && v.storage_path);
    if (!all.length) return { status: "no_clips", clips: 0, skipped: 0 };

    const rowIds = [...new Set(all.map((v) => v.row_id).filter(Boolean))];
    const resultIds = [...new Set(all.map((v) => v.result_id))];
    const [{ data: rows }, { data: results }, { data: names }] = await Promise.all([
      rowIds.length ? admin.from("pl_exercise_rows").select("id, sort_order").in("id", rowIds) : Promise.resolve({ data: [] }),
      admin
        .from("pl_row_results")
        .select("id, actual_load, actual_load_unit, entered_value, entered_unit, actual_reps, actual_rpe_num, actual_rpe, actual_rir, completed_duration_seconds, load_type, normalized_kg")
        .in("id", resultIds),
      // every set of the workout by its name in it ("Top set", "Backoff 2", "Set 3") and whether it's a main lift
      admin.rpc("pl_day_set_names", { _day: comp.day_id }),
    ]);
    const orderOf = new Map<string, number>(((rows ?? []) as any[]).map((r) => [r.id, Number(r.sort_order) || 0]));
    const resultOf = new Map<string, any>(((results ?? []) as any[]).map((r) => [r.id, r]));
    const nameOf = new Map<string, { set_name: string; main: boolean }>(
      ((names ?? []) as any[]).map((n) => [`${n.row_id}:${n.set_index}`, { set_name: n.set_name, main: !!n.main }]),
    );

    // each clip as the film uses it: its feed copy when it has one
    const { picked, tooLong, overMax } = pickFilmClips(
      all.map((v) => {
        const f = filmFile(v);
        return { ...v, order: orderOf.get(v.row_id) ?? 999, src: f.path, width: f.width, height: f.height, duration_s: f.duration_s, size_bytes: f.size_bytes, mime: f.feed ? null : v.mime };
      }),
    );
    const skipped = tooLong + overMax;
    if (!picked.length) return { status: "no_clips", clips: 0, skipped };

    // The session's post as it is now (never its lock-in).
    const { data: post } = await admin
      .from("community_posts")
      .select("id, caption, visibility, auto_shared, archived_at, media_path, media_thumb_path, media_type, media_width, media_height, extra_media, film, hide_loads")
      .eq("completion_id", comp.id)
      .is("locked_in_at", null)
      .maybeSingle();
    const crewVisible = (v: string | null | undefined) => v === "community" || v === "followers" || v === "close_friends";
    if (data.auto && post && !post.auto_shared && (post.archived_at || !crewVisible(post.visibility))) {
      // they took it out of Crew (hid it, sent it to their coach only, archived it): it stays that way
      return { status: "hidden", postId: post.id, clips: 0, skipped };
    }
    const wanted = picked.map((v) => filmPaths(userId, comp.id, v.id, v.src).path);
    if (post && !post.auto_shared && !post.archived_at && crewVisible(post.visibility) && filmUpToDate(post.film, wanted)) {
      return { status: "up_to_date", postId: post.id, clips: wanted.length, skipped };
    }

    // Copy each clip (and its poster) into their community folder, recorded as checked.
    const filmSlides: Slide[] = [];
    const film: FilmSlide[] = [];
    for (const v of picked) {
      const { path, thumb } = filmPaths(userId, comp.id, v.id, v.src);
      if (!(await copyInto(admin, v.src, path))) continue;
      const hasPoster = !!v.thumbnail_path && (await copyInto(admin, v.thumbnail_path, thumb));
      const { data: obj } = await admin.rpc("media_video_object", { _bucket: DST_BUCKET, _path: path });
      if (!obj?.id) continue;
      const { data: srcCheck } = await admin
        .from("media_video_checks")
        .select("duration_s, width, height, video_codec, bytes, mime")
        .eq("bucket", SRC_BUCKET)
        .eq("path", v.src)
        .maybeSingle();
      const { error: chkErr } = await admin.from("media_video_checks").upsert(
        {
          bucket: DST_BUCKET,
          path,
          object_id: obj.id,
          owner: userId,
          duration_s: Number(srcCheck?.duration_s ?? v.duration_s ?? 0),
          width: srcCheck?.width ?? v.width ?? null,
          height: srcCheck?.height ?? v.height ?? null,
          video_codec: srcCheck?.video_codec ?? null,
          bytes: Number(obj.bytes ?? srcCheck?.bytes ?? v.size_bytes ?? 0),
          mime: obj.mime ?? v.mime ?? null,
          context: "workout",
          client: { mode: "film", source: v.id, feed: v.src !== v.storage_path },
          checked_at: new Date().toISOString(),
        },
        { onConflict: "bucket,path" },
      );
      if (chkErr) continue;
      filmSlides.push({ path, thumb: hasPoster ? thumb : null, type: "video", width: v.width ?? null, height: v.height ?? null });
      const r = resultOf.get(v.result_id);
      const values: FilmSetValues | null = r ? filmSetValues(r) : null;
      const set = Number(v.set_index) || 1;
      const named = nameOf.get(`${v.row_id}:${set}`);
      const kg = r?.normalized_kg == null || r.normalized_kg === "" ? null : Number(r.normalized_kg);
      film.push({
        path,
        exercise: v.exercise_name ?? "Set",
        set,
        set_name: named?.set_name ?? `Set ${set}`,
        main: named?.main ?? false,
        kg: Number.isFinite(kg) ? kg : null,
        ...filmLabels(values, v.label),
      });
    }
    if (!filmSlides.length) throw new Error("Couldn't get your clips ready. Try again in a minute.");

    // Their own photos stay first; the film follows (ten slides at most).
    const own: Slide[] = post
      ? [
          post.media_path ? { path: post.media_path, thumb: post.media_thumb_path, type: post.media_type, width: post.media_width, height: post.media_height } : null,
          ...((Array.isArray(post.extra_media) ? post.extra_media : []) as Slide[]),
        ].filter((s): s is Slide => !!s && !!s.path && !isFilmPath(s.path))
      : [];
    const slides = [...own, ...filmSlides].slice(0, FILM_MAX_SLIDES);
    const cover = slides[0];
    const extras = slides.slice(1);
    const onPost = new Set(slides.map((s) => s.path));
    const filmOnPost = film.filter((f) => onPost.has(f.path));
    // the post's own caption: the best set of each main lift filmed (film_caption), no emoji; theirs stays theirs
    const hide = post ? !!post.hide_loads : !!(await lastHideLoads(admin, comp.client_id));
    const [{ data: next }, { data: previous }] = await Promise.all([
      admin.rpc("film_caption", { _film: filmOnPost, _hide: hide }),
      post?.film ? admin.rpc("film_caption", { _film: post.film, _hide: hide }) : Promise.resolve({ data: null }),
    ]);
    const caption = filmCaptionFor(post?.caption, previous, typeof next === "string" ? next : "");
    // where it goes: where they put it, else the crew (a private account's
    // trigger keeps it to their followers)
    const visibility = post && !post.auto_shared && crewVisible(post.visibility) ? post.visibility : "community";

    const fields = {
      caption,
      visibility,
      media_path: cover.path,
      media_thumb_path: cover.thumb,
      media_type: cover.type,
      media_width: cover.width,
      media_height: cover.height,
      extra_media: extras,
      film: filmOnPost,
      auto_shared: false,
      archived_at: null,
      archived_from: null,
      updated_at: new Date().toISOString(),
    };
    let postId: string;
    if (post) {
      const { error } = await admin.from("community_posts").update(fields).eq("id", post.id);
      if (error) throw new Error(error.message || "Couldn't post your film. Try again.");
      postId = post.id;
      // this workout's film files the post no longer shows (an original a feed copy replaced, a removed clip)
      const ours = `${userId}/film/${comp.id}/`;
      const keep = new Set(slides.flatMap((sl) => [sl.path, sl.thumb]).filter(Boolean) as string[]);
      const before = [
        post.media_path ? { path: post.media_path, thumb: post.media_thumb_path } : null,
        ...((Array.isArray(post.extra_media) ? post.extra_media : []) as Slide[]),
      ];
      const stale = [...new Set(before.flatMap((sl) => (sl ? [sl.path, sl.thumb] : [])))].filter(
        (p): p is string => !!p && p.startsWith(ours) && !keep.has(p),
      );
      if (stale.length) await admin.storage.from(DST_BUCKET).remove(stale).catch(() => undefined);
    } else {
      const { data: made, error } = await admin
        .from("community_posts")
        .insert({ ...fields, author_user_id: userId, client_id: comp.client_id, completion_id: comp.id, hide_loads: hide })
        .select("id")
        .single();
      if (error) throw new Error(error.message || "Couldn't post your film. Try again.");
      postId = made.id;
    }
    return { status: "posted", postId, clips: filmOnPost.length, skipped: skipped + (film.length - filmOnPost.length) };
  });
