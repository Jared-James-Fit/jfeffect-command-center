import { Layers, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { SERIES_LABEL, featuredLift, formatTopSet, isTrainingNow, type CommunityPost, type WorkoutShareStats } from "@/lib/community";

// Small on purpose: Home's shelf loads this with the app, the feed card stays in its own chunk.

/** The small picture a post gets (a video's still, else the photo); null for a card-only post. */
export function postThumbPath(p: Pick<CommunityPost, "media_thumb_path" | "media_type" | "media_path">): string | null {
  return p.media_thumb_path ?? (p.media_type === "image" ? p.media_path : null);
}

/**
 * A post, small: its photo, else its workout, lock-in or note card, with a
 * corner mark for a carousel or video (its first slide only: no swiping
 * inside it). Fills its box (the profile grid's squares, Home's Crew feed).
 * `footer`: keep the card's words clear of a strip along the bottom (the
 * like count). `large`: Home's Crew feed cards, with the author along the top.
 */
export function PostTileFace({ post, thumb, unit, footer = false, large = false }: { post: CommunityPost; thumb: string | null; unit: "kg" | "lb"; footer?: boolean; large?: boolean }) {
  const shared = post.shared_comment && !post.shared_comment.gone ? post.shared_comment : null;
  const pad = large ? "p-4 pt-12" : "p-2.5";
  const bottom = footer && (large ? "pb-11" : "pb-8");
  return (
    <>
      {post.kind === "note" && post.media_type && thumb ? (
        // a coach post with a photo shows the photo, like any other post
        <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : post.kind === "note" ? (
        <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.28),transparent_60%)] text-left", pad, bottom)}>
          <span className={cn("font-black uppercase tracking-[0.14em] text-primary", large ? "text-[10px]" : "text-[8px]")}>{post.poll ? "Poll" : post.series ? SERIES_LABEL[post.series]?.name.split(" ")[0] ?? "Note" : "Note"}</span>
          <span className={cn("font-semibold leading-snug", large ? "line-clamp-4 text-[15px]" : cn("text-[11px]", footer ? "line-clamp-4" : "line-clamp-5"))}>
            {post.quote ? `“${post.quote}”` : post.caption || (shared ? `“${shared.body || "📷"}”` : "")}
          </span>
        </div>
      ) : post.media_type && thumb ? (
        <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : post.stats ? (
        <WorkoutTile stats={post.stats} unit={unit} pad={pad} bottom={bottom} large={large} />
      ) : post.locked_in_at ? (
        <LockInTile post={post} pad={pad} bottom={bottom} large={large} />
      ) : (
        // a reopened workout without a photo: its words, else the session
        <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)] text-left text-white", pad, bottom)}>
          <span className={cn("font-black uppercase tracking-[0.14em] text-red-400", large ? "text-[10px]" : "text-[8px]")}>Workout</span>
          <span className={cn("font-semibold leading-snug", large ? "line-clamp-4 text-[15px]" : cn("text-[11px]", footer ? "line-clamp-4" : "line-clamp-5"))}>
            {post.caption || <span className={cn("font-display uppercase leading-[1.02]", large ? "text-[26px]" : "text-[15px]")}>{post.session_title ?? "Session"}</span>}
          </span>
        </div>
      )}
      {(post.extra_media?.length ?? 0) > 0 ? (
        <Layers className={cn("absolute text-white drop-shadow", large ? "right-3 top-3 h-5 w-5" : "right-1.5 top-1.5 h-4 w-4")} aria-label="Carousel" />
      ) : (
        post.media_type === "video" && <Play className={cn("absolute fill-white text-white drop-shadow", large ? "right-3 top-3 h-5 w-5" : "right-1.5 top-1.5 h-4 w-4")} />
      )}
    </>
  );
}

type Box = { pad: string; bottom: string | false; large: boolean };

/** The workout card, small: the session and its best lift (gold for a PR). */
function WorkoutTile({ stats, unit, pad, bottom, large }: { stats: WorkoutShareStats; unit: "kg" | "lb" } & Box) {
  const lift = featuredLift(stats);
  const pr = !!lift?.pr;
  return (
    <div className={cn("flex h-full w-full flex-col justify-between text-white", pad, bottom, pr ? "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(245,158,11,0.45),#0b0b0e_60%)]" : "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)]")}>
      {pr ? <span className={cn("w-max rounded-full bg-amber-400 font-black uppercase text-[#2b1700]", large ? "px-2 py-px text-[10px]" : "px-1.5 text-[8px]")}>PR</span> : <span />}
      <div>
        <div className={cn("font-display line-clamp-2 uppercase leading-[1.02]", large ? "text-[26px]" : "text-[15px]")}>{stats.workout_title}</div>
        {lift && <div className={cn("font-display mt-0.5 uppercase", large ? "text-[19px]" : "text-[13px]", pr ? "text-amber-300" : "text-white/80")}>{formatTopSet(lift.detail, unit)}</div>}
      </div>
    </div>
  );
}

/** A lock-in, small: LOCKED IN and the session (a pulse while they're training). */
function LockInTile({ post, pad, bottom, large }: { post: CommunityPost } & Box) {
  return (
    <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.55),rgba(127,29,29,0.16)_45%,#0a0a0d_75%)] text-white", pad, bottom)}>
      {isTrainingNow(post) ? <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> : <span />}
      <div>
        <div className={cn("font-display uppercase leading-none", large ? "text-[32px]" : "text-[17px]")}>Locked in</div>
        <div className={cn("mt-0.5 line-clamp-2 font-bold text-white/70", large ? "text-[12px]" : "text-[10px]")}>{post.session_title}</div>
      </div>
    </div>
  );
}
