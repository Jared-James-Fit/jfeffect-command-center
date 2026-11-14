/**
 * The coach's Crew page is the clients' Crew (Nov 14 2026: "The admin layout
 * for the crew posts are too different from clients. Make it similar but have
 * the features where the admin can manage posts and insights"): the same bar,
 * stories and full-screen feed, with the coach's tools on one page of their
 * own, Manage, opened from the bar: what's waiting on them, the Posts
 * schedule and Insights. Which tab a link asks for lives in the hash, so a
 * push, an old link or Back lands on the right one.
 */
export type ManageTab = "needs" | "posts" | "insights";

export const MANAGE_TABS: { key: ManageTab; label: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "posts", label: "Posts" },
  { key: "insights", label: "Insights" },
];

/**
 * The Manage tab a link asks for, or null for the feed: `#tab=needs`,
 * `#tab=posts` (and the old `#tab=daily`, `#tab=birthdays`, `#birthday=<id>`,
 * and the Posts tab's own `#tab=posts&manage=…` pages), `#tab=insights`
 * (and the old `#tab=scores`).
 */
export function manageTabFromHash(h: string): ManageTab | null {
  if (/tab=needs/.test(h)) return "needs";
  if (/tab=(posts|daily|birthdays)/.test(h) || /birthday=/.test(h)) return "posts";
  if (/tab=(insights|scores)/.test(h)) return "insights";
  return null;
}
