import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Heart, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { crewStories, isPulsePost, pickWorkoutWin, postTimeLabel, reactionEmoji, workoutHeadline, type CommunityPost, type StoryGroup } from "@/lib/community";
import { useFullMediaUrl, usePostMediaUrls, useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { markPostViewed } from "@/components/community/post-views";
import { useClientImpersonation } from "@/lib/client-impersonation";

/** How long one moment shows before the next. */
const FRAME_MS = 5000;

/**
 * Crew Stories: the crew's last day, Instagram-style, at the top of the
 * feed. A bubble per person with something new (ringed while any of it is
 * unseen, on any device); tap to watch their moments full screen: tap the
 * sides to step, hold to pause, swipe down to close. Moments are the posts
 * people made plus the automatic ones that had a real win in them (a PR, a
 * milestone, a streak), never routine sessions. Each one can be cheered
 * right there (🔥 for a win, ❤️ for a post) or opened in full.
 *
 * Nothing new is posted for this: it's the feed's own posts, so the
 * automatic-sharing switch on your profile and who-sees-it on every post
 * apply exactly as in the feed.
 */
export function StoryRail({ posts, unit, viewerIsStaff, onOpenPost, lead }: { posts: CommunityPost[]; unit: "kg" | "lb"; viewerIsStaff: boolean; onOpenPost: (id: string) => void; lead?: React.ReactNode }) {
  const [seenNow, setSeenNow] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => {
    const g = crewStories(posts);
    // what's been watched since the feed loaded counts too
    return g.map((x) => ({ ...x, unseen: x.items.some((p) => !p.seen && !seenNow.has(p.id)) }));
  }, [posts, seenNow]);
  const [open, setOpen] = useState<number | null>(null);
  // the order is fixed while watching (rings change as you go)
  const frozen = useRef<StoryGroup<CommunityPost>[]>([]);
  if (!groups.length) return null;
  const watch = (i: number) => {
    frozen.current = groups;
    setOpen(i);
  };
  return (
    <>
      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-4 sm:px-4" data-story-rail data-no-swipe-back aria-label="Crew stories">
        {lead}
        {groups.map((g, i) => (
          <button key={g.author.user_id} type="button" onClick={() => watch(i)} className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label={`${g.author.name}'s story${g.unseen ? ", new" : ""}`} data-story-unseen={g.unseen ? "" : undefined}>
            <span className={cn("grid h-[64px] w-[64px] place-items-center rounded-full p-[2.5px]", g.unseen ? "bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)]" : "bg-border")}>
              <span className="grid h-full w-full place-items-center rounded-full bg-background p-[2px]">
                <UserAvatar src={g.author.avatar_url} name={g.author.name} size={54} expandable={false} />
              </span>
            </span>
            <span className={cn("w-full truncate text-center text-[11px]", g.unseen ? "font-bold" : "font-medium text-muted-foreground")}>{g.author.name.split(" ")[0]}</span>
          </button>
        ))}
      </div>
      {open != null && (
        <StoryViewer
          groups={frozen.current}
          posts={posts}
          start={open}
          unit={unit}
          viewerIsStaff={viewerIsStaff}
          onSeen={(id) => setSeenNow((s) => (s.has(id) ? s : new Set(s).add(id)))}
          onClose={() => setOpen(null)}
          onOpenPost={(id) => {
            setOpen(null);
            onOpenPost(id);
          }}
        />
      )}
    </>
  );
}

function StoryViewer({
  groups,
  posts,
  start,
  unit,
  viewerIsStaff,
  onSeen,
  onClose,
  onOpenPost,
}: {
  groups: StoryGroup<CommunityPost>[];
  posts: CommunityPost[];
  start: number;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onSeen: (id: string) => void;
  onClose: () => void;
  onOpenPost: (id: string) => void;
}) {
  const { isImpersonating } = useClientImpersonation();
  const [gi, setGi] = useState(start);
  const [ii, setIi] = useState(() => Math.max(0, groups[start]?.items.findIndex((p) => !p.seen) ?? 0));
  const group = groups[gi];
  // the live copy (reactions land on it while it's showing)
  const post = group ? posts.find((p) => p.id === group.items[ii]?.id) ?? group.items[ii] : null;
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);

  const next = () => {
    if (!group) return onClose();
    if (ii < group.items.length - 1) setIi(ii + 1);
    else if (gi < groups.length - 1) {
      setGi(gi + 1);
      setIi(Math.max(0, groups[gi + 1].items.findIndex((p) => !p.seen)));
    } else onClose();
  };
  const prev = () => {
    if (ii > 0) setIi(ii - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setIi(groups[gi - 1].items.length - 1);
    } else setProgress(0);
  };

  // count it seen the moment it shows (never as the coach previewing a client)
  useEffect(() => {
    if (!post) return;
    setProgress(0);
    onSeen(post.id);
    if (!isImpersonating) markPostViewed(post.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // the clock
  useEffect(() => {
    if (!post || paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (!document.hidden) setProgress((p) => Math.min(1, p + dt / FRAME_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [post?.id, paused]);
  useEffect(() => {
    if (progress >= 1) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  if (!group || !post) return null;

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button, a")) return;
    press.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    holdTimer.current = window.setTimeout(() => setPaused(true), 220);
  };
  const onUp = (e: React.PointerEvent) => {
    window.clearTimeout(holdTimer.current);
    const p = press.current;
    press.current = null;
    const wasHold = paused;
    setPaused(false);
    if (!p) return;
    const dy = e.clientY - p.y;
    if (dy > 80 && Math.abs(dy) > Math.abs(e.clientX - p.x)) return onClose();
    if (wasHold || Date.now() - p.t > 220) return;
    if (p.x < window.innerWidth / 3) prev();
    else next();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,900px)] sm:max-w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{group.author.name}'s story</DialogTitle>
        <DialogDescription className="sr-only">Tap the right side for the next moment, the left to go back, hold to pause, swipe down to close.</DialogDescription>
        <div
          className="relative flex min-h-0 flex-1 select-none flex-col touch-none"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => {
            window.clearTimeout(holdTimer.current);
            press.current = null;
            setPaused(false);
          }}
          data-story-viewer
        >
          <StoryFrame post={post} unit={unit} />

          {/* top: progress, who, close */}
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6" style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}>
            <div className="flex gap-1">
              {group.items.map((p, i) => (
                <span key={p.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                  <span className="block h-full bg-white" style={{ width: `${i < ii ? 100 : i === ii ? progress * 100 : 0}%` }} />
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <UserAvatar src={group.author.avatar_url} name={group.author.name} size={32} expandable={false} />
              <span className="min-w-0 truncate text-[14px] font-bold">{group.author.name.split(" ")[0]}</span>
              <span className="shrink-0 text-[12px] text-white/70">{postTimeLabel(post.created_at)}</span>
              <button type="button" onClick={onClose} className="ml-auto grid h-10 w-10 place-items-center rounded-full active:bg-white/10" aria-label="Close">
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          <StoryActions post={post} viewerIsStaff={viewerIsStaff} onOpen={() => onOpenPost(post.id)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One moment, full screen: a win, a photo (or a clip's first frame), or words. */
function StoryFrame({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
  const { data: thumbs } = usePostMediaUrls([post]);
  const isImage = post.media_type === "image";
  const { data: full } = useFullMediaUrl(isImage ? post.media_path : null, isImage);
  const thumb = thumbs?.[post.media_thumb_path ?? (isImage ? post.media_path ?? "" : "")] ?? null;

  if (isPulsePost(post)) {
    const win = pickWorkoutWin(post.stats!, unit);
    const style = WIN_STYLE[win.kind];
    return (
      <div className={cn("flex flex-1 flex-col justify-center px-7", style.tint)} data-story-frame="win">
        <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-black uppercase tracking-[0.16em]", style.text)}>
          <style.Icon className="h-5 w-5" /> {win.label}
        </span>
        <span className="font-display mt-3 block text-[52px] uppercase leading-[0.95]">{win.headline}</span>
        {win.detail && <span className={cn("mt-2 block text-[20px] font-bold", win.kind === "pr" ? "text-amber-300" : "text-white/85")}>{win.detail}</span>}
        <span className="mt-4 block text-[14px] font-semibold text-white/60">{workoutHeadline(post.stats!)}</span>
      </div>
    );
  }
  const src = full ?? thumb ?? (post.media_type ? null : post.gif_url ?? null);
  if (src) {
    return (
      <div className="relative flex flex-1 items-center justify-center bg-black" data-story-frame="photo">
        <img src={src} alt="" className="max-h-full w-full object-contain" draggable={false} />
        {post.media_type === "video" && (
          <span className="pointer-events-none absolute grid h-16 w-16 place-items-center rounded-full bg-black/50 backdrop-blur-sm">
            <Play className="h-7 w-7 fill-white" />
          </span>
        )}
      </div>
    );
  }
  if (post.media_type) return <div className="flex flex-1 items-center justify-center bg-black" data-story-frame="loading" />;
  return (
    <div className="flex flex-1 items-center justify-center bg-[radial-gradient(120%_90%_at_80%_0%,rgba(239,51,64,0.35),transparent_60%)] bg-zinc-950 px-8" data-story-frame="words">
      <p className="line-clamp-[12] whitespace-pre-wrap text-center text-[24px] font-bold leading-snug">{post.caption}</p>
    </div>
  );
}

/** Cheer it right here (🔥 for a win, ❤️ for a post), or open it with its comments. */
function StoryActions({ post, viewerIsStaff, onOpen }: { post: CommunityPost; viewerIsStaff: boolean; onOpen: () => void }) {
  const react = useReact(post, viewerIsStaff);
  const win = isPulsePost(post);
  const mine = post.my_reaction;
  const give = () => react.mutate(mine ? null : win ? "fire" : "heart", { onError: () => toast.error("Couldn't send that") });
  const caption = !win && post.media_type ? post.caption?.trim() : null;
  return (
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pt-10" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}>
      {caption && <p className="mb-3 line-clamp-3 whitespace-pre-wrap text-[15px] leading-snug">{caption}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={give}
          aria-pressed={!!mine}
          className={cn("inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-black active:scale-95", mine ? "bg-white/15 text-white" : "bg-white text-black")}
          aria-label={mine ? "Take it back" : win ? "Give props" : "Like"}
        >
          {win ? <>{mine ? `${reactionEmoji(mine) ?? "🔥"} Sent` : "🔥 Props"}</> : <><Heart className={cn("h-5 w-5", mine && "fill-red-500 text-red-500")} /> {mine ? "Liked" : "Like"}</>}
        </button>
        <button type="button" onClick={onOpen} className="ml-auto inline-flex h-11 items-center gap-1 rounded-full bg-white/15 px-4 text-[14px] font-bold active:scale-95">
          {win ? "View workout" : "View post"} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
