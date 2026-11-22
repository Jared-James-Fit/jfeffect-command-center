/**
 * Everything the roadmap engine reads for one athlete, with whatever session
 * it's given (the athlete's or coach's own login, so RLS decides; the service
 * role in the daily hook). The weight-management loader does the heavy part
 * (weigh-ins, goal, meet, check-ins, cardio, lifts); this adds the targets
 * they're on (the coach's plan, or a self-coached athlete's own), the
 * maintenance their results imply, the health texts the safety screen reads,
 * the competitions either side of the goal, and the roadmap's own state.
 * Every read but the client row is best-effort.
 */
import { loadWeightManagement, type LoadedWeightManagement } from "@/lib/weight-management/load.server";
import { buildAssessment, type AssessmentInput } from "@/lib/weight-management/assessment";
import type { CheckinRow } from "@/lib/weight-management/digestion";
import { prepSport } from "@/lib/weight-management/records";
import { addDays, daysBetween } from "@/lib/weight-management/units";
import { foodLogSummary, observedMaintenance, weightTrend } from "@/lib/nutrition-targets/nutrition-intel";
import { healthProfileFromRecords, loadHealthRecords } from "@/lib/health/health-load";
import { planEnergy, type CurrentPlan } from "@/lib/nutrition-roadmap/blocks";
import type { RoadmapInput } from "@/lib/nutrition-roadmap/build";
import type { Macros, RoadmapPlan } from "@/lib/nutrition-roadmap/types";

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

export type RoadmapRow = {
  client_id: string;
  active_revision_id: string | null;
  status: string | null;
  needs_coach: boolean;
  next_checkin_on: string | null;
  last_reminded_on: string | null;
  last_flagged_on: string | null;
  off_plan_days: number;
  prefs: { everyDays?: number | null; lockCompetition?: boolean; reminders?: boolean } | null;
  auto_adjust: boolean;
  athlete_goal: { name?: string | null; date?: string | null; weightClass?: string | null; federation?: string | null; sport?: "powerlifting" | "bodybuilding" | "other" } | null;
  asks: string[] | null;
};

export type RevisionRow = {
  id: string;
  client_id: string;
  created_at: string;
  trigger: string;
  status: "proposed" | "active" | "superseded" | "rejected";
  decider: "coach" | "athlete";
  plan: RoadmapPlan;
  hash: string;
  summary: string | null;
  changes: string[];
  proposal: unknown;
  explanation: { summary?: string; focus?: string } | null;
  decided_at: string | null;
  decision_note: string | null;
  applied: unknown;
  auto_applied: boolean;
};

export type LoadedRoadmap = {
  ctx: RoadmapInput;
  wm: LoadedWeightManagement;
  clientId: string;
  userId: string | null;
  firstName: string;
  selfCoached: boolean;
  archived: boolean;
  row: RoadmapRow | null;
  active: RevisionRow | null;
  pending: RevisionRow | null;
  /** The member row for a self-coached athlete (their targets live on it). */
  memberId: string | null;
  checkinDue: { id: string; due_on: string; kind: string; reason: string | null; asks: string[] } | null;
};

const REVISION_COLS = "id, client_id, created_at, trigger, status, decider, plan, hash, summary, changes, proposal, explanation, decided_at, decision_note, applied, auto_applied";

export async function loadRoadmap(sb: any, clientId: string, opts: { today?: string } = {}): Promise<LoadedRoadmap> {
  const [wm, clientRow, rowRes, revisions, roadmapCheckins] = await Promise.all([
    loadWeightManagement(sb, clientId, opts),
    sb.from("clients").select("id, user_id, service_tier, archived, status").eq("id", clientId).maybeSingle(),
    safe<RoadmapRow | null>(() => sb.from("nutrition_roadmaps").select("client_id, active_revision_id, status, needs_coach, next_checkin_on, last_reminded_on, last_flagged_on, off_plan_days, prefs, auto_adjust, athlete_goal, asks").eq("client_id", clientId).maybeSingle(), null),
    safe<RevisionRow[]>(() => sb.from("nutrition_roadmap_revisions").select(REVISION_COLS).eq("client_id", clientId).in("status", ["active", "proposed"]).order("created_at", { ascending: false }).limit(10), []),
    safe<any[]>(() => sb.from("nutrition_roadmap_checkins").select("id, due_on, kind, reason, asks, answers, submitted_at").eq("client_id", clientId).order("due_on", { ascending: false }).limit(12), []),
  ]);
  const c = clientRow?.data;
  if (!c) throw new Error("Client not found.");
  const today = wm.input.today;
  const selfCoached = c.service_tier === "self_serve";
  const userId: string | null = c.user_id ?? null;
  const row = rowRes;
  const active = revisions.find((r) => r.status === "active") ?? null;
  const pending = revisions.find((r) => r.status === "proposed") ?? null;

  // the targets they're on
  let memberId: string | null = null;
  let planNow: CurrentPlan | null = null;
  let current: Macros | null = null;
  let changedOn: string | null = null;
  const input: AssessmentInput = { ...wm.input };
  const [planDays, member, compProfile] = await Promise.all([
    !selfCoached && wm.refs.planId
      ? safe<any>(() => sb.from("nutrition_targets").select("id, start_date, phase, last_updated_at, updated_at, nutrition_target_days(day_label, calories, protein, carbs, fats)").eq("id", wm.refs.planId).maybeSingle(), null)
      : Promise.resolve(null),
    selfCoached && userId ? safe<any>(() => sb.from("app_members").select("id").eq("user_id", userId).maybeSingle(), null) : Promise.resolve(null),
    // the class they compete in (the athlete, their coach or their own forms keep it), for a meet prep that doesn't name one
    safe<any>(() => sb.from("athlete_competition_profiles").select("weight_class").eq("client_id", clientId).maybeSingle(), null),
  ]);
  if (planDays) {
    planNow = {
      start: planDays.start_date ?? null,
      phase: planDays.phase ?? null,
      days: (planDays.nutrition_target_days ?? []).map((d: any) => ({ label: String(d.day_label ?? ""), kcal: d.calories ?? null, protein: d.protein ?? null, carbs: d.carbs ?? null, fat: d.fats ?? null })),
      weeklyKcal: input.plan.weeklyKcal,
    };
    current = planEnergy(planNow, input.trainingDays.length)?.avg ?? null;
    changedOn = String(planDays.last_updated_at ?? planDays.start_date ?? "").slice(0, 10) || null;
  }
  memberId = member?.id ?? null;
  if (selfCoached && memberId) {
    const t = await safe<any>(() => sb.from("member_nutrition_targets").select("id, source, goal, calories, protein_g, carbs_g, fat_g, created_at").eq("member_id", memberId).eq("active", true).maybeSingle(), null);
    if (t?.calories) {
      current = { kcal: Number(t.calories), proteinG: Number(t.protein_g ?? 0), carbsG: Number(t.carbs_g ?? 0), fatG: Number(t.fat_g ?? 0) };
      changedOn = String(t.created_at).slice(0, 10);
      const phase = t.goal === "lose" ? "Fat Loss" : t.goal === "gain" ? "Muscle Gain" : t.goal === "maintain" ? "Maintenance" : null;
      planNow = { start: changedOn, phase, days: [{ label: "Every day", kcal: current.kcal, protein: current.proteinG, carbs: current.carbsG, fat: current.fatG }], weeklyKcal: current.kcal };
      input.plan = { ...input.plan, start: changedOn, weeklyKcal: current.kcal, phase, starts: [changedOn] };
    }
  }

  // a self-coached athlete's own competition, when no coach meet prep says otherwise
  const ag = row?.athlete_goal;
  if (!input.meet && ag?.date && ag.date >= today) {
    input.meet = { name: ag.name ?? null, date: ag.date, weightClass: ag.weightClass ?? null, federation: ag.federation ?? null, sport: ag.sport ?? prepSport(null, ag.weightClass ?? null) };
  }

  // a meet prep with no class: the one on their competition profile (a new object, so the assessment is read again)
  const profileClass: string | null = compProfile?.weight_class ?? null;
  if (input.meet && !input.meet.weightClass && profileClass) input.meet = { ...input.meet, weightClass: profileClass };

  // self-coached check-ins read like weekly ones: the same answer keys
  const submitted = roadmapCheckins.filter((r) => r.submitted_at);
  if (selfCoached && submitted.length) {
    const extra: CheckinRow[] = submitted.map((r) => ({ date: String(r.submitted_at).slice(0, 10), answers: (r.answers ?? {}) as Record<string, unknown> }));
    input.checkins = [...input.checkins, ...extra];
  }
  const answers = [
    ...submitted.map((r) => ({ date: String(r.submitted_at).slice(0, 10), answers: (r.answers ?? {}) as Record<string, unknown> })),
    ...input.checkins.map((r) => ({ date: r.date, answers: (r.answers ?? {}) as Record<string, unknown> })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const assessment = selfCoached || input.meet !== wm.input.meet ? buildAssessment(input) : wm.assessment;

  // maintenance their own results imply: logged food, else the plan they stick to
  let observed = null;
  try {
    const start = input.plan.start && input.plan.start > addDays(today, -56) ? input.plan.start : addDays(today, -42);
    const trend = weightTrend(input.weighIns, start, today);
    let food = null;
    if (memberId) {
      const logs = await safe<any[]>(() => sb.from("member_meal_logs").select("logged_at, calories, protein_g, carbs_g, fat_g").eq("member_id", memberId).gte("logged_at", `${start}T00:00:00Z`).limit(5000), []);
      food = foodLogSummary(logs.map((l) => ({ at: l.logged_at, kcal: l.calories, protein: l.protein_g, carbs: l.carbs_g, fat: l.fat_g })), start, today, wm.client.tz);
    }
    observed = observedMaintenance({ trend, food, planKcal: current?.kcal ?? input.plan.weeklyKcal, adherence: assessment.checkins.adherence });
  } catch {
    observed = null;
  }

  // health texts for the safety screen
  let healthTexts: string[] = [];
  try {
    const records = await loadHealthRecords(sb, clientId, { forms: true, today });
    const hp = healthProfileFromRecords(records, today);
    healthTexts = [...hp.conditions, ...hp.medications, ...hp.injuries.filter((i) => /eating|pregnan|breast/i.test(`${i.label} ${i.details ?? ""}`))].map((e) => `${e.label}${e.details ? ` ${e.details}` : ""}`);
  } catch {
    healthTexts = [];
  }

  // competitions either side of the goal
  const preps = await safe<any[]>(() => sb.from("pl_preps").select("event_name, title, event_date, goal_type, weight_class, archived, status").eq("client_id", clientId).gte("event_date", addDays(today, -21)).order("event_date").limit(8), []);
  const live = preps.filter((p) => !p.archived && !/cancel/i.test(String(p.status ?? "")) && p.event_date);
  const past = [...live].reverse().find((p) => String(p.event_date) < today) ?? null;
  const upcoming = live.filter((p) => String(p.event_date) >= today);
  const goalDate = assessment.goal?.date ?? null;
  const after = upcoming.find((p) => goalDate && String(p.event_date) > goalDate) ?? null;
  const recentEvent = past ? { name: past.event_name || past.title || null, date: String(past.event_date).slice(0, 10), physique: prepSport(past.goal_type, past.weight_class) === "bodybuilding" } : null;
  const nextEvent = after ? { name: after.event_name || after.title || null, date: String(after.event_date).slice(0, 10) } : null;

  // check-ins: the last one, and the ones missed in a row (self-coached)
  const lastWeekly = input.checkins.map((r) => r.date).sort().pop() ?? null;
  const lastCheckin = [selfCoached ? (submitted[0]?.submitted_at ? String(submitted[0].submitted_at).slice(0, 10) : null) : null, lastWeekly].filter(Boolean).sort().pop() ?? null;
  let missedCheckins = 0;
  if (selfCoached) {
    for (const r of roadmapCheckins) {
      if (r.submitted_at) break;
      if (String(r.due_on) < addDays(today, -3)) missedCheckins++;
    }
  }
  const open = roadmapCheckins.find((r) => !r.submitted_at && String(r.due_on) <= today) ?? null;

  const ctx: RoadmapInput = {
    today,
    input,
    assessment,
    selfCoached,
    planNow,
    current,
    targetsChangedOn: changedOn,
    observed,
    healthTexts,
    answers,
    recentEvent: recentEvent && daysBetween(recentEvent.date, today) <= 21 ? recentEvent : null,
    nextEvent,
    prefs: { everyDays: row?.prefs?.everyDays ?? null, lockCompetition: !!row?.prefs?.lockCompetition },
    consent: !!row?.auto_adjust,
    active: active?.plan ?? null,
    lastCheckin,
    missedCheckins,
  };
  return {
    ctx,
    wm: { ...wm, input, assessment },
    clientId,
    userId,
    firstName: wm.client.firstName,
    selfCoached,
    archived: !!c.archived || /deactivated|deleted/i.test(String(c.status ?? "")),
    row,
    active,
    pending,
    memberId,
    checkinDue: open ? { id: open.id, due_on: String(open.due_on), kind: String(open.kind), reason: open.reason ?? null, asks: (open.asks ?? []) as string[] } : null,
  };
}

export const REVISION_SELECT = REVISION_COLS;
