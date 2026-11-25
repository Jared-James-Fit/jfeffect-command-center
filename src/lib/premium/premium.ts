/**
 * JF Effect Premium (groundwork, T01): an entitlement on the member's account
 * (member_access 'jf_premium'), never a coaching package and never on the
 * public pages. Nobody has it until a purchase path exists, except someone the
 * admin grants it to as complimentary. Premium gives Build with Cleo in the
 * program builder and the Cleo inbox (weekly recaps). Pure.
 */
export const PREMIUM_KEY = "jf_premium";
export const PREMIUM_NAME = "JF Effect Premium";

/** Cleo's voice: short, casual, sure of itself, never hype or made-up numbers. */
export const CLEO_WELCOME = {
  title: "Hey, I'm Cleo.",
  body:
    "You've got Premium. Two things are yours now: Build with Cleo in Programs (I draft a program from your goal, experience and days, and you change anything before you start it) and a weekly recap here every Monday, straight from what you logged.",
};

export type CleoInboxItem = {
  id: string;
  kind: "welcome" | "weekly_recap" | "note";
  title: string;
  body: string | null;
  cards: Array<{ key: string; value: string; label: string; sub?: string | null }>;
  created_at: string;
  read_at: string | null;
};

export function unreadCount(items: readonly Pick<CleoInboxItem, "read_at">[]): number {
  return items.filter((i) => !i.read_at).length;
}
