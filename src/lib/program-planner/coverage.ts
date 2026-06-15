/**
 * Compute the "Client Programming Coverage" summary used above the
 * calendar — programmed-through date, future weeks, gap detection.
 */
import type { PlannerCoverage, PlannerPlacement } from "./types";
import type { ExistingScheduledDay } from "./conflicts";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function parseISO(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function diffDays(aISO: string, bISO: string): number {
  return Math.round((parseISO(bISO).getTime() - parseISO(aISO).getTime()) / 86_400_000);
}
function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeCoverage(input: {
  existingDays: ExistingScheduledDay[];
  newPlacements?: PlannerPlacement[];
  /** ISO today; injectable for tests. */
  today?: string;
  /** How many forward days to scan for gaps. Default 12 weeks. */
  horizonDays?: number;
}): PlannerCoverage {
  const today = input.today ?? todayISO();
  const horizon = input.horizonDays ?? 84;

  const allDates = new Set<string>();
  let drafts = 0;
  let published = 0;
  let workoutsThisMonth = 0;
  const thisMonth = today.slice(0, 7);

  for (const d of input.existingDays) {
    if (!d.scheduled_date) continue;
    allDates.add(d.scheduled_date);
    if (d.scheduled_date.startsWith(thisMonth)) workoutsThisMonth++;
    // We don't have explicit draft/published flags here; callers can pass a
    // pre-filtered list if they want to separate. Default to published bucket.
    published++;
  }
  for (const p of input.newPlacements ?? []) {
    if (p.date) {
      allDates.add(p.date);
      if (p.date.startsWith(thisMonth)) workoutsThisMonth++;
      drafts++;
    }
  }

  let programmedThrough: string | null = null;
  for (const d of allDates) {
    if (!programmedThrough || d > programmedThrough) programmedThrough = d;
  }

  let futureWeeks = 0;
  if (programmedThrough && programmedThrough >= today) {
    futureWeeks = Math.max(0, Math.floor(diffDays(today, programmedThrough) / 7));
  }

  // Gap detection: scan from today forward up to `horizon` days. A gap is
  // a run of empty days *between* two scheduled days inside that window.
  const gaps: PlannerCoverage["gaps"] = [];
  if (allDates.size > 0) {
    let gapStart: string | null = null;
    let prevScheduled = false;
    for (let i = 0; i <= horizon; i++) {
      const iso = addDaysISO(today, i);
      const has = allDates.has(iso);
      if (!has) {
        if (prevScheduled && !gapStart) gapStart = iso;
      } else {
        if (gapStart) {
          const end = addDaysISO(iso, -1);
          const days = diffDays(gapStart, end) + 1;
          // Ignore short gaps — rest days within a normal weekly training
          // pattern (e.g. Wed/Sat/Sun off on a Mon/Tue/Thu/Fri split) are
          // intentional, not programming gaps. Only flag a full missed week.
          if (days >= 7) gaps.push({ start: gapStart, end, days });
          gapStart = null;
        }
        prevScheduled = true;
      }
    }
  }

  return {
    programmedThrough,
    futureWeeks,
    gaps,
    workoutsThisMonth,
    drafts,
    published,
  };
}