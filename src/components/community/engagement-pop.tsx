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
export function useEngagementPop<T extends HTMLElement>(post: CommunityPost) {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  const engaged = isEngaged(post);
  useEffect(() => {
    const el = ref.current;
    if (!el || !engaged || on || popped.has(post.id) || typeof IntersectionObserver === "undefined") return;
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
  }, [engaged, on, post.id]);
  const done = useCallback(() => setOn(false), []);
  return { ref, on, done };
}

/** Its reactions drifting up and away (the feed: out of the heart; Home: out of the capsule). */
export function ReactionsRise({ kinds, size = "md", className }: { kinds: string[]; size?: "sm" | "md"; className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute", className)} aria-hidden>
      {kinds.map((k, i) => (
        <span key={k} className={cn("engage-float absolute bottom-0", size === "sm" ? "text-[14px]" : "text-[18px]")} style={{ left: `${i * 16}px`, animationDelay: `${180 + i * 160}ms` }}>
          {k}
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
