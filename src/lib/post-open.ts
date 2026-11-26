import type { CommunityNotice } from "@/lib/community-notifications";

/**
 * Where a Crew post opens (Nov 26 2026): always its own screen, exactly as the
 * feed shows it (the post filling the screen, its slides, ❤️ 💬 🔁 ✈️ 🔖 down
 * the right), never the old workout page. A notice about one set ("liked your
 * Belt Squat PR") opens on that set's clip; a comment or a reply opens with the
 * comments up over the post. Pure: the notice, a link's hash and a push all
 * read it the same way.
 */
export type PostOpen = {
  id: string;
  /** The exercise whose clip it opens on (a "Belt Squat PR" notice): its heaviest set's slide, else the first. */
  exercise?: string | null;
  /** Its comments open over it (a comment, a reply or a liked comment). */
  sheet?: "comments" | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Belt Squat PR" → "Belt Squat"; a milestone ("10th session this month") names no exercise. */
export function exerciseFromWin(win: string | null | undefined): string | null {
  const m = /^(.+?)\s+PR$/.exec((win ?? "").trim());
  const name = m?.[1]?.trim();
  return name ? name : null;
}

/** What a Crew notice opens: its post, on the slide it's about, with the comments up for a comment. Null for a follow. */
export function postOpenFromNotice(
  n: Pick<CommunityNotice, "kind" | "post_id" | "win">,
): PostOpen | null {
  if (!n.post_id) return null;
  switch (n.kind) {
    case "comment":
    case "reply":
    case "comment_like":
      return { id: n.post_id, sheet: "comments" };
    case "reaction":
    case "repost": {
      const exercise = exerciseFromWin(n.win);
      return exercise ? { id: n.post_id, exercise } : { id: n.post_id };
    }
    default:
      return null;
  }
}

/** Two ways an exercise can be written ("Belt Squat" / "belt  squat"). */
function sameExercise(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * The slide a post opens on for `exercise`: of its slides (postSlides, cover
 * first), the workout film's clip of that exercise, its heaviest set when
 * several were filmed (the first of those on a tie); 0 when nothing matches.
 */
export function slideForExercise(
  slides: readonly { path: string }[],
  film: readonly { path: string; exercise: string; kg?: number | null }[] | null | undefined,
  exercise: string | null | undefined,
): number {
  if (!exercise || !film?.length || slides.length < 2) return 0;
  const byPath = new Map(film.map((f) => [f.path, f]));
  let best = -1;
  let bestKg = -Infinity;
  slides.forEach((s, i) => {
    const f = byPath.get(s.path);
    if (!f || !sameExercise(f.exercise, exercise)) return;
    const kg = typeof f.kg === "number" && Number.isFinite(f.kg) ? f.kg : 0;
    if (kg > bestKg) {
      best = i;
      bestKg = kg;
    }
  });
  return best < 0 ? 0 : best;
}

/** The link's hash for a post (no "#"): `post=<id>`, then `&ex=<exercise>` and `&sheet=comments` when it has them. */
export function postOpenHash(o: PostOpen): string {
  let h = `post=${o.id}`;
  if (o.exercise) h += `&ex=${encodeURIComponent(o.exercise)}`;
  if (o.sheet === "comments") h += "&sheet=comments";
  return h;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A post to open from a link's hash (`#post=<id>&ex=…&sheet=comments`); null when it names none. */
export function postOpenFromHash(hash: string | null | undefined): PostOpen | null {
  const h = (hash ?? "").replace(/^#/, "");
  const parts = new Map<string, string>();
  for (const part of h.split("&")) {
    const i = part.indexOf("=");
    if (i > 0) parts.set(part.slice(0, i), part.slice(i + 1));
  }
  const id = parts.get("post");
  if (!id || !UUID.test(id)) return null;
  const out: PostOpen = { id: id.toLowerCase() };
  const ex = parts.get("ex");
  if (ex) {
    const name = safeDecode(ex).trim();
    if (name) out.exercise = name.slice(0, 120);
  }
  if (parts.get("sheet") === "comments") out.sheet = "comments";
  return out;
}

/** An "open this post" request in any of its shapes (an id, or a PostOpen), cleaned; null when it isn't one. */
export function toPostOpen(v: unknown): PostOpen | null {
  if (typeof v === "string") return UUID.test(v) ? { id: v.toLowerCase() } : null;
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<PostOpen>;
  if (typeof o.id !== "string" || !UUID.test(o.id)) return null;
  const out: PostOpen = { id: o.id.toLowerCase() };
  if (typeof o.exercise === "string" && o.exercise.trim())
    out.exercise = o.exercise.trim().slice(0, 120);
  if (o.sheet === "comments") out.sheet = "comments";
  return out;
}

/** A hash with the post it opened taken out (`post=`, `ex=`, `sheet=`), "#"-led, or "" when nothing's left. */
export function withoutPostHash(hash: string | null | undefined): string {
  const rest = (hash ?? "")
    .replace(/^#/, "")
    .split("&")
    .filter((part) => part && !/^(?:post|ex|sheet)=/.test(part));
  return rest.length ? `#${rest.join("&")}` : "";
}
