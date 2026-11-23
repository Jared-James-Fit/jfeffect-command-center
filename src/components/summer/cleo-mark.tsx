import { cn } from "@/lib/utils";

/**
 * Cleo's signature (Nov 23 2026): the "plate C". A C drawn as a weight plate
 * seen from the side of the bar: a heavy ring opening to the right, and its
 * hub, the point everything turns on. Strength first, a coach's focus second,
 * and nothing borrowed from the stock AI vocabulary (no sparkle, robot, brain,
 * circuit, gradient or glow).
 *
 * One geometry everywhere, drawn on a 24-unit grid so it stays crisp at 16 px:
 * ring radius 8, stroke 3.4 with round terminals at ±42° from the opening's
 * centre, hub radius 2.6. It's always one colour (`currentColor`), so it
 * follows the theme and the text it sits beside; the avatar inverts it.
 *
 *   CleoMark       the icon alone (toolbar, launcher, recommendation)
 *   CleoWordmark   "Cleo" set in the app's face, tight and semibold
 *   CleoLockup     mark + wordmark
 *   CleoAvatar     the mark in a filled circle (chat), cleo-avatar.tsx
 *   CleoDot        the hub alone: a quiet "Cleo has something" indicator
 */

/** The ring's path: an arc from 42° to 318°, opening to the right. */
export const CLEO_RING_PATH = "M17.95 6.65 A8 8 0 1 0 17.95 17.35";

export function CleoMark({
  size = 20,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Read out when it stands alone; omitted, the mark is decoration beside its own words. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-cleo-mark
    >
      <path d={CLEO_RING_PATH} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function CleoWordmark({ className }: { className?: string }) {
  return <span className={cn("font-semibold tracking-[-0.02em]", className)}>Cleo</span>;
}

/** Mark and name together, the mark sized to the text. */
export function CleoLockup({ size = 18, className, textClassName }: { size?: number; className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-cleo-lockup>
      <CleoMark size={size} />
      <CleoWordmark className={textClassName} />
    </span>
  );
}

/** The hub alone, for a small "Cleo suggests" marker beside a line. */
export function CleoDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground", className)} data-cleo-dot />;
}
