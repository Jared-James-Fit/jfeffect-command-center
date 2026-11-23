/**
 * The home page's price story opens with what help usually costs (Nov 23
 * 2026; pure and tested in price-reveal.test.ts): a personal trainer
 * (trainer-cost.ts), then higher-priced online coaching
 * (online-coaching-cost.ts), each as a year of it, before the app is shown and
 * priced. Both are measured against the coaching on the site: each shows only
 * while it costs more than the highest monthly coaching package listed, so the
 * story never asks anyone to read a lower number as the expensive one. With no
 * coaching price on the site there's nothing to compare, and neither shows.
 */
import { listedPackages, type PublicPackage } from "./packages";
import { trainerAnchor, wholeDollars, type TrainerAnchor } from "./trainer-cost";
import { onlineAnchor, type OnlineAnchor } from "./online-coaching-cost";

export type CostAnchors = { trainer: TrainerAnchor | null; online: OnlineAnchor | null };

/** The highest monthly coaching price listed on the site, in cents (null when there's none). */
export function highestMonthlyCents(rows: readonly PublicPackage[]): number | null {
  const prices = listedPackages(rows)
    .filter((p) => p.kind === "subscription" && p.interval === "month" && (p.priceCents ?? 0) > 0)
    .map((p) => p.priceCents as number);
  return prices.length ? Math.max(...prices) : null;
}

/** Both examples, measured against the coaching on the site; null when neither belongs on the page. */
export function costAnchors(rows: readonly PublicPackage[]): CostAnchors | null {
  const top = highestMonthlyCents(rows);
  const trainer = trainerAnchor(top);
  const online = onlineAnchor(top);
  return trainer || online ? { trainer, online } : null;
}

/** "$1,560 a year": a monthly price as a year of it, for reading beside the yearly examples. */
export function yearLine(monthCents: number | null | undefined): string | null {
  if (!monthCents || monthCents <= 0) return null;
  return `${wholeDollars(monthCents * 12)} a year`;
}
