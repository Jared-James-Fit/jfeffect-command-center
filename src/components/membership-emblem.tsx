import { useId } from "react";
import { cn } from "@/lib/utils";
import { BADGE_LABEL, emblemTier, type BadgeTier } from "@/lib/membership-badge";

/**
 * JF Effect's membership emblems: a plate leaning forward like the JF italic, with strokes cut
 * the same way. One stroke graphite outline (Free), two strokes platinum (Member, Premium),
 * three strokes muted gold (Coaching). Shape, stroke count and finish each tell them apart, so
 * one is readable at 12px without its colour. Drawn once here; colours are theme tokens
 * (--emblem-*, styles.css). No animation, no background.
 */

// The plate: a parallelogram leaning right (the logo's italic), corners rounded by the stroke.
const PLATE = "M6.2 3.2 H18.4 L14.8 16.8 H2.6 Z";
// Strokes parallel to the plate's sides (dx -3.6 per 13.6 of height), centred inside it.
const STROKE = (topX: number) => `M${topX} 6.4 L${(topX - 2.1).toFixed(2)} 13.6`;
const STROKES: Record<BadgeTier, number[]> = {
  free: [11.5],
  member: [10.1, 12.9],
  coaching: [8.7, 11.5, 14.3],
};

export function MembershipEmblem({
  badge,
  size = 14,
  className,
  title,
}: {
  badge: string | null | undefined;
  /** Rendered width and height in px (12–16 in compact places). */
  size?: number;
  className?: string;
  /** Override the accessible name. */
  title?: string;
}) {
  const tier = emblemTier(badge);
  const gid = useId().replace(/:/g, "");
  if (!tier) return null;
  const label = title ?? `${BADGE_LABEL[badge as keyof typeof BADGE_LABEL] ?? "Free"} membership`;
  const decorative = label === "";
  const fillId = `emb-${tier}-${gid}`;
  const colors =
    tier === "coaching"
      ? { a: "var(--emblem-coach-a)", b: "var(--emblem-coach-b)", edge: "var(--emblem-coach-edge)", mark: "var(--emblem-coach-mark)" }
      : tier === "member"
        ? { a: "var(--emblem-member-a)", b: "var(--emblem-member-b)", edge: "var(--emblem-member-edge)", mark: "var(--emblem-member-mark)" }
        : null;
  return (
    <svg
      viewBox="0 0 21 20"
      width={size}
      height={size}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-membership-emblem={tier}
      className={cn("inline-block shrink-0 align-[-0.125em]", className)}
    >
      {!decorative && <title>{label}</title>}
      {colors ? (
        <>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0" style={{ stopColor: colors.a }} />
              <stop offset="1" style={{ stopColor: colors.b }} />
            </linearGradient>
          </defs>
          <path d={PLATE} fill={`url(#${fillId})`} stroke={colors.edge} strokeWidth={1.2} strokeLinejoin="round" />
          {STROKES[tier].map((x) => (
            <path key={x} d={STROKE(x)} stroke={colors.mark} strokeWidth={1.7} strokeLinecap="round" fill="none" />
          ))}
        </>
      ) : (
        <>
          <path d={PLATE} fill="none" stroke="var(--emblem-free)" strokeWidth={1.5} strokeLinejoin="round" />
          {STROKES.free.map((x) => (
            <path key={x} d={STROKE(x)} stroke="var(--emblem-free)" strokeWidth={1.7} strokeLinecap="round" fill="none" />
          ))}
        </>
      )}
    </svg>
  );
}

/** The emblem with its word, for larger places (a profile header, an account row's detail). */
export function MembershipBadgeLabel({ badge, className }: { badge: string | null | undefined; className?: string }) {
  const tier = emblemTier(badge);
  if (!tier) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-muted-foreground", className)} data-membership-label={badge}>
      <MembershipEmblem badge={badge} size={14} title="" />
      {BADGE_LABEL[badge as keyof typeof BADGE_LABEL]}
    </span>
  );
}
