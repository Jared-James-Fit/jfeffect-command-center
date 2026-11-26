import { BadgeCheck } from "lucide-react";
import { MembershipEmblem } from "@/components/membership-emblem";
import { nameMarks } from "@/lib/membership-badge";
import { useMembershipBadge } from "@/lib/use-membership-badges";
import { cn } from "@/lib/utils";

/**
 * What sits beside a person's name everywhere they show (posts, comments, stories, profiles,
 * likes, search, chats, League): the coach mark for staff, else their membership emblem, and
 * "Virtual" for a virtual Crew account, which is never hidden. Small, inline, never a banner.
 *
 * Give it the author card when there is one (`person`); else a `userId`, and the badge is looked
 * up in one batched call for the screen (community_badges).
 */
export function NameMarks({
  person,
  userId,
  size = 14,
  className,
  onDark,
}: {
  person?: { is_coach?: boolean | null; badge?: string | null; virtual?: boolean | null } | null;
  userId?: string | null;
  size?: number;
  className?: string;
  onDark?: boolean;
}) {
  // Look the badge up only when the card didn't carry one (an older payload, a people search row).
  const looked = useMembershipBadge(!person || person.badge === undefined ? userId ?? null : null);
  const marks = nameMarks({
    is_coach: person?.is_coach ?? looked?.is_coach,
    badge: person && person.badge !== undefined ? person.badge : looked?.badge,
    virtual: person?.virtual ?? looked?.virtual,
  });
  if (!marks.coach && !marks.badge && !marks.virtual) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)} data-name-marks>
      {marks.coach ? (
        <CoachBadge className={size < 15 ? "h-3.5 w-3.5" : undefined} />
      ) : marks.badge ? (
        <MembershipEmblem badge={marks.badge} size={size} />
      ) : null}
      {marks.virtual && <VirtualTag onDark={onDark} />}
    </span>
  );
}

/** The coach mark next to a name: small, verified-style, never a banner. */
export function CoachBadge({ className }: { className?: string }) {
  return <BadgeCheck className={cn("h-4 w-4 shrink-0 fill-primary text-primary-foreground", className)} aria-label="Coach" role="img" />;
}

/** The disclosure on a virtual Crew account: compact, neutral, always there. */
export function VirtualTag({ onDark, className }: { onDark?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] font-semibold uppercase leading-none tracking-wide",
        onDark ? "bg-white/15 text-white/80" : "bg-muted text-muted-foreground",
        className,
      )}
      title="A virtual account run by JF Effect, not a real person"
      aria-label="Virtual account run by JF Effect"
      data-virtual-tag
    >
      Virtual
    </span>
  );
}
