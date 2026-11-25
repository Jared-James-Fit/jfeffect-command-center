/**
 * Shared client intelligence (Nov 23 2026): what every Cleo specialty
 * (Training, Nutrition, Cardio) knows about one client, built from the records
 * every time, never from a conversation's memory. Each line says what kind of
 * thing it is, in priority order:
 *
 *   CONFIRMED FACTS        their profile, schedule, meet, health on file
 *   WORK AND LIFESTYLE     their work & lifestyle profile (client-context), the
 *                          coach's private context facts (never quoted to the
 *                          client) and, for the coach's own Cleo conversations,
 *                          the relationship as tone-only context
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
import { durationKindOf, durationOfCompletion, sessionLengthFacts } from "@/lib/workouts/session-duration";
import { sessionLimit } from "@/lib/program-intel/session-limit";
import { bookedSessionLength } from "@/lib/program-intel/context";

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
  /**
   * The staff member asking (a specialty dock): their own recent Cleo conversations about this
   * client go in as context (Nov 24 2026), so a decision talked through in Cleo's panel is known in
   * the Training, Nutrition and Cardio docks too. Never anyone else's conversations.
   */
  viewer?: string | null;
  cardio?: { live: CardioPlan; ctx: PlanContext; unit: SpeedUnit; outcomes: VersionOutcome[]; read: CardioRead } | null;
  /**
   * The coach's private relationship with them as context (Cleo's own conversation with the coach,
   * which drafts messages in his voice): tone only, never a coaching decision. Off for plan writing.
   */
  relationship?: boolean;
};

/** The whole brief as text, for a prompt. */
export async function clientIntelText(sb: any, x: ClientIntelInput, focus: IntelFocus): Promise<string> {
  const { loaded, clientId } = x;
  const { input, assessment } = loaded;
  const today = assessment.today;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 56 * 86_400_000).toISOString();
  const [rules, notes, nutritionPlan, wmReviews, planEdits, proposals, recs, health, program, sessions, goalsSetup, ptSessions, life] = await Promise.all([
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
    // How long their sessions really take (session-duration.ts), against the session limit.
    safe<any[]>(() => sb.from("pl_day_completions").select("*").eq("client_id", clientId).gte("completed_at", since).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(12), []),
    safe<any>(() => sb.from("client_goals_setup").select("workout_length_minutes").eq("client_id", clientId).maybeSingle(), null),
    safe<any[]>(() => sb.from("pt_sessions").select("starts_at, ends_at, status").eq("client_id", clientId).gte("starts_at", since).limit(200), []),
    import("@/lib/client-context/load.server").then((m) => m.clientContextText(sb, clientId, "coach", { relationship: !!x.relationship, today })).catch(() => null),
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
  if (life) out.push(life);

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

  // Session length against the limit: measured or reconstructed sessions only, each kind said.
  try {
    const limit = sessionLimit({ goalsMinutes: goalsSetup?.workout_length_minutes ?? null, ptMinutes: bookedSessionLength(ptSessions).minutes });
    const reads = sessions
      .map((c) => durationOfCompletion(c, { estimatedMin: c.estimated_duration_min ?? null }))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => ({ minutes: d.minutes, kind: durationKindOf(d) }));
    const planned = sessions.map((c) => Number(c.estimated_duration_min)).filter((n) => n > 0).sort((a, b) => a - b);
    const lines = sessionLengthFacts(reads, limit, planned.length ? planned[planned.length >> 1] : null);
    out.push(`SESSION LENGTH (measured = a confirmed time or the session clock; reconstructed = from logged set times; estimates are never counted):\n${lines.join("\n")}`);
  } catch {
    /* optional */
  }

  // Decision history
  const hist: string[] = [];
  for (const p of proposals) hist.push(`- ${String(p.created_at).slice(0, 10)} Cleo cardio proposal "${clip(p.instructions, 120)}": ${p.status}${p.decision_note ? ` (coach: ${clip(p.decision_note, 160)})` : ""}${(p.change_lines ?? []).length ? ` · ${clip((p.change_lines ?? []).join("; "), 160)}` : ""}`);
  for (const e of planEdits) hist.push(`- ${String(e.created_at).slice(0, 10)} nutrition change "${clip(e.instructions, 140)}": ${e.status}`);
  for (const w of wmReviews) hist.push(`- ${String(w.created_at).slice(0, 10)} weight-management read "${clip(w.headline, 140)}": ${w.status}${w.decision_note ? ` (coach: ${clip(w.decision_note, 160)})` : ""}`);
  for (const r of recs) hist.push(`- ${String(r.created_at).slice(0, 10)} check-in recommendation "${clip(r.headline, 120)}": ${r.status}${r.coach_note ? ` (coach: ${clip(r.coach_note, 160)})` : ""}`);
  out.push(`DECISION HISTORY (newest first):\n${hist.length ? hist.join("\n") : "- Nothing recorded yet"}`);

  // The asker's own conversations with Cleo about them (summaries, not the full text)
  if (x.viewer) {
    const talks = await safe<any[]>(
      () =>
        sb
          .from("summer_chats")
          .select("title, summary, preview, last_message_at")
          .eq("user_id", x.viewer)
          .eq("client_id", clientId)
          .order("last_message_at", { ascending: false })
          .limit(2),
      [],
    );
    const lines = talks
      .map((t) => {
        const gist = String(t.summary || t.preview || "").trim();
        return gist ? `- "${clip(t.title, 80)}" (${String(t.last_message_at).slice(0, 10)}): ${clip(gist, 700)}` : null;
      })
      .filter(Boolean);
    if (lines.length) out.push(`FROM THE COACH'S RECENT CONVERSATIONS WITH CLEO ABOUT THEM (summaries; what the coach decided or asked for there counts as a coach instruction unless something above is newer):\n${lines.join("\n")}`);
  }

  return out.join("\n\n");
}

/**
 * The client's other plans for Cleo's training work (Nov 24 2026): the training
 * AI already reads their full training history (Program Intelligence's brief)
 * and the nutrition plan's one line; this adds what it couldn't see: the cardio
 * in force and the cardio read (cardio against lifting recovery), the nutrition
 * plan's days, the weight-management read, and the other two plans' quality
 * reads. Context, never instructions: the program is the coach's. Best effort:
 * anything that can't be read is left out. Server only.
 */
export async function otherPlansForTraining(sb: any, clientId: string): Promise<string | null> {
  try {
    const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
    const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
    const { scoreCardioPlan } = await import("@/lib/cardio/quality");
    const loaded = await loadWeightManagement(sb, clientId);
    const view = await loadCardioWorkspace(sb, clientId, { loaded }).catch(() => null);
    const out: string[] = [];
    if (view) {
      const c = view.live;
      out.push(
        `Cardio in force: ${
          c.sessions.length ? c.sessions.map((s) => `${sessionLine(s, view.speedUnit)} · ${daysWords(s, view.ctx)} · ${TIMING_SHORT[s.timing]}${s.enabled ? "" : " (paused)"}`).join("; ") : "none"
        }`,
      );
      const r = view.read;
      out.push(`Cardio read: ${r.primary.title}. ${r.primary.observation}${r.primary.relation === "pattern" ? " (a pattern, not a confirmed cause)" : ""}`);
      const cq = scoreCardioPlan(c, view.scoreCtx);
      if (cq.verdict.kind !== "insufficient") out.push(`Cardio plan quality: ${cq.score ?? "not scored"}${cq.score != null ? "/100" : ""}. ${cq.verdict.headline}`);
    }
    try {
      const { nutritionQualityFor } = await import("@/lib/nutrition-targets/plan-quality.server");
      const n = await nutritionQualityFor(sb, clientId);
      if (n.quality && n.quality.verdict.kind !== "insufficient") out.push(`Nutrition plan quality: ${n.quality.score ?? "not scored"}${n.quality.score != null ? "/100" : ""}. ${n.quality.verdict.headline}`);
    } catch {
      /* optional */
    }
    const a = loaded.assessment;
    out.push(`Weight management: ${a.recommendation.headline}${a.checkins.poorSleep >= 2 ? " · sleep flagged on recent check-ins" : ""}${a.checkins.lowEnergy >= 2 ? " · energy flagged on recent check-ins" : ""}`);
    if (loaded.input.performance.lower) out.push(`Lower-body strength lately: ${loaded.input.performance.lower}${loaded.input.performance.detail ? ` (${clip(loaded.input.performance.detail, 160)})` : ""}`);
    // their work & lifestyle (client-facing only: a program's notes are read by the athlete)
    const life = await import("@/lib/client-context/load.server").then((m) => m.clientContextText(sb, clientId, "client_facing")).catch(() => null);
    if (life) out.push(life);
    return out.length ? out.join("\n") : null;
  } catch (e: any) {
    console.warn("[client-intel] other plans unavailable", e?.message);
    return null;
  }
}
