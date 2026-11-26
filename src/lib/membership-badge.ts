/**
 * Membership badges (pure). The database decides a person's badge from what they actually have
 * (`_membership_badge`: an active coaching client, Premium, a paid or complimentary membership,
 * else free; null when they hid it), never stored, so a plan change shows at once. Staff get the
 * coach mark instead. Premium and a membership share the platinum emblem; the word tells them apart.
 */

export type MembershipBadge = "coaching" | "premium" | "member" | "free";
/** The three emblems. */
export type BadgeTier = "coaching" | "member" | "free";

export const BADGE_LABEL: Record<MembershipBadge, string> = {
  coaching: "Coaching",
  premium: "Premium",
  member: "Member",
  free: "Free",
};

export function emblemTier(badge: string | null | undefined): BadgeTier | null {
  if (badge === "coaching") return "coaching";
  if (badge === "premium" || badge === "member") return "member";
  if (badge === "free") return "free";
  return null;
}

export function isMembershipBadge(v: unknown): v is MembershipBadge {
  return v === "coaching" || v === "premium" || v === "member" || v === "free";
}

/** The marks shown beside a person's name: the coach mark, else their emblem; and a virtual label. */
export function nameMarks(p: {
  is_coach?: boolean | null;
  badge?: string | null;
  virtual?: boolean | null;
}): { coach: boolean; badge: MembershipBadge | null; virtual: boolean } {
  const coach = !!p.is_coach;
  return {
    coach,
    badge: !coach && isMembershipBadge(p.badge) ? p.badge : null,
    virtual: !!p.virtual,
  };
}
