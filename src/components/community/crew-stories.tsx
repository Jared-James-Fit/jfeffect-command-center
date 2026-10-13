import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, ChevronRight, Eye, Heart, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, activityStoryGroup, crewStories, isPulsePost, myStory, type ActivityCover, namesLine, pickWorkoutWin, postTimeLabel, reactionEmoji, storyEnd, workoutHeadline, type CommunityPost, type StoryEnd, type StoryGroup } from "@/lib/community";
import { useFullMediaUrl, usePostMediaUrls, useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { ViewersSheet, markPostViewed } from "@/components/community/post-views";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useFollowState } from "@/lib/community-social";
import { useAuth } from "@/lib/auth";
import { useDirectThreads, useMessageAuthor } from "@/lib/direct-chats";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { ActivityBubble, ActivityGlyph } from "@/components/community/pulse-strip";

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
export function StoryRail({ posts, unit, viewerIsStaff, onOpenPost, onJumpTo, lead, addYours, activity }: {
  posts: CommunityPost[];
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenPost: (id: string) => void;
  /** Close and take them to this post in the feed. */
  onJumpTo?: (id: string) => void;
  lead?: React.ReactNode;
  /** The end card's "add yours" (when they have nothing in the stories themselves). */
  addYours?: React.ReactNode;
  /**
   * Right after your own bubble: the crew's Activity, which plays like a story
   * (keeps the row up on a quiet day). `posts` are the week's sessions (its
   * tag); `onList` opens the whole week as a list.
   */
  activity?: { posts: CommunityPost[]; weekComplete: boolean; onList: () => void } | null;
}) {
  const [seenNow, setSeenNow] = useState<Set<string>>(() => new Set());
  const { data: follows } = useFollowState();
  const groups = useMemo(() => {
    const g = crewStories(posts, Date.now(), new Set(follows?.following ?? []));
    // what's been watched since the feed loaded counts too
    return g.map((x) => ({ ...x, unseen: x.items.some((p) => !p.seen && !seenNow.has(p.id)) }));
  }, [posts, seenNow, follows]);
  // Activity, played like a story: first in the row (after Post), then the people
  const actGroup = useMemo(() => (activity ? activityStoryGroup(posts, seenNow) : null), [activity, posts, seenNow]);
  // yours: what you shared in the last day (a finished session posts itself), with who saw it
  const mine = useMemo(() => myStory(posts), [posts]);
  const [open, setOpen] = useState<number | null>(null);
  // the order is fixed while watching (rings change as you go)
  const frozen = useRef<StoryGroup<CommunityPost>[]>([]);
  if (!groups.length && !activity && !mine) return null;
  /** i = a person's bubble; -1 = Activity; -2 = yours. */
  const watch = (i: number) => {
    const all = [...(actGroup ? [actGroup] : []), ...(mine ? [mine] : []), ...groups];
    frozen.current = all;
    setOpen(i === -1 ? 0 : i === -2 ? (actGroup ? 1 : 0) : i + (actGroup ? 1 : 0) + (mine ? 1 : 0));
  };
  return (
    <>
      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-4 sm:px-4" data-story-rail data-no-swipe-back aria-label="Crew stories">
        {lead}
        {mine && (
          <button type="button" onClick={() => watch(-2)} className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label="Your story" data-story-mine>
            <span className="grid h-[64px] w-[64px] place-items-center rounded-full bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)] p-[2.5px]">
              <span className="grid h-full w-full place-items-center rounded-full bg-background p-[2px]">
                <UserAvatar src={mine.author.avatar_url} name={mine.author.name} size={54} expandable={false} />
              </span>
            </span>
            <span className="w-full truncate text-center text-[11px] font-bold">Your story</span>
          </button>
        )}
        {activity && (
          <ActivityBubble
            posts={activity.posts}
            weekComplete={activity.weekComplete}
            unseen={!!actGroup?.unseen}
            // no sessions this week at all: straight to the list
            onClick={() => (actGroup ? watch(-1) : activity.onList())}
          />
        )}
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
          onActivityList={
            activity
              ? () => {
                  setOpen(null);
                  activity.onList();
                }
              : undefined
          }
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
  onActivityList,
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
  /** In the Activity story: the whole week as a list. */
  onActivityList?: () => void;
}) {
  const { isImpersonating } = useClientImpersonation();
  const firstUnseen = (g: StoryGroup<CommunityPost>) => Math.max(0, g.items.findIndex((p) => !p.seen));
  // frames: Activity opens on its cover (frame 0), then its moments
  const lead = (g: StoryGroup<CommunityPost>) => (g.cover ? 1 : 0);
  const frames = (g: StoryGroup<CommunityPost>) => lead(g) + g.items.length;
  const startAt = (g: StoryGroup<CommunityPost>) => (g.cover ? 0 : firstUnseen(g));
  const [gi, setGi] = useState(start);
  const [ii, setIi] = useState(() => (groups[start] ? startAt(groups[start]) : 0));
  const group = groups[gi];
  const atCover = !!group?.cover && ii === 0;
  const item = group && !atCover ? group.items[ii - lead(group)] : undefined;
  // the live copy (reactions land on it while it's showing)
  const post = item ? posts.find((p) => p.id === item.id) ?? item : null;
  const frameKey = atCover ? `cover:${gi}` : post?.id;
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
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return onClose();
    setDrag({ y: window.innerHeight, settle: true });
    window.setTimeout(onClose, 210);
  };

  const next = () => {
    if (!group) return close();
    if (ii < frames(group) - 1) return setIi(ii + 1);
    // on to the next person with something not watched this time (a PR already seen in
    // Activity doesn't skip their photo), from where that starts; else the end card.
    // Your own story never plays itself after someone else's.
    const fresh = (p: CommunityPost) => !watched.current.has(p.id);
    const j = groups.findIndex((g, k) => k > gi && !g.mine && g.items.some(fresh));
    if (j >= 0) {
      const items = groups[j].items;
      const at = items.findIndex((p) => fresh(p) && !p.seen);
      setGi(j);
      setIi(lead(groups[j]) + (at >= 0 ? at : Math.max(0, items.findIndex(fresh))));
    } else {
      setPaused(false);
      setEnd(storyEnd(groups, posts, watched.current));
    }
  };
  const watchFrom = (j: number) => {
    setEnd(null);
    setGi(j);
    setIi(startAt(groups[j]));
  };
  const prev = () => {
    if (ii > 0) setIi(ii - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setIi(frames(groups[gi - 1]) - 1);
    } else setProgress(0);
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

  if (!group || (!post && !atCover)) return null;

  const onDown = (e: React.PointerEvent) => {
    // never from a sheet opened on top (who viewed it): it isn't the story
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as Element).closest("button, a, input, textarea")) return;
    // replying: a tap on the story just puts the keyboard away
    if (composing) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    press.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    lastMove.current = { y: e.clientY, t: performance.now() };
    velocity.current = 0;
    holdTimer.current = window.setTimeout(() => setPaused(true), 220);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || closing.current) return;
    const dy = e.clientY - p.y;
    if (!dragging.current) {
      // a downward drag (not a tap, not sideways) picks the story up
      if (dy < 12 || dy < Math.abs(e.clientX - p.x) * 1.2) return;
      dragging.current = true;
      window.clearTimeout(holdTimer.current);
      setPaused(true);
    }
    const now = performance.now();
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
    // swipe up: the post itself (the workout, comments); on Activity's cover, the whole week
    if (dy < -80 && Math.abs(dy) > Math.abs(e.clientX - p.x)) return post ? onOpenPost(post.id) : onActivityList?.();
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
  const who = post && group.activity ? post.author : group.author;

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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-black will-change-transform sm:rounded-[28px]" style={lifted} data-story-card>
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
        <DialogTitle className="sr-only">{group.activity ? "Crew activity" : group.mine ? "Your story" : `${group.author.name}'s story`}</DialogTitle>
        <DialogDescription className="sr-only">Tap the right side for the next moment, the left to go back, hold to pause, swipe up for the post, swipe down to close. Reply or send a quick reaction at the bottom.</DialogDescription>
        <div
          className="relative flex min-h-0 flex-1 select-none flex-col touch-none"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerMove={onMove}
          onPointerCancel={() => {
            window.clearTimeout(holdTimer.current);
            press.current = null;
            if (dragging.current) {
              dragging.current = false;
              springBack();
            } else setPaused(false);
          }}
          data-story-viewer
        >
          {post ? <StoryFrame post={post} unit={unit} /> : <ActivityCoverFrame cover={group.cover!} more={group.items.length} />}

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
              {/* Activity: each moment is someone's session, so it names them */}
              {post ? (
                <UserAvatar src={who.avatar_url} name={who.name} size={32} expandable={false} />
              ) : (
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white">
                  <ActivityGlyph className="[&>svg]:h-4 [&>svg]:w-4" />
                </span>
              )}
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-bold">{post ? (group.mine ? "Your story" : who.name.split(" ")[0]) : "Crew activity"}</span>
                  <span className="shrink-0 text-[12px] text-white/70">{post ? postTimeLabel(post.created_at) : "This week"}</span>
                </span>
                {group.activity && post && <span className="block text-[11px] font-semibold leading-tight text-white/65">Crew activity · earlier this week</span>}
              </span>
              {group.activity && onActivityList && (
                <button type="button" onClick={onActivityList} className="ml-auto h-8 shrink-0 rounded-full bg-white/15 px-3 text-[12px] font-bold backdrop-blur-sm active:scale-95" data-story-activity-all>
                  All activity
                </button>
              )}
              <button type="button" onClick={close} className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-white/10", !(group.activity && onActivityList) && "ml-auto")} aria-label="Close">
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {!post ? (
            // the cover: the whole week as a list
            onActivityList && (
              <div className="absolute inset-x-0 bottom-0 px-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
                <button type="button" onClick={onActivityList} className="flex h-12 w-full items-center justify-center gap-1 rounded-full bg-white text-[15px] font-black text-black active:scale-[0.98]" data-story-cover-all>
                  See the whole week <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )
          ) : post.is_mine ? (
            <MyStoryBar post={post} onOpen={() => onOpenPost(post.id)} onHold={setComposing} />
          ) : (
            <StoryBar post={post} viewerIsStaff={viewerIsStaff} onOpen={() => onOpenPost(post.id)} onComposing={setComposing} />
          )}
        </div>
        </>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Activity's first frame: the crew's week in numbers, before its best moments. */
function ActivityCoverFrame({ cover, more }: { cover: ActivityCover; more: number }) {
  const prs = cover.prs > 0;
  return (
    <div className="flex flex-1 flex-col justify-center bg-zinc-950 bg-[radial-gradient(110%_70%_at_85%_8%,rgba(245,158,11,0.30),transparent_60%)] px-7" data-story-frame="cover">
      <span className="inline-flex items-center gap-1.5 text-[13px] font-black uppercase tracking-[0.16em] text-amber-300">
        <Activity className="h-5 w-5" /> This week in the crew
      </span>
      <span className="font-display mt-4 block text-[104px] leading-[0.85] tabular-nums">{prs ? cover.prs : cover.sessions}</span>
      <span className="font-display block text-[40px] uppercase leading-none text-amber-300">{prs ? (cover.prs === 1 ? "PR" : "PRs") : cover.sessions === 1 ? "session" : "sessions"}</span>
      <span className="mt-4 block text-[17px] font-bold text-white/85">
        {prs && `${cover.sessions} ${cover.sessions === 1 ? "session" : "sessions"} · `}
        {cover.athletes} {cover.athletes === 1 ? "athlete" : "athletes"}
      </span>
      {cover.faces.length > 0 && (
        <span className="mt-5 flex -space-x-2">
          {cover.faces.map((a) => (
            <span key={a.user_id} className="rounded-full ring-[3px] ring-zinc-950">
              <UserAvatar src={a.avatar_url} name={a.name} size={40} expandable={false} />
            </span>
          ))}
        </span>
      )}
      {more > 0 && <span className="mt-6 block text-[14px] font-semibold text-white/60">Next: {more} {more === 1 ? "win" : "wins"} from earlier this week</span>}
    </div>
  );
}

/** Your own story: who's seen it and the hearts (nothing to reply to). Tap Seen by for the names. */
function MyStoryBar({ post, onOpen, onHold }: { post: CommunityPost; onOpen: () => void; onHold: (on: boolean) => void }) {
  const [viewers, setViewers] = useState(false);
  // the story waits while the list is open
  useEffect(() => {
    onHold(viewers);
  }, [viewers, onHold]);
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
      <button type="button" onClick={onOpen} className="ml-auto inline-flex h-11 shrink-0 items-center gap-0.5 rounded-full bg-white/15 pl-4 pr-3 text-[14px] font-bold backdrop-blur-sm active:scale-95">
        {isPulsePost(post) ? "Workout" : "Post"} <ChevronRight className="h-4 w-4" />
      </button>
      <ViewersSheet postId={viewers ? post.id : null} onClose={() => setViewers(false)} />
    </div>
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
  const win = isPulsePost(post);
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

  const caption = !win && post.media_type ? post.caption?.trim() : null;
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
                  <button key={g.author.user_id} type="button" onClick={() => onWatch(j)} className="flex w-[62px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label={g.activity ? "Watch the crew's activity" : `Watch ${g.author.name}'s story`}>
                    <span className="grid h-[60px] w-[60px] place-items-center rounded-full bg-[conic-gradient(from_200deg,#ef3340,#f59e0b,#ef3340)] p-[2.5px]">
                      <span className="grid h-full w-full place-items-center rounded-full bg-zinc-950 p-[2px]">
                        {g.activity ? <ActivityGlyph /> : <UserAvatar src={g.author.avatar_url} name={g.author.name} size={50} expandable={false} />}
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
