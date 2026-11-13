/**
 * Workout film (pure, tested): a finished workout's set videos as its Crew
 * post, one clip per slide, each with a caption made for the athlete: the
 * exercise, then "Set 2 · 145 kg × 5 @ RPE 8". The server builds it
 * (workout-film.functions.ts) and the feed shows each clip's caption on it.
 */
import { setVideoLabel } from "@/lib/set-videos/label";

/** One clip's caption on the post (community_posts.film), keyed by its path. */
export type FilmSlide = {
  path: string;
  exercise: string;
  set: number;
  /** "145 kg × 5 @ RPE 8". */
  label: string;
  /** The same without the weight, for a post that hides weights. */
  label_no_load: string;
};

/** Slides on a post at most (Instagram's ten). */
export const FILM_MAX_SLIDES = 10;
/** A workout post's clip can run 90 s (VIDEO_LIMITS.workout) and weigh 50 MB (the database's guard). */
export const FILM_CLIP_MAX_S = 90;
export const FILM_CLIP_MAX_BYTES = 50 * 1024 * 1024;
/** Seconds a clip may run over (container rounding), as the server's check allows. */
const TOLERANCE_S = 1.5;

export type FilmClipSource = {
  id: string;
  /** Where its exercise sits in the workout (the row's sort order). */
  order: number;
  set_index: number;
  created_at: string;
  duration_s: number | null;
  size_bytes: number | null;
};

/**
 * Which clips go on the post, in the order they were trained (exercise, then
 * set, then when filmed): ones too long or too big for a workout post are
 * left out and counted, and at most `max` go on.
 */
export function pickFilmClips<T extends FilmClipSource>(clips: T[], max = FILM_MAX_SLIDES): { picked: T[]; tooLong: number; overMax: number } {
  const sorted = [...clips].sort(
    (a, b) => a.order - b.order || a.set_index - b.set_index || Date.parse(a.created_at) - Date.parse(b.created_at),
  );
  const fits = sorted.filter(
    (c) =>
      (c.duration_s == null || c.duration_s <= FILM_CLIP_MAX_S + TOLERANCE_S) &&
      (c.size_bytes == null || c.size_bytes <= FILM_CLIP_MAX_BYTES),
  );
  return { picked: fits.slice(0, max), tooLong: sorted.length - fits.length, overMax: Math.max(0, fits.length - max) };
}

/** The set's numbers, as they were logged. */
export type FilmSetValues = {
  load: number | null;
  unit: "kg" | "lb";
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  loadType: "external" | "bodyweight" | "assisted" | null;
  durationSec: number | null;
};

/** A logged set's numbers (a pl_row_results row), as its labels read them. */
export type LoggedSetRow = {
  entered_value?: number | string | null;
  entered_unit?: string | null;
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
  actual_reps?: number | string | null;
  actual_rpe_num?: number | string | null;
  actual_rpe?: number | string | null;
  actual_rir?: number | string | null;
  completed_duration_seconds?: number | string | null;
  load_type?: string | null;
};

export function filmSetValues(r: LoggedSetRow): FilmSetValues {
  const num = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  return {
    load: num(r.entered_value) ?? num(r.actual_load),
    unit: (r.entered_unit ?? r.actual_load_unit) === "lb" ? "lb" : "kg",
    reps: num(r.actual_reps),
    rpe: num(r.actual_rpe_num) ?? num(r.actual_rpe),
    rir: num(r.actual_rir),
    loadType: r.load_type === "bodyweight" || r.load_type === "assisted" ? r.load_type : "external",
    durationSec: num(r.completed_duration_seconds),
  };
}

/** A clip's two labels: with the weight, and without it (a post that hides weights). */
export function filmLabels(v: FilmSetValues | null, fallback: string | null): { label: string; label_no_load: string } {
  if (!v) {
    const label = (fallback ?? "").trim();
    // what's after the weight ("× 5 @ RPE 8") is the part that stays
    const rest = label.replace(/^.*?×\s*/, "");
    const noLoad = rest !== label && /^\d+/.test(rest) ? rest.replace(/^(\d+)/, (n) => `${n} ${n === "1" ? "rep" : "reps"}`) : "";
    return { label, label_no_load: noLoad };
  }
  const base = { unit: v.unit, reps: v.reps, rpe: v.rpe, rir: v.rpe == null ? v.rir : null, loadType: v.loadType ?? "external", durationSec: v.durationSec };
  return {
    label: setVideoLabel({ ...base, load: v.load }),
    label_no_load: setVideoLabel({ ...base, load: null, loadType: "external" }),
  };
}

/** What a clip's caption says: the exercise, then "Set 2 · 145 kg × 5 @ RPE 8". */
export function filmCaption(f: Pick<FilmSlide, "exercise" | "set" | "label" | "label_no_load">, hideLoads: boolean): { title: string; detail: string } {
  const what = (hideLoads ? f.label_no_load : f.label) || "";
  return { title: f.exercise || "Set", detail: [`Set ${f.set}`, what].filter(Boolean).join(" · ") };
}

/** The post's own caption when the athlete hasn't written one. */
export function filmPostCaption(workoutTitle: string | null | undefined, clips: number): string {
  const sets = `${clips} ${clips === 1 ? "set" : "sets"} on film 🎥`;
  const title = (workoutTitle ?? "").trim();
  return title ? `${title} · ${sets}` : sets;
}

/** Our caption's shape: "Lower A (Squat Focus) · 3 sets on film 🎥", or just the count. */
const FILM_CAPTION = /^(?:(.*) · )?\d+ sets? on film 🎥$/u;

/**
 * A film post's caption: their own words when they wrote some, else ours,
 * kept to the count on the post as clips are added (a clip that landed later,
 * or one that only fit once its 720p copy was made, never leaves the caption
 * saying fewer sets than the post shows).
 */
export function filmCaptionFor(current: string | null | undefined, workoutTitle: string | null | undefined, clips: number): string {
  const now = (current ?? "").trim();
  const ours = filmPostCaption(workoutTitle, clips);
  if (!now) return ours;
  const m = FILM_CAPTION.exec(now);
  return m && (m[1] ?? "").trim() === (workoutTitle ?? "").trim() ? ours : now;
}

/**
 * Whether a post's caption is still the one we wrote for its film (the
 * workout and the count), not their own words: on a post's screen the
 * workout's own line already names it, so saying it twice only takes room
 * from the picture.
 */
export function isOwnFilmCaption(caption: string | null | undefined, workoutTitles: readonly (string | null | undefined)[]): boolean {
  const m = FILM_CAPTION.exec((caption ?? "").trim());
  if (!m) return false;
  const named = (m[1] ?? "").trim();
  return !named || workoutTitles.some((t) => (t ?? "").trim() === named);
}

/** Where a clip's copy lives in community-media (the athlete's own folder). */
export function filmPaths(userId: string, completionId: string, setVideoId: string, sourcePath: string): { path: string; thumb: string } {
  const ext = (/\.([a-z0-9]{2,4})$/i.exec(sourcePath)?.[1] ?? "mp4").toLowerCase();
  // a feed copy gets its own name, so a post made from the original is seen as behind and swapped
  const feed = /-feed\.[a-z0-9]{2,4}$/i.test(sourcePath) ? "-feed" : "";
  const base = `${userId}/film/${completionId}/${setVideoId}${feed}`;
  return { path: `${base}.${ext}`, thumb: `${base}-poster.jpg` };
}

/** A set video as the film reads it: the clip the coach got, and its 720p copy for Crew when the phone made one. */
export type FilmFileSource = {
  storage_path: string;
  width: number | null;
  height: number | null;
  duration_s: number | string | null;
  size_bytes: number | string | null;
  feed_path?: string | null;
  feed_width?: number | null;
  feed_height?: number | null;
  feed_duration_s?: number | string | null;
  feed_size_bytes?: number | string | null;
};

const num = (n: number | string | null | undefined): number | null =>
  n == null || n === "" || !Number.isFinite(Number(n)) ? null : Number(n);

/**
 * The file a film slide is made from: the set video's feed copy (720p, made
 * after the coach had the original) when it has one, else the original.
 * The coach chat's clip never changes either way.
 */
export function filmFile(v: FilmFileSource): {
  path: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  size_bytes: number | null;
  feed: boolean;
} {
  if (v.feed_path)
    return {
      path: v.feed_path,
      width: v.feed_width ?? v.width ?? null,
      height: v.feed_height ?? v.height ?? null,
      duration_s: num(v.feed_duration_s) ?? num(v.duration_s),
      size_bytes: num(v.feed_size_bytes),
      feed: true,
    };
  return {
    path: v.storage_path,
    width: v.width ?? null,
    height: v.height ?? null,
    duration_s: num(v.duration_s),
    size_bytes: num(v.size_bytes),
    feed: false,
  };
}

/** A path is one of the athlete's film copies (never a photo they added themselves). */
export function isFilmPath(path: string | null | undefined): boolean {
  return !!path && /^[^/]+\/film\//.test(path);
}

/** The post already shows every clip that should be on it. */
export function filmUpToDate(postFilm: Pick<FilmSlide, "path">[] | null | undefined, wantedPaths: string[]): boolean {
  if (!wantedPaths.length) return true;
  const have = new Set((postFilm ?? []).map((f) => f.path));
  return wantedPaths.every((p) => have.has(p));
}
