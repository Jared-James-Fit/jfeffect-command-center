/**
 * OpenPowerlifting, read the way the athletes' own careers already are
 * (20261029090000_powerlifting_careers_opl_sync.sql reads the same CSV in SQL):
 * a lifter's page `/u/<slug>` and its CSV at `/api/liftercsv/<slug>`, every
 * meet with its attempts, a missed attempt stored as a negative number. Pure
 * (tested in competition-opl.test.ts): the worker fetches, this reads.
 *
 * Identity is never assumed from a name: a slug picked from a name is only a
 * candidate until its meets agree with what we know about the competitor (sex,
 * federation, weight class, country), and two plausible lifters stay
 * "ambiguous" for the coach to pick.
 */
import type { AttemptTriple, MeetRecord } from "./types";

/** One object per data line, keyed by the header. Quoted fields and doubled quotes handled. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const num = (v: string | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pos = (v: string | undefined): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const triple = (r: Record<string, string>, lift: "Squat" | "Bench" | "Deadlift"): AttemptTriple => [
  num(r[`${lift}1Kg`]),
  num(r[`${lift}2Kg`]),
  num(r[`${lift}3Kg`]),
];

/** A lifter CSV → meets, newest first, one per meet and event (Open division first, like the SQL sync). */
export function meetsFromOplCsv(text: string): MeetRecord[] {
  const recs = parseCsv(text).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.Date ?? ""));
  const picked = new Map<string, Record<string, string>>();
  for (const r of recs) {
    const key = `${r.Date}|${(r.MeetName ?? "").toLowerCase()}|${(r.Event ?? "SBD").toUpperCase()}`;
    const had = picked.get(key);
    const better = (x: Record<string, string>) =>
      [(x.Division ?? "").toLowerCase() === "open" ? 1 : 0, num(x.TotalKg) ?? 0] as const;
    if (!had) picked.set(key, r);
    else {
      const [ao, at] = better(r);
      const [bo, bt] = better(had);
      if (ao > bo || (ao === bo && at > bt)) picked.set(key, r);
    }
  }
  return [...picked.values()]
    .map((r): MeetRecord => {
      const attempts = { s: triple(r, "Squat"), b: triple(r, "Bench"), d: triple(r, "Deadlift") };
      const any = [...attempts.s, ...attempts.b, ...attempts.d].some((x) => x != null);
      return {
        date: r.Date,
        name: r.MeetName || null,
        federation: r.Federation || null,
        equipment: r.Equipment || null,
        event: (r.Event || "SBD").toUpperCase(),
        division: r.Division || null,
        weightClass: r.WeightClassKg || null,
        bodyweight: pos(r.BodyweightKg),
        squat: pos(r.Best3SquatKg),
        bench: pos(r.Best3BenchKg),
        deadlift: pos(r.Best3DeadliftKg),
        total: pos(r.TotalKg),
        place: r.Place || null,
        attempts: any ? attempts : null,
        tested: r.Tested ? /^yes$/i.test(r.Tested) : null,
        country: r.Country || r.MeetCountry || null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The lifter's sex from their meets ("M" / "F"), when the CSV says. */
export function sexFromOplCsv(text: string): "M" | "F" | null {
  const r = parseCsv(text).find((x) => /^[MF]$/i.test(x.Sex ?? ""));
  return r ? (r.Sex.toUpperCase() as "M" | "F") : null;
}

/** 'https://www.openpowerlifting.org/u/janedoe1' → 'janedoe1' (also openipf.org). */
export function slugFromUrl(url: string | null | undefined): string | null {
  const m = String(url ?? "").match(/open(?:powerlifting|ipf)\.org\/u\/([a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** OpenPowerlifting's username for a name: letters and digits, lowercased, accents dropped. */
export function slugFromName(name: string): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Usernames to try for a name: the plain one, then the numbered ones OPL gives namesakes. */
export function slugCandidates(name: string, max = 4): string[] {
  const base = slugFromName(name);
  if (base.length < 3) return [];
  return [base, ...Array.from({ length: max }, (_, i) => `${base}${i + 1}`)];
}

export type IdentityHints = {
  sex?: "M" | "F" | null;
  federation?: string | null;
  weightClass?: string | null;
  country?: string | null;
};

/**
 * How well a candidate's history fits what we know about the competitor (0 to
 * 1), and why. Sex that disagrees rules a candidate out; federation, class and
 * country each add evidence. A candidate with no meets in the last 4 years
 * counts for less (it's probably someone else, or retired).
 */
export function identityFit(
  meets: MeetRecord[],
  sex: "M" | "F" | null,
  hints: IdentityHints,
  today: string,
): { score: number; why: string[] } {
  const why: string[] = [];
  if (!meets.length) return { score: 0, why: ["No meets"] };
  if (hints.sex && sex && hints.sex !== sex) return { score: 0, why: ["Different sex"] };
  let score = 0.35;
  const recent = meets.filter((m) => m.date >= `${Number(today.slice(0, 4)) - 4}${today.slice(4)}`);
  if (recent.length) {
    score += 0.15;
    why.push(`${recent.length} meet${recent.length === 1 ? "" : "s"} in the last 4 years`);
  } else why.push("No meets in the last 4 years");
  const fed = String(hints.federation ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (
    fed &&
    meets.some(
      (m) =>
        String(m.federation ?? "")
          .toLowerCase()
          .replace(/[^a-z]/g, "") === fed,
    )
  ) {
    score += 0.2;
    why.push(`Competes in ${hints.federation}`);
  }
  const cls = String(hints.weightClass ?? "").replace(/[^0-9+]/g, "");
  if (
    cls &&
    meets.slice(0, 3).some((m) => String(m.weightClass ?? "").replace(/[^0-9+]/g, "") === cls)
  ) {
    score += 0.2;
    why.push(`Recently in the ${hints.weightClass} class`);
  }
  if (
    hints.country &&
    meets.some((m) => String(m.country ?? "").toLowerCase() === String(hints.country).toLowerCase())
  ) {
    score += 0.1;
    why.push(`From ${hints.country}`);
  }
  return { score: Math.min(1, Math.round(score * 100) / 100), why };
}

/**
 * Of the candidates found, the one to link: the best fit when it's clearly
 * ahead (0.2 over the next) and good enough (0.55), else ambiguous with the
 * contenders listed; none found is not_found.
 */
export function resolveIdentity(
  candidates: Array<{ slug: string; score: number; why: string[]; meets: number }>,
): {
  status: "matched" | "ambiguous" | "not_found";
  slug: string | null;
  contenders: typeof candidates;
} {
  const ranked = candidates.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: "not_found", slug: null, contenders: [] };
  const [a, b] = ranked;
  if (a.score >= 0.55 && (!b || a.score - b.score >= 0.2))
    return { status: "matched", slug: a.slug, contenders: ranked.slice(0, 4) };
  return { status: "ambiguous", slug: null, contenders: ranked.slice(0, 4) };
}
