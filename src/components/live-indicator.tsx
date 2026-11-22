import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One live look for the whole app (chat presence, the Live boards, training
 * now): a breathing dot with two soft waves, a still dot on a live avatar's
 * corner, and the red Live pills glowing. Animations live in styles.css
 * ("Live indicators") and stop with reduced motion.
 */

const TONE = {
  green: "bg-emerald-500",
  white: "bg-white",
  red: "bg-red-500",
} as const;

/** The live dot: breathing, with two waves rolling out of it. */
export function LiveDot({
  className = "",
  size = 8,
  tone = "green",
  ring = true,
}: {
  className?: string;
  /** px */
  size?: number;
  tone?: keyof typeof TONE;
  /** a background-colored edge so it reads on top of an avatar */
  ring?: boolean;
}) {
  return (
    <span aria-label="Live" role="img" className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span aria-hidden className={cn("jf-live-wave absolute inset-0 rounded-full", TONE[tone])} />
      <span aria-hidden className={cn("jf-live-wave jf-live-wave-2 absolute inset-0 rounded-full", TONE[tone])} />
      <span aria-hidden className={cn("jf-live-core relative inline-flex h-full w-full rounded-full", TONE[tone], ring && "ring-2 ring-background")} />
    </span>
  );
}

/** The dot and a word ("Live", "3 active now") in the live green. */
export function LiveMark({ children = "Live", className, size = 8 }: { children?: ReactNode; className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400", className)}>
      <LiveDot size={size} ring={false} />
      {children}
    </span>
  );
}

/**
 * An avatar that's live right now (in the chat now, training now): a still
 * dot on the photo's corner, Instagram's "Active now", green or the Crew's
 * training red. Never a ring: a ring around a photo means a story (story-ring.tsx),
 * and a spinning coloured ring read as one. Not live: the avatar as it is.
 * `tag` is kept for older call sites; the dot says it.
 */
export function LiveAvatar({
  live,
  children,
  size,
  tone = "green",
  className,
}: {
  live: boolean | undefined;
  children: ReactNode;
  /** the avatar's size in px (the dot sits on its corner) */
  size: number;
  /** (no longer drawn: the dot is the whole mark) */
  tag?: boolean;
  /** green: in the chat now; red: training now (Crew) */
  tone?: "green" | "red";
  className?: string;
}) {
  if (!live) return <span className={cn("relative inline-flex shrink-0", className)}>{children}</span>;
  const dot = Math.round(Math.min(16, Math.max(9, size * 0.24)));
  // on the circle's edge at the bottom right (45°), whatever the size
  const inset = Math.round(size * 0.146 - dot / 2);
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }} data-live>
      {children}
      <span
        role="img"
        aria-label={tone === "red" ? "Training now" : "Active now"}
        className={cn("pointer-events-none absolute rounded-full ring-2 ring-background", tone === "red" ? "bg-red-500" : "bg-emerald-500")}
        style={{ width: dot, height: dot, right: inset, bottom: inset }}
        data-live-dot
      />
    </span>
  );
}

/** A red pill for something happening now ("Live", "Training now"), glowing, with its dot breathing. */
export function LivePill({ children = "Live", className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("jf-live-pill inline-flex items-center gap-1 rounded-[5px] bg-red-500 px-1 text-[9px] font-bold uppercase leading-[14px] tracking-wide text-white", className)}>
      <LiveDot size={5} tone="white" ring={false} />
      {children}
    </span>
  );
}
