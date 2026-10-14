import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One live look for the whole app (chat presence, the Live boards, training
 * now): a breathing dot with two soft waves, a ring of light turning around a
 * live avatar with a LIVE tag, and the red Live pills glowing. Animations live
 * in styles.css ("Live indicators") and stop with reduced motion.
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
 * An avatar that's live right now: a ring of light turning around it, a soft
 * glow, and a LIVE tag along the bottom. Not live: the avatar as it is.
 */
export function LiveAvatar({
  live,
  children,
  size,
  tag = true,
  tone = "green",
  className,
}: {
  live: boolean | undefined;
  children: ReactNode;
  /** the avatar's size in px (the ring sits just outside it) */
  size: number;
  /** the LIVE tag (off for very small avatars) */
  tag?: boolean;
  /** green: in the chat now; red: training now (Crew) */
  tone?: "green" | "red";
  className?: string;
}) {
  if (!live) return <span className={cn("relative inline-flex shrink-0", className)}>{children}</span>;
  const pad = size >= 56 ? 4 : 3;
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }} data-live>
      <span aria-hidden className={cn("jf-live-halo pointer-events-none absolute rounded-full", tone === "red" && "jf-live-halo-red")} style={{ inset: -pad }} />
      <span aria-hidden className={cn("jf-live-ring pointer-events-none absolute rounded-full", tone === "red" && "jf-live-ring-red")} style={{ inset: -pad }} />
      {children}
      {tag && (
        <span
          aria-label="Live"
          className={cn(
            "jf-live-pill absolute left-1/2 -translate-x-1/2 rounded-[5px] font-black uppercase leading-none tracking-wide text-white ring-2 ring-background",
            tone === "red" ? "bg-red-500" : "bg-emerald-500",
            size >= 56 ? "-bottom-1.5 px-1.5 py-[3px] text-[9px]" : "-bottom-1 px-1 py-[2px] text-[8px]",
          )}
          style={{ ["--jf-live-glow" as string]: tone === "red" ? "#ef4444" : "#10b981" }}
        >
          Live
        </span>
      )}
    </span>
  );
}

/** A red pill for something happening now ("Live", "Training now"), glowing, with its dot breathing. */
export function LivePill({ children = "Live", className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("jf-live-pill inline-flex items-center gap-1 rounded-[5px] bg-red-500 px-1 text-[9px] font-black uppercase leading-[14px] tracking-wide text-white", className)}>
      <LiveDot size={5} tone="white" ring={false} />
      {children}
    </span>
  );
}
