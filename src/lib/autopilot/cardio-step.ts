/**
 * The weight-management engine's one-variable treadmill step
 * (`stepTreadmill`, weight-management/treadmill.ts) put on the client's cardio
 * plan as the builder edits it (cardio/plan.ts), so a cardio proposal from the
 * weekly assessment is a real draft without asking a model: the session it
 * names (the walk after lifting = the training-day session, the days-off walk
 * = the non-training one), the one thing it changes (minutes, walks a week,
 * incline, speed, a walk added or the training-day walk taken off), nothing
 * else. Returns null when the plan has no session the step can be read onto
 * (a coach's own non-treadmill plan, two sessions on the same days): the
 * cardio Cleo then writes the draft from the same words, and the coach
 * reviews it. Pure and tested (autopilot.test.ts).
 */
import { newSession, type CardioPlan, type CardioSession, type PlanContext } from "@/lib/cardio/plan";
import { normalizeCardioWeekdays } from "@/lib/cardio-prescription";
import type { CardioStep, TreadmillSession } from "@/lib/weight-management/treadmill";

const TREADMILL = new Set(["treadmill_flat", "treadmill_incline", "treadmill_variable"]);

function matching(plan: CardioPlan, which: "trainingDay" | "restDay"): number {
  const rule = which === "trainingDay" ? ["training"] : ["non_training", "weekdays"];
  const hits = plan.sessions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.enabled && TREADMILL.has(s.modality) && rule.includes(s.days) && (which === "restDay" || s.timing !== "before_lifting"));
  return hits.length === 1 ? hits[0].i : -1;
}

export function applyCardioStep(
  plan: CardioPlan,
  step: CardioStep,
  after: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null } | null,
  ctx?: PlanContext,
): CardioPlan | null {
  if (!step.session || step.variable === "none") return null;
  const sessions: CardioSession[] = plan.sessions.map((s) => ({ ...s, weekdays: [...s.weekdays] }));
  const target = after?.[step.session] ?? null;

  if (step.variable === "added") {
    if (step.session !== "restDay" || !target) return null;
    if (matching({ sessions }, "restDay") >= 0) return null;
    const s = newSession("treadmill_incline", "weekdays", ctx);
    s.weekdays = normalizeCardioWeekdays(target.weekdays);
    if (!s.weekdays.length) return null;
    s.minutes = target.minutes;
    s.speedMinMph = target.speedMph;
    s.speedMaxMph = target.speedMph;
    s.incline = target.inclinePct;
    s.inclineMax = null;
    s.instructions = "Easy incline walk on a day off: you can talk the whole time.";
    sessions.push(s);
    return { sessions };
  }

  const i = matching({ sessions }, step.session);
  if (i < 0) return null;
  const s = sessions[i];
  switch (step.variable) {
    case "minutes":
      if (step.to == null || step.to <= 0) return null;
      s.minutes = Math.round(step.to);
      break;
    case "incline":
      if (step.to == null) return null;
      s.incline = step.to;
      if (s.inclineMax != null && s.inclineMax < step.to) s.inclineMax = step.to;
      break;
    case "speed":
      if (step.to == null) return null;
      s.speedMinMph = step.to;
      if (s.speedMaxMph == null || s.speedMaxMph < step.to) s.speedMaxMph = step.to;
      break;
    case "frequency": {
      const days = normalizeCardioWeekdays(target?.weekdays ?? []);
      if (!days.length || step.session !== "restDay") return null;
      s.days = "weekdays";
      s.weekdays = days;
      break;
    }
    case "removed":
      s.enabled = false;
      break;
    default:
      return null;
  }
  return { sessions };
}
