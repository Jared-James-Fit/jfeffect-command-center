/**
 * What a personal trainer costs, for the home page's price story (Nov 23
 * 2026; pure and tested in price-reveal.test.ts). It's the story's first
 * number: before the app is shown and priced, the page says what help usually
 * costs, as a year of it.
 *
 * It has to be defensible, so it's a worked example from a published rate,
 * never a guess, a premium gym's price or a "worth" figure:
 *
 *   - the rate is the City of Edmonton's published fee for one private
 *     personal training session for anyone who isn't a member of its
 *     facilities ($76.50): what anyone walking into a public rec centre pays,
 *     not a private gym's rate;
 *   - the other public rates checked are listed beside it, with links, lower
 *     and higher ones both (Mississauga's 8-session tier is $56.23, Calgary's
 *     5-session package works out to $83), so anyone can see where the example
 *     sits: never the highest rate checked;
 *   - the maths is shown (rate × sessions a week × 52 weeks), and once and
 *     three times a week are said too, so twice a week is visibly an example;
 *   - it's before tax, like the coaching prices it's compared with.
 *
 * The names of the public providers appear only in the collapsed sources; the
 * line a visitor reads says "a city rec centre's published rate". A trainer in
 * the room, an online coach and an app are different things, and the page says
 * so right after the numbers (cost-anchors.tsx). Nothing calls the coaching a
 * discount on a trainer.
 *
 * When the rates are checked again, change the sources and CHECKED_ON together.
 */

export type RateSource = {
  /** Who publishes the rate ("City of Edmonton"). */
  provider: string;
  /** The rate as they state it. */
  detail: string;
  url: string;
};

/** The example: a public rec centre's published rate for one private session, in cents, before tax. */
export const EXAMPLE_RATE_CENTS = 7650;
/** The example's sessions a week (once and three times a week are shown beside it). */
export const EXAMPLE_PER_WEEK = 2;
/** When the published rates below were last checked. */
export const CHECKED_ON = "Nov 23, 2026";

export const EXAMPLE_SOURCE: RateSource = {
  provider: "City of Edmonton",
  detail:
    "Private personal training: $76.50 a session for non-members, $73 a session in a pack of 5 and $70 in a pack of 10. Members pay $61.20 a session.",
  url: "https://www.edmonton.ca/activities_parks_recreation/personal-training-nutritional-services",
};

/** Other public rates checked the same day, so the example can be seen in context. */
export const OTHER_SOURCES: readonly RateSource[] = [
  {
    provider: "City of Calgary",
    detail: "Private personal training at Village Square Leisure Centre: $415 for 5 sessions ($83 a session), $725 for 10 ($72.50 a session).",
    url: "https://www.calgary.ca/rec-locations/pools/village-square-personal-training.html",
  },
  {
    provider: "City of Mississauga",
    detail: "Private personal training, 60 minutes, 2026: $66.15 a session for 1 to 7 sessions, $56.23 for 8 or more, plus HST.",
    url: "https://www.mississauga.ca/recreation-and-sports/sports-and-activities/personal-training/",
  },
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
];

/** A year and a month of sessions at a rate, in cents (a month is a twelfth of 52 weeks). */
export function trainerCost(rateCents: number, perWeek: number): { yearCents: number; monthCents: number } {
  const yearCents = Math.round(rateCents * perWeek * 52);
  return { yearCents, monthCents: Math.round(yearCents / 12) };
}

/** "$663", "$7,956": whole dollars, rounded to the nearest. */
export function wholeDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

/** "$76.50". */
export function exactDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SESSION_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

export type TrainerAnchor = {
  rate: string;
  perWeek: number;
  /** "Two private sessions a week at $76.50 each, a city rec centre's published rate." Names nobody. */
  sessions: string;
  month: string;
  year: string;
  /** "Once a week is about $3,978 a year. Three times is about $11,934." */
  otherFrequencies: string;
  /** "$76.50 × 2 sessions × 52 weeks = $7,956 a year, about $663 a month." */
  maths: string;
  source: RateSource;
  others: readonly RateSource[];
  checkedOn: string;
};

/**
 * The trainer example, when it belongs on the page: only while a month of it
 * costs more than the highest monthly coaching price on the site (so the story
 * never asks anyone to read a lower number as the expensive one), and only
 * when there's a coaching price to compare it with at all. Otherwise null.
 */
export function trainerAnchor(
  highestMonthlyCents: number | null,
  rateCents = EXAMPLE_RATE_CENTS,
  perWeek = EXAMPLE_PER_WEEK,
): TrainerAnchor | null {
  if (!highestMonthlyCents || highestMonthlyCents <= 0 || rateCents <= 0 || perWeek <= 0) return null;
  const { yearCents, monthCents } = trainerCost(rateCents, perWeek);
  if (monthCents <= highestMonthlyCents) return null;
  const once = trainerCost(rateCents, 1).yearCents;
  const three = trainerCost(rateCents, 3).yearCents;
  const rate = exactDollars(rateCents);
  const count = SESSION_WORDS[perWeek] ?? String(perWeek);
  return {
    rate,
    perWeek,
    sessions: `${count} private ${perWeek === 1 ? "session" : "sessions"} a week at ${rate} each, a city rec centre's published rate.`,
    month: wholeDollars(monthCents),
    year: wholeDollars(yearCents),
    otherFrequencies: `Once a week is about ${wholeDollars(once)} a year. Three times is about ${wholeDollars(three)}.`,
    maths: `${rate} × ${perWeek} sessions × 52 weeks = ${wholeDollars(yearCents)} a year, about ${wholeDollars(monthCents)} a month.`,
    source: EXAMPLE_SOURCE,
    others: OTHER_SOURCES,
    checkedOn: CHECKED_ON,
  };
}
