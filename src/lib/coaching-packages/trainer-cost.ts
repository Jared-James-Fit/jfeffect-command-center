/**
 * What a personal trainer costs, for the home page's price story (Nov 23
 * 2026; pure and tested in price-reveal.test.ts). Before the coaching prices
 * are revealed, the page shows what an hour with a trainer usually costs, so
 * $249 and $130 a month land against something a visitor already knows.
 *
 * It has to be defensible, so it's a worked example from published rates,
 * never a guess or a "worth" figure:
 *
 *   - the rate is the City of Mississauga's 2026 published fee for a private
 *     personal trainer at its lower tier (8 or more sessions, 60 minutes,
 *     before HST): a public recreation program's bulk rate, below every
 *     single-session price checked, never a premium gym's;
 *   - the other public rates checked are listed beside it, with links, lower
 *     ones included (Oshawa's 10-session bundle works out under $50 an hour),
 *     so anyone can see where the example sits;
 *   - the maths is shown (rate × sessions a week × 52 weeks, ÷ 12 for a
 *     month), and once and three times a week are said too, so twice a week
 *     is visibly an example, not the most flattering number;
 *   - it's before tax, like the coaching prices it's compared with.
 *
 * A trainer in the room and online coaching are different services, and the
 * page says so beside the number (what each gives you and what it doesn't).
 * Nothing here calls the coaching a discount on a trainer.
 *
 * When the rates are checked again, change RATES and CHECKED_ON together.
 */
import type { PriceReveal } from "./price-reveal";

export type RateSource = {
  /** Who publishes the rate ("City of Mississauga"). */
  provider: string;
  /** The rate as they state it. */
  detail: string;
  url: string;
};

/** The example: the lowest published tier of a public program, in cents, before tax. */
export const EXAMPLE_RATE_CENTS = 5623;
/** The example's sessions a week (once and three times a week are shown beside it). */
export const EXAMPLE_PER_WEEK = 2;
/** When the published rates below were last checked. */
export const CHECKED_ON = "Nov 23, 2026";

/** The line under the example, naming where its rate comes from. */
export const EXAMPLE_LINE = "The City of Mississauga's 2026 rate for a private trainer, when you buy 8 or more sessions.";

export const EXAMPLE_SOURCE: RateSource = {
  provider: "City of Mississauga",
  detail: "Private personal training, 60 minutes, 2026: $66.15 a session for 1 to 7 sessions, $56.23 for 8 or more, plus HST.",
  url: "https://www.mississauga.ca/recreation-and-sports/sports-and-activities/personal-training/",
};

/** Other public rates checked the same day, so the example can be seen in context. */
export const OTHER_SOURCES: readonly RateSource[] = [
  {
    provider: "City of Oshawa",
    detail: "Personal training for members, up to 60 minutes: $58.25 a session, $269.40 for 5, $495.10 for 10.",
    url: "https://www.oshawa.ca/explore-play/recreation/fitness/personal-training/",
  },
  {
    provider: "University of Ottawa",
    detail: "Private personal training: $59 a session, tax included.",
    url: "https://www.uottawa.ca/campus-life/recreation/registered-activities/personal-training",
  },
  {
    provider: "City of Edmonton",
    detail: "Private personal training: $61.20 a session for members, $76.50 for everyone else.",
    url: "https://www.edmonton.ca/activities_parks_recreation/personal-training-nutritional-services",
  },
];

/** A year and a month of sessions at a rate, in cents (a month is a twelfth of 52 weeks). */
export function trainerCost(rateCents: number, perWeek: number): { yearCents: number; monthCents: number } {
  const yearCents = Math.round(rateCents * perWeek * 52);
  return { yearCents, monthCents: Math.round(yearCents / 12) };
}

/** "$487", "$5,848": whole dollars, rounded to the nearest. */
export function wholeDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

/** "$56.23". */
export function exactDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type TrainerAnchor = {
  rate: string;
  perWeek: number;
  month: string;
  year: string;
  /** "Once a week is about $244 a month. Three times is about $731." */
  otherFrequencies: string;
  /** "$56.23 × 2 sessions × 52 weeks = $5,848 a year, or $487 a month." */
  maths: string;
  /** Where the example's rate comes from, in one line. */
  sourceLine: string;
  source: RateSource;
  others: readonly RateSource[];
  checkedOn: string;
};

/**
 * The trainer example, when it belongs on the page: only beside the coaching
 * reveal, and only while a month of it costs more than the higher coaching
 * price shown next (so the story never asks anyone to read a lower number as
 * the expensive one). Otherwise null, and the reveal starts with the coaching.
 */
export function trainerAnchor(reveal: PriceReveal | null, rateCents = EXAMPLE_RATE_CENTS, perWeek = EXAMPLE_PER_WEEK): TrainerAnchor | null {
  if (!reveal || rateCents <= 0 || perWeek <= 0) return null;
  const { yearCents, monthCents } = trainerCost(rateCents, perWeek);
  if (monthCents <= (reveal.anchor.priceCents ?? 0)) return null;
  const once = trainerCost(rateCents, 1).monthCents;
  const three = trainerCost(rateCents, 3).monthCents;
  const rate = exactDollars(rateCents);
  return {
    rate,
    perWeek,
    month: wholeDollars(monthCents),
    year: wholeDollars(yearCents),
    otherFrequencies: `Once a week is about ${wholeDollars(once)} a month. Three times is about ${wholeDollars(three)}.`,
    maths: `${rate} × ${perWeek} sessions × 52 weeks = ${wholeDollars(yearCents)} a year, or ${wholeDollars(monthCents)} a month.`,
    sourceLine: EXAMPLE_LINE,
    source: EXAMPLE_SOURCE,
    others: OTHER_SOURCES,
    checkedOn: CHECKED_ON,
  };
}
