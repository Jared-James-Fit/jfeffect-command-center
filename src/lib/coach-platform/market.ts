/**
 * What coaches pay elsewhere, for the owner's pricing review only (never on
 * a public page: competitor prices change and a comparison would need
 * checking every time). Seen Nov 22 2026 through search results, mostly
 * third-party pricing pages (the vendors' own pages couldn't be opened from
 * the session that gathered them), converted at 1.43 CAD per USD (Bank of
 * Canada, mid-November 2026). docs/COACH_PLATFORM_BUSINESS_2026-11.md has the
 * sources. Recheck on the vendor's own page before quoting any of it.
 */

export type MarketRow = {
  name: string;
  /** Free tier, in words. */
  free: string;
  /** Monthly cost in CAD at these client counts; null when it isn't published. */
  at: Partial<Record<1 | 5 | 10 | 20 | 50 | 100, number | null>>;
  note: string;
};

export const MARKET_SEEN = "2026-11-22";
export const USD_TO_CAD = 1.43;

export const MARKET: readonly MarketRow[] = [
  { name: "Trainerize", free: "1 client", at: { 1: 0, 5: 35.75, 10: 71.5, 20: 112.97, 50: 193.05, 100: 286 }, note: "Nutrition and payments are paid add-ons." },
  { name: "Everfit", free: "Up to 5 clients, limited features", at: { 1: 0, 5: 0, 10: 41.47, 20: 70.07, 50: 135.85, 100: 236 }, note: "Payments add-on $9 USD a month." },
  { name: "Hevy Coach", free: "None (30-day trial)", at: { 1: 35.75, 5: 35.75, 10: 35.75, 20: 71.5, 50: 128.7, 100: 228.8 }, note: "Tiers by client count." },
  { name: "TrueCoach", free: "None (14-day trial)", at: { 5: 42.87, 10: 100.07, 20: 100.07, 50: 235.92, 100: null }, note: "Sources disagree on its prices." },
  { name: "CoachRx", free: "None (14-day trial)", at: { 1: 41.47, 5: 41.47, 10: 112.97, 20: 112.97, 50: 112.97, 100: 284.57 }, note: "Over 150 clients: per-client fee on top." },
  { name: "Kahunas", free: "None", at: { 5: 35.75, 10: 71.5, 20: 143, 50: 143, 100: null }, note: "$5 USD a seat, less from 25 and 50 seats. Invited clients count." },
  { name: "PT Distinction", free: "Listed", at: { 1: 28.46, 5: 45.62, 10: 85.66, 20: 85.66, 50: 171.46, 100: 343.06 }, note: "Currency on its page wasn't stated." },
  { name: "My PT Hub", free: "None (30-day trial)", at: { 5: 74, 10: 74, 20: 74, 50: 74, 100: 74 }, note: "Premium is unlimited clients, about $74–84." },
];

export const MARKET_SIZES = [1, 5, 10, 20, 50, 100] as const;
