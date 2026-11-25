/**
 * Wednesday Wins and the Sunday Recap as carousels (Nov 25 2026): the cover
 * is one big number people read in the grid (what the crew lifted, how much
 * of the plan got done), and what supports it follows on its own slides
 * (the numbers, the weeks or the days, the week's moments, the goal). Pure,
 * so the feed and Share to Instagram know how many slides a post paints
 * without painting it.
 */
import { isRecapStats, isWinsStats, type CommunityPost, type RecapStats, type WinsStats } from "@/lib/community";

export type WinsSlide = "hero" | "numbers" | "weeks" | "goal";
export type RecapSlide = "hero" | "numbers" | "days" | "moments";

export function winsSlides(s: WinsStats): WinsSlide[] {
  const out: WinsSlide[] = ["hero", "numbers"];
  out.push((s.history?.length ?? 0) > 1 ? "weeks" : "goal");
  return out;
}

export function recapSlides(s: RecapStats): RecapSlide[] {
  const out: RecapSlide[] = ["hero", "numbers"];
  if (s.days?.some((n) => n > 0)) out.push("days");
  if (s.top?.length) out.push("moments");
  return out;
}

/** How many pictures a Wins or Recap post paints (1 for anything else). */
export function statsSlideCount(post: Pick<CommunityPost, "series" | "series_data">): number {
  if (post.series === "sunday_recap" && isRecapStats(post.series_data)) return recapSlides(post.series_data).length;
  if (isWinsStats(post.series_data)) return winsSlides(post.series_data).length;
  return 1;
}
