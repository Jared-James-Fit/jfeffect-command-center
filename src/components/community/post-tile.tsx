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
 * corner mark for a carousel or video. Fills its box (the profile grid's
 * squares, Home's shelf). `footer`: keep the card's words clear of a strip
 * along the bottom (Home's like count).
 */
export function PostTileFace({ post, thumb, unit, footer = false }: { post: CommunityPost; thumb: string | null; unit: "kg" | "lb"; footer?: boolean }) {
  const shared = post.shared_comment && !post.shared_comment.gone ? post.shared_comment : null;
  return (
    <>
      {post.kind === "note" ? (
        <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.28),transparent_60%)] p-2.5 text-left", footer && "pb-8")}>
          <span className="text-[8px] font-black uppercase tracking-[0.14em] text-primary">{post.series ? SERIES_LABEL[post.series]?.name.split(" ")[0] ?? "Note" : "Note"}</span>
          <span className={cn("text-[11px] font-semibold leading-snug", footer ? "line-clamp-4" : "line-clamp-5")}>
            {post.quote ? `“${post.quote}”` : post.caption || (shared ? `“${shared.body || "📷"}”` : "")}
          </span>
        </div>
      ) : post.media_type && thumb ? (
        <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : post.stats ? (
        <WorkoutTile stats={post.stats} unit={unit} footer={footer} />
      ) : post.locked_in_at ? (
        <LockInTile post={post} footer={footer} />
      ) : (
        // a reopened workout without a photo: its words, else the session
        <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)] p-2.5 text-left text-white", footer && "pb-8")}>
          <span className="text-[8px] font-black uppercase tracking-[0.14em] text-red-400">Workout</span>
          <span className={cn("text-[11px] font-semibold leading-snug", footer ? "line-clamp-4" : "line-clamp-5")}>
            {post.caption || <span className="font-display text-[15px] uppercase leading-[1.02]">{post.session_title ?? "Session"}</span>}
          </span>
        </div>
      )}
      {(post.extra_media?.length ?? 0) > 0 ? (
        <Layers className="absolute right-1.5 top-1.5 h-4 w-4 text-white drop-shadow" aria-label="Carousel" />
      ) : (
        post.media_type === "video" && <Play className="absolute right-1.5 top-1.5 h-4 w-4 fill-white text-white drop-shadow" />
      )}
    </>
  );
}

/** The workout card, small: the session and its best lift (gold for a PR). */
function WorkoutTile({ stats, unit, footer }: { stats: WorkoutShareStats; unit: "kg" | "lb"; footer: boolean }) {
  const lift = featuredLift(stats);
  const pr = !!lift?.pr;
  return (
    <div className={cn("flex h-full w-full flex-col justify-between p-2.5 text-white", footer && "pb-8", pr ? "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(245,158,11,0.45),#0b0b0e_60%)]" : "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)]")}>
      {pr ? <span className="w-max rounded-full bg-amber-400 px-1.5 text-[8px] font-black uppercase text-[#2b1700]">PR</span> : <span />}
      <div>
        <div className="font-display line-clamp-2 text-[15px] uppercase leading-[1.02]">{stats.workout_title}</div>
        {lift && <div className={cn("font-display mt-0.5 text-[13px] uppercase", pr ? "text-amber-300" : "text-white/80")}>{formatTopSet(lift.detail, unit)}</div>}
      </div>
    </div>
  );
}

/** A lock-in, small: LOCKED IN and the session (a pulse while they're training). */
function LockInTile({ post, footer }: { post: CommunityPost; footer: boolean }) {
  return (
    <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.55),rgba(127,29,29,0.16)_45%,#0a0a0d_75%)] p-2.5 text-white", footer && "pb-8")}>
      {isTrainingNow(post) ? <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> : <span />}
      <div>
        <div className="font-display text-[17px] uppercase leading-none">Locked in</div>
        <div className="mt-0.5 line-clamp-2 text-[10px] font-bold text-white/70">{post.session_title}</div>
      </div>
    </div>
  );
}
