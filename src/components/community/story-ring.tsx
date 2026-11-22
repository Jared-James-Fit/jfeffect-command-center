import { createContext, useContext, useId, type ReactNode } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { ringGeometry, type StoryRingState } from "@/lib/story-ring";
import type { CommunityPost, StoryGroup } from "@/lib/community";

/**
 * The one story indicator for every photo in the app (Nov 22 2026): no ring
 * when there's no story, the JF Effect ring (amber into the brand red) while
 * there's a moment you haven't watched, Close Friends green, and a quiet grey
 * ring once you've watched it all. The ring is drawn outside the photo (an
 * SVG around it), so the photo and the layout keep their size whatever the
 * state, the gap between ring and photo is truly see-through (it reads on
 * any background, the dark story viewer included), and the only motion is
 * the ring easing from colour to grey as you finish watching.
 */
export const STORY_RING_FROM = "#f7a53a";
export const STORY_RING_TO = "#ef3340";
const CLOSE_FRIENDS = "#10b981";
const SEEN = "color-mix(in oklch, var(--muted-foreground) 45%, transparent)";

export function StoryRing({ state, size, children, className }: { state: StoryRingState; size: number; children: ReactNode; className?: string }) {
  const id = useId().replace(/:/g, "");
  const { stroke, gap } = ringGeometry(size);
  const pad = stroke + gap;
  const outer = size + pad * 2;
  const r = outer / 2 - stroke / 2;
  const colour = state === "unseen" || state === "close_friends";
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full", className)} style={{ width: size, height: size }} data-story-ring={state}>
      {children}
      {state !== "none" && (
        // max-w-none: the base styles cap an svg at its parent's width, which squashed the ring off centre
        <svg
          aria-hidden
          className="pointer-events-none absolute max-w-none overflow-visible"
          style={{ left: -pad, top: -pad, width: outer, height: outer }}
          viewBox={`0 0 ${outer} ${outer}`}
        >
          <defs>
            <linearGradient id={`sr${id}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor={STORY_RING_FROM} />
              <stop offset="100%" stopColor={STORY_RING_TO} />
            </linearGradient>
          </defs>
          {/* watched: grey, faded in under the colour as it goes */}
          <circle cx={outer / 2} cy={outer / 2} r={r} fill="none" strokeWidth={Math.max(1, stroke - 0.5)} style={{ stroke: SEEN }} />
          <circle
            cx={outer / 2}
            cy={outer / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            stroke={state === "close_friends" ? CLOSE_FRIENDS : `url(#sr${id})`}
            className="transition-opacity duration-300 ease-out motion-reduce:transition-none"
            style={{ opacity: colour ? 1 : 0 }}
          />
        </svg>
      )}
    </span>
  );
}

/**
 * Who has a story up, and a way to play it: provided by the Crew screen
 * (StoryHostProvider, crew-stories.tsx) from the stories the rail reads, and
 * outside Crew by the app's own host (GlobalStoryHost) from the same data
 * already loaded. Without a host every photo is plain.
 */
export type StoryHost = {
  ring: (userId: string) => StoryRingState;
  /** Play this person's story; false when they have nothing up. */
  open: (userId: string) => boolean;
  /** Play a story the caller found itself (a profile reads its own posts). */
  play?: (group: StoryGroup<CommunityPost>, posts: CommunityPost[]) => void;
};
export const StoryHostContext = createContext<StoryHost | null>(null);

export function useStoryRing(userId: string | null | undefined): { state: StoryRingState; open: () => boolean } {
  const host = useContext(StoryHostContext);
  const state = userId && host ? host.ring(userId) : "none";
  return { state, open: () => !!userId && !!host && host.open(userId) };
}

/**
 * The photo's button: exactly the photo's box (inline-grid, so no line box
 * makes it taller than the photo), and a keyboard focus ring round the
 * outside of the story ring, never an off-centre outline.
 */
const PRESS =
  "inline-grid shrink-0 place-items-center rounded-full outline-none active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-ring";

/**
 * A person's photo with their story ring. With a story up, a tap plays it
 * (Instagram's); without one, the tap does what this photo always did there
 * (`onPress`: their profile, the chat; else, with `expandable`, the photo
 * opens big), and there's no ring at all.
 */
export function StoryAvatar({
  userId,
  src,
  name,
  size,
  onPress,
  pressLabel,
  expandable = false,
  story,
  className,
}: {
  userId: string | null | undefined;
  src: string | null | undefined;
  name: string;
  size: number;
  /** The tap when there's no story to play. */
  onPress?: () => void;
  pressLabel?: string;
  /** No story and no onPress: a tap opens the photo big. */
  expandable?: boolean;
  /** The caller's own read (a profile's own stories), instead of the host's. */
  story?: { state: StoryRingState; open: () => boolean };
  className?: string;
}) {
  const fromHost = useStoryRing(userId);
  const { state, open } = story ?? fromHost;
  if (state === "none") {
    if (onPress) {
      return (
        <button type="button" onClick={onPress} className={cn(PRESS, className)} aria-label={pressLabel ?? name} data-story-avatar="none">
          <UserAvatar src={src} name={name} size={size} expandable={false} />
        </button>
      );
    }
    return <UserAvatar src={src} name={name} size={size} expandable={expandable} className={className} />;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!open()) onPress?.();
      }}
      className={cn(PRESS, "transition-transform duration-150", className)}
      aria-label={`Watch ${name}'s story${state === "seen" ? "" : ", new"}`}
      data-story-avatar={state}
    >
      <StoryRing state={state} size={size}>
        <UserAvatar src={src} name={name} size={size} expandable={false} />
      </StoryRing>
    </button>
  );
}
