/**
 * Automatic research (pure, tested in competition-research.test.ts): who is
 * likely in the athlete's class at this meet, from OpenPowerlifting's public
 * rankings (the same data its site shows: each lifter's best total in a
 * federation, class and year), and what a public page someone links says.
 *
 * OpenPowerlifting is public-domain data. Its rankings endpoint
 * (/api/rankings/raw/<class>/<sex>/<federation>/<year>) is what the site
 * itself reads; it isn't a documented API, so a change on their side shows
 * as "couldn't read the rankings" and nothing is guessed. A rankings list is
 * who has competed, never a start list: everyone found here is a suggested
 * entrant the coach confirms or dismisses.
 */
import type { Lift } from "./types";

export const OPL_BASE = "https://www.openpowerlifting.org";

const IPF_MEN = ["53", "59", "66", "74", "83", "93", "105", "120", "120+"];
const IPF_WOMEN = ["43", "47", "52", "57", "63", "69", "76", "84", "84+"];

/** OpenPowerlifting's federation token for a meet's federation (Canada's IPF affiliate is CanPL from 2026). */
export function oplFederation(
  federation: string | null | undefined,
  meetDate: string,
): string | null {
  const f = String(federation ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!f) return null;
  if (f === "canpl" || f === "canadianpowerlifting" || f === "canadapowerlifting") return "canpl";
  if (f === "cpu" || f === "canadianpowerliftingunion")
    return meetDate >= "2026-01-01" ? "canpl" : "cpu";
  if (f === "ipf" || f === "internationalpowerliftingfederation") return "ipf";
  if (/^[a-z0-9]{2,20}$/.test(f)) return f;
  return null;
}

/** The IPF class as OpenPowerlifting names it ("ipf66", "ipf120+"); null outside the IPF classes. */
export function oplIpfClass(sex: "M" | "F" | null, weightClass: string | null): string | null {
  if (!sex || !weightClass) return null;
  const wc = String(weightClass)
    .replace(/\s*kg$/i, "")
    .replace(/^-/, "")
    .trim();
  const list = sex === "M" ? IPF_MEN : IPF_WOMEN;
  return list.includes(wc) ? `ipf${wc}` : null;
}

/** The next IPF class up and down from a class (for a class decision). */
export function adjacentIpfClasses(
  sex: "M" | "F",
  weightClass: string,
): { up: string | null; down: string | null } {
  const list = sex === "M" ? IPF_MEN : IPF_WOMEN;
  const i = list.indexOf(String(weightClass).replace(/\s*kg$/i, ""));
  if (i < 0) return { up: null, down: null };
  return { up: list[i + 1] ?? null, down: i > 1 ? list[i - 1] : null };
}

export function rankingsPath(input: {
  federation: string;
  ipfClass: string;
  sex: "M" | "F";
  year: number;
  count?: number;
}): string {
  const sex = input.sex === "M" ? "men" : "women";
  const end = Math.max(5, Math.min(100, input.count ?? 40)) - 1;
  return `/api/rankings/raw/${encodeURIComponent(input.ipfClass)}/${sex}/${input.federation}/${input.year}?start=0&end=${end}&lang=en&units=kg`;
}

export type RankingRow = {
  name: string;
  slug: string;
  instagram: string | null;
  country: string | null;
  state: string | null;
  federation: string | null;
  date: string;
  meetPath: string | null;
  sex: "M" | "F" | null;
  equipment: string | null;
  division: string | null;
  bodyweight: number | null;
  weightClass: string | null;
  squat: number | null;
  bench: number | null;
  deadlift: number | null;
  total: number | null;
};

const n = (x: unknown): number | null => {
  const v = typeof x === "number" ? x : parseFloat(String(x ?? ""));
  return Number.isFinite(v) && v > 0 ? v : null;
};
const s = (x: unknown): string | null => {
  const v = typeof x === "string" ? x.trim() : "";
  return v ? v : null;
};

/**
 * One rankings answer read: {total_length, rows: [[index, rank, name, slug,
 * instagram, colour, country, state, federation, date, meet country, meet
 * state, meet path, sex, equipment, age, division, bodyweight, class, squat,
 * bench, deadlift, total, points]]}. A row that doesn't read is skipped.
 */
export function parseRankings(json: unknown): RankingRow[] {
  const rows = (json as any)?.rows;
  if (!Array.isArray(rows)) return [];
  const out: RankingRow[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 23) continue;
    const name = s(r[2]);
    const slug = s(r[3]);
    const date = s(r[9]);
    if (
      !name ||
      !slug ||
      !/^[a-z0-9]{2,80}$/.test(slug) ||
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    )
      continue;
    const ig = s(r[4]);
    out.push({
      name,
      slug,
      instagram: ig && /^[A-Za-z0-9._]{1,30}$/.test(ig) ? ig : null,
      country: s(r[6]),
      state: s(r[7]),
      federation: s(r[8]),
      date,
      meetPath: s(r[12]),
      sex: r[13] === "M" || r[13] === "F" ? r[13] : null,
      equipment: s(r[14]),
      division: s(r[16]),
      bodyweight: n(r[17]),
      weightClass: s(r[18]),
      squat: n(r[19]),
      bench: n(r[20]),
      deadlift: n(r[21]),
      total: n(r[22]),
    });
  }
  return out;
}

const norm = (x: string) =>
  x
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/** Each lifter once (their best total across the lists), the athlete and dismissed lifters left out, strongest first. */
export function likelyField(
  lists: RankingRow[][],
  opts: {
    excludeSlugs?: string[];
    excludeNames?: string[];
    country?: string | null;
    limit?: number;
    /** a total this far under the strongest isn't in the race (default 0.85) */
    floorShare?: number;
  },
): RankingRow[] {
  const ex = new Set((opts.excludeSlugs ?? []).map((x) => x.toLowerCase()));
  const exNames = new Set((opts.excludeNames ?? []).map(norm));
  const best = new Map<string, RankingRow>();
  for (const list of lists)
    for (const r of list) {
      if (ex.has(r.slug) || exNames.has(norm(r.name))) continue;
      if (opts.country && r.country && r.country !== opts.country) continue;
      if (!(r.total && r.total > 0)) continue;
      const had = best.get(r.slug);
      if (!had || r.total > (had.total ?? 0) || (r.total === had.total && r.date > had.date))
        best.set(r.slug, r);
    }
  const sorted = [...best.values()].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const top = sorted[0]?.total ?? 0;
  const floor = top * (opts.floorShare ?? 0.85);
  return sorted.filter((r) => (r.total ?? 0) >= floor).slice(0, opts.limit ?? 10);
}

/** One line for the coach and the evidence: where a suggested entrant comes from. */
export function rankingNote(r: RankingRow): string {
  return `OpenPowerlifting rankings: ${r.total} kg (${r.squat ?? "–"}/${r.bench ?? "–"}/${r.deadlift ?? "–"}) at ${r.bodyweight ?? "?"} kg on ${r.date}${r.federation ? ` (${r.federation})` : ""}`;
}

/** A class's field in a few numbers (a class decision's evidence). */
export function classSummary(
  weightClass: string,
  rows: RankingRow[],
  ourExpected: number | null,
): {
  weightClass: string;
  lifters: Array<{ name: string; total: number; date: string }>;
  ourPlace: number | null;
} {
  const lifters = rows
    .filter((r) => r.total)
    .slice(0, 8)
    .map((r) => ({ name: r.name, total: r.total!, date: r.date }));
  return {
    weightClass,
    lifters,
    ourPlace: ourExpected != null ? 1 + lifters.filter((l) => l.total > ourExpected).length : null,
  };
}

/**
 * What the athlete would total in another class (pure): their own meets at
 * that class in the last three years (the median of the latest three), and
 * their expected here scaled to that class's bodyweight (the half power, the
 * same rule the competitor read uses, at most 10% either way). Both are said;
 * the estimate is their own record when there is one, else the scaled one.
 * Never a forecast for the class: a class decision's evidence.
 */
export function ourAtClass(input: {
  weightClass: string;
  meets: Array<{
    date: string;
    weightClass: string | null;
    total: number | null;
    event?: string | null;
  }>;
  today: string;
  expectedHere: number | null;
  limitHere: number | null;
}): { kg: number | null; own: number[]; ownSince: string | null; scaled: number | null } {
  const key = (c: string | null | undefined) =>
    String(c ?? "")
      .replace(/kg$/i, "")
      .trim();
  const want = key(input.weightClass);
  const threeYears = `${Number(input.today.slice(0, 4)) - 3}${input.today.slice(4)}`;
  const own = input.meets
    .filter(
      (m) =>
        (m.event ?? "SBD").toUpperCase() === "SBD" &&
        key(m.weightClass) === want &&
        (m.total ?? 0) > 0 &&
        m.date >= threeYears &&
        m.date <= input.today,
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const limitThere = Number(want.replace("+", ""));
  const scaled =
    input.expectedHere != null && input.limitHere && limitThere > 0
      ? Math.round(
          (input.expectedHere *
            Math.max(0.9, Math.min(1.1, Math.pow(limitThere / input.limitHere, 0.5)))) /
            2.5,
        ) * 2.5
      : null;
  const totals = own.map((m) => m.total!).sort((a, b) => a - b);
  const median = totals.length
    ? totals.length % 2
      ? totals[(totals.length - 1) / 2]
      : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
    : null;
  return {
    kg: median ?? scaled,
    own: own.map((m) => m.total!),
    ownSince: own.length ? own[own.length - 1].date : null,
    scaled,
  };
}

/* ------------------------------------------------------------------ */
/* A public page someone linked                                       */

/** A page's address the server may fetch: https on a public host, Google Sheets / Docs as their export. */
export function fetchableUrl(raw: string): { url: string; kind: "sheet" | "doc" | "page" } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return null;
  const sheet = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (host === "docs.google.com" && sheet) {
    const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1];
    return {
      url: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`,
      kind: "sheet",
    };
  }
  const doc = u.pathname.match(/^\/document\/d\/([A-Za-z0-9_-]+)/);
  if (host === "docs.google.com" && doc)
    return { url: `https://docs.google.com/document/d/${doc[1]}/export?format=txt`, kind: "doc" };
  return { url: u.toString(), kind: "page" };
}

/** A page's words with its tables kept readable (cells split by " | ", rows on their own lines). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|div|li|h[1-6]|section|article|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/* A meet's details read from a page                                  */

export type MeetInfo = {
  date: string | null;
  endDate: string | null;
  location: string | null;
  weighIn: string | null;
  liftingStart: string | null;
  registrationDeadline: string | null;
  qualifyingTotals: Array<{ weightClass: string; sex: "M" | "F" | null; totalKg: number }>;
  notes: string[];
};

export const MEET_INFO_SYSTEM = `You copy a powerlifting meet's details out of the text or document given. Copy only what's written: never guess, never fill a gap. Dates as YYYY-MM-DD, times as HH:MM (24-hour). Qualifying totals in kg exactly as written, with the class they're for.
Answer ONLY with JSON:
{"date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null", "location": "venue and city or null", "weigh_in": "HH:MM or null", "lifting_start": "HH:MM or null", "registration_deadline": "YYYY-MM-DD or null", "qualifying_totals": [{"weight_class": "66", "sex": "M|F|null", "total_kg": 600}], "notes": ["rules or schedule details worth knowing, copied (0-8)"]}`;

/** What the model copied, kept only where the source says it (a total or a time that isn't written is dropped). */
export function cleanMeetInfo(raw: unknown, source: string | null): MeetInfo {
  const j = (raw ?? {}) as any;
  const src = source ?? null;
  const has = (v: string) => !src || src.includes(v);
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const time = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const timeIn = (v: string | null) => {
    if (!v || !src) return v;
    const [h, m] = v.split(":").map(Number);
    const h12 = h % 12 || 12;
    return [
      v,
      `${h}:${String(m).padStart(2, "0")}`,
      `${h12}:${String(m).padStart(2, "0")}`,
      m === 0 ? `${h12}` : null,
    ].some((x) => x && src.includes(x))
      ? v
      : null;
  };
  const totals = (Array.isArray(j.qualifying_totals) ? j.qualifying_totals : [])
    .map((q: any) => ({
      weightClass: String(q?.weight_class ?? "")
        .trim()
        .slice(0, 12),
      sex: q?.sex === "M" || q?.sex === "F" ? q.sex : null,
      totalKg: Number(q?.total_kg),
    }))
    .filter(
      (q: any) =>
        q.weightClass &&
        Number.isFinite(q.totalKg) &&
        q.totalKg > 40 &&
        q.totalKg < 1500 &&
        has(String(q.totalKg).replace(/\.0$/, "")),
    )
    .slice(0, 40);
  return {
    date: date(j.date),
    endDate: date(j.end_date),
    location:
      typeof j.location === "string" && j.location.trim() ? j.location.trim().slice(0, 160) : null,
    weighIn: timeIn(time(j.weigh_in)),
    liftingStart: timeIn(time(j.lifting_start)),
    registrationDeadline: date(j.registration_deadline),
    qualifyingTotals: totals,
    notes: (Array.isArray(j.notes) ? j.notes : [])
      .filter((x: unknown) => typeof x === "string" && x.trim())
      .map((x: string) => x.trim().slice(0, 300))
      .slice(0, 8),
  };
}

/** Lifts in a rankings row, for a competitor's quick read. */
export function rowLifts(r: RankingRow): Record<Lift, number | null> {
  return { squat: r.squat, bench: r.bench, deadlift: r.deadlift };
}
