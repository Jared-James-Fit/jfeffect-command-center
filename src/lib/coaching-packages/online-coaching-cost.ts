/**
 * What higher-priced online coaching costs, for the home page's price story
 * (Nov 23 2026; pure and tested in price-reveal.test.ts). It's the story's
 * second number, after a personal trainer's: online coaching costs less than a
 * trainer, and the higher-priced packages still run thousands a year.
 *
 * Examples only, never an average, and never a competitor named on the page:
 * the page describes each package (where the coach is, what it includes, its
 * price) and keeps who they are out of what a visitor reads. Who they are is
 * recorded here and in docs/pricing-anchors.md, with where each price was
 * read, so the numbers can be checked:
 *
 *   - Calgary Barbell, calgarybarbell.com/coaching: Comprehensive Coaching,
 *     $289.99 CAD a month (fully custom programming, an intake call, one weekly
 *     video check-in and form review, block review calls, unlimited
 *     communication); calgarybarbell.com/nutrition: Comprehensive Coaching &
 *     Nutrition Package Deal, $389.99 CAD a month. Its Fundamental Coaching
 *     tier is $189.99 a month.
 *   - Paris Demers (Vancouver), parisdemers.com/pages/online-fitness-coaching:
 *     online coaching from $400 CAD a month plus GST, nutrition coaching
 *     included, month to month.
 *   - Strengthcity Online (Surrey), its Trainerize profile: General Fitness
 *     Coaching $199 CAD a month, Performance Coaching $249 CAD a month.
 *
 * The range shown is the higher-priced packages ($289.99 to $400 a month), and
 * the lower tiers checked are said beside it, so nobody reads the range as
 * what every coach charges. Prices are in Canadian dollars before tax, like
 * the coaching prices they're compared with.
 *
 * When the prices are checked again, change EXAMPLES, LOWER_TIERS and
 * CHECKED_ON together (and the doc).
 */
import { CHECKED_ON, wholeDollars, exactDollars } from "./trainer-cost";

export type CoachingExample = {
  /** Who, without a name ("A Calgary strength coaching business"). */
  who: string;
  /** What the package includes, as its own page says it. */
  what: string;
  /** Its monthly price, in cents, before tax. */
  monthCents: number;
  /** "from": the published price is where the package starts. */
  from?: boolean;
};

/** The higher-priced packages checked. */
export const EXAMPLES: readonly CoachingExample[] = [
  {
    who: "A Calgary strength coaching business",
    what: "A custom program, a weekly video check-in and form review, block review calls and unlimited messaging.",
    monthCents: 28999,
  },
  {
    who: "The same business, with nutrition",
    what: "The same coaching with their nutrition coaching added, as one package.",
    monthCents: 38999,
  },
  {
    who: "A Vancouver coach",
    what: "Online coaching with nutrition coaching included, month to month, plus GST.",
    monthCents: 40000,
    from: true,
  },
];

/** The lower tiers the same check found, in cents a month: said beside the range. */
export const LOWER_TIERS: readonly number[] = [18999, 19900, 24900];

export type OnlineAnchor = {
  /** "$3,480" and "$4,800": a year of the cheapest and dearest example. */
  yearLow: string;
  yearHigh: string;
  /** "$289.99 to $400 a month". */
  monthRange: string;
  /** "$289.99 × 12 = $3,480. $400 × 12 = $4,800." */
  maths: string;
  examples: readonly { who: string; what: string; price: string }[];
  /** "Lower tiers from the same check ran $189.99 to $249 a month." */
  lowerTiers: string;
  checkedOn: string;
};

/** "$289.99", "$400": cents only when there are some. */
function price(cents: number): string {
  return cents % 100 === 0 ? wholeDollars(cents) : exactDollars(cents);
}

/**
 * The online coaching example, when it belongs on the page: only while every
 * monthly coaching price on the site is below the cheapest of the
 * higher-priced packages (so "higher-priced" stays true), and only when there's
 * a coaching price to compare it with at all. Otherwise null.
 */
export function onlineAnchor(highestMonthlyCents: number | null, examples: readonly CoachingExample[] = EXAMPLES): OnlineAnchor | null {
  if (!highestMonthlyCents || highestMonthlyCents <= 0 || !examples.length) return null;
  const months = examples.map((e) => e.monthCents);
  const low = Math.min(...months);
  const high = Math.max(...months);
  if (highestMonthlyCents >= low) return null;
  const lowers = LOWER_TIERS.filter((c) => c < low);
  return {
    yearLow: wholeDollars(low * 12),
    yearHigh: wholeDollars(high * 12),
    monthRange: `${price(low)} to ${price(high)} a month`,
    maths: `${price(low)} × 12 = ${wholeDollars(low * 12)}. ${price(high)} × 12 = ${wholeDollars(high * 12)}.`,
    examples: examples.map((e) => ({ who: e.who, what: e.what, price: `${e.from ? "from " : ""}${price(e.monthCents)} a month` })),
    lowerTiers: lowers.length
      ? `Lower tiers from the same check ran ${price(Math.min(...lowers))} to ${price(Math.max(...lowers))} a month.`
      : "",
    checkedOn: CHECKED_ON,
  };
}
