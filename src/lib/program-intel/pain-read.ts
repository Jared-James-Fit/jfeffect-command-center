/**
 * Pain reports, read once per place for the coach (pure, tested).
 *
 * A check-out stores the places as text ("Shoulder (L), Low back", "Other"
 * with the place in the note), so counting by that text made "Shoulder (L)",
 * "shoulder (l), low back" and "Left shoulder" three separate items, and the
 * same reports were listed again under each section that read them. Here each
 * report is split into its places with the pain library's own reader
 * (regionFromName / regionsInText: the same one Pain history uses) and every
 * reader of Program Intelligence gets one line per place: how many reports,
 * over how many days, the worst level, and which way it's going.
 *
 * Never a diagnosis: a place and what was reported there.
 */
import { regionFromName, regionOf, regionsInText, type PainSide } from "@/lib/pain/regions";

export type PainReportLite = { date: string | null; area: string | null; level: number | null; note: string | null };

export type PainPlace = {
  /** A pain region key ("shoulder"), or "other:<words>" for a place the reader couldn't name. */
  key: string;
  label: string;
  /** Sides named across its reports (a midline place may have none). */
  sides: PainSide[];
  reports: number;
  /** Distinct days with a report. */
  days: number;
  first: string | null;
  last: string | null;
  /** The worst level reported (0–10), when any report had one. */
  worst: number | null;
  /** Earlier vs later reports' levels, with 3+ levelled reports; null when it can't be read. */
  trend: "better" | "same" | "worse" | null;
  /** "Nov 3: level 4 · "pinch on bench"", newest first. */
  evidence: string[];
};

type Place = { key: string; label: string; side: PainSide | null };

function side(s: string | undefined): PainSide | null {
  return s === "L" || s === "l" ? "L" : s === "R" || s === "r" ? "R" : null;
}

/** The places one report names. */
export function placesInReport(r: PainReportLite): Place[] {
  const out: Place[] = [];
  const add = (p: Place) => {
    if (!out.some((x) => x.key === p.key && x.side === p.side)) out.push(p);
  };
  // "Other" keeps a report with no place as somewhere else; "General" (the first review's
  // catch-all for feeling off) counts only when its note names a body part
  let other = false;
  let general = false;
  for (const token of (r.area ?? "").split(",")) {
    const t = token.trim();
    if (!t) continue;
    const m = /^(.+?)\s*\(([LRlr])\)$/.exec(t);
    const name = (m ? m[1] : t).trim();
    if (/^general$/i.test(name)) {
      general = true;
      continue;
    }
    if (/^other$/i.test(name)) {
      other = true;
      continue;
    }
    const region = regionFromName(name);
    if (region) {
      add({ key: region, label: regionOf(region)?.label ?? name, side: side(m?.[2]) ?? sideIn(name) });
      continue;
    }
    // words the chips never had ("Left tennis elbow"): read them like a note
    const named = regionsInText(name);
    if (named.length) for (const p of named) add({ key: p.region, label: regionOf(p.region)?.label ?? p.region, side: p.side });
    else add({ key: `other:${name.toLowerCase()}`, label: name, side: null });
  }
  if (other || general || !out.length) {
    const named = regionsInText(r.note);
    for (const p of named) add({ key: p.region, label: regionOf(p.region)?.label ?? p.region, side: p.side });
    if (!named.length && other) add({ key: "other", label: "Somewhere else", side: null });
  }
  return out;
}

function sideIn(name: string): PainSide | null {
  return /\bleft\b/i.test(name) ? "L" : /\bright\b/i.test(name) ? "R" : null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One line per place, the place with most reports first (then the most recent). */
export function consolidatePain(reports: PainReportLite[]): PainPlace[] {
  const by = new Map<string, { label: string; sides: Set<PainSide>; rows: PainReportLite[] }>();
  for (const r of reports) {
    for (const p of placesInReport(r)) {
      const g = by.get(p.key) ?? { label: p.label, sides: new Set<PainSide>(), rows: [] };
      if (p.side) g.sides.add(p.side);
      if (!g.rows.includes(r)) g.rows.push(r);
      by.set(p.key, g);
    }
  }
  const out: PainPlace[] = [];
  for (const [key, g] of by) {
    const rows = [...g.rows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    const dates = rows.map((r) => r.date).filter((d): d is string => !!d);
    const levels = rows.map((r) => r.level).filter((n): n is number => n != null && Number.isFinite(n));
    let trend: PainPlace["trend"] = null;
    if (levels.length >= 3) {
      const half = Math.floor(levels.length / 2);
      const early = mean(levels.slice(0, half));
      const late = mean(levels.slice(levels.length - half));
      trend = late - early >= 1 ? "worse" : early - late >= 1 ? "better" : "same";
    }
    out.push({
      key,
      label: g.label,
      sides: [...g.sides].sort(),
      reports: rows.length,
      days: new Set(dates).size || rows.length,
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
      worst: levels.length ? Math.max(...levels) : null,
      trend,
      evidence: [...rows].reverse().slice(0, 6).map((r) => `${r.date ?? "?"}: ${r.level != null ? `level ${r.level}` : "no level"}${r.note?.trim() ? ` · "${r.note.trim().slice(0, 80)}"` : ""}`),
    });
  }
  return out.sort((a, b) => b.reports - a.reports || String(b.last ?? "").localeCompare(String(a.last ?? "")));
}

/** "Left shoulder", "Both knees", "Low back", from the place and the sides named. */
export function painPlaceName(p: Pick<PainPlace, "key" | "label" | "sides">): string {
  const sided = regionOf(p.key)?.sided ?? false;
  if (!p.sides.length) return p.label;
  if (p.sides.length === 2) return sided ? `Both ${plural(p.label.toLowerCase())}` : `${p.label} (both sides)`;
  const word = p.sides[0] === "L" ? "Left" : "Right";
  return sided ? `${word} ${p.label.toLowerCase()}` : `${p.label} (${word.toLowerCase()} side)`;
}

function plural(s: string): string {
  if (s.includes("/")) return s;
  if (s.endsWith("f")) return `${s.slice(0, -1)}ves`;
  return s.endsWith("s") ? s : `${s}s`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-16" → "Oct 16" (with the year when asked); anything else as it came. */
function shortDate(d: string, year: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const s = `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
  return year ? `${s}, ${m[1]}` : s;
}

/** "3 reports · Oct 16 → Oct 23 · worst 6/10 · getting worse" */
export function painPlaceLine(p: PainPlace): string {
  const parts = [`${p.reports} report${p.reports === 1 ? "" : "s"}${p.days !== p.reports ? ` on ${p.days} day${p.days === 1 ? "" : "s"}` : ""}`];
  const crossYear = !!(p.first && p.last && p.first.slice(0, 4) !== p.last.slice(0, 4));
  if (p.first && p.last && p.first !== p.last) parts.push(`${shortDate(p.first, crossYear)} → ${shortDate(p.last, crossYear)}`);
  else if (p.last) parts.push(shortDate(p.last, false));
  if (p.worst != null) parts.push(`worst ${p.worst}/10`);
  if (p.trend === "worse") parts.push("getting worse");
  else if (p.trend === "better") parts.push("easing");
  return parts.join(" · ");
}

/** Worth the coach's look: reported on 2+ days, worse, or a 7+/10. */
export function painNeedsLook(p: PainPlace): boolean {
  return p.days >= 2 || p.trend === "worse" || (p.worst ?? 0) >= 7;
}
