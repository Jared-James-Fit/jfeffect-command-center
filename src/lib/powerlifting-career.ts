/**
 * Powerlifting careers: one athlete's meets (synced from OpenPowerlifting by
 * 20261029090000_powerlifting_careers_opl_sync.sql) and what to say about
 * them: the level of each meet, the athlete's badges, their bests and records,
 * and which meets JF Effect coached.
 */

export type MeetLevel = "international" | "national" | "regional" | "provincial" | "local";

/** Highest first. Text always names the level, the colour only backs it up. */
export const LEVELS: Record<MeetLevel, { label: string; rank: number; tone: string }> = {
  international: { label: "International", rank: 5, tone: "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  national: { label: "National", rank: 4, tone: "border-amber-500/50 bg-amber-400/15 text-amber-700 dark:text-amber-300" },
  regional: { label: "Regional", rank: 3, tone: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  provincial: { label: "Provincial", rank: 2, tone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  local: { label: "Local", rank: 1, tone: "border-border bg-muted text-muted-foreground" },
};

export type Attempts = { s: (number | null)[]; b: (number | null)[]; d: (number | null)[] };

export type CareerMeet = {
  id: string;
  date: string;
  meet_name: string;
  town: string | null;
  location: string | null;
  federation: string | null;
  level: MeetLevel;
  place: string | null;
  division: string | null;
  equipment: string | null;
  event: string;
  weight_class: string | null;
  bw_kg: number | null;
  squat_kg: number | null;
  bench_kg: number | null;
  deadlift_kg: number | null;
  total_kg: number | null;
  gl: number | null;
  dots: number | null;
  attempts: Attempts | null;
  entered_name: string | null;
  coached: boolean;
};

export type Career = {
  athlete: {
    athlete_id: string;
    client_id: string | null;
    display_name: string;
    athlete_name: string;
    avatar_url: string | null;
    sex: string | null;
    is_alumni: boolean;
    is_me: boolean;
    opl_url: string | null;
    synced_at: string | null;
    periods: { start: string | null; end: string | null }[];
    country_filter: string | null;
  };
  meets: CareerMeet[];
};

const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const isLevel = (v: unknown): v is MeetLevel => typeof v === "string" && v in LEVELS;

export function normalizeCareer(raw: any): Career | null {
  if (!raw?.athlete) return null;
  return {
    athlete: { ...raw.athlete, periods: raw.athlete.periods ?? [] },
    meets: ((raw.meets ?? []) as any[]).map((m) => ({
      ...m,
      level: isLevel(m.level) ? m.level : "local",
      bw_kg: num(m.bw_kg),
      squat_kg: num(m.squat_kg),
      bench_kg: num(m.bench_kg),
      deadlift_kg: num(m.deadlift_kg),
      total_kg: num(m.total_kg),
      gl: num(m.gl),
      dots: num(m.dots),
      coached: !!m.coached,
      attempts: m.attempts ?? null,
      event: m.event ?? "SBD",
    })),
  };
}

/** "1" → 1; "DQ" / "G" / null → null. */
export function placeNum(place: string | null | undefined): number | null {
  return place && /^\d+$/.test(place) ? Number(place) : null;
}

const ORD = ["th", "st", "nd", "rd"];
export function placeLabel(place: string | null | undefined): string | null {
  if (!place) return null;
  const n = placeNum(place);
  if (n == null) return place.toUpperCase() === "DQ" || place.toUpperCase() === "DD" ? "DQ" : place.toUpperCase() === "G" ? "Guest" : place;
  const v = n % 100;
  return `${n}${ORD[(v - 20) % 10] ?? ORD[v] ?? ORD[0]}`;
}

export const isDq = (m: Pick<CareerMeet, "place">) => ["DQ", "DD"].includes((m.place ?? "").toUpperCase());

/** "International lifter": the highest level they've competed at. */
export function competitorTier(meets: CareerMeet[]): { level: MeetLevel; title: string } | null {
  if (!meets.length) return null;
  const level = meets.reduce<MeetLevel>((best, m) => (LEVELS[m.level].rank > LEVELS[best].rank ? m.level : best), "local");
  return { level, title: `${LEVELS[level].label} lifter` };
}

export type Honour = { level: MeetLevel; place: number; title: string; count: number };

/**
 * Podium finishes worth a badge: the best finish at each level from provincial
 * up ("National champion", "Regional medalist ×2"), highest level first.
 */
export function honours(meets: CareerMeet[], max = 2): Honour[] {
  const out: Honour[] = [];
  for (const level of ["international", "national", "regional", "provincial"] as MeetLevel[]) {
    const podiums = meets.filter((m) => m.level === level).map((m) => placeNum(m.place)).filter((p): p is number => p != null && p <= 3);
    if (!podiums.length) continue;
    const best = Math.min(...podiums);
    const count = podiums.filter((p) => p === best).length;
    out.push({ level, place: best, count, title: `${LEVELS[level].label} ${best === 1 ? "champion" : "medalist"}` });
  }
  return out.slice(0, max);
}

export type Best = { kg: number; meet: CareerMeet };

/** Best judged squat, bench, deadlift, total and GL points (a DQ'd meet's lifts don't count). */
export function careerBests(meets: CareerMeet[]) {
  const ok = meets.filter((m) => !isDq(m));
  const best = (pick: (m: CareerMeet) => number | null): Best | null =>
    ok.reduce<Best | null>((b, m) => {
      const kg = pick(m);
      return kg != null && kg > 0 && (!b || kg > b.kg) ? { kg, meet: m } : b;
    }, null);
  return {
    squat: best((m) => m.squat_kg),
    bench: best((m) => m.bench_kg),
    deadlift: best((m) => m.deadlift_kg),
    total: best((m) => (m.event === "SBD" ? m.total_kg : null)),
    gl: best((m) => (m.event === "SBD" ? m.gl : null)),
  };
}

/** Meets where the total beat every earlier full-power total (a record at the time). */
export function totalRecords(meets: CareerMeet[]): Set<string> {
  const ids = new Set<string>();
  let best = 0;
  for (const m of [...meets].sort((a, b) => a.date.localeCompare(b.date))) {
    if (m.event !== "SBD" || isDq(m) || !m.total_kg) continue;
    if (m.total_kg > best) {
      if (best > 0) ids.add(m.id);
      best = m.total_kg;
    }
  }
  return ids;
}

/** Attempts made out of taken; null when the meet has no attempt data. */
export function attemptsMade(m: Pick<CareerMeet, "attempts">): { made: number; taken: number } | null {
  if (!m.attempts) return null;
  const all = [...(m.attempts.s ?? []), ...(m.attempts.b ?? []), ...(m.attempts.d ?? [])].filter((v): v is number => v != null && v !== 0);
  if (!all.length) return null;
  return { made: all.filter((v) => v > 0).length, taken: all.length };
}

/** Meets grouped by year, newest first. */
export function byYear(meets: CareerMeet[]): [string, CareerMeet[]][] {
  const map = new Map<string, CareerMeet[]>();
  for (const m of [...meets].sort((a, b) => b.date.localeCompare(a.date))) {
    const y = m.date.slice(0, 4);
    map.set(y, [...(map.get(y) ?? []), m]);
  }
  return [...map.entries()];
}

/** "2022–now" / "2023–2024", from the coaching periods. */
export function coachedSpan(c: Career): string | null {
  const ps = c.athlete.periods;
  if (!ps.length) return null;
  const y = (d: string | null) => (d ? d.slice(0, 4) : null);
  const starts = ps.map((p) => y(p.start));
  const ends = ps.map((p) => y(p.end));
  const first = starts.includes(null) ? y(c.meets.filter((m) => m.coached).at(-1)?.date ?? null) : starts.sort()[0];
  const last = ends.includes(null) ? "now" : ends.sort().at(-1)!;
  return first ? (first === last ? first : `${first}–${last}`) : `until ${last}`;
}
