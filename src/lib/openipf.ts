/**
 * OpenIPF for the coach's athletes, the app's side (pure, tested in
 * openipf.test.ts). The database finds them and keeps their meets
 * (20270525090000_openipf_discovery.sql): once a month every coaching client
 * and alumni record with no profile is searched by name, a lifter whose name
 * matches is a suggestion the coach approves in Messages or on the client's
 * profile, a meet the daily sync adds to a profile it already read is news
 * with its records, and Remove / Add back put the link and its meets away and
 * back. These are the words and numbers the screens show.
 */

export const OPENIPF = "https://www.openipf.org";
export const OPENPOWERLIFTING = "https://www.openpowerlifting.org";

/** Letters folded the way names are written in English: the same table as public.openipf_fold. */
const FOLD_FROM = "áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñńçćčýÿšžłß";
const FOLD_TO = "aaaaaaaeeeeeiiiiiooooooouuuuunncccyyszls";

export function openipfFold(s: string | null | undefined): string {
  const lower = String(s ?? "").toLowerCase();
  let out = "";
  for (const ch of lower) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out;
}

/** What two names are compared by (public.openipf_name_key): letters only, a "#2" left off. */
export function nameKey(name: string | null | undefined): string {
  return openipfFold(String(name ?? "").replace(/\s*#\d+\s*$/, "")).replace(/[^a-z]/g, "");
}

/** A name as OpenPowerlifting shows it, without its "#2". */
export function plainLifterName(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s*#\d+\s*$/, "").trim();
}

/** A profile link's site and slug (public.powerlifting_opl_profile), or null when it isn't one. */
export function parseProfileUrl(url: string | null | undefined): { host: string; slug: string } | null {
  const u = String(url ?? "").trim();
  if (!/(openipf|openpowerlifting)\.org\/u\//i.test(u)) return null;
  const slug = /\/u\/([^/?#]+)/i.exec(u)?.[1]?.toLowerCase();
  if (!slug || !/^[a-z0-9]+$/.test(slug)) return null;
  return { host: /openipf\.org/i.test(u) ? OPENIPF : OPENPOWERLIFTING, slug };
}

export function profileUrl(host: string | null | undefined, slug: string | null | undefined): string | null {
  if (!slug) return null;
  return `${host === OPENPOWERLIFTING ? OPENPOWERLIFTING : OPENIPF}/u/${slug}`;
}

/** "OpenIPF" or "OpenPowerlifting", for the site a profile is on. */
export function siteName(host: string | null | undefined): string {
  return host === OPENPOWERLIFTING ? "OpenPowerlifting" : "OpenIPF";
}

export type OpenIpfSuggestion = {
  id: string;
  kind: "match" | "new_meet";
  client_id: string | null;
  athlete_id: string | null;
  subject_name: string;
  subject_sex: string | null;
  host: string | null;
  slug: string | null;
  lifter_name: string | null;
  sex: string | null;
  country: string | null;
  federation: string | null;
  equipment: string | null;
  division: string | null;
  bodyweight_kg: number | null;
  weight_class: string | null;
  squat_kg: number | null;
  bench_kg: number | null;
  deadlift_kg: number | null;
  total_kg: number | null;
  points: number | null;
  best_date: string | null;
  meet_count: number | null;
  first_meet: string | null;
  last_meet: string | null;
  last_meet_name: string | null;
  result_id: string | null;
  meet_name: string | null;
  meet_date: string | null;
  prs: string[] | null;
  confidence: "likely" | "possible" | null;
  reasons: string[] | null;
  status: "pending" | "approved" | "dismissed" | "seen" | "expired";
  created_at: string;
  decided_at: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A stored calendar date as people say it ("Nov 2, 2025"), never read as UTC midnight. */
export function meetDay(ymd: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** 137.5 → "137.5", 140 → "140". */
export function kg(n: number | null | undefined): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return String(Math.round(v * 10) / 10);
}

/** "580 kg total · 200 / 140 / 240", or what's there of it. */
export function liftsLine(s: Pick<OpenIpfSuggestion, "squat_kg" | "bench_kg" | "deadlift_kg" | "total_kg">): string | null {
  const parts = [kg(s.squat_kg), kg(s.bench_kg), kg(s.deadlift_kg)];
  const total = kg(s.total_kg);
  const sbd = parts.every(Boolean) ? parts.join(" / ") : null;
  if (total && sbd) return `${total} kg total · ${sbd}`;
  if (total) return `${total} kg total`;
  const bench = kg(s.bench_kg);
  return bench && !parts[0] && !parts[2] ? `${bench} kg bench` : null;
}

/** What we know about a lifter found by name: "2 meets · last Nov 2, 2025 · CPU · Canada". */
export function matchLine(s: OpenIpfSuggestion): string {
  const meets = s.meet_count ? `${s.meet_count} meet${s.meet_count === 1 ? "" : "s"}` : null;
  const last = meetDay(s.last_meet ?? s.best_date);
  return [meets, last ? `last ${last}` : null, s.federation, s.country].filter(Boolean).join(" · ");
}

const PR_WORD: Record<string, string> = { squat: "squat", bench: "bench", deadlift: "deadlift", total: "total" };

/** "Squat and total PRs", "Bench PR", or null with none. */
export function prLine(prs: string[] | null | undefined): string | null {
  const list = (prs ?? []).map((p) => PR_WORD[p]).filter(Boolean);
  if (!list.length) return null;
  const words = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `${words[0].toUpperCase()}${words.slice(1)} PR${list.length === 1 ? "" : "s"}`;
}

/** The Messages row's line for the newest thing waiting. */
export function inboxPreview(list: OpenIpfSuggestion[]): string {
  const waiting = list.filter((s) => s.status === "pending");
  if (!waiting.length) return "Nothing waiting";
  const s = waiting[0];
  if (s.kind === "new_meet") {
    const pr = prLine(s.prs);
    return `${s.subject_name}: new meet${s.meet_name ? `, ${s.meet_name}` : ""}${pr ? ` · ${pr}` : ""}`;
  }
  return `${s.subject_name} may be on ${siteName(s.host)}`;
}

/** Waiting first (new meets, then likely matches, then possible ones), each newest first. */
export function suggestionOrder(a: OpenIpfSuggestion, b: OpenIpfSuggestion): number {
  const rank = (s: OpenIpfSuggestion) =>
    s.status !== "pending" ? 9 : s.kind === "new_meet" ? (s.prs?.length ? 0 : 1) : s.confidence === "likely" ? 2 : 3;
  return rank(a) - rank(b) || String(b.created_at).localeCompare(String(a.created_at));
}

/** The Athlete setup row's words. */
export function openIpfSummary(s: { linked: boolean; meet_count: number; last_meet: string | null; pending: number } | null | undefined): string | null {
  if (!s) return null;
  if (s.linked) return `${s.meet_count} meet${s.meet_count === 1 ? "" : "s"}${s.last_meet ? ` · last ${meetDay(s.last_meet)}` : ""}`;
  if (s.pending) return "A possible match is waiting";
  return null;
}

/** What a decided suggestion says in Recent. */
export function decidedWord(s: OpenIpfSuggestion): string {
  if (s.kind === "new_meet") return "Seen";
  return s.status === "approved" ? "Added" : s.status === "dismissed" ? "Not them" : "Settled";
}

// ---------------------------------------------------------------- meet bests

export type MeetRow = {
  squat_kg: number | null;
  bench_kg: number | null;
  deadlift_kg: number | null;
  meet_date: string | null;
  meet_name: string | null;
};

export type CompLift = "squat" | "bench" | "deadlift";
export type MeetBest = { kg: number; date: string; meet: string | null };
export type MeetBests = Partial<Record<CompLift, MeetBest>>;

/** Meet bests older than this aren't offered as maxes: two years of training changes a lifter. */
export const MEET_BEST_MONTHS = 24;

/** Each lift's best single in competition in the last two years (all lifts, any source). */
export function meetBests(rows: MeetRow[], todayYmd: string): MeetBests {
  const cut = new Date(`${todayYmd}T12:00:00Z`);
  cut.setUTCMonth(cut.getUTCMonth() - MEET_BEST_MONTHS);
  const from = cut.toISOString().slice(0, 10);
  const out: MeetBests = {};
  for (const r of rows ?? []) {
    const date = String(r.meet_date ?? "").slice(0, 10);
    if (!date || date < from || date > todayYmd) continue;
    for (const [lift, v] of [["squat", r.squat_kg], ["bench", r.bench_kg], ["deadlift", r.deadlift_kg]] as const) {
      const n = Number(v);
      if (!(n > 0)) continue;
      const cur = out[lift];
      // the heavier lift wins; the same weight again keeps the later meet
      if (!cur || n > cur.kg || (n === cur.kg && date > cur.date)) out[lift] = { kg: n, date, meet: r.meet_name ?? null };
    }
  }
  return out;
}

/** The library names the maxes are kept under. */
export const MAX_LIFT_NAME: Record<CompLift, string> = {
  squat: "Competition Squat",
  bench: "Competition Bench Press",
  deadlift: "Competition Deadlift",
};

const LB_PER_KG = 2.2046226218;

export type ExistingMax = {
  id?: string;
  lift: string;
  one_rm: number | null;
  training_max: number | null;
  unit: "kg" | "lb";
  source: string;
  tested_at: string | null;
  block_id: string | null;
  active: boolean;
};

export type MaxWrite = {
  lift: string;
  unit: "kg" | "lb";
  one_rm: number;
  training_max: number | null;
  tested_at: string;
  /** what was there, for Undo (null: there was no row) */
  before: Pick<ExistingMax, "one_rm" | "training_max" | "unit" | "source" | "tested_at"> | null;
};

/** A weight in a unit, to the nearest 0.5. */
function inUnit(kgValue: number, unit: "kg" | "lb"): number {
  const v = unit === "lb" ? kgValue * LB_PER_KG : kgValue;
  return Math.round(v * 2) / 2;
}

/**
 * The maxes "Use as maxes" writes: each lift's 1RM is its meet best, in the
 * unit its row already uses (else the athlete's), a tested max dated on the
 * meet; the training max moves only when asked, at `trainingPct` of it. Only
 * the global rows (a block's own maxes are the program's), never a lift whose
 * 1RM already says the same.
 */
export function maxWritesFromBests(
  bests: MeetBests,
  existing: ExistingMax[],
  opts: { unit: "kg" | "lb"; trainingPct?: number | null },
): MaxWrite[] {
  const out: MaxWrite[] = [];
  for (const lift of ["squat", "bench", "deadlift"] as const) {
    const best = bests[lift];
    if (!best) continue;
    const name = MAX_LIFT_NAME[lift];
    const row = existing.find((m) => m.block_id == null && m.lift.toLowerCase() === name.toLowerCase()) ?? null;
    const unit = row?.unit ?? opts.unit;
    const oneRm = inUnit(best.kg, unit);
    const pct = opts.trainingPct && opts.trainingPct > 0 && opts.trainingPct <= 100 ? opts.trainingPct : null;
    // a training max lands on a weight they can load, rounded down (2.5 kg / 5 lb)
    const step = unit === "kg" ? 2.5 : 5;
    const tm = pct ? Math.floor((oneRm * pct) / 100 / step) * step : row?.training_max ?? null;
    if (row && Number(row.one_rm) === oneRm && (pct == null || Number(row.training_max) === tm)) continue;
    out.push({
      lift: name,
      unit,
      one_rm: oneRm,
      training_max: tm,
      tested_at: best.date,
      before: row ? { one_rm: row.one_rm, training_max: row.training_max, unit: row.unit, source: row.source, tested_at: row.tested_at } : null,
    });
  }
  return out;
}

/** "Squat 230 · Bench 150 · Deadlift 272.5 kg" (the meet bests in kg, as lifted). */
export function bestsLine(bests: MeetBests): string | null {
  const parts = (["squat", "bench", "deadlift"] as const)
    .filter((l) => bests[l])
    .map((l) => `${l[0].toUpperCase()}${l.slice(1)} ${kg(bests[l]!.kg)}`);
  return parts.length ? `${parts.join(" · ")} kg` : null;
}
