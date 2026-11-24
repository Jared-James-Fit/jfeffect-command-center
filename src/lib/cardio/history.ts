/**
 * What each published cardio plan did (Nov 23 2026): for every version, the
 * weeks it was in force, how much of it was done, and what bodyweight did
 * meanwhile. It's how the coach and Cleo know what's already been tried and
 * how it went, from the records alone (never a model's memory). Pure, tested.
 */
export type VersionRow = {
  id: string;
  version_no: number;
  effective_date: string;
  published_at: string;
  weekly_minutes: number | null;
  weekly_sessions: number | null;
  change_lines: string[] | null;
  source: string | null;
  note: string | null;
};

export type CompletionLite = { completed_date: string; completed?: boolean | null; skipped?: boolean | null; duration_minutes?: number | null };
export type WeighInLite = { date: string; kg: number };

export type VersionOutcome = {
  id: string;
  versionNo: number;
  from: string;
  to: string | null;
  weeks: number;
  weeklyMinutes: number | null;
  /** Sessions done of those planned while it was in force (null when it was too short to tell). */
  donePct: number | null;
  doneMinutesPerWeek: number | null;
  /** Bodyweight change a week while in force, % (least squares; null with under 4 weigh-ins over 10 days). */
  bodyweightPctPerWeek: number | null;
  changes: string[];
  source: string | null;
  note: string | null;
};

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function slopePctPerWeek(points: WeighInLite[]): number | null {
  if (points.length < 4) return null;
  const sorted = points.slice().sort((a, b) => a.date.localeCompare(b.date));
  const span = daysBetween(sorted[0].date, sorted[sorted.length - 1].date);
  if (span < 10) return null;
  const xs = sorted.map((p) => daysBetween(sorted[0].date, p.date) / 7);
  const ys = sorted.map((p) => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (!den) return null;
  return Math.round(((num / den) / my) * 1000) / 10;
}

/** Each version's outcome, newest first. A version is in force from its effective date to the next one's. */
export function versionOutcomes(versions: VersionRow[], completions: CompletionLite[], weighIns: WeighInLite[], today: string): VersionOutcome[] {
  const sorted = versions.slice().sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.version_no - b.version_no);
  const out: VersionOutcome[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const next = sorted[i + 1];
    const from = v.effective_date;
    const end = next ? addDays(next.effective_date, -1) : today;
    if (end < from) {
      out.push({ id: v.id, versionNo: v.version_no, from, to: end, weeks: 0, weeklyMinutes: v.weekly_minutes, donePct: null, doneMinutesPerWeek: null, bodyweightPctPerWeek: null, changes: v.change_lines ?? [], source: v.source, note: v.note });
      continue;
    }
    const days = daysBetween(from, end) + 1;
    const weeks = Math.round((days / 7) * 10) / 10;
    const done = completions.filter((c) => c.completed_date >= from && c.completed_date <= end && c.completed !== false && !c.skipped);
    const planned = v.weekly_sessions != null ? v.weekly_sessions * (days / 7) : null;
    const donePct = planned && planned >= 2 && days >= 7 ? Math.min(100, Math.round((done.length / planned) * 100)) : null;
    const doneMinutes = done.reduce((a, c) => a + (Number(c.duration_minutes) || 0), 0);
    out.push({
      id: v.id,
      versionNo: v.version_no,
      from,
      to: next ? end : null,
      weeks,
      weeklyMinutes: v.weekly_minutes,
      donePct,
      doneMinutesPerWeek: days >= 7 ? Math.round(doneMinutes / (days / 7)) : null,
      bodyweightPctPerWeek: slopePctPerWeek(weighIns.filter((p) => p.date >= from && p.date <= end)),
      changes: v.change_lines ?? [],
      source: v.source,
      note: v.note,
    });
  }
  return out.reverse();
}

/** The outcomes as text for Cleo: what's been tried and how it went. */
export function outcomesText(outcomes: VersionOutcome[], limit = 6): string {
  if (!outcomes.length) return "No cardio plan has been published from the builder yet.";
  return outcomes
    .slice(0, limit)
    .map((o) => {
      const parts = [
        `v${o.versionNo} from ${o.from}${o.to ? ` to ${o.to}` : " (current)"}`,
        o.weeklyMinutes != null ? `${o.weeklyMinutes} min/week planned` : null,
        o.donePct != null ? `${o.donePct}% of sessions done` : null,
        o.bodyweightPctPerWeek != null ? `bodyweight ${o.bodyweightPctPerWeek > 0 ? "+" : ""}${o.bodyweightPctPerWeek}%/week` : null,
        o.changes.length ? `changed: ${o.changes.slice(0, 3).join("; ")}` : null,
        o.note ? `coach's reason: ${o.note}` : null,
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    })
    .join("\n");
}
