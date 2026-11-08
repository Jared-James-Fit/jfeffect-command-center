/**
 * Who the athlete is, as the records say: profile, goals, competition,
 * schedule, session length, equipment, injuries and pain, notes and check-ins,
 * recovery, the coach-confirmed memory, the previous program and the history
 * before it. Every field says where it came from; a field nothing on file can
 * answer is null and listed as missing, never guessed. Deterministic.
 */
import { cardioPlanFromTargets, type CardioPlan } from "./cardio";
import { daysBetween, localDate, mean, round } from "./core";
import type { EquipmentResolution } from "./equipment";
import { experienceLevel, setupNotes, type ExperienceLevel } from "./first-program";
import type { IntelRecords, IntelReport, RawPtSession, Unit } from "./types";

export type ProgramSummary = {
  blockIds: string[];
  label: string;
  start: string | null;
  end: string | null;
  weeks: number;
  plannedDaysPerWeek: number | null;
  trainedDaysPerWeek: number | null;
  trained: number;
  due: number;
  sessionAdherencePct: number | null;
  setAdherencePct: number | null;
  intent: string[];
};

export type AthleteContext = {
  name: string;
  unit: Unit;
  today: string;
  profile: {
    age: number | null;
    sex: string | null;
    heightCm: number | null;
    bodyweightKg: number | null;
    bodyweightDate: string | null;
    bodyweightChange4wKg: number | null;
    weightClass: string | null;
    experience: string | null;
    trainingSince: string | null;
    isPowerlifter: boolean;
    /** Their experience read as a level (Goals & Setup), or null when not on file. */
    level?: ExperienceLevel | null;
  };
  goals: { main: string | null; other: string | null; target: string | null; styles: string[]; clientGoals: string | null; bodyweightGoal: string | null; updatedAt: string | null; onFile: boolean; /** Goals & Setup's last answer (anything else they told you), when it says something. */ notes?: string | null; location?: string | null };
  competition: {
    next: { name: string; date: string; weeksOut: number; federation: string | null; weightClass: string | null; division: string | null } | null;
    history: Array<{ date: string | null; name: string | null; squat: number | null; bench: number | null; deadlift: number | null; total: number | null; bodyweight: number | null }>;
  };
  schedule: {
    committedDays: string[];
    committedFrequency: number | null;
    goalsDaysPerWeek: number | null;
    availableWeekdays: string[];
    preferredTime: string | null;
    notes: string | null;
    updatedAt: string | null;
    observedWeekdays: string[];
  };
  session: {
    goalsMinutes: number | null;
    observedMedian: number | null;
    observedP80: number | null;
    entries: number;
    /** The PT session they book (minutes, median), when 4+ are booked 8 weeks back to 4 ahead: the whole workout fits inside it. */
    ptMinutes?: number | null;
    ptBooked?: number;
  };
  /** Their cardio plan (the app adds its training-day session to every workout), or none. */
  cardio: CardioPlan;
  equipment: EquipmentResolution;
  injuries: { stated: string[]; painReports: Array<{ date: string | null; area: string | null; level: number | null; note: string | null }>; areas: string[] };
  notes: { coach: string[]; client: string[]; checkins: Array<{ date: string | null; form: string | null; answers: Array<{ q: string; a: string }> }> };
  recovery: { sessionRpeAvg: number | null; ratingAvg: number | null; fatigue: Record<string, number>; sleep: Record<string, number>; checkouts: number };
  memory: { established: Array<{ statement: string; category: string | null; date: string; kind: string; confidence: string }>; proposed: number; rejected: number };
  previous: ProgramSummary | null;
  history: { blocks: number; firstDate: string | null; programs: ProgramSummary[] };
  /** Nothing logged yet: the program is built from what they told you at setup. */
  firstProgram?: boolean;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * How long the PT session they book is: the median length of their booked
 * sessions (cancelled and rescheduled ones left out), once 4 or more are
 * booked; null when they don't train in booked sessions.
 */
export function bookedSessionLength(sessions: RawPtSession[] | null | undefined): { minutes: number | null; booked: number } {
  const mins = (sessions ?? [])
    .filter((x) => !/cancel|resched/i.test(x.status ?? ""))
    .map((x) => (x.starts_at && x.ends_at ? Math.round((Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 60_000) : null))
    .filter((n): n is number => n != null && Number.isFinite(n) && n >= 20 && n <= 180);
  return { minutes: mins.length >= 4 ? Math.round(median(mins) as number) : null, booked: mins.length };
}

/** One program's shape and how it went, from its own report. */
export function summarizeProgram(report: IntelReport, rec: IntelRecords, label: string): ProgramSummary {
  const weeks = report.weeks;
  const full = weeks.filter((w) => w.dueDays > 0 && w.dueDays === w.plannedDays);
  const planned = median(weeks.map((w) => w.plannedDays).filter((n) => n > 0));
  const trainedPerWeek = full.length ? round(mean(full.map((w) => w.completedDays + w.partialDays)) as number, 1) : null;
  const c = report.coverage;
  const intent: string[] = [];
  for (const b of rec.blocks) {
    const parts = [b.name, b.training_focus && `focus: ${b.training_focus}`, b.goal && `goal: ${b.goal}`, b.coach_notes && `coach notes: ${b.coach_notes}`].filter(Boolean);
    if (parts.length) intent.push(parts.join(" · "));
  }
  for (const n of rec.roadmapNotes.filter((x) => !x.hidden && !x.week_id)) {
    const t = [n.coach_label ?? n.ai_label, n.coach_summary].filter(Boolean).join(": ");
    if (t) intent.push(`Roadmap: ${t}`);
  }
  for (const w of rec.weeks.filter((x) => x.phase || x.notes)) intent.push(`Week ${w.week_index}: ${[w.phase, w.notes].filter(Boolean).join(" · ")}`);
  return {
    blockIds: rec.blocks.map((b) => b.id),
    label,
    start: c.firstDate ?? rec.blocks.map((b) => b.start_date).filter(Boolean).sort()[0] ?? null,
    end: c.lastDate ?? rec.blocks.map((b) => b.end_date).filter(Boolean).sort().slice(-1)[0] ?? null,
    weeks: weeks.length,
    plannedDaysPerWeek: planned,
    trainedDaysPerWeek: trainedPerWeek,
    trained: c.completedDays + c.partialDays,
    due: c.dueDays,
    sessionAdherencePct: c.dueDays ? Math.round(((c.completedDays + c.partialDays) / c.dueDays) * 100) : null,
    setAdherencePct: c.prescribedSetsDue ? Math.round((c.completedSets / c.prescribedSetsDue) * 100) : null,
    intent: [...new Set(intent)].slice(0, 20),
  };
}

export function buildAthleteContext(x: {
  rec: IntelRecords;
  history: IntelReport;
  prevRec: IntelRecords | null;
  prev: IntelReport | null;
  prevLabel: string;
  programs: Array<{ report: IntelReport; rec: IntelRecords; label: string }>;
  equipment: EquipmentResolution;
}): AthleteContext {
  const { rec } = x;
  const today = rec.today;
  const unit: Unit = rec.client.preferred_weight_unit === "kg" ? "kg" : "lb";
  const dob = rec.client.date_of_birth;
  const age = dob ? Math.floor(daysBetween(dob.slice(0, 10), today) / 365.25) : null;
  const bw = [...rec.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  const lastBw = bw[bw.length - 1] ?? null;
  const fourWeeksBefore = lastBw ? bw.filter((b) => daysBetween(b.date, lastBw.date) >= 21 && daysBetween(b.date, lastBw.date) <= 42).slice(-1)[0] : null;
  const nextMeet = rec.preps
    .filter((p) => p.event_date && p.event_date >= today && p.status !== "Archived" && p.status !== "archived")
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0];
  const firstDate = x.history.coverage.firstDate ?? rec.blocks.map((b) => b.start_date).filter(Boolean).sort()[0] ?? null;
  const g = rec.goals;

  // When they actually train: weekdays of the previous program's trained workouts.
  const tz = rec.client.timezone;
  const dayCounts = new Map<string, number>();
  const trainedDays = (x.prev ?? x.history).days.filter((d) => d.status === "completed" || d.status === "partial");
  for (const d of trainedDays) {
    if (!d.date) continue;
    const wd = WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
    dayCounts.set(wd, (dayCounts.get(wd) ?? 0) + 1);
  }
  const observedWeekdays = [...dayCounts.entries()].filter(([, n]) => n >= Math.max(2, trainedDays.length * 0.12)).sort((a, b) => WEEKDAYS.indexOf(a[0]) - WEEKDAYS.indexOf(b[0])).map(([d]) => d);
  void tz;

  const durations = trainedDays.map((d) => d.durationMin).filter((n): n is number => n != null && n >= 10 && n <= 240);
  const booked = bookedSessionLength(rec.ptSessions);
  const stated = [g?.injuries_has ? g.injuries_details || "Injury noted in Goals & Setup (no details)" : null, rec.client.injuries, rec.client.intake_injuries].filter((s): s is string => !!s?.trim()).map((s) => s.trim());
  const pain = x.history.recovery.painReports.filter((p) => !p.date || !firstDate || p.date >= (x.prev?.coverage.firstDate ?? firstDate) || daysBetween(p.date, today) <= 120);
  const areas = [...new Set(pain.map((p) => (p.area ?? "").toLowerCase().trim()).filter(Boolean))];

  const clientNotes: string[] = [];
  for (const d of (x.prev ?? x.history).days) {
    if (d.clientNotes) clientNotes.push(`${d.date ?? "?"} ${d.title}: "${d.clientNotes}"`);
    if (d.feedback?.client_note) clientNotes.push(`${d.date ?? "?"} check-out: "${d.feedback.client_note}"`);
    for (const r of d.rows) for (const n of r.clientNotes) clientNotes.push(`${d.date ?? "?"} ${r.exercise}: "${n}"`);
    for (const r of d.rows) for (const s of r.actual) if (s.notes) clientNotes.push(`${d.date ?? "?"} ${r.exercise} set ${s.setIndex}: "${s.notes}"`);
  }
  const coachNotes: string[] = [];
  for (const [k, v] of [["Coach notes", rec.client.coach_notes], ["Training notes", rec.client.training_notes], ["Lifestyle", rec.client.lifestyle_notes], ["Schedule notes", rec.client.schedule_notes], ["Goals & Setup notes", g?.final_notes]] as const) if (v?.trim()) coachNotes.push(`${k}: ${v.trim()}`);
  for (const n of rec.fileNotes) coachNotes.push(`File note${n.pinned ? " (pinned)" : ""} ${n.created_at?.slice(0, 10) ?? ""}: ${[n.title, n.body].filter(Boolean).join(": ")}`);
  for (const p of rec.preps) if (p.coach_notes?.trim()) coachNotes.push(`Prep "${p.title ?? p.event_name ?? "program"}": ${p.coach_notes.trim()}`);

  const established = rec.observations
    .filter((o) => o.status === "approved" || o.status === "corrected")
    .map((o) => ({ statement: o.corrected_statement ?? o.statement, category: o.category, date: o.created_at.slice(0, 10), kind: o.kind, confidence: o.confidence }));

  const fb = (x.prev ?? x.history).days.filter((d) => d.feedback).length;
  return {
    name: rec.client.full_name?.trim() || "Athlete",
    unit,
    today,
    profile: {
      age: age != null && age > 5 && age < 100 ? age : null,
      sex: rec.client.sex ?? null,
      heightCm: rec.client.height_cm ?? null,
      bodyweightKg: lastBw ? round(lastBw.kg, 1) : null,
      bodyweightDate: lastBw?.date ?? null,
      bodyweightChange4wKg: lastBw && fourWeeksBefore ? round(lastBw.kg - fourWeeksBefore.kg, 1) : null,
      weightClass: nextMeet?.weight_class ?? rec.preps.find((p) => p.weight_class)?.weight_class ?? rec.meets.find((m) => m.weight_class_kg)?.weight_class_kg ?? null,
      experience: g?.training_experience ?? rec.client.intake_training_experience ?? null,
      trainingSince: firstDate,
      isPowerlifter: !!rec.client.is_powerlifter,
      level: experienceLevel(g?.training_experience ?? rec.client.intake_training_experience ?? null),
    },
    goals: {
      main: g?.main_goal ?? null,
      other: g?.main_goal_other ?? null,
      target: g?.goal_target ?? null,
      styles: g?.training_styles ?? [],
      clientGoals: rec.client.goals ?? null,
      bodyweightGoal: rec.client.bodyweight_goal_type ? `${rec.client.bodyweight_goal_type}${rec.client.bodyweight_goal_value ? ` ${rec.client.bodyweight_goal_value}${rec.client.bodyweight_goal_unit ?? ""}` : ""}` : null,
      updatedAt: g?.updated_at ?? g?.completed_at ?? null,
      onFile: !!g,
      notes: setupNotes(g?.final_notes),
      location: g?.training_location ?? null,
    },
    competition: {
      next: nextMeet?.event_date
        ? { name: nextMeet.event_name ?? nextMeet.title ?? "Meet", date: nextMeet.event_date, weeksOut: Math.round(daysBetween(today, nextMeet.event_date) / 7), federation: nextMeet.federation, weightClass: nextMeet.weight_class, division: nextMeet.division }
        : null,
      history: rec.meets.map((m) => ({ date: m.meet_date, name: m.meet_name, squat: m.squat_kg, bench: m.bench_kg, deadlift: m.deadlift_kg, total: m.total_kg, bodyweight: m.bodyweight_kg })),
    },
    schedule: {
      committedDays: rec.client.committed_training_days ?? [],
      committedFrequency: rec.client.committed_training_frequency ?? null,
      goalsDaysPerWeek: g?.training_days_per_week ?? null,
      availableWeekdays: g?.available_weekdays ?? rec.client.available_training_days ?? [],
      preferredTime: rec.client.preferred_training_time ?? null,
      notes: rec.client.schedule_notes ?? null,
      updatedAt: rec.client.schedule_updated_at ?? null,
      observedWeekdays,
    },
    session: {
      goalsMinutes: g?.workout_length_minutes ?? null,
      observedMedian: median(durations),
      observedP80: quantile(durations, 0.8),
      entries: durations.length,
      ptMinutes: booked.minutes,
      ptBooked: booked.booked,
    },
    cardio: cardioPlanFromTargets(x.rec.cardioTargets ?? [], x.rec.cardioCompletions ?? [], x.rec.today),
    equipment: x.equipment,
    injuries: { stated, painReports: pain, areas },
    notes: {
      coach: coachNotes,
      client: clientNotes,
      checkins: (rec.checkins ?? []).map((c) => ({ date: c.submitted_at ? localDate(c.submitted_at, rec.client.timezone) : null, form: c.form, answers: c.answers })),
    },
    recovery: { ...(x.prev ?? x.history).recovery, checkouts: fb },
    memory: {
      established,
      proposed: rec.observations.filter((o) => o.status === "proposed").length,
      rejected: rec.observations.filter((o) => o.status === "rejected").length,
    },
    previous: x.prev && x.prevRec ? summarizeProgram(x.prev, x.prevRec, x.prevLabel) : null,
    history: { blocks: x.history.blocks.length, firstDate, programs: x.programs.map((p) => summarizeProgram(p.report, p.rec, p.label)) },
    firstProgram: x.history.coverage.loggedSets === 0,
  };
}
