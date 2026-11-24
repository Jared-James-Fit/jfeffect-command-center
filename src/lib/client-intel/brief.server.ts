/**
 * Shared client intelligence (Nov 23 2026): what every Cleo specialty
 * (Training, Nutrition, Cardio) knows about one client, built from the records
 * every time, never from a conversation's memory. Each line says what kind of
 * thing it is, in priority order:
 *
 *   CONFIRMED FACTS        their profile, schedule, meet, health on file
 *   COACH INSTRUCTIONS     the coach's rules for them (program_rules), the coach's
 *                          notes, the coach's own reasons for past changes
 *   CURRENT PLANS          training block, nutrition plan, cardio plan in force
 *   OBSERVATIONS           measured or reported: bodyweight, adherence, strength,
 *                          check-in flags, steps
 *   DECISION HISTORY       what was proposed, what the coach approved or turned
 *                          down and why, and how each published cardio plan went
 *   INTERPRETATIONS        the engines' reads (weight management, cardio), labelled
 *
 * Facts and coach instructions win over any interpretation; a suggestion the
 * coach already turned down isn't made again unless something changed. Read
 * with the service role after the caller checked the staff member reaches the
 * client; every section is best-effort and a section that can't be read is
 * left out (never guessed). Server only.
 */
import type { LoadedWeightManagement } from "@/lib/weight-management/load.server";
import { assessmentText } from "@/lib/weight-management/assessment";
import { healthProfileFromRecords, loadHealthRecords } from "@/lib/health/health-load";
import { healthProfileForAi } from "@/lib/health/health-profile";
import { sessionLine, daysWords, TIMING_SHORT, type CardioPlan, type PlanContext } from "@/lib/cardio/plan";
import { outcomesText, type VersionOutcome } from "@/lib/cardio/history";
import type { CardioRead } from "@/lib/cardio/insights";
import type { SpeedUnit } from "@/lib/weight-management/units";

export type IntelFocus = "cardio" | "nutrition" | "training";

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

const clip = (s: unknown, n = 220) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export type ClientIntelInput = {
  clientId: string;
  loaded: LoadedWeightManagement;
  cardio?: { live: CardioPlan; ctx: PlanContext; unit: SpeedUnit; outcomes: VersionOutcome[]; read: CardioRead } | null;
};

/** The whole brief as text, for a prompt. */
export async function clientIntelText(sb: any, x: ClientIntelInput, focus: IntelFocus): Promise<string> {
  const { loaded, clientId } = x;
  const { input, assessment } = loaded;
  const today = assessment.today;
  const [rules, notes, nutritionPlan, wmReviews, planEdits, proposals, recs, health, program] = await Promise.all([
    safe<any[]>(() => sb.from("program_rules").select("kind, rule, client_id, expires_on, active").or(`client_id.eq.${clientId},client_id.is.null`).eq("active", true).limit(40), []),
    safe<any[]>(
      () =>
        sb
          .from("client_file_notes")
          .select("title, body, topic, pinned, created_at")
          .eq("client_id", clientId)
          .is("archived_at", null)
          .order("pinned", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(8),
      [],
    ),
    safe<any>(
      () =>
        sb
          .from("nutrition_targets")
          .select("phase, custom_phase, start_date, end_date, status, nutrition_target_days(day_label, calories, protein, carbs, fats, steps, sort_order)")
          .eq("client_id", clientId)
          .neq("status", "Archived")
          .order("start_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      null,
    ),
    safe<any[]>(() => sb.from("weight_management_reviews").select("created_at, headline, status, decision_note, decided_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(5), []),
    safe<any[]>(() => sb.from("nutrition_plan_edits").select("created_at, instructions, status, applied_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(5), []),
    safe<any[]>(() => sb.from("cardio_cleo_proposals").select("created_at, instructions, status, change_lines, decision_note").eq("client_id", clientId).order("created_at", { ascending: false }).limit(5), []),
    safe<any[]>(() => sb.from("client_coaching_recommendations").select("created_at, headline, status, coach_note").eq("client_id", clientId).order("created_at", { ascending: false }).limit(3), []),
    loadHealthRecords(sb, clientId, { forms: false, today }).catch(() => null),
    focus !== "training" ? import("@/lib/program-context.server").then((m) => m.loadProgramContext(sb, clientId, today)).catch(() => null) : Promise.resolve(null),
  ]);

  const out: string[] = [];
  out.push(
    "CLIENT INTELLIGENCE (shared by Cleo's training, nutrition and cardio work; built from the records, not from memory). Priority: confirmed facts and coach instructions override any interpretation. Don't re-propose something the coach turned down unless something has changed since, and don't ask for anything stated here.",
  );

  // Confirmed facts
  const facts: string[] = [];
  if (input.sex || input.age || input.heightCm) facts.push(`- ${[input.sex === "M" ? "Male" : input.sex === "F" ? "Female" : null, input.age ? `${input.age} years` : null, input.heightCm ? `${input.heightCm} cm` : null].filter(Boolean).join(", ")}`);
  if (input.level) facts.push(`- Training experience: ${input.level}`);
  facts.push(`- Training days: ${input.trainingDays.length ? input.trainingDays.join(", ") : "not set"}${input.sessionMinutes ? ` · sessions about ${input.sessionMinutes} min` : ""}`);
  if (input.heavyLowerDays.length) facts.push(`- Heavy squat or deadlift on: ${input.heavyLowerDays.join(", ")}`);
  if (input.meet) facts.push(`- Next ${input.meet.sport === "bodybuilding" ? "show" : "meet"}: ${input.meet.name ?? "unnamed"} on ${input.meet.date}${input.meet.weightClass ? `, class ${input.meet.weightClass}` : ""}${assessment.meetWeeksOut != null ? ` (${Math.round(assessment.meetWeeksOut)} weeks out)` : ""}`);
  if (input.powerlifter) facts.push("- Competes in powerlifting");
  if (input.health.walkingLimits.length) facts.push(`- Walking load limits: ${input.health.walkingLimits.join(", ")}`);
  if (input.health.fluidRestriction) facts.push("- A fluid limit is on file (their doctor's number)");
  if (health) {
    try {
      const hp = healthProfileFromRecords(health, today);
      const h = healthProfileForAi(hp, focus === "nutrition" ? "nutrition" : "training");
      if (h) facts.push(h);
    } catch {
      /* the health section is optional */
    }
  }
  out.push(`CONFIRMED FACTS:\n${facts.join("\n")}`);

  // Coach instructions
  const coach: string[] = [];
  for (const r of rules) {
    if (r.expires_on && r.expires_on < today) continue;
    coach.push(`- [${String(r.kind).replace(/_/g, " ")}${r.client_id ? "" : ", every athlete"}] ${clip(r.rule)}`);
  }
  for (const n of notes) {
    if (focus === "cardio" && n.topic === "nutrition") continue;
    coach.push(`- Coach note${n.pinned ? " (pinned)" : ""}${n.topic ? ` · ${n.topic}` : ""}: ${clip([n.title, n.body].filter(Boolean).join(": "))}`);
  }
  if (x.cardio) {
    for (const s of x.cardio.live.sessions) if (s.coachNote.trim()) coach.push(`- Coach's private note on ${sessionLine(s, x.cardio.unit)}: ${clip(s.coachNote)}`);
  }
  out.push(`COACH INSTRUCTIONS (these win):\n${coach.length ? coach.join("\n") : "- None on file"}`);

  // Current plans
  const plans: string[] = [];
  if (program) {
    try {
      const { programContextText } = await import("@/lib/program-context");
      const t = programContextText(program as any);
      if (t) plans.push(`Training:\n${t}`);
    } catch {
      /* optional */
    }
  }
  if (nutritionPlan) {
    const days = ((nutritionPlan.nutrition_target_days ?? []) as any[])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((d) => `${d.day_label}: ${d.calories ?? "?"} kcal, P${d.protein ?? "?"} C${d.carbs ?? "?"} F${d.fats ?? "?"}${d.steps ? `, ${d.steps} steps` : ""}`);
    plans.push(`Nutrition (${nutritionPlan.custom_phase || nutritionPlan.phase || "no phase"}, since ${nutritionPlan.start_date}): ${days.join("; ") || "no days"}`);
  } else plans.push("Nutrition: no plan");
  if (x.cardio) {
    const c = x.cardio;
    plans.push(
      `Cardio in force: ${
        c.live.sessions.length
          ? c.live.sessions.map((s) => `${sessionLine(s, c.unit)} · ${daysWords(s, c.ctx)} · ${TIMING_SHORT[s.timing]}${s.enabled ? "" : " (paused)"}`).join("; ")
          : "none"
      }`,
    );
  }
  out.push(`CURRENT PLANS:\n${plans.join("\n")}`);

  // Observations and the engines' reads
  out.push(`OBSERVATIONS AND THE WEIGHT-MANAGEMENT READ (measured or reported; the recommendation in it is an interpretation):\n${assessmentText(assessment)}`);
  if (x.cardio) {
    const r = x.cardio.read;
    out.push(
      `CARDIO READ (signals are measured or reported; the recommendation is an interpretation):\n${r.signals.map((s) => `- ${s.label} (${s.source}): ${s.value}`).join("\n")}\n- Recommendation: ${r.primary.title}. ${r.primary.observation} ${r.primary.reason} (confidence ${r.primary.confidence}${r.primary.relation === "pattern" ? "; a pattern, not a confirmed cause" : ""})${r.gaps.length ? `\n- Missing: ${r.gaps.join("; ")}` : ""}`,
    );
    out.push(`CARDIO PLANS SO FAR AND HOW THEY WENT:\n${outcomesText(x.cardio.outcomes)}`);
  }

  // Decision history
  const hist: string[] = [];
  for (const p of proposals) hist.push(`- ${String(p.created_at).slice(0, 10)} Cleo cardio proposal "${clip(p.instructions, 120)}": ${p.status}${p.decision_note ? ` (coach: ${clip(p.decision_note, 160)})` : ""}${(p.change_lines ?? []).length ? ` · ${clip((p.change_lines ?? []).join("; "), 160)}` : ""}`);
  for (const e of planEdits) hist.push(`- ${String(e.created_at).slice(0, 10)} nutrition change "${clip(e.instructions, 140)}": ${e.status}`);
  for (const w of wmReviews) hist.push(`- ${String(w.created_at).slice(0, 10)} weight-management read "${clip(w.headline, 140)}": ${w.status}${w.decision_note ? ` (coach: ${clip(w.decision_note, 160)})` : ""}`);
  for (const r of recs) hist.push(`- ${String(r.created_at).slice(0, 10)} check-in recommendation "${clip(r.headline, 120)}": ${r.status}${r.coach_note ? ` (coach: ${clip(r.coach_note, 160)})` : ""}`);
  out.push(`DECISION HISTORY (newest first):\n${hist.length ? hist.join("\n") : "- Nothing recorded yet"}`);

  return out.join("\n\n");
}
