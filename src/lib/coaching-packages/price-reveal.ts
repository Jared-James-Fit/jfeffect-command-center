/**
 * The home page's price reveal (Nov 23 2026; pure and tested in
 * price-reveal.test.ts): the Steve Jobs way of showing a price, kept honest.
 *
 * At the iPad's launch the product was shown first, a higher price was
 * established, and then the real one was revealed. JF Effect does it with two
 * of its own listed packages, never a made-up reference: Coaching Plus at its
 * real price, then "Don't need the private calls?", then Complete Online
 * Coaching at its real price. They're two different products, so nothing here
 * is a discount: the higher price is never crossed out, never called a former
 * price, and the lower one is never "only" or "save".
 *
 * The reveal shows only when the packages make every word of it true:
 *
 *   - the flagship is the recommended monthly package, with no included calls
 *     (so "without them" is true);
 *   - the anchor is a listed monthly package above it that says it's
 *     everything in the flagship ("Everything in Complete Online Coaching")
 *     and adds nothing but calls (every other line is about calls), so the
 *     calls are the only difference;
 *   - both are listed. While Plus is a draft or taken off the site, there's
 *     no reveal and the page shows the packages as they are.
 */
import {
  callsLine,
  ctaHref,
  intervalLabel,
  listedPackages,
  priceLabel,
  TAX_NOTE,
  type PublicPackage,
} from "./packages";

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

export type PriceReveal = {
  /** The higher, real price shown first (Coaching Plus). */
  anchor: PublicPackage;
  /** The recommended package revealed after it (Complete Online Coaching). */
  flagship: PublicPackage;
  anchorPrice: string;
  flagshipPrice: string;
  /** "/month". */
  per: string;
  taxNote: string;
  /** How many calls the anchor adds, and how long each is. */
  calls: number;
  callMinutes: number;
  /** "Two private 30-minute video calls each billing month." */
  callsSentence: string;
  /** "two" (for "except the two calls"). */
  callsWord: string;
  anchorHref: string;
  flagshipHref: string;
};

const norm = (s: string) => s.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ").toLowerCase();

/** Whether a package says it's everything in another one ("Everything in Complete Online Coaching"). */
export function buildsOn(pkg: Pick<PublicPackage, "features">, base: Pick<PublicPackage, "name">): boolean {
  const line = `everything in ${norm(base.name)}`;
  return pkg.features.some((f) => norm(f) === line);
}

/** Whether every line a package adds on top of another is about its calls (so the calls are the only difference). */
export function addsOnlyCalls(pkg: Pick<PublicPackage, "features">, base: Pick<PublicPackage, "name">): boolean {
  const line = `everything in ${norm(base.name)}`;
  const extras = pkg.features.filter((f) => norm(f) !== line && f.trim());
  return extras.length > 0 && extras.every((f) => /\bcalls?\b/i.test(f));
}

/** The reveal, when the listed packages make it true; else null (the page shows the packages as they are). */
export function priceReveal(rows: readonly PublicPackage[], from = "reveal"): PriceReveal | null {
  const listed = listedPackages(rows).filter(
    (p) => p.kind === "subscription" && (p.priceCents ?? 0) > 0 && p.interval === "month",
  );
  const flagship = listed.find((p) => p.recommended);
  if (!flagship || flagship.includedCalls > 0) return null;
  const anchor = listed
    .filter(
      (p) =>
        p.slug !== flagship.slug &&
        (p.priceCents ?? 0) > (flagship.priceCents ?? 0) &&
        p.includedCalls > 0 &&
        buildsOn(p, flagship) &&
        addsOnlyCalls(p, flagship),
    )
    .sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0))[0];
  if (!anchor) return null;
  const line = callsLine(anchor);
  if (!line) return null;
  return {
    anchor,
    flagship,
    anchorPrice: priceLabel(anchor.priceCents),
    flagshipPrice: priceLabel(flagship.priceCents),
    per: intervalLabel(flagship),
    taxNote: TAX_NOTE,
    calls: anchor.includedCalls,
    callMinutes: anchor.callMinutes,
    callsSentence: `${line}.`,
    callsWord: COUNT_WORDS[anchor.includedCalls] ?? String(anchor.includedCalls),
    anchorHref: ctaHref(anchor, from),
    flagshipHref: ctaHref(flagship, from),
  };
}
