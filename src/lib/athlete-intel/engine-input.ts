/**
 * What the competition engines take from Athlete Intelligence (pure, tested):
 * the facts that are current become what loadCompetitionContext already reads
 * (completed competition-standard sets for the strength line, meets as
 * lifted, a recent bodyweight, current pain, technical cues), what the
 * gameplan draft reads (their coach's attempts and warm-ups, rack heights,
 * gear, cues, their coach's instructions), the lines the missing-information
 * card lists as retrieved, and numbered evidence Cleo can cite.
 *
 * Only completed sets ever count toward strength: a prescribed or unknown one
 * never does. Loads are kilograms; the strength line reads pounds, so the
 * conversion is done here once.
 */
import { estimate1RMWithRpe } from "@/lib/analytics/e1rm";
import { liftForPlace } from "@/lib/competition/watch";
import type {
  AttemptPlanData,
  EquipmentData,
  Fact,
  Lift,
  MeetData,
  Provider,
  RiskData,
  TrainingData,
  WarmupData,
} from "./types";
import { PROVIDER_LABEL } from "./types";

const LB_PER_KG = 2.2046226218;
const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A completed set that can show strength: the competition lift to standard, a weight, a date, ≤ 12 reps. */
export function strengthSet(f: Fact): boolean {
  if (f.kind !== "training" || !f.lift || !f.date) return false;
  const t = f.data as TrainingData;
  return t.completion === "completed" && t.standard === "competition" && t.loadKg != null && t.loadKg > 0 && t.reps >= 1 && t.reps <= 12;
}

/** The estimated max (kg) a set implies, its effort counted when it says. */
export function setE1rm(t: Pick<TrainingData, "loadKg" | "reps" | "rpe" | "rir">): number | null {
  if (t.loadKg == null || !(t.loadKg > 0)) return null;
  const rpe = t.rpe ?? (t.rir != null ? 10 - t.rir : null);
  return Math.round(estimate1RMWithRpe(t.loadKg, t.reps, rpe) * 10) / 10;
}

/** The uploaded sets shaped like loadCompetitionContext's own (lb), minus any already logged in the app. */
export function strengthRows(facts: Fact[], appSets: any[] = []): any[] {
  const out: any[] = [];
  const logged = (day: string, lift: Lift, kg: number, reps: number) =>
    appSets.some((s) => {
      const t = String(s.competition_lift_type ?? "").toLowerCase();
      const l = t.includes("squat") ? "squat" : t.includes("bench") ? "bench" : t.includes("dead") ? "deadlift" : null;
      return l === lift && String(s.date).slice(0, 10) === day && Math.abs(Number(s.load) / LB_PER_KG - kg) <= 1.2 && Number(s.reps) === reps;
    });
  for (const f of facts) {
    if (!strengthSet(f)) continue;
    const t = f.data as TrainingData;
    if (logged(f.date!, f.lift!, t.loadKg!, t.reps)) continue;
    const lb = t.loadKg! * LB_PER_KG;
    out.push({
      id: `intel:${f.id}`,
      row_id: `intel:${f.source_id ?? f.id}:${f.date}`,
      set_index: 1,
      date: `${f.date}T12:00:00Z`,
      load: lb,
      reps: t.reps,
      rpe: t.rpe,
      rir: t.rir,
      velocity_mps: null,
      counts_load: true,
      est_1rm: lb * (1 + t.reps / 30),
      is_competition_lift: true,
      competition_lift_type: f.lift,
      intel: true,
    });
  }
  return out;
}

/** Uploaded meets as athlete_powerlifting_results rows, minus any already on their record within two days. */
export function meetRows(facts: Fact[], existing: Array<{ meet_date: string }> = []): any[] {
  const out: any[] = [];
  const near = (d: string) =>
    existing.some((m) => Math.abs((Date.parse(`${String(m.meet_date).slice(0, 10)}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86_400_000) <= 2);
  for (const f of facts) {
    if (f.kind !== "meet" || !f.date || near(f.date)) continue;
    const m = f.data as MeetData;
    if (!(m.squat && m.bench && m.deadlift)) continue;
    out.push({
      meet_date: f.date,
      meet_name: m.name,
      federation: m.federation,
      equipment: "Raw",
      event: "SBD",
      division: null,
      weight_class_kg: m.weightClass,
      bodyweight_kg: m.bodyweightKg,
      squat_kg: m.squat,
      bench_kg: m.bench,
      deadlift_kg: m.deadlift,
      total_kg: m.total ?? m.squat + m.bench + m.deadlift,
      place: m.place,
      attempts: m.attempts,
      tested: null,
      intel: true,
    });
  }
  return out;
}

export type CoachAttempts = Partial<Record<Lift, { opener: number | null; second: number | null; third: number | null; by: Provider; label: string; factId: string; basis: Fact["basis"] }>>;
export type CoachWarmups = Partial<Record<Lift, { rows: Array<{ kg: number | null; pct: number | null; reps: number }>; by: Provider; label: string }>>;

export type GameplanIntel = {
  attempts: CoachAttempts;
  warmups: CoachWarmups;
  racks: { squat?: { height: string | null; safety: string | null }; bench?: { height: string | null; safety: string | null; footBlocks: string | null } };
  gear: string[];
  cues: Partial<Record<Lift, string[]>>;
  generalCues: string[];
  instructions: string[];
};

const who = (f: Fact) => (f.provider_name ? f.provider_name : PROVIDER_LABEL[f.provider]);

/** What the gameplan draft takes from the current facts for one competition. */
export function gameplanIntel(facts: Fact[], competitionId: string | null): GameplanIntel {
  const g: GameplanIntel = { attempts: {}, warmups: {}, racks: {}, gear: [], cues: {}, generalCues: [], instructions: [] };
  for (const f of facts) {
    if (f.kind === "attempt_plan" && f.lift && (f.competition_id === competitionId || f.competition_id == null)) {
      const a = f.data as AttemptPlanData;
      const prev = g.attempts[f.lift];
      if (!prev || f.competition_id === competitionId)
        g.attempts[f.lift] = { opener: a.opener, second: a.second, third: a.third, by: f.provider, label: who(f), factId: f.id, basis: f.basis };
    }
    if (f.kind === "warmup" && f.lift) {
      const w = f.data as WarmupData;
      if (w.rows?.length >= 2) g.warmups[f.lift] = { rows: w.rows, by: f.provider, label: who(f) };
    }
    if (f.kind === "equipment") {
      const e = f.data as EquipmentData;
      if (f.lift === "squat" && (e.rackHeight || e.safety)) g.racks.squat = { height: e.rackHeight ?? null, safety: e.safety ?? null };
      if (f.lift === "bench" && (e.rackHeight || e.safety || e.footBlocks))
        g.racks.bench = { height: e.rackHeight ?? null, safety: e.safety ?? null, footBlocks: e.footBlocks ?? null };
      for (const x of e.gear ?? []) if (!g.gear.some((y) => y.toLowerCase() === x.toLowerCase())) g.gear.push(x);
    }
    if (f.kind === "cue") {
      const t = (f.data as { text: string }).text;
      if (f.lift) {
        const list = (g.cues[f.lift] ??= []);
        if (!list.includes(t) && list.length < 4) list.push(t);
      } else if (!g.generalCues.includes(t) && g.generalCues.length < 4) g.generalCues.push(t);
    }
    if (f.kind === "instruction" && (f.competition_id === competitionId || f.competition_id == null)) {
      const t = (f.data as { text: string }).text;
      const line = `${who(f)}: ${t}`;
      if (!g.instructions.includes(line) && g.instructions.length < 6) g.instructions.push(line);
    }
  }
  return g;
}

/** The latest uploaded bodyweight within three weeks (the engines prefer the app's own weigh-ins). */
export function recentBodyweight(facts: Fact[], today: string): { kg: number; date: string } | null {
  const from = addDays(today, -21);
  const list = facts
    .filter((f) => f.kind === "bodyweight" && f.date && f.date >= from && f.date <= today)
    .sort((a, b) => b.date!.localeCompare(a.date!));
  const f = list[0];
  return f ? { kg: Math.round((f.data as { kg: number }).kg * 10) / 10, date: f.date! } : null;
}

/** Current pain or injury notes (the latest word on each place), as the watch list's pain entries. */
export function currentRisks(facts: Fact[], today: string): Array<{ place: string; lift: Lift | null; worse: boolean; score: null; factId: string; text: string; date: string | null }> {
  const from = addDays(today, -42);
  const byPlace = new Map<string, Fact>();
  const sorted = facts
    .filter((f) => f.kind === "risk" && (!f.date || f.date >= from))
    .sort((a, b) => String(a.date ?? a.received_at.slice(0, 10)).localeCompare(String(b.date ?? b.received_at.slice(0, 10))));
  for (const f of sorted) {
    const r = f.data as RiskData;
    const key = (r.place ?? f.lift ?? "general").toLowerCase();
    byPlace.set(key, f);
  }
  const out = [];
  for (const f of byPlace.values()) {
    const r = f.data as RiskData;
    if (r.status === "resolved") continue;
    // an undated note only counts when it arrived recently
    if (!f.date && f.received_at.slice(0, 10) < from) continue;
    const place = r.place ?? (f.lift ? `${f.lift} (uploaded note)` : "Uploaded note");
    out.push({ place, lift: f.lift ?? liftForPlace(place), worse: false, score: null, factId: f.id, text: r.text, date: f.date });
  }
  return out;
}

/** Lines for the missing-information card's "retrieved" list. */
export function retrievedLines(facts: Fact[], sourcesReady: number): string[] {
  if (!sourcesReady) return [];
  const done = facts.filter(strengthSet).length;
  const meets = facts.filter((f) => f.kind === "meet").length;
  const coach = facts.some((f) => f.kind === "attempt_plan" && f.provider === "primary_coach");
  const parts = [
    done ? `${done} completed competition-lift set${done === 1 ? "" : "s"}` : null,
    meets ? `${meets} meet${meets === 1 ? "" : "s"}` : null,
    coach ? "their coach's attempt plan" : null,
  ].filter(Boolean);
  return [`${sourcesReady} uploaded file${sourcesReady === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}`];
}

/** Numbered evidence Cleo can cite (U-*), the most telling first, kept short. */
export function intelEvidence(facts: Fact[], today: string): Array<{ id: string; kind: "training" | "intel"; text: string; lift: Lift | null; date: string | null }> {
  const out: Array<{ id: string; kind: "training" | "intel"; text: string; lift: Lift | null; date: string | null }> = [];
  const twelve = addDays(today, -84);
  for (const lift of LIFTS) {
    const sets = facts
      .filter((f) => f.kind === "training" && f.lift === lift && f.date && f.date >= twelve && (f.data as TrainingData).standard === "competition")
      .sort((a, b) => b.date!.localeCompare(a.date!))
      .slice(0, 8);
    sets.forEach((f, i) => {
      const t = f.data as TrainingData;
      const plan = t.planned ? ` (prescribed ${t.planned.loadKg ?? "?"} kg × ${t.planned.reps ?? "?"}${t.planned.rpe != null ? ` @ ${t.planned.rpe}` : ""})` : "";
      out.push({
        id: `U-${lift.slice(0, 2).toUpperCase()}${i + 1}`,
        kind: t.completion === "completed" ? "training" : "intel",
        lift,
        date: f.date,
        text: `${f.date} ${t.exercise}: ${t.loadKg ?? (t.pct != null ? `${t.pct}%` : "?")}${t.loadKg != null ? " kg" : ""} × ${t.reps}${t.sets > 1 ? ` × ${t.sets} sets` : ""}${t.rpe != null ? ` @ RPE ${t.rpe}` : ""}, ${t.completion}${plan}; from ${who(f)} (uploaded)`,
      });
    });
  }
  facts
    .filter((f) => f.kind === "warmup" && f.lift)
    .forEach((f, i) =>
      out.push({ id: `U-WU${i + 1}`, kind: "intel", lift: f.lift, date: f.date, text: `${who(f)}'s ${f.lift} warm-ups: ${(f.data as WarmupData).rows.map((r) => `${r.kg ?? `${r.pct}%`}×${r.reps}`).join(", ")}` }),
    );
  facts
    .filter((f) => f.kind === "attempt_plan")
    .forEach((f, i) => {
      const a = f.data as AttemptPlanData;
      out.push({ id: `U-AP${i + 1}`, kind: "intel", lift: f.lift, date: f.date, text: `${who(f)}'s ${f.lift} attempts: ${[a.opener, a.second, a.third].map((x) => x ?? "–").join("/")} kg` });
    });
  facts
    .filter((f) => f.kind === "instruction" || f.kind === "technique" || f.kind === "taper")
    .slice(0, 8)
    .forEach((f, i) => out.push({ id: `U-N${i + 1}`, kind: "intel", lift: f.lift, date: f.date, text: `${who(f)} (${f.kind}): ${(f.data as { text: string }).text}` }));
  return out;
}
