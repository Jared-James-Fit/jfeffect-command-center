import { useState } from "react";
import { LiveDot } from "@/components/live-indicator";
import { Layers, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { featuredLift, formatTopSet, isTrainingNow, workoutHeadline, workoutSubtitle, type CommunityPost, type WorkoutShareStats } from "@/lib/community";
import { focusPosition } from "@/lib/photo-frame";

// Small on purpose: Home's shelf loads this with the app, the feed card stays in its own chunk.

/** The small picture a post gets (a video's still, else the photo); null for a card-only post. */
export function postThumbPath(p: Pick<CommunityPost, "media_thumb_path" | "media_type" | "media_path">): string | null {
  return p.media_thumb_path ?? (p.media_type === "image" ? p.media_path : null);
}

/** A lesson's own title (its card data), for a tile; null for anything else. */
function lessonTitle(post: Pick<CommunityPost, "series" | "series_extra">): string | null {
  const t = post.series === "lesson" ? (post.series_extra as { title?: unknown } | null | undefined)?.title : null;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * A post, small: its photo, else its workout, lock-in or note card, with a
 * corner mark for a carousel or video (its first slide only: no swiping
 * inside it). Fills its box (the profile grid's 3:4 tiles, Home's Crew feed).
 * On the grid a card's words sit in the middle of the tile, centred, and the
 * only thing in a corner is what it is (PR, a poll, training now), so every
 * tile lines up with the ones beside it; a lesson shows its title.
 * `footer`: keep the card's words clear of a strip along the bottom (the
 * like count). `large`: Home's Crew feed cards, with the author along the top.
 * A picture that won't load falls back to the card (never a broken-image box);
 * `onBroken` tells the parent so its overlays stop dressing it as a photo.
 */
export function PostTileFace({ post, thumb: signed, unit, footer = false, large = false, onBroken }: { post: CommunityPost; thumb: string | null; unit: "kg" | "lb"; footer?: boolean; large?: boolean; onBroken?: (url: string) => void }) {
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = signed && signed !== broken ? signed : null;
  const fail = () => {
    if (!thumb) return;
    setBroken(thumb);
    onBroken?.(thumb);
  };
  const shared = post.shared_comment && !post.shared_comment.gone ? post.shared_comment : null;
  const pad = large ? "p-4 pt-12" : "p-2.5";
  // which part of a cropped cover shows (a clip's framing, picked when it was posted)
  const objectPosition = focusPosition(post.media_focus);
  const bottom = footer && (large ? "pb-11" : "pb-8");
  return (
    <>
      {post.kind === "note" && post.media_type && thumb ? (
        // a coach post with a photo shows the photo, like any other post
        <TileImg src={thumb} onError={fail} position={objectPosition} />
      ) : post.kind === "note" && !large ? (
        <GridCard tone="note" mark={post.poll ? <TileMark>Poll</TileMark> : null}>
          {lessonTitle(post) ? (
            <span className="line-clamp-5 text-balance text-[13px] font-black leading-tight">{lessonTitle(post)}</span>
          ) : (
            <span className="line-clamp-6 text-balance text-[11.5px] font-medium leading-snug">{post.quote ? `“${post.quote}”` : post.caption || (shared ? `“${shared.body || "📷"}”` : "")}</span>
          )}
        </GridCard>
      ) : post.kind === "note" ? (
        <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.28),transparent_60%)] text-left", pad, bottom)}>
          <span className={cn("font-black uppercase tracking-[0.14em] text-primary", large ? "text-[10px]" : "text-[8px]")}>{post.poll ? "Poll" : "Note"}</span>
          <span className={cn("font-semibold leading-snug", large ? "line-clamp-4 text-[15px]" : cn("text-[11px]", footer ? "line-clamp-4" : "line-clamp-5"))}>
            {post.quote ? `“${post.quote}”` : post.caption || (shared ? `“${shared.body || "📷"}”` : "")}
          </span>
        </div>
      ) : post.media_type && thumb ? (
        <TileImg src={thumb} onError={fail} position={objectPosition} />
      ) : post.stats ? (
        <WorkoutTile stats={post.stats} unit={unit} pad={pad} bottom={bottom} large={large} />
      ) : post.locked_in_at ? (
        <LockInTile post={post} pad={pad} bottom={bottom} large={large} />
      ) : !large ? (
        <GridCard tone="workout">
          {post.caption ? (
            <span className="line-clamp-6 text-balance text-[11.5px] font-semibold leading-snug">{post.caption}</span>
          ) : (
            <span className="font-display line-clamp-3 text-[15px] uppercase leading-[1.02]">{post.session_title ?? "Session"}</span>
          )}
        </GridCard>
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

/** A tile's photo: fills the tile from its middle, and fades in once it's loaded (a cached one shows at once). */
function TileImg({ src, onError, position }: { src: string; onError: () => void; position?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={onError}
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
      }}
      data-loaded={loaded ? "" : undefined}
      className="media-fade h-full w-full object-cover object-center"
      // a clip's (or an older photo's) framing, picked when it was posted
      style={position ? { objectPosition: position } : undefined}
    />
  );
}

type Box = { pad: string; bottom: string | false; large: boolean };

const CARD_BG = {
  note: "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.28),transparent_60%)]",
  workout: "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)] text-white",
  pr: "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(245,158,11,0.45),#0b0b0e_60%)] text-white",
  lockin: "bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.55),rgba(127,29,29,0.16)_45%,#0a0a0d_75%)] text-white",
} as const;

/**
 * A card on the profile grid: its words in the middle of the tile, centred
 * both ways (the same room above and below, so a mark in the corner never
 * touches them), and its mark, if it has one, in the top-left corner.
 */
function GridCard({ tone, mark, children }: { tone: keyof typeof CARD_BG; mark?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("relative flex h-full w-full flex-col items-center justify-center gap-1 px-2.5 py-6 text-center", CARD_BG[tone])} data-grid-card={tone}>
      {mark && <span className="absolute left-2 top-2 flex">{mark}</span>}
      {children}
    </div>
  );
}

/** What a card is, in its corner: a small pill (PR, Poll). */
function TileMark({ children, tone = "red" }: { children: React.ReactNode; tone?: "red" | "gold" }) {
  return (
    <span className={cn("rounded-full px-1.5 text-[8px] font-black uppercase leading-[14px] tracking-[0.08em]", tone === "gold" ? "bg-amber-400 text-[#2b1700]" : "bg-primary/90 text-primary-foreground")}>{children}</span>
  );
}

/** The workout card, small: the session and its best lift (gold for a PR). */
function WorkoutTile({ stats, unit, pad, bottom, large }: { stats: WorkoutShareStats; unit: "kg" | "lb" } & Box) {
  const lift = featuredLift(stats);
  const pr = !!lift?.pr;
  if (!large)
    return (
      <GridCard tone={pr ? "pr" : "workout"} mark={pr ? <TileMark tone="gold">PR</TileMark> : null}>
        <span className="font-display line-clamp-3 text-balance text-[15px] uppercase leading-[1.02]">{workoutHeadline(stats)}</span>
        {lift && <span className={cn("font-display text-[13px] uppercase leading-none", pr ? "text-amber-300" : "text-white/80")}>{formatTopSet(lift.detail, unit)}</span>}
      </GridCard>
    );
  return (
    <div className={cn("flex h-full w-full flex-col justify-between text-white", pad, bottom, pr ? "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(245,158,11,0.45),#0b0b0e_60%)]" : "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)]")}>
      {pr ? <span className={cn("w-max rounded-full bg-amber-400 font-black uppercase text-[#2b1700]", large ? "px-2 py-px text-[10px]" : "px-1.5 text-[8px]")}>PR</span> : <span />}
      <div>
        {large && <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/55">Workout completed</div>}
        <div className={cn("font-display line-clamp-2 uppercase leading-[1.02]", large ? "text-[26px]" : "text-[15px]")}>{workoutHeadline(stats)}</div>
        {large && workoutSubtitle(stats) && <div className="mt-0.5 truncate text-[11px] font-semibold text-white/60">{workoutSubtitle(stats)}</div>}
        {lift && <div className={cn("font-display mt-0.5 uppercase", large ? "text-[19px]" : "text-[13px]", pr ? "text-amber-300" : "text-white/80")}>{formatTopSet(lift.detail, unit)}</div>}
      </div>
    </div>
  );
}

/** A lock-in, small: LOCKED IN and the session (a pulse while they're training). */
function LockInTile({ post, pad, bottom, large }: { post: CommunityPost } & Box) {
  if (!large)
    return (
      <GridCard tone="lockin" mark={isTrainingNow(post) ? <LiveDot size={8} tone="red" ring={false} /> : null}>
        <span className="font-display text-[17px] uppercase leading-none">Locked in</span>
        {post.session_title && <span className="line-clamp-2 text-balance text-[10px] font-bold text-white/70">{post.session_title}</span>}
      </GridCard>
    );
  return (
    <div className={cn("flex h-full w-full flex-col justify-between bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.55),rgba(127,29,29,0.16)_45%,#0a0a0d_75%)] text-white", pad, bottom)}>
      {isTrainingNow(post) ? <LiveDot size={8} tone="red" ring={false} /> : <span />}
      <div>
        <div className={cn("font-display uppercase leading-none", large ? "text-[32px]" : "text-[17px]")}>Locked in</div>
        <div className={cn("mt-0.5 line-clamp-2 font-bold text-white/70", large ? "text-[12px]" : "text-[10px]")}>{post.session_title}</div>
      </div>
    </div>
  );
}
