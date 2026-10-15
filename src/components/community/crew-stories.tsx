import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Eye, Heart, Play, Plus, Sticker as StickerIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, crewStories, isPulsePost, myStory, namesLine, pickWorkoutWin, postTimeLabel, reactionEmoji, storyEnd, storyFrameKind, storyWords, workoutHeadline, type CommunityAuthor, type CommunityPost, type StoryEnd, type StoryGroup } from "@/lib/community";
import { useCommunityProfile, useFullMediaUrl, usePostMediaUrls, useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { ViewersSheet, markPostViewed } from "@/components/community/post-views";
import { LessonStoryFrame } from "@/components/community/lesson-card";
import { StorySticker } from "@/components/community/story-sticker";
import { stickerSpot } from "@/lib/lessons";
import { PostStickerEditor } from "@/components/community/sticker-editor";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useFollowState } from "@/lib/community-social";
import { useAuth } from "@/lib/auth";
import { useDirectThreads, useMessageAuthor } from "@/lib/direct-chats";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";

/** How long one moment shows before the next. */
const FRAME_MS = 5000;
/** One turn of the cube from one person's story to the next. */
const TURN_MS = 320;

/**
 * Crew Stories: the crew's last day, Instagram-style, at the top of the
 * feed. A bubble per person with something new (ringed while any of it is
 * unseen, on any device); tap to watch their moments full screen: tap the
 * sides to step, hold to pause, swipe down to close. Moments are what people
 * shared with the crew in the last day, including each finished session
 * (posted for them when automatic sharing is on), led by its best win; a
 * bubble with a PR in it wears a small "PR" tag. Each one can be cheered
 * right there (the heart, as everywhere) or opened in full. After the last
 * one, an end card points at the next good thing instead of dropping you
 * back on the feed (see StoryEndCard). There's no separate crew "Activity"
 * story: the week's wins are Wednesday Wins in the feed, and Rankings.
 *
 * Nothing new is posted for this: it's the feed's own posts, so the
 * automatic-sharing switch on your profile and who-sees-it on every post
 * apply exactly as in the feed.
 */
export function StoryRail({ posts, unit, viewerIsStaff, onOpenPost, onOpenPerson, onJumpTo, addStory, addYours }: {
  posts: CommunityPost[];
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenPost: (id: string) => void;
  /** Their profile (Instagram: tap the name or photo on a story). The story closes first. */
  onOpenPerson?: (a: CommunityAuthor) => void;
  /** Close and take them to this post in the feed. */
  onJumpTo?: (id: string) => void;
  /**
   * Adding to your story (the camera), Instagram's way: "Your story" leads the
   * row with a + on it, and your own story has a + too. Hands over the button
   * that opens it; nothing to add (coaches, nobody to post as) = no bubble.
   */
  addStory?: (trigger: (begin: () => void) => React.ReactNode) => React.ReactNode;
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
  // yours: what you shared in the last day (a finished session posts itself), with who saw it
  const mine = useMemo(() => myStory(posts), [posts]);
  const [open, setOpen] = useState<number | null>(null);
  // the order is fixed while watching (rings change as you go)
  const frozen = useRef<StoryGroup<CommunityPost>[]>([]);
  // opens the camera (from the bubble's +, or the + on your own story)
  const addRef = useRef<(() => void) | null>(null);
  // your picture for "Your story" before there's anything in it
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(addStory && !mine ? (user?.id ?? null) : null);
  // a quiet day with nothing to add either: no row at all
  if (!groups.length && !mine && !addStory) return null;
  /** i = a person's bubble; -1 = yours. */
  const watch = (i: number) => {
    frozen.current = [...(mine ? [mine] : []), ...groups];
    setOpen(i === -1 ? 0 : i + (mine ? 1 : 0));
  };
  return (
    <>
      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-4 sm:px-4" data-story-rail data-no-swipe-back aria-label="Crew stories">
        {addStory ? (
          addStory((begin) => {
            addRef.current = begin;
            const who = mine?.author ?? me?.author ?? null;
            return (
              <div className="relative flex w-[64px] shrink-0 flex-col items-center gap-1" data-story-mine={mine ? "" : "empty"}>
                {/* your story plays from the picture; with nothing in it yet, the picture adds one */}
                <button type="button" onClick={mine ? () => watch(-1) : begin} className="active:scale-95" aria-label={mine ? `Your story${mine.prs ? `, ${prTag(mine.prs)}` : ""}` : "Add to your story"}>
                  <span className={cn("relative grid h-[64px] w-[64px] place-items-center rounded-full p-[2.5px]", mine ? "bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)]" : "bg-transparent")}>
                    <span className="grid h-full w-full place-items-center rounded-full bg-background p-[2px]">
                      <UserAvatar src={who?.avatar_url ?? null} name={who?.name ?? "You"} size={54} expandable={false} />
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={begin}
                  className="absolute right-[-1px] top-[42px] grid h-[22px] w-[22px] place-items-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-background active:scale-90"
                  aria-label="Add to your story"
                  data-story-add
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={3.5} />
                </button>
                <span className="w-full truncate text-center text-[11px] font-bold">Your story</span>
              </div>
            );
          })
        ) : mine && (
          <button type="button" onClick={() => watch(-1)} className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label={`Your story${mine.prs ? `, ${prTag(mine.prs)}` : ""}`} data-story-mine>
            <span className="relative grid h-[64px] w-[64px] place-items-center rounded-full bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)] p-[2.5px]">
              <span className="grid h-full w-full place-items-center rounded-full bg-background p-[2px]">
                <UserAvatar src={mine.author.avatar_url} name={mine.author.name} size={54} expandable={false} />
              </span>
              <PrTag prs={mine.prs} />
            </span>
            <span className="w-full truncate text-center text-[11px] font-bold">Your story</span>
          </button>
        )}
        {groups.map((g, i) => (
          <button key={g.author.user_id} type="button" onClick={() => watch(i)} className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label={`${g.author.name}'s story${g.prs ? `, ${prTag(g.prs)}` : ""}${g.unseen ? ", new" : ""}`} data-story-unseen={g.unseen ? "" : undefined}>
            {/* Close Friends: green ring, as on Instagram */}
            <span data-story-close-friends={g.unseen && g.closeFriends ? "" : undefined} className={cn("relative grid h-[64px] w-[64px] place-items-center rounded-full p-[2.5px]", g.unseen ? (g.closeFriends ? "bg-emerald-500" : "bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)]") : "bg-border")}>
              <span className="grid h-full w-full place-items-center rounded-full bg-background p-[2px]">
                <UserAvatar src={g.author.avatar_url} name={g.author.name} size={54} expandable={false} />
              </span>
              <PrTag prs={g.prs} />
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
          onOpenPerson={onOpenPerson}
          addYours={addYours}
          onAdd={addStory ? () => addRef.current?.() : undefined}
        />
      )}
    </>
  );
}

/** "PR", "2 PRs": what a bubble's story holds, read at a glance. */
function prTag(n: number): string {
  return n > 1 ? `${n} PRs` : "PR";
}

/** The small tag on a story bubble with a PR in it (the win, on the athlete who set it). */
function PrTag({ prs }: { prs: number }) {
  if (prs <= 0) return null;
  return (
    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-background bg-primary px-1.5 text-[9px] font-black leading-[14px] text-primary-foreground tabular-nums" data-story-pr>
      {prTag(prs)}
    </span>
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
  onOpenPerson,
  addYours,
  onAdd,
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
  onOpenPerson?: (a: CommunityAuthor) => void;
  addYours?: React.ReactNode;
  /** Your own story: the + on your picture adds another (the story closes, the camera opens). */
  onAdd?: () => void;
}) {
  const { isImpersonating } = useClientImpersonation();
  const firstUnseen = (g: StoryGroup<CommunityPost>) => Math.max(0, g.items.findIndex((p) => !p.seen));
  const frames = (g: StoryGroup<CommunityPost>) => g.items.length;
  const [gi, setGi] = useState(start);
  const [ii, setIi] = useState(() => (groups[start] ? firstUnseen(groups[start]) : 0));
  const group = groups[gi];
  const item = group ? group.items[ii] : undefined;
  // the live copy (reactions land on it while it's showing)
  const post = item ? posts.find((p) => p.id === item.id) ?? item : null;
  const frameKey = post?.id;
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  // what's shown this sitting, and the end card once it's all been watched
  const watched = useRef(new Set<string>());
  const [end, setEnd] = useState<StoryEnd<CommunityPost> | null>(null);
  // writing a reply (or picking a quick reaction): the story waits
  const [composing, setComposing] = useState(false);
  // Swipe down to close, as on Instagram: the story follows the finger (shrinking, the feed showing
  // through behind it); let go far enough down, or flick, and it slides away, else it springs back.
  const [drag, setDrag] = useState<{ y: number; settle: boolean } | null>(null);
  const dragging = useRef(false);
  const closing = useRef(false);
  const lastMove = useRef<{ y: number; t: number } | null>(null);
  const velocity = useRef(0);
  // Swipe sideways for the next (or the last) person, Instagram's cube: their story and yours
  // follow the finger round the corner; let go past a quarter (or flick) and it turns, else it
  // settles back. A story that runs out turns the same way. p: -1 = the next person, 1 = the last.
  const [swipe, setSwipe] = useState<{ p: number; settle: boolean } | null>(null);
  // the turn in progress: who it lands on (an automatic one can skip people already watched)
  const [turn, setTurn] = useState<{ to: number; ii: number; dir: 1 | -1 } | null>(null);
  const swiping = useRef(false);
  const turning = useRef(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const lastX = useRef<{ x: number; t: number } | null>(null);
  const vx = useRef(0);
  // a sticker sits just above the bottom bar, however tall it is (a caption, View post, the reply box)
  const [barH, setBarH] = useState<number | null>(null);
  const hasSticker = !!post?.sticker;
  useEffect(() => {
    const bar = hasSticker ? stage.current?.querySelector<HTMLElement>("[data-story-bar], [data-story-mine-bar]") : null;
    if (!bar) return;
    const measure = () => setBarH(bar.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [post?.id, post?.is_mine, hasSticker]);
  const nextPerson = gi + 1 < groups.length ? gi + 1 : null;
  const prevPerson = gi > 0 ? gi - 1 : null;
  const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const land = (j: number, at: number) => {
    setEnd(null);
    setGi(j);
    setIi(at);
  };
  /** Turn the cube to person j (from wherever a finger left it), then show them from frame `at`. */
  const turnTo = (j: number, at: number, dir: 1 | -1) => {
    if (turning.current) return;
    if (reduced()) return land(j, at);
    turning.current = true;
    setPaused(true);
    setTurn({ to: j, ii: at, dir });
    setSwipe((sw) => ({ p: sw?.p ?? 0, settle: false }));
    requestAnimationFrame(() => requestAnimationFrame(() => setSwipe({ p: dir === 1 ? -1 : 1, settle: true })));
    window.setTimeout(() => {
      land(j, at);
      setSwipe(null);
      setTurn(null);
      setPaused(false);
      turning.current = false;
    }, TURN_MS);
  };
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return onClose();
    setDrag({ y: window.innerHeight, settle: true });
    window.setTimeout(onClose, 210);
  };
  // someone's profile: the story slides away and their page is underneath
  const openPerson = onOpenPerson
    ? (a: CommunityAuthor) => {
        close();
        window.setTimeout(() => onOpenPerson(a), 230);
      }
    : undefined;

  const next = () => {
    if (!group) return close();
    if (ii < frames(group) - 1) return setIi(ii + 1);
    // on to the next person with something not watched this time, from where that
    // starts; else the end card. Your own story never plays itself after someone else's.
    const fresh = (p: CommunityPost) => !watched.current.has(p.id);
    const j = groups.findIndex((g, k) => k > gi && !g.mine && g.items.some(fresh));
    if (j >= 0) {
      const items = groups[j].items;
      const at = items.findIndex((p) => fresh(p) && !p.seen);
      turnTo(j, at >= 0 ? at : Math.max(0, items.findIndex(fresh)), 1);
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
    else if (gi > 0) turnTo(gi - 1, frames(groups[gi - 1]) - 1, -1);
    else setProgress(0);
  };

  // count it seen the moment it shows (never as the coach previewing a client)
  useEffect(() => {
    if (!frameKey) return;
    setProgress(0);
    if (!post) return;
    watched.current.add(post.id);
    onSeen(post.id);
    if (!isImpersonating) markPostViewed(post.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  // the clock (stopped on the end card, and while replying)
  useEffect(() => {
    if (!frameKey || paused || end || composing) return;
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
  }, [frameKey, paused, end, composing]);
  useEffect(() => {
    if (progress >= 1 && !end) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  if (!group || !post) return null;

  const onDown = (e: React.PointerEvent) => {
    // never from a sheet opened on top (who viewed it): it isn't the story
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as Element).closest("button, a, input, textarea, [data-story-interactive]")) return;
    // replying: a tap on the story just puts the keyboard away
    if (composing) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    if (turning.current) return;
    press.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    lastMove.current = { y: e.clientY, t: performance.now() };
    lastX.current = { x: e.clientX, t: performance.now() };
    velocity.current = 0;
    vx.current = 0;
    holdTimer.current = window.setTimeout(() => setPaused(true), 220);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || closing.current || turning.current) return;
    const dy = e.clientY - p.y;
    const dx = e.clientX - p.x;
    if (!dragging.current && !swiping.current) {
      // sideways turns to another person; a downward drag picks the story up; anything less is a tap
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) swiping.current = true;
      else if (dy >= 12 && dy >= Math.abs(dx) * 1.2) dragging.current = true;
      else return;
      window.clearTimeout(holdTimer.current);
      setPaused(true);
    }
    const now = performance.now();
    if (swiping.current) {
      const lx = lastX.current;
      if (lx && now > lx.t) vx.current = 0.7 * ((e.clientX - lx.x) / (now - lx.t)) + 0.3 * vx.current;
      lastX.current = { x: e.clientX, t: now };
      const w = stage.current?.clientWidth || window.innerWidth;
      let q = dx / w;
      // nobody that way: it gives a little, then holds
      if ((q < 0 && nextPerson == null) || (q > 0 && prevPerson == null)) q = Math.sign(q) * Math.min(0.12, Math.abs(q) * 0.3);
      setSwipe({ p: Math.max(-1, Math.min(1, q)), settle: false });
      return;
    }
    const last = lastMove.current;
    if (last && now > last.t) velocity.current = 0.7 * ((e.clientY - last.y) / (now - last.t)) + 0.3 * velocity.current;
    lastMove.current = { y: e.clientY, t: now };
    setDrag({ y: Math.max(0, dy), settle: false });
  };
  const springBack = () => {
    setDrag({ y: 0, settle: true });
    window.setTimeout(() => setDrag((d) => (d && d.y === 0 ? null : d)), 230);
    setPaused(false);
  };
  const onUp = (e: React.PointerEvent) => {
    window.clearTimeout(holdTimer.current);
    const p = press.current;
    press.current = null;
    if (swiping.current) {
      swiping.current = false;
      const q = swipe?.p ?? 0;
      const v = vx.current;
      const toNext = q < 0 && (q < -0.25 || (v < -0.4 && q < -0.03));
      const toPrev = q > 0 && (q > 0.25 || (v > 0.4 && q > 0.03));
      if (toNext && nextPerson != null) return turnTo(nextPerson, firstUnseen(groups[nextPerson]), 1);
      if (toPrev && prevPerson != null) return turnTo(prevPerson, firstUnseen(groups[prevPerson]), -1);
      setPaused(false);
      // past the last person: the end card (what's next, who saw yours)
      if (toNext) {
        setSwipe(null);
        setEnd(storyEnd(groups, posts, watched.current));
        return;
      }
      setSwipe({ p: 0, settle: true });
      window.setTimeout(() => setSwipe((sw) => (sw && sw.p === 0 ? null : sw)), TURN_MS);
      return;
    }
    if (dragging.current) {
      dragging.current = false;
      const dy = p ? e.clientY - p.y : 0;
      // far enough, or a quick flick down
      if (dy > 110 || (velocity.current > 0.45 && dy > 30)) close();
      else springBack();
      return;
    }
    const wasHold = paused;
    setPaused(false);
    if (!p) return;
    const dy = e.clientY - p.y;
    if (dy > 80 && Math.abs(dy) > Math.abs(e.clientX - p.x)) return close();
    // swipe up: the post itself (the workout, comments)
    if (dy < -80 && Math.abs(dy) > Math.abs(e.clientX - p.x)) return onOpenPost(post.id);
    if (wasHold || Date.now() - p.t > 220) return;
    if (p.x < window.innerWidth / 3) prev();
    else next();
  };

  // while it's dragged: down with the finger, a little smaller and rounder, the dim behind fading
  const pull = drag ? Math.min(1, drag.y / (window.innerHeight * 0.5)) : 0;
  const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  const lifted: React.CSSProperties | undefined = drag
    ? {
        transform: `translate3d(0, ${drag.y}px, 0) scale(${1 - pull * 0.14})`,
        borderRadius: Math.round(8 + pull * 24),
        transformOrigin: "50% 30%",
        transition: drag.settle ? `transform 210ms ${ease}, border-radius 210ms ${ease}` : "none",
      }
    : undefined;
  const who = group.author;
  // the cube: this story on the front, the next person's on the right side, the last one's on the left
  const sp = swipe?.p ?? 0;
  const turnEase = swipe?.settle ? `transform ${TURN_MS}ms cubic-bezier(0.25, 0.8, 0.25, 1)` : "none";
  const face = (offset: number): React.CSSProperties => ({
    transform: `translate3d(${(sp + offset) * 100}%, 0, 0) rotateY(${(sp + offset) * 90}deg)`,
    transformOrigin: sp + offset < 0 ? "100% 50%" : "0% 50%",
    transition: turnEase,
    backfaceVisibility: "hidden",
  });
  const nextFace = turn?.dir === 1 ? { j: turn.to, at: turn.ii } : nextPerson != null ? { j: nextPerson, at: firstUnseen(groups[nextPerson]) } : null;
  const prevFace = turn?.dir === -1 ? { j: turn.to, at: turn.ii } : prevPerson != null ? { j: prevPerson, at: firstUnseen(groups[prevPerson]) } : null;

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0 text-white shadow-none dark:bg-transparent sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,900px)] sm:max-w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        overlayStyle={drag ? { opacity: 1 - pull, transition: drag.settle ? `opacity 210ms ${ease}` : "none" } : undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          // Esc while replying puts the keyboard away, it doesn't close the stories
          if (composing) {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur?.();
          }
        }}
      >
        <div ref={stage} className={cn("relative flex min-h-0 flex-1 flex-col sm:rounded-[28px]", swipe && "bg-black")} style={{ perspective: "1100px" }} data-story-stage>
        {/* the people either side, ready (their pictures load before you get there) */}
        {!end && nextFace && (
          <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ ...face(1), visibility: swipe && sp < 0 ? "visible" : "hidden" }} aria-hidden data-story-face="next">
            <StoryPeek group={groups[nextFace.j]} at={nextFace.at} unit={unit} />
          </div>
        )}
        {!end && prevFace && (
          <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ ...face(-1), visibility: swipe && sp > 0 ? "visible" : "hidden" }} aria-hidden data-story-face="prev">
            <StoryPeek group={groups[prevFace.j]} at={prevFace.at} unit={unit} />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-black will-change-transform sm:rounded-[28px]" style={swipe ? face(0) : lifted} data-story-card>
        {end ? (
          <StoryEndCard
            end={end}
            groups={groups}
            posts={posts}
            viewerIsStaff={viewerIsStaff}
            onClose={close}
            onWatch={watchFrom}
            onOpenPost={onOpenPost}
            onJumpTo={onJumpTo}
            addYours={addYours}
          />
        ) : (
        <>
        <DialogTitle className="sr-only">{group.mine ? "Your story" : `${group.author.name}'s story`}</DialogTitle>
        <DialogDescription className="sr-only">Tap the right side for the next moment, the left to go back, hold to pause, swipe left or right for the next or last person, swipe up for the post, swipe down to close. Reply or send a quick reaction at the bottom.</DialogDescription>
        <div
          className="relative flex min-h-0 flex-1 select-none flex-col touch-none"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerMove={onMove}
          onPointerCancel={() => {
            window.clearTimeout(holdTimer.current);
            press.current = null;
            if (swiping.current) {
              swiping.current = false;
              setSwipe(null);
              setPaused(false);
            } else if (dragging.current) {
              dragging.current = false;
              springBack();
            } else setPaused(false);
          }}
          data-story-viewer
        >
          <StoryFrame post={post} unit={unit} />
          {post.sticker && (
            // where the poster put it; else above the reply bar's fade, so the
            // whole sticker takes taps (the bar's top 40px is its fade, not buttons)
            <div className="absolute inset-x-0 z-40" style={stickerSpot(post.sticker.y, barH)}>
              <StorySticker post={post} onComposing={setComposing} onOpenPerson={openPerson} />
            </div>
          )}

          {/* top: progress, who, close */}
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6" style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}>
            <div className="flex gap-1">
              {Array.from({ length: frames(group) }, (_, i) => (
                <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                  <span className="block h-full bg-white" style={{ width: `${i < ii ? 100 : i === ii ? progress * 100 : 0}%` }} />
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              {group.mine && onAdd ? (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    window.setTimeout(onAdd, 240);
                  }}
                  className="relative shrink-0 active:scale-95"
                  aria-label="Add to your story"
                  data-story-viewer-add
                >
                  <UserAvatar src={who.avatar_url} name={who.name} size={32} expandable={false} />
                  <span className="absolute -bottom-0.5 -right-1 grid h-[16px] w-[16px] place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-black">
                    <Plus className="h-2.5 w-2.5" strokeWidth={4} />
                  </span>
                </button>
              ) : openPerson ? (
                <button type="button" onClick={() => openPerson(who)} className="shrink-0 rounded-full active:scale-95" aria-label={group.mine ? "Open your profile" : `Open ${who.name}'s profile`} data-story-profile>
                  <UserAvatar src={who.avatar_url} name={who.name} size={32} expandable={false} />
                </button>
              ) : (
                <UserAvatar src={who.avatar_url} name={who.name} size={32} expandable={false} />
              )}
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  {openPerson ? (
                    <button type="button" onClick={() => openPerson(who)} className="min-w-0 truncate text-left text-[14px] font-bold active:opacity-70" data-story-profile-name>
                      {group.mine ? "Your story" : who.name.split(" ")[0]}
                    </button>
                  ) : (
                    <span className="truncate text-[14px] font-bold">{group.mine ? "Your story" : who.name.split(" ")[0]}</span>
                  )}
                  <span className="shrink-0 text-[12px] text-white/70">{postTimeLabel(post.created_at)}</span>
                </span>
              </span>
              <button type="button" onClick={close} className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-white/10" aria-label="Close">
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {post.is_mine ? (
            <MyStoryBar post={post} onOpen={() => onOpenPost(post.id)} onHold={setComposing} onOpenPerson={openPerson} />
          ) : (
            <StoryBar post={post} viewerIsStaff={viewerIsStaff} onOpen={() => onOpenPost(post.id)} onComposing={setComposing} />
          )}
        </div>
        </>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Another person's story as it'll look when the cube turns to them: their frame and their header. */
function StoryPeek({ group, at, unit }: { group: StoryGroup<CommunityPost>; at: number; unit: "kg" | "lb" }) {
  const post = group.items[at] ?? group.items[0];
  if (!post) return null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black sm:rounded-[28px]">
      <StoryFrame post={post} unit={unit} />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6" style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}>
        <div className="flex gap-1">
          {group.items.map((it, i) => (
            <span key={it.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white" style={{ width: i < at ? "100%" : "0%" }} />
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex h-10 items-center gap-2">
          <UserAvatar src={group.author.avatar_url} name={group.author.name} size={32} expandable={false} />
          <span className="truncate text-[14px] font-bold">{group.mine ? "Your story" : group.author.name.split(" ")[0]}</span>
          <span className="shrink-0 text-[12px] text-white/70">{postTimeLabel(post.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

/** Your own story: who's seen it and the hearts (nothing to reply to). Tap Seen by for the names. */
function MyStoryBar({ post, onOpen, onHold, onOpenPerson }: { post: CommunityPost; onOpen: () => void; onHold: (on: boolean) => void; onOpenPerson?: (a: CommunityAuthor) => void }) {
  const [viewers, setViewers] = useState(false);
  const [sticker, setSticker] = useState(false);
  // the story waits while the list (or the sticker editor) is open
  useEffect(() => {
    onHold(viewers || sticker);
  }, [viewers, sticker, onHold]);
  useEffect(() => () => onHold(false), [onHold]);
  const v = post.views;
  const hearts = post.reaction_count ?? 0;
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pt-10" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.85rem)" }} data-story-mine-bar>
      <button
        type="button"
        onClick={() => v?.count && setViewers(true)}
        disabled={!v?.count}
        className="flex h-11 min-w-0 items-center gap-2 rounded-full bg-white/15 pl-2 pr-4 text-[14px] font-bold backdrop-blur-sm active:scale-95 disabled:active:scale-100"
        aria-label={v?.count ? `Seen by ${v.count}. See who` : "No views yet"}
      >
        {v?.faces.length ? (
          <span className="flex shrink-0 -space-x-1.5">
            {v.faces.slice(0, 3).map((a) => (
              <span key={a.user_id} className="rounded-full ring-2 ring-black/60">
                <UserAvatar src={a.avatar_url} name={a.name} size={26} expandable={false} />
              </span>
            ))}
          </span>
        ) : (
          <Eye className="ml-1.5 h-5 w-5 shrink-0" />
        )}
        <span className="truncate">{v?.count ? `Seen by ${v.count}` : "No views yet"}</span>
      </button>
      {hearts > 0 && <span className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full bg-white/15 px-3.5 text-[14px] font-bold backdrop-blur-sm">❤️ {hearts}</span>}
      {post.visibility === "community" && (
        <button
          type="button"
          onClick={() => setSticker(true)}
          className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur-sm active:scale-95"
          aria-label={post.sticker ? "Change your sticker" : "Add a poll, slider or question"}
          data-story-add-sticker
        >
          <StickerIcon className="h-5 w-5" />
        </button>
      )}
      <button type="button" onClick={onOpen} className={cn("inline-flex h-11 shrink-0 items-center gap-0.5 rounded-full bg-white/15 pl-4 pr-3 text-[14px] font-bold backdrop-blur-sm active:scale-95", post.visibility !== "community" && "ml-auto")}>
        {storyFrameKind(post) === "win" ? "Workout" : "Post"} <ChevronRight className="h-4 w-4" />
      </button>
      <ViewersSheet postId={viewers ? post.id : null} onClose={() => setViewers(false)} onOpenAuthor={onOpenPerson} />
      <PostStickerEditor post={post} open={sticker} onClose={() => setSticker(false)} />
    </div>
  );
}

/** One moment, full screen: a lesson, a win, a photo (or a clip's first frame), or words (storyFrameKind). */
function StoryFrame({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
  const { data: thumbs } = usePostMediaUrls([post]);
  const isImage = post.media_type === "image";
  const { data: full } = useFullMediaUrl(isImage ? post.media_path : null, isImage);
  const thumb = thumbs?.[post.media_thumb_path ?? (isImage ? post.media_path ?? "" : "")] ?? null;
  const kind = storyFrameKind(post);

  // a lesson always plays as its lesson (title, diagram, hook), photo or not
  if (kind === "lesson") return <LessonStoryFrame post={post} />;
  if (kind === "win") {
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
  if (kind === "media") {
    const src = full ?? thumb ?? (post.media_type ? null : post.gif_url ?? null);
    if (!src) return <div className="flex flex-1 items-center justify-center bg-black" data-story-frame="loading" />;
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
  const words = storyWords(post);
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[radial-gradient(120%_90%_at_80%_0%,rgba(239,51,64,0.35),transparent_60%)] bg-zinc-950 px-8" data-story-frame="words">
      <p className="line-clamp-[12] whitespace-pre-wrap text-center text-[24px] font-bold leading-snug">{words.text}</p>
      {words.by && <p className="mt-3 text-center text-[14px] font-semibold text-white/60">{words.by}</p>}
    </div>
  );
}

/** The two in the bar, and the eight that open with the keyboard (Instagram's quick reactions): gym-flavoured for a win. */
const QUICK_WIN = ["🔥", "💪", "👏", "🙌", "😤", "🐐", "💯", "🎉"];
const QUICK_POST = ["😍", "😂", "🔥", "👏", "😮", "🙌", "💯", "🎉"];

/**
 * The bar under a story, as on Instagram / TikTok: "Message Alyssa…" with
 * two quick emoji in it, and the heart. Tapping the field pauses the story
 * and opens eight quick reactions; one tap sends it (with a shower of it on
 * screen), or type and Send. It all goes privately, the same way as Message
 * on a post (useMessageAuthor): member to member as a message request, a
 * coach and their client in their coach chat; the other person sees
 * "Replied to your story" with the moment. Swipe up (or View workout) opens
 * the post itself.
 */
function StoryBar({ post, viewerIsStaff, onOpen, onComposing }: { post: CommunityPost; viewerIsStaff: boolean; onOpen: () => void; onComposing: (on: boolean) => void }) {
  const { role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const react = useReact(post, viewerIsStaff);
  const send = useMessageAuthor();
  const frame = storyFrameKind(post);
  const win = frame === "win";
  const mine = post.my_reaction;
  const first = post.author.name.split(" ")[0];
  const staff = role === "admin" || role === "coach";
  // the same rule as Message on a post (coaches use team chat with each other)
  const canMessage = !post.is_mine && !(post.author.is_coach && staff);
  // a request that's waiting on them can't take more until they reply
  const { data: threads = [] } = useDirectThreads(canMessage && !staff && !post.author.is_coach);
  const thread = threads.find((t) => t.other.user_id === post.author.user_id) ?? null;
  const full = !!thread?.outgoing && thread.left === 0;
  const quick = win ? QUICK_WIN : QUICK_POST;

  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [pop, setPop] = useState(0);
  const [shower, setShower] = useState<{ id: number; emoji: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  const view = useVisualViewportBox(focused);
  const lift = view?.keyboard ? Math.max(0, window.innerHeight - view.top - view.height) : 0;

  // a new moment starts clean
  useEffect(() => {
    setText("");
    setSent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  useEffect(() => {
    onComposing(focused || text.trim().length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, text]);
  useEffect(() => () => onComposing(false), [onComposing]);
  useEffect(() => {
    if (!sent) return;
    const t = window.setTimeout(() => setSent(null), 2200);
    return () => window.clearTimeout(t);
  }, [sent]);

  const like = () => {
    if (!mine) {
      setPop((n) => n + 1);
      navigator.vibrate?.(8);
    }
    react.mutate(mine ? null : "heart", { onError: () => toast.error("Couldn't send that") });
  };
  const deliver = async (body: string, emoji?: string) => {
    const b = body.trim();
    if (!b || send.isPending) return;
    if (isImpersonating) return void toast.message(PREVIEW_ONLY_MESSAGE);
    if (full) return void toast.message(`You can message ${first} again once they reply`);
    if (emoji) {
      setShower({ id: Date.now(), emoji });
      navigator.vibrate?.(10);
    }
    input.current?.blur();
    setText("");
    try {
      const r = await send.mutateAsync({ postId: post.id, body: b, story: true });
      setSent(r.route === "direct" && r.status === "request" ? `Sent to ${first} as a message request` : `Sent to ${first}`);
    } catch (e: any) {
      setText(emoji ? "" : b);
      toast.error(e?.message ?? "That didn't send. Try again.");
    }
  };
  const onFocus = () => {
    window.clearTimeout(blurTimer.current);
    setFocused(true);
  };
  // a beat later, so tapping a quick reaction still lands
  const onBlur = () => {
    blurTimer.current = window.setTimeout(() => setFocused(false), 160);
  };
  // keep the keyboard up while a quick reaction is tapped
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  // the frame shows a picture or a workout card: the words go here (a words frame already shows them)
  const caption = frame === "media" || frame === "win" ? post.caption?.trim() : null;
  const typing = text.trim().length > 0;
  return (
    <>
      {/* typing: the story dims, eight quick reactions in the middle */}
      {focused && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-8 backdrop-blur-md animate-in fade-in duration-150"
          // centred in what the keyboard leaves free, above the bar
          style={{ paddingBottom: lift ? lift + 76 : 0 }}
          data-story-quick
        >
          {!typing && (
            <div className="w-full max-w-[320px] text-center">
              <p className="mb-4 text-[13px] font-bold text-white/70">Quick reactions</p>
              <div className="grid grid-cols-4 gap-y-4">
                {quick.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onMouseDown={keepFocus}
                    onClick={() => void deliver(e, e)}
                    className="mx-auto grid h-16 w-16 place-items-center rounded-full text-[40px] leading-none active:scale-90"
                    aria-label={`Send ${e} to ${first}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* what was sent: a shower of it */}
      {shower && (
        <div key={shower.id} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden onAnimationEnd={(e) => e.target === e.currentTarget.lastChild && setShower(null)}>
          {[12, 30, 50, 68, 84, 22, 58, 76].map((x, i) => (
            <span key={i} className="story-emoji-rise absolute bottom-24 text-[44px]" style={{ left: `${x}%`, animationDelay: `${i * 70}ms`, fontSize: i % 3 === 0 ? 56 : 40 }}>
              {shower.emoji}
            </span>
          ))}
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pt-10 transition-[bottom] duration-150"
        style={{ bottom: lift, paddingBottom: lift ? "0.6rem" : "max(env(safe-area-inset-bottom), 0.75rem)" }}
        data-story-bar
      >
        {!focused && (
          <div className="mb-3 px-1">
            {caption && <p className="mb-2.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-snug">{caption}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onOpen} className="inline-flex h-8 items-center gap-0.5 rounded-full bg-white/15 pl-3 pr-2 text-[13px] font-bold backdrop-blur-sm active:scale-95">
                {win ? "View workout" : "View post"} <ChevronRight className="h-4 w-4" />
              </button>
              {sent && <span className="min-w-0 truncate text-[13px] font-semibold text-white/85 animate-in fade-in duration-200" data-story-sent>✓ {sent}</span>}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {canMessage ? (
            <div className={cn("flex h-12 min-w-0 flex-1 items-center rounded-full border pl-4 pr-1", focused ? "border-white bg-black/40" : "border-white/50")}>
              <input
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                onFocus={onFocus}
                onBlur={onBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void deliver(text);
                  }
                }}
                disabled={full}
                enterKeyHint="send"
                placeholder={full ? `You can message ${first} again once they reply` : `Message ${first}…`}
                className="h-full min-w-0 flex-1 select-text bg-transparent text-[16px] text-white outline-none placeholder:text-white/80 disabled:placeholder:text-white/55"
                aria-label={`Message ${post.author.name}`}
              />
              {typing ? (
                <button type="button" onMouseDown={keepFocus} onClick={() => void deliver(text)} disabled={send.isPending} className="h-10 shrink-0 rounded-full px-3 text-[15px] font-black active:scale-95 disabled:opacity-50" data-story-send>
                  Send
                </button>
              ) : (
                !full &&
                quick.slice(0, 2).map((e) => (
                  <button key={e} type="button" onMouseDown={keepFocus} onClick={() => void deliver(e, e)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[24px] leading-none active:scale-90" aria-label={`Send ${e} to ${first}`} data-story-emoji>
                    {e}
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {!focused && (
            <button type="button" onClick={like} aria-pressed={!!mine} aria-label={mine ? "Take it back" : win ? "Celebrate" : "Like"} className="grid h-12 w-12 shrink-0 place-items-center rounded-full active:scale-90" data-story-heart>
              <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
                {mine && mine !== "heart" ? <span className="text-[28px] leading-none">{reactionEmoji(mine)}</span> : <Heart className={cn("h-[30px] w-[30px]", mine && "fill-[#ef3340] text-[#ef3340]")} strokeWidth={1.8} />}
              </span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** A moment in a few words: "Competition Squat PR · 140 kg × 3", "10th session this month", or the post's words. */
function momentLine(post: CommunityPost): string {
  if (storyFrameKind(post) === "win" && !post.caption?.trim()) {
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
