import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Heart, MessageCircle, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ActivitySpinner } from "@/components/activity-spinner";
import { UserAvatar } from "@/components/user-avatar";
import { ReactionBurst, useBurst } from "@/components/community/reaction-button";
import { useHoldToPause, useSoundFlash } from "@/components/community/clip-gestures";
import { holdFeedVideos } from "@/components/community/inline-video";
import {
  REACTION,
  reactionTotal,
  slideThumbPath,
  type CommunityAuthor,
  type CommunityPost,
} from "@/lib/community";
import { useFullMediaUrl, useReact, useSlideThumbUrls } from "@/lib/community.queries";
import {
  reelIndexAt,
  reelItems,
  reelLoaded,
  reelSlot,
  reelStart,
  type ReelItem,
} from "@/lib/reels";
import { reelVideo } from "@/lib/video-pool";
import { clipFrame } from "@/lib/photo-frame";
import { ClipFrameBox } from "@/components/community/clip-frame-box";
import { cn } from "@/lib/utils";

export type ReelStart = { postId: string; path: string | null };

/**
 * The feed's clips full screen, one per swipe (TikTok's / Reels'): a tap on
 * a clip in the feed opens it here, each clip whole at its own shape on
 * black, playing with sound and looping; swipe up for the next clip (a
 * workout film's sets one after another, then the next post's), down for
 * the one before. Reels' gestures: a tap is its sound (on or off, said in
 * the middle), a finger held down pauses it with everything else out of the
 * way, two taps ❤️ where the finger was; the speaker mutes too. Only the
 * clip on screen and the one either side hold a video (three pooled
 * elements, video-pool.ts), each buffered before it's swiped to.
 */
export function ReelsViewer({
  start,
  posts,
  viewerIsStaff,
  onClose,
  onOpenComments,
  onOpenAuthor,
}: {
  start: ReelStart | null;
  posts: CommunityPost[];
  viewerIsStaff: boolean;
  onClose: () => void;
  onOpenComments: (post: CommunityPost) => void;
  onOpenAuthor: (author: CommunityAuthor) => void;
}) {
  return (
    <Dialog open={!!start} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showBackButton={false}
        className="fixed inset-0 left-0 top-0 block h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white outline-none focus:outline-none dark:bg-black sm:rounded-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-reels
      >
        <DialogTitle className="sr-only">Videos</DialogTitle>
        <DialogDescription className="sr-only">
          Swipe up for the next video, down for the one before.
        </DialogDescription>
        {start && (
          <Reels
            start={start}
            posts={posts}
            viewerIsStaff={viewerIsStaff}
            onClose={onClose}
            onOpenComments={onOpenComments}
            onOpenAuthor={onOpenAuthor}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Reels({
  start,
  posts,
  viewerIsStaff,
  onClose,
  onOpenComments,
  onOpenAuthor,
}: {
  start: ReelStart;
  posts: CommunityPost[];
  viewerIsStaff: boolean;
  onClose: () => void;
  onOpenComments: (post: CommunityPost) => void;
  onOpenAuthor: (author: CommunityAuthor) => void;
}) {
  const items = useMemo(() => reelItems(posts), [posts]);
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const [activeKey, setActiveKey] = useState<string | null>(
    () => items[reelStart(items, start.postId, start.path)]?.key ?? null,
  );
  const keyRef = useRef(activeKey);
  keyRef.current = activeKey;
  const active = Math.max(
    0,
    items.findIndex((it) => it.key === activeKey),
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  // Reels play with sound (the tap that opened them allowed it); muted only when the phone says no
  const [sound, setSound] = useState(true);

  // the feed's own clips hold still underneath
  useEffect(() => holdFeedVideos(), []);

  // open on the clip that was tapped, and stay on it if clips are added above it; a
  // refetch that moves nothing never touches the scroll (it would stop a swipe)
  const placed = useRef<{ key: string | null; index: number }>({ key: null, index: -1 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const key = keyRef.current;
    const i = items.findIndex((it) => it.key === key);
    if (i < 0 || (placed.current.key === key && placed.current.index === i)) return;
    placed.current = { key, index: i };
    el.scrollTop = i * el.clientHeight;
  }, [items]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const i = reelIndexAt(el.scrollTop, el.clientHeight, items.length);
    const next = items[i];
    if (!next || next.key === keyRef.current) return;
    placed.current = { key: next.key, index: i };
    keyRef.current = next.key;
    setActiveKey(next.key);
  };

  const go = useCallback((dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight, behavior: "smooth" });
  }, []);

  // a keyboard: up / down between clips
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="relative mx-auto h-full w-full sm:max-w-[480px]">
      <div
        ref={scroller}
        onScroll={onScroll}
        data-reels-scroller
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((it, i) => {
          const post = byId.get(it.postId);
          if (!post) return <div key={it.key} className="h-full w-full snap-start snap-always" />;
          return (
            <ReelPage
              key={it.key}
              item={it}
              post={post}
              active={i === active}
              loaded={reelLoaded(i, active)}
              slot={reelSlot(i)}
              sound={sound}
              setSound={setSound}
              viewerIsStaff={viewerIsStaff}
              onOpenComments={onOpenComments}
              onOpenAuthor={(a) => {
                onClose();
                onOpenAuthor(a);
              }}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute left-2 z-10 grid h-11 w-11 place-items-center rounded-full text-white active:opacity-70 [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.6))]"
        style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        aria-label="Close"
        data-reels-close
      >
        <ChevronLeft className="h-7 w-7" />
      </button>
    </div>
  );
}

function ReelPage({
  item,
  post,
  active,
  loaded,
  slot,
  sound,
  setSound,
  viewerIsStaff,
  onOpenComments,
  onOpenAuthor,
}: {
  item: ReelItem;
  post: CommunityPost;
  active: boolean;
  loaded: boolean;
  slot: number;
  sound: boolean;
  setSound: (on: boolean) => void;
  viewerIsStaff: boolean;
  onOpenComments: (post: CommunityPost) => void;
  onOpenAuthor: (author: CommunityAuthor) => void;
}) {
  const thumbPath = slideThumbPath(item.slide);
  const thumbs = useSlideThumbUrls(thumbPath ? [item.slide] : []);
  const poster = thumbPath ? (thumbs[thumbPath] ?? null) : null;
  const { data: url } = useFullMediaUrl(item.slide.path, loaded);
  // framed in the studio: shown as its frame, whole on black (its poster is that frame)
  const frame = clipFrame(item.slide.focus);
  const framed = !!frame;
  const media = item.slide.width && item.slide.height ? item.slide.width / item.slide.height : null;
  const react = useReact(post, viewerIsStaff);
  const host = useRef<HTMLDivElement | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  // the pooled element this page holds right now (a new one when its slot changes)
  const [attached, setAttached] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  // held down (Reels'): paused until the finger lets go
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [burst, fireBurst] = useBurst();
  const [soundFlash, flashSound] = useSoundFlash();
  const hold = useHoldToPause<true>(
    (e) => ((e.target as Element | null)?.closest?.("button") ? null : true),
    (_t, on) => setPaused(on),
  );
  const lastTap = useRef(0);
  const tapTimer = useRef<number | null>(null);

  // the pooled element lives in this page while it's on screen or next to it
  useLayoutEffect(() => {
    if (!loaded) return;
    const el = host.current;
    if (!el) return;
    const v = reelVideo(slot);
    v.className = framed ? "absolute inset-0 h-full w-full object-cover" : "absolute inset-0 h-full w-full object-contain";
    el.appendChild(v);
    vid.current = v;
    setAttached(v);
    const handlers: [string, () => void][] = [
      [
        "playing",
        () => {
          setPlaying(true);
          setWaiting(false);
        },
      ],
      ["pause", () => setPlaying(false)],
      ["waiting", () => setWaiting(true)],
      ["canplay", () => setWaiting(false)],
      ["error", () => setFailed(true)],
    ];
    handlers.forEach(([k, f]) => v.addEventListener(k, f));
    return () => {
      handlers.forEach(([k, f]) => v.removeEventListener(k, f));
      v.pause();
      v.remove();
      vid.current = null;
      setAttached(null);
      setPlaying(false);
    };
  }, [loaded, slot, framed]);

  // its clip
  useEffect(() => {
    const v = attached;
    if (!v || !url) return;
    if (v.getAttribute("src") !== url) {
      setFailed(false);
      setPlaying(false);
      v.src = url;
    }
  }, [attached, url]);

  // swiped away and back: from the start, and playing again
  useEffect(() => {
    if (active) return;
    setPaused(false);
    setExpanded(false);
    const v = vid.current;
    if (v && v.currentTime > 0) v.currentTime = 0;
  }, [active]);

  const shouldPlay = active && !!attached && !!url && !paused && !failed;
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (!shouldPlay) {
      v.pause();
      return;
    }
    v.muted = !sound;
    const p = v.play() as Promise<void> | undefined;
    p?.catch?.(() => {
      // sound without a tap first: the phone said no, so it plays muted (the speaker turns it on)
      if (!v.muted) {
        setSound(false);
        v.muted = true;
        void (v.play() as Promise<void> | undefined)?.catch?.(() => undefined);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, url, attached]);

  useEffect(() => {
    if (vid.current) vid.current.muted = !sound;
  }, [sound]);

  // the clip's own clock under it
  useEffect(() => {
    if (!active || !playing) return;
    let raf = 0;
    const tick = () => {
      const v = vid.current;
      const b = bar.current;
      if (v && b && v.duration && Number.isFinite(v.duration))
        b.style.transform = `scaleX(${Math.min(1, v.currentTime / v.duration)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, playing]);

  // a spinner only when a clip makes you wait
  const [slow, setSlow] = useState(false);
  const stuck = active && !playing && !paused && !failed;
  useEffect(() => {
    if (!stuck && !waiting) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 450);
    return () => window.clearTimeout(t);
  }, [stuck, waiting]);

  useEffect(
    () => () => {
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
    },
    [],
  );

  const like = (next: boolean) => {
    react.mutate(next ? REACTION.key : null, {
      onError: () => toast.error("Couldn't save that reaction"),
    });
  };

  // Reels': a tap is the sound, on or off (said in the middle), a finger held down pauses it, two quick taps ❤️
  // where the finger was (never taking one back)
  const onTap = (e: React.MouseEvent) => {
    if (hold.justReleased()) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = 0;
      fireBurst(e);
      if (!post.my_reaction) like(true);
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      flashSound(toggleSound());
    }, 280);
  };

  const toggleSound = (): boolean => {
    const next = !sound;
    if (next) {
      // inside the tap (which also lets every pooled clip make sound, video-pool.ts)
      const v = vid.current;
      if (v) {
        v.muted = false;
        if (v.paused && shouldPlay)
          void (v.play() as Promise<void> | undefined)?.catch?.(() => undefined);
      }
    }
    setSound(next);
    return next;
  };

  const liked = !!post.my_reaction;
  const likes = reactionTotal(post);
  const caption = post.caption?.trim() || "";

  return (
    <section
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
      aria-roledescription="video"
      aria-label={
        item.slide.caption
          ? `${item.slide.caption.title}, ${item.slide.caption.detail}`
          : `Video by ${post.author.name}`
      }
      data-reel={item.key}
      data-reel-active={active ? "" : undefined}
    >
      {frame ? (
        // framed in the studio: just that part, whole on black
        <div className="absolute inset-0 select-none [-webkit-touch-callout:none]" onClick={onTap} {...hold.handlers} data-reel-video>
          <ClipFrameBox
            frame={frame}
            media={media}
            fit="contain"
            poster={
              poster && (
                <img
                  src={poster}
                  alt=""
                  draggable={false}
                  className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200", playing ? "opacity-0" : "opacity-100")}
                />
              )
            }
          >
            {(style) => <div ref={host} style={style} />}
          </ClipFrameBox>
        </div>
      ) : (
        <>
          {/* the clip, whole, at its own shape */}
          <div ref={host} className="absolute inset-0 select-none [-webkit-touch-callout:none]" onClick={onTap} {...hold.handlers} data-reel-video />
          {poster && (
            <img
              src={poster}
              alt=""
              draggable={false}
              className={cn(
                "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
                playing ? "opacity-0" : "opacity-100",
              )}
            />
          )}
        </>
      )}
      <ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={REACTION.emoji} />
      {soundFlash}
      {active && slow && !failed && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center"
          role="status"
          aria-label="Loading video"
        >
          <ActivitySpinner size={30} className="text-white" />
        </div>
      )}
      {failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-[15px] text-white/80">
          This video couldn't play right now.
        </div>
      )}
      {item.clips > 1 && (
        <span
          className="pointer-events-none absolute right-3 rounded-full bg-black/55 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-white"
          style={{ top: "calc(env(safe-area-inset-top) + 1.1rem)" }}
        >
          {item.clip}/{item.clips}
        </span>
      )}

      {/* what it is, over a scrim at the bottom */}
      <div
        // held down: out of the way until the finger lets go (Reels')
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent pl-4 pr-20 pt-24 transition-opacity duration-200",
          hold.holding && "opacity-0 [&_*]:pointer-events-none",
        )}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <button
          type="button"
          onClick={() => onOpenAuthor(post.author)}
          className="pointer-events-auto flex max-w-full items-center gap-2.5 text-left active:opacity-70"
          data-reel-author
        >
          <UserAvatar
            src={post.author.avatar_url}
            name={post.author.name}
            size={34}
            expandable={false}
          />
          <span className="truncate text-[15px] font-semibold [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
            {post.author.name}
          </span>
        </button>
        {item.slide.caption && (
          <div className="mt-2.5" data-reel-slide-caption>
            <div className="truncate text-[15px] font-semibold leading-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
              {item.slide.caption.title}
            </div>
            <div className="mt-0.5 truncate text-[13px] tabular-nums text-white/85">
              {item.slide.caption.detail}
            </div>
          </div>
        )}
        {caption && (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className={cn(
              "pointer-events-auto mt-2 block w-full whitespace-pre-line text-left text-[14px] leading-snug text-white/90",
              !expanded && "line-clamp-2",
            )}
            data-reel-caption
          >
            {caption}
          </button>
        )}
      </div>

      {/* ❤️ 💬 🔊 on the right, Reels' place */}
      <div
        className={cn("absolute right-1.5 flex flex-col items-center gap-3 transition-opacity duration-200", hold.holding && "pointer-events-none opacity-0")}
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
      >
        <ReelButton
          label={liked ? "Unlike" : "Like"}
          pressed={liked}
          count={likes}
          onClick={() => like(!liked)}
        >
          <Heart className={cn("h-7 w-7", liked && "fill-destructive text-destructive")} />
        </ReelButton>
        <ReelButton
          label={`Comments (${post.comment_count})`}
          count={post.comment_count}
          onClick={() => onOpenComments(post)}
        >
          <MessageCircle className="h-7 w-7 -scale-x-100" />
        </ReelButton>
        <ReelButton
          label={sound ? "Mute" : "Turn sound on"}
          pressed={sound}
          onClick={toggleSound}
          data-reel-sound
        >
          {sound ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
        </ReelButton>
      </div>

      {/* how far through */}
      <div
        className="pointer-events-none absolute inset-x-0 h-0.5 bg-white/20"
        style={{ bottom: "env(safe-area-inset-bottom)" }}
        aria-hidden
      >
        <div
          ref={bar}
          className="h-full w-full origin-left bg-white/85"
          style={{ transform: "scaleX(0)" }}
        />
      </div>
    </section>
  );
}

function ReelButton({
  label,
  pressed,
  count,
  onClick,
  children,
  ...rest
}: {
  label: string;
  pressed?: boolean;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
} & Record<`data-${string}`, unknown>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className="flex min-w-11 flex-col items-center gap-0.5 text-white active:scale-90 [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.55))]"
      {...rest}
    >
      <span className="grid h-11 w-11 place-items-center">{children}</span>
      {count !== undefined && (
        <span className="text-[12px] font-semibold tabular-nums">{count > 0 ? count : ""}</span>
      )}
    </button>
  );
}
