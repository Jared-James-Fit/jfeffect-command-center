import { useCallback, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { engagementLine, isEngaged, reactionKinds, type CommunityPost } from "@/lib/community";

// Once per post per app session, wherever it's seen first (Home or the feed).
const popped = new Set<string>();

/**
 * A post people are reacting to (isEngaged): `on` turns true once, a beat
 * after `ref`'s element has settled on screen, then back off when the
 * animation is done (`done`). Never twice for a post in one app session.
 */
export function useEngagementPop<T extends HTMLElement>(post: CommunityPost, hidden = false) {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  const engaged = isEngaged(post);
  useEffect(() => {
    const el = ref.current;
    // `hidden`: what it rises out of isn't showing yet (the feed's first post under the stories, its sheet
    // open, a clip held paused), so it waits, never playing where nobody can see it
    if (!el || hidden || !engaged || on || popped.has(post.id) || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        window.clearTimeout(timer);
        if (!e.isIntersecting || e.intersectionRatio < 0.6) return;
        // a beat after it settles on screen, not while it flies past
        timer = window.setTimeout(() => {
          if (popped.has(post.id)) return;
          popped.add(post.id);
          io.disconnect();
          setOn(true);
        }, 500);
      },
      { threshold: [0, 0.6] },
    );
    io.observe(el);
    return () => {
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [engaged, on, post.id, hidden]);
  const done = useCallback(() => setOn(false), []);
  return { ref, on, done };
}

/** How many float up for a post with `total` reactions: at least 3, at most 6, every kind at least once. */
export function riseCount(kinds: number, total: number): number {
  return Math.max(kinds, Math.min(6, Math.max(3, total)));
}

/**
 * Its reactions drifting up and away, one after another with a little sway
 * (Instagram Live's hearts): the feed's own screen, out of the heart down
 * the right (`lg`, rising high); the feed's cards, out of the heart; Home,
 * out of the capsule (`sm`).
 */
export function ReactionsRise({ kinds, total = 0, size = "md", className }: { kinds: string[]; total?: number; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!kinds.length) return null;
  const n = riseCount(kinds.length, total);
  const rise = size === "lg" ? "-170px" : size === "sm" ? "-40px" : "-56px";
  return (
    <span className={cn("pointer-events-none absolute", className)} aria-hidden data-reactions-rise={n}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cn("engage-float absolute bottom-0 -translate-x-1/2", size === "sm" ? "text-[14px]" : size === "lg" ? "text-[24px]" : "text-[18px]")}
          style={{
            left: `${size === "lg" ? ((i * 7) % 3) * 8 - 8 : i * 16}px`,
            animationDelay: `${160 + i * 180}ms`,
            ["--rise-x" as string]: `${((i * 37) % 23) - 11}px`,
            ["--rise-y" as string]: rise,
          }}
        >
          {kinds[i % kinds.length]}
        </span>
      ))}
    </span>
  );
}

/**
 * Home's Crew feed cards: a small capsule pops up over the post (who
 * reacted, the comment count) with its reactions floating up out of it,
 * then fades away by itself. Taps go straight through. Fills its parent
 * (which must be `relative`), clear of the like count in the corner.
 */
export function EngagementPop({ post }: { post: CommunityPost }) {
  const { ref, on, done } = useEngagementPop<HTMLDivElement>(post);
  const faces = [...(post.reactors ?? [])].sort((a, b) => Number(!!b.is_me) - Number(!!a.is_me)).slice(0, 3);
  const kinds = reactionKinds(post);
  return (
    <div ref={ref} data-engagement-pop={on ? "" : undefined} className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {on && (
        <div
          className="engage-pop absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-6.5rem)] items-center gap-1.5 rounded-full bg-black/70 py-0.5 pl-0.5 pr-2.5 text-white shadow-lg ring-1 ring-white/15 backdrop-blur-md"
          onAnimationEnd={(e) => e.animationName.startsWith("engage-pop") && done()}
        >
          {faces.length > 0 ? (
            <span className="flex shrink-0 -space-x-1.5">
              {faces.map((r) => (
                <span key={r.user_id} className="rounded-full ring-2 ring-black/60">
                  <UserAvatar src={r.avatar_url} name={r.is_me ? "You" : r.name} size={18} expandable={false} />
                </span>
              ))}
            </span>
          ) : (
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-[11px]">{kinds[0] ?? "💬"}</span>
          )}
          {faces.length > 0 && kinds.length > 0 && <span className="shrink-0 text-[11px] leading-none tracking-[-0.15em]">{kinds.join("")}</span>}
          <span className="min-w-0 truncate text-[10px] font-bold">{engagementLine(post)}</span>
          <ReactionsRise kinds={kinds} size="sm" className="bottom-full left-2.5" />
        </div>
      )}
    </div>
  );
}
