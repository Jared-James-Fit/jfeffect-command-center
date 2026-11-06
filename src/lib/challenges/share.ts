// What a shared result says: the card's words, the caption and the link back.
// Pure (tested). Only verified scores ever reach here; a live rank is always
// labelled live with its time, never as a final result.
import { formatScore, loadText, num, ordinal, scoreParts } from "./format";
import type { ChallengePublic, ResultData } from "./types";
import { SITE_URL } from "@/lib/share-meta";

export type CardKind = "result" | "entered" | "event";

export interface CardInput {
  kind: CardKind;
  title: string;
  detail: string;
  name?: string;
  score?: { value: string; unit: string };
  rank?: { label: string; of: number | null; division?: string | null };
  badge: { text: string; live: boolean };
  headline: string;
  photoUrl?: string | null;
  gold?: boolean;
  qrUrl: string;
  displayUrl: string;
  facts?: string[];
  sponsor?: string | null;
}

/** The address people type or tap: jfeffect.com/challenges/<slug>[/<handle>]. */
export function challengeUrl(slug: string, opts: { handle?: string | null; ref?: string | null; src?: string | null } = {}): string {
  const path = `/challenges/${slug}${opts.handle ? `/${opts.handle}` : ""}`;
  const q = new URLSearchParams();
  if (opts.ref) q.set("ref", opts.ref);
  if (opts.src) q.set("src", opts.src);
  const qs = q.toString();
  return `${SITE_URL}${path}${qs ? `?${qs}` : ""}`;
}

export function displayUrl(slug: string): string {
  return `jfeffect.com/challenges/${slug}`;
}

/** "BENCH PRESS · 225 LB · ONE SET" */
export function detailLine(c: Pick<ChallengePublic, "activity" | "load_value" | "load_unit" | "attempts_allowed" | "metric" | "time_cap_seconds">): string {
  const parts: string[] = [];
  if (c.activity) parts.push(c.activity.replace(/^barbell\s+/i, ""));
  if (c.load_value && c.load_unit) parts.push(`${num(c.load_value)} ${c.load_unit}`);
  if (c.time_cap_seconds) parts.push(c.time_cap_seconds % 60 === 0 ? `${c.time_cap_seconds / 60} min` : `${c.time_cap_seconds}s`);
  if (c.metric === "reps" && c.attempts_allowed === 1 && !c.time_cap_seconds) parts.push("one set");
  return parts.join(" · ").toUpperCase();
}

/** "LIVE · 7:42 PM" (a moving rank) or "FINAL RESULT". */
export function badgeFor(final: boolean, at: Date, timeZone = "America/Winnipeg"): { text: string; live: boolean } {
  if (final) return { text: "FINAL RESULT", live: false };
  const t = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(at);
  return { text: `LIVE RANK · ${t.toUpperCase()}`, live: true };
}

/** The headlines a person can pick for their card, best first. */
export function headlineOptions(r: Pick<ResultData, "rank" | "final" | "tied" | "won"> & { city?: string | null }): string[] {
  const out: string[] = [];
  if (r.rank == null) return ["I'M IN. ARE YOU?", "SEE YOU THERE", "COME WATCH"];
  if (r.final && r.rank === 1) out.push(r.tied ? "CO-CHAMPION" : "CHAMPION");
  else if (r.final && r.rank <= 3) out.push("PODIUM FINISH");
  if (!r.final && r.rank === 1) out.push("CURRENTLY #1");
  if (!r.final && r.rank > 1) out.push(r.city ? `CURRENTLY #${r.rank} IN ${r.city.toUpperCase()}` : `CURRENTLY #${r.rank}`);
  out.push("CAN YOU BEAT ME?", "YOUR TURN.");
  return Array.from(new Set(out));
}

export function cardFromResult(r: ResultData, opts: { headline?: string; now?: Date; photoUrl?: string | null } = {}): CardInput {
  const c = r.challenge;
  const competed = r.rank != null && r.score != null;
  const headline = opts.headline ?? headlineOptions({ ...r, city: c.city })[0];
  const qrUrl = challengeUrl(c.slug, { ref: r.athlete.handle, src: "qr" });
  if (!competed) {
    return {
      kind: "entered",
      title: c.title,
      detail: detailLine(c),
      name: r.athlete.name,
      badge: { text: `BIB #${r.athlete.bib}`, live: false },
      headline,
      photoUrl: opts.photoUrl ?? null,
      qrUrl,
      displayUrl: displayUrl(c.slug),
      facts: eventFacts(c),
    };
  }
  return {
    kind: "result",
    title: c.title,
    detail: detailLine(c),
    name: r.athlete.name,
    score: scoreParts(r.score, c),
    rank: {
      label: `${r.tied ? "T" : "#"}${r.rank}`,
      of: r.ranked || null,
      division: r.divisions > 1 ? r.division : null,
    },
    badge: badgeFor(r.final, opts.now ?? new Date(), c.timezone),
    headline,
    photoUrl: opts.photoUrl ?? null,
    gold: r.final && r.rank === 1,
    qrUrl,
    displayUrl: displayUrl(c.slug),
  };
}

/** "SAT DEC 12", "WINNIPEG", "FREE ENTRY", for an event card. */
export function eventFacts(c: Pick<ChallengePublic, "starts_at" | "timezone" | "city" | "entry_fee">, prize?: string | null): string[] {
  const facts: string[] = [];
  if (c.starts_at) {
    facts.push(new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: c.timezone }).format(new Date(c.starts_at)).replace(/,/g, "").toUpperCase());
  } else {
    facts.push("DATE TBA");
  }
  if (c.city) facts.push(c.city.toUpperCase());
  if (prize) facts.push(prize.toUpperCase());
  else if (c.entry_fee) facts.push(/^free$/i.test(c.entry_fee) ? "FREE ENTRY" : c.entry_fee.toUpperCase());
  return facts.slice(0, 3);
}

export function cardForEvent(c: ChallengePublic, prize: string | null, headline = "SCAN TO ENTER"): CardInput {
  return {
    kind: "event",
    title: c.title,
    detail: detailLine(c),
    badge: c.status === "live" ? { text: "LIVE NOW", live: true } : c.final ? { text: "FINAL RESULTS", live: false } : { text: "FREE TO ENTER", live: false },
    headline,
    qrUrl: challengeUrl(c.slug, { src: "qr" }),
    displayUrl: displayUrl(c.slug),
    facts: eventFacts(c, prize ? shortPrize(prize) : null),
  };
}

/** "$225 CAD + the winner's trophy" → "$225 prize". */
export function shortPrize(prize: string): string {
  const m = prize.match(/\$\s?\d[\d,]*/);
  return m ? `${m[0].replace(/\s/g, "")} prize` : prize.slice(0, 18);
}

/** The words to paste under the post. Plain, first person, one link. */
export function resultCaption(r: ResultData, url: string): string {
  const c = r.challenge;
  if (r.rank == null || r.score == null) {
    const when = c.starts_at
      ? new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: c.timezone }).format(new Date(c.starts_at))
      : null;
    return `I'm in the ${c.title}${when ? ` on ${when}` : ""}. ${c.entry_fee && /^free$/i.test(c.entry_fee) ? "It's free to enter. " : ""}Who's coming with me?\n\n${url}`;
  }
  const score = formatScore(r.score, c);
  const what = c.metric === "reps" && c.load_value && c.load_unit ? `${score} with ${num(c.load_value)} ${c.load_unit}` : score;
  const place = r.final
    ? r.rank === 1
      ? `Won it${r.tied ? " (tied)" : ""}`
      : `Finished ${ordinal(r.rank)} of ${r.ranked}`
    : `Currently #${r.rank} of ${r.ranked}`;
  const ask = r.final ? "Next one, you're coming." : "Think you can beat me?";
  return `${what} at the ${c.title}. ${place}. ${ask}\n\n${url}`;
}

export function eventCaption(c: ChallengePublic, url: string, prize: string | null): string {
  const load = loadText(c.load_value, c.load_unit);
  const bits = [
    c.tagline || c.title,
    load ? `${c.activity}, ${load}.` : null,
    prize ? `Prize: ${prize}.` : null,
    /^free$/i.test(c.entry_fee) ? "Free to enter." : null,
  ].filter(Boolean);
  return `${bits.join(" ")}\n\n${url}`;
}

/** Initials for an avatar with no photo. */
export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
