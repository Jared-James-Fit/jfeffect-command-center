import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Heart, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { crewStories, isPulsePost, namesLine, pickWorkoutWin, postTimeLabel, reactionEmoji, storyEnd, workoutHeadline, type CommunityPost, type StoryEnd, type StoryGroup } from "@/lib/community";
import { useFullMediaUrl, usePostMediaUrls, useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { markPostViewed } from "@/components/community/post-views";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useFollowState } from "@/lib/community-social";

/** How long one moment shows before the next. */
const FRAME_MS = 5000;

/**
 * Crew Stories: the crew's last day, Instagram-style, at the top of the
 * feed. A bubble per person with something new (ringed while any of it is
 * unseen, on any device); tap to watch their moments full screen: tap the
 * sides to step, hold to pause, swipe down to close. Moments are the posts
 * people made plus the automatic ones that had a real win in them (a PR, a
 * milestone, a streak), never routine sessions. Each one can be cheered
 * right there (the heart, as everywhere) or opened in full. After the last
 * one, an end card points at the next good thing instead of dropping you
 * back on the feed (see StoryEndCard).
 *
 * Nothing new is posted for this: it's the feed's own posts, so the
 * automatic-sharing switch on your profile and who-sees-it on every post
 * apply exactly as in the feed.
 */
export function StoryRail({ posts, unit, viewerIsStaff, onOpenPost, onJumpTo, lead, addYours }: {
  posts: CommunityPost[];
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenPost: (id: string) => void;
  /** Close and take them to this post in the feed. */
  onJumpTo?: (id: string) => void;
  lead?: React.ReactNode;
  /** The end card's "add yours" (when they have nothing in the stories themselves). */
  addYours?: React.ReactNode;
}) {
  const [seenNow, setSeenNow] = useState<Set<string>>(() => new Set());
  const { data: follows } = useFollowState();
  const groups = useMemo(() => {
    const g = crewStories(posts, Date.now(), new Set(follows?.following ?? []));
    // what's been watched since the feed loaded counts too
    return g.map((x) => ({ ...x, unseen: x.items.some((p) => !p.seen && !seenNow.has(p.id)) }));
  }, [posts, seenNow, follows]);
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
          onJumpTo={(id) => {
            setOpen(null);
            if (onJumpTo) onJumpTo(id);
            else onOpenPost(id);
          }}
          addYours={addYours}
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
  onJumpTo,
  addYours,
}: {
  groups: StoryGroup<CommunityPost>[];
  posts: CommunityPost[];
  start: number;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onSeen: (id: string) => void;
  onClose: () => void;
  onOpenPost: (id: string) => void;
  onJumpTo: (id: string) => void;
  addYours?: React.ReactNode;
}) {
  const { isImpersonating } = useClientImpersonation();
  const firstUnseen = (g: StoryGroup<CommunityPost>) => Math.max(0, g.items.findIndex((p) => !p.seen));
  const [gi, setGi] = useState(start);
  const [ii, setIi] = useState(() => (groups[start] ? firstUnseen(groups[start]) : 0));
  const group = groups[gi];
  // the live copy (reactions land on it while it's showing)
  const post = group ? posts.find((p) => p.id === group.items[ii]?.id) ?? group.items[ii] : null;
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  // what's shown this sitting, and the end card once it's all been watched
  const watched = useRef(new Set<string>());
  const [end, setEnd] = useState<StoryEnd<CommunityPost> | null>(null);

  const next = () => {
    if (!group) return onClose();
    if (ii < group.items.length - 1) return setIi(ii + 1);
    // on to the next person not watched yet this time, else the end card
    const j = groups.findIndex((g, k) => k > gi && !g.items.some((p) => watched.current.has(p.id)));
    if (j >= 0) {
      setGi(j);
      setIi(firstUnseen(groups[j]));
    } else {
      setPaused(false);
      setEnd(storyEnd(groups, posts, watched.current));
    }
  };
  const watchFrom = (j: number) => {
    setEnd(null);
    setGi(j);
    setIi(firstUnseen(groups[j]));
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
    watched.current.add(post.id);
    onSeen(post.id);
    if (!isImpersonating) markPostViewed(post.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // the clock (stopped on the end card)
  useEffect(() => {
    if (!post || paused || end) return;
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
  }, [post?.id, paused, end]);
  useEffect(() => {
    if (progress >= 1 && !end) next();
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
        {end ? (
          <StoryEndCard
            end={end}
            groups={groups}
            posts={posts}
            viewerIsStaff={viewerIsStaff}
            onClose={onClose}
            onWatch={watchFrom}
            onOpenPost={onOpenPost}
            onJumpTo={onJumpTo}
            addYours={addYours}
          />
        ) : (
        <>
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
        </>
        )}
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

/** Celebrate it right here (the same heart as everywhere), or open it with its comments. */
function StoryActions({ post, viewerIsStaff, onOpen }: { post: CommunityPost; viewerIsStaff: boolean; onOpen: () => void }) {
  const react = useReact(post, viewerIsStaff);
  const win = isPulsePost(post);
  const mine = post.my_reaction;
  const [pop, setPop] = useState(0);
  const give = () => {
    if (!mine) setPop((n) => n + 1);
    react.mutate(mine ? null : "heart", { onError: () => toast.error("Couldn't send that") });
  };
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
          aria-label={mine ? "Take it back" : win ? "Celebrate" : "Like"}
        >
          <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
            {mine && mine !== "heart" ? <span className="text-[18px] leading-none">{reactionEmoji(mine)}</span> : <Heart className={cn("h-5 w-5", mine && "fill-[#ef3340] text-[#ef3340]")} />}
          </span>
          {mine ? (win ? "Celebrated" : "Liked") : win ? "Celebrate" : "Like"}
        </button>
        <button type="button" onClick={onOpen} className="ml-auto inline-flex h-11 items-center gap-1 rounded-full bg-white/15 px-4 text-[14px] font-bold active:scale-95">
          {win ? "View workout" : "View post"} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** A moment in a few words: "Competition Squat PR · 140 kg × 3", "10th session this month", or the post's words. */
function momentLine(post: CommunityPost): string {
  if (isPulsePost(post)) {
    const win = pickWorkoutWin(post.stats!, "kg");
    if (win.kind === "pr") return `${win.headline} PR`;
    return win.headline;
  }
  const words = post.caption?.trim().split("\n")[0];
  if (words) return words;
  if (post.locked_in_at) return "Locked in";
  if (post.media_type) return post.media_type === "video" ? "A clip" : "A photo";
  return post.gif_url ? "A GIF" : post.audio ? "A voice memo" : post.poll ? "A poll" : "A post";
}

/**
 * After the last story: "You're all caught up", then the next good thing,
 * only what's actually there. Stories you didn't get to, a one-tap heart
 * for the moments you watched without celebrating, how your own story is
 * doing (or Add yours), and the feed posts you haven't seen. Swipe down,
 * ✕ or Back to the feed to leave.
 */
function StoryEndCard({
  end,
  groups,
  posts,
  viewerIsStaff,
  onClose,
  onWatch,
  onOpenPost,
  onJumpTo,
  addYours,
}: {
  end: StoryEnd<CommunityPost>;
  groups: StoryGroup<CommunityPost>[];
  posts: CommunityPost[];
  viewerIsStaff: boolean;
  onClose: () => void;
  onWatch: (groupIndex: number) => void;
  onOpenPost: (id: string) => void;
  onJumpTo: (id: string) => void;
  addYours?: React.ReactNode;
}) {
  const live = (id: string) => posts.find((p) => p.id === id);
  const mine = end.mine ? live(end.mine.id) ?? end.mine : null;
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ y: number; top: boolean } | null>(null);
  // swipe down to close (from the top; never from a sheet opened on top of this)
  const onTouchStart = (e: React.TouchEvent) => {
    if (!e.currentTarget.contains(e.target as Node)) return;
    touch.current = { y: e.touches[0].clientY, top: (scroller.current?.scrollTop ?? 0) <= 0 };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (t?.top && e.changedTouches[0].clientY - t.y > 90) onClose();
  };
  const feedFaces = [...new Map(end.feedNew.map((p) => [p.author.user_id, p.author])).values()].slice(0, 3);
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-zinc-950 bg-[radial-gradient(110%_60%_at_50%_0%,rgba(239,51,64,0.30),transparent_65%)] animate-in fade-in duration-300"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      data-story-end
    >
      <DialogTitle className="sr-only">You're all caught up</DialogTitle>
      <DialogDescription className="sr-only">You've watched the crew's stories. What's next is below.</DialogDescription>
      <div className="flex justify-end px-3" style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-white/10" aria-label="Close">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-4">
        {/* sits in the middle when it's short, scrolls when it isn't */}
        <div className="my-auto">
        {/* who you just watched */}
        <div className="flex flex-col items-center pt-2 text-center">
          <div className="relative">
            <div className="flex -space-x-2">
              {end.people.slice(0, 4).map((a) => (
                <span key={a.user_id} className="rounded-full ring-[3px] ring-zinc-950">
                  <UserAvatar src={a.avatar_url} name={a.name} size={46} expandable={false} />
                </span>
              ))}
            </div>
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 ring-[3px] ring-zinc-950">
              <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
            </span>
          </div>
          <h2 className="mt-4 text-[26px] font-black leading-tight">You're all caught up</h2>
          {end.moments > 0 && (
            <p className="mt-1 text-[14px] text-white/65">
              {end.moments} {end.moments === 1 ? "moment" : "moments"} from {namesLine(end.people)}
            </p>
          )}
        </div>

        {/* more stories you didn't get to this time */}
        {end.stillNew.length > 0 && (
          <section className="mt-7" data-story-end-more>
            <h3 className="text-[12px] font-black uppercase tracking-[0.14em] text-white/55">Still new</h3>
            <div className="-mx-5 mt-2.5 flex gap-3 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {end.stillNew.map((j) => {
                const g = groups[j];
                return (
                  <button key={g.author.user_id} type="button" onClick={() => onWatch(j)} className="flex w-[62px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label={`Watch ${g.author.name}'s story`}>
                    <span className="grid h-[60px] w-[60px] place-items-center rounded-full bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)] p-[2.5px]">
                      <span className="grid h-full w-full place-items-center rounded-full bg-zinc-950 p-[2px]">
                        <UserAvatar src={g.author.avatar_url} name={g.author.name} size={50} expandable={false} />
                      </span>
                    </span>
                    <span className="w-full truncate text-center text-[11px] font-bold">{g.author.name.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* the ones you watched but didn't celebrate: one tap each */}
        {end.celebrate.length > 0 && (
          <section className="mt-7" data-story-end-love>
            <h3 className="text-[12px] font-black uppercase tracking-[0.14em] text-white/55">Give them some love</h3>
            <ul className="mt-1.5">
              {end.celebrate.map((id) => {
                const p = live(id);
                return p ? <EndLoveRow key={id} post={p} viewerIsStaff={viewerIsStaff} onOpen={() => onOpenPost(id)} /> : null;
              })}
            </ul>
          </section>
        )}

        {/* yours: how it's doing */}
        {mine && (
          <section className="mt-7">
            <h3 className="text-[12px] font-black uppercase tracking-[0.14em] text-white/55">Your story</h3>
            <button type="button" onClick={() => onOpenPost(mine.id)} className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-3.5 py-3 text-left active:bg-white/10" data-story-end-mine>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{momentLine(mine)}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-white/65">
                  {(mine.views?.faces.length ?? 0) > 0 && (
                    <span className="flex -space-x-1.5">
                      {mine.views!.faces.slice(0, 3).map((f) => (
                        <span key={f.user_id} className="rounded-full ring-2 ring-zinc-900">
                          <UserAvatar src={f.avatar_url} name={f.name} size={20} expandable={false} />
                        </span>
                      ))}
                    </span>
                  )}
                  <span>
                    {mine.views?.count ? `Seen by ${mine.views.count}` : "No views yet"}
                    {(mine.reaction_count ?? 0) > 0 ? ` · ❤️ ${mine.reaction_count}` : ""}
                    {mine.comment_count > 0 ? ` · 💬 ${mine.comment_count}` : ""}
                  </span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
            </button>
          </section>
        )}
        </div>
      </div>

      {/* what's next */}
      <div className="space-y-2.5 px-5 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
        {!mine && addYours}
        {end.feedNew.length > 0 ? (
          <button type="button" onClick={() => onJumpTo(end.feedNew[0].id)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-[15px] font-black text-black active:scale-[0.98]" data-story-end-feed>
            <span className="flex -space-x-1.5">
              {feedFaces.map((a) => (
                <span key={a.user_id} className="rounded-full ring-2 ring-white">
                  <UserAvatar src={a.avatar_url} name={a.name} size={22} expandable={false} />
                </span>
              ))}
            </span>
            {end.feedNew.length} new in the feed
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={onClose} className="h-12 w-full rounded-2xl bg-white/15 text-[15px] font-black active:scale-[0.98]">
            Back to the feed
          </button>
        )}
      </div>
    </div>
  );
}

/** One moment you skipped past: who, what, and the heart. */
function EndLoveRow({ post, viewerIsStaff, onOpen }: { post: CommunityPost; viewerIsStaff: boolean; onOpen: () => void }) {
  const react = useReact(post, viewerIsStaff);
  const mine = post.my_reaction;
  const [pop, setPop] = useState(0);
  const give = () => {
    if (!mine) {
      setPop((n) => n + 1);
      navigator.vibrate?.(8);
    }
    react.mutate(mine ? null : "heart", { onError: () => toast.error("Couldn't send that") });
  };
  return (
    <li className="flex items-center gap-3 py-1.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70" aria-label={`${post.author.name}: ${momentLine(post)}. Open it`}>
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={40} expandable={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{post.author.name.split(" ")[0]}</span>
          <span className="flex min-w-0 text-[13px] text-white/65">
            <span className="truncate">{momentLine(post)}</span>
            <span className="shrink-0">&nbsp;· {postTimeLabel(post.created_at)}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={give}
        aria-pressed={!!mine}
        aria-label={mine ? "Take it back" : isPulsePost(post) ? "Celebrate" : "Like"}
        className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full active:scale-90", mine ? "bg-[#ef3340]/15" : "bg-white/10")}
        data-story-end-heart
      >
        <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
          {mine && mine !== "heart" ? <span className="text-[20px] leading-none">{reactionEmoji(mine)}</span> : <Heart className={cn("h-[22px] w-[22px]", mine && "fill-[#ef3340] text-[#ef3340]")} />}
        </span>
      </button>
    </li>
  );
}
