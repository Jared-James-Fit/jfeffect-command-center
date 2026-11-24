/**
 * One coordinated recommendation after a weekly check-in (Nov 23 2026): the
 * weight-management engine's call (energy balance, adherence, recovery,
 * digestion, the target: weight-management/decision.ts) and cardio's recovery
 * and performance read (cardio/insights.ts) put together into a single
 * assessment for the coach, so Training, Nutrition and Cardio never send three
 * separate, contradicting suggestions. One lever at a time: a food change and
 * a cardio increase never go out together, and an increase never sits beside a
 * reduction. Holding the plan is a recommendation of its own (and the usual
 * one). Private to the coach; nothing here is sent to the client or written to
 * a plan. Pure and tested (coaching-recommendation.test.ts).
 */
import type { Recommendation as WmRecommendation } from "@/lib/weight-management/decision";
import type { CardioRead, CardioRecommendation } from "@/lib/cardio/insights";

export type RecDomain = "nutrition" | "cardio" | "training" | "overall";
export type RecConfidence = "high" | "moderate" | "low";

export type RecAction =
  | { kind: "cardio_draft"; ask: string }
  | { kind: "nutrition_change"; instruction: string }
  | { kind: "review"; tab: "training" | "nutrition" | "cardio" }
  | { kind: "none" };

export type RecItem = {
  domain: RecDomain;
  title: string;
  observation: string;
  recommendation: string;
  reason: string;
  confidence: RecConfidence;
  action: RecAction;
};

export type CoachingRecommendation = {
  headline: string;
  /** Nothing to change: keep the plan. */
  hold: boolean;
  items: RecItem[];
};

const EVIDENCE: Record<string, RecConfidence> = { strong: "high", moderate: "moderate", weak: "low" };

export const DOMAIN_LABEL: Record<RecDomain, string> = {
  nutrition: "Nutrition",
  cardio: "Cardio",
  training: "Training",
  overall: "Overall",
};

function cardioItem(r: CardioRecommendation): RecItem {
  return {
    domain: "cardio",
    title: r.title,
    observation: r.observation,
    recommendation: r.ask ?? r.title,
    reason: r.relation === "pattern" ? `${r.reason} This is a pattern in the data, not a confirmed cause.` : r.reason,
    confidence: r.confidence,
    action: r.ask ? { kind: "cardio_draft", ask: r.ask } : { kind: "review", tab: "cardio" },
  };
}

export function consolidate(wm: WmRecommendation | null, cardio: CardioRead | null): CoachingRecommendation {
  const items: RecItem[] = [];
  const conf = (wm ? EVIDENCE[wm.evidence] : "low") ?? "low";
  const wmReason = wm?.reasons?.[0] ?? "";

  const food = wm?.actions.find((a) => a.kind === "nutrition");
  const wmCardio = wm?.actions.find((a) => a.kind === "cardio");
  if (food && food.kind === "nutrition") {
    items.push({
      domain: "nutrition",
      title: wm!.headline,
      observation: wmReason || wm!.headline,
      recommendation: food.instruction,
      reason: wm!.expected ?? `About ${Math.abs(food.kcalPerDay)} kcal a day, from ${food.from.replace("_", " and ")}.`,
      confidence: conf,
      action: { kind: "nutrition_change", instruction: food.instruction },
    });
  }
  if (wmCardio && wmCardio.kind === "cardio") {
    items.push({
      domain: "cardio",
      title: wmCardio.direction === "up" ? "Add a little cardio" : "Ease the cardio back",
      observation: wmReason || wm!.headline,
      recommendation: wmCardio.step.why,
      reason: wm!.expected ?? wm!.headline,
      confidence: conf,
      action: {
        kind: "cardio_draft",
        ask: wmCardio.direction === "up" ? `Increase cardio by one small step: ${wmCardio.step.why}` : `Reduce cardio by one small step: ${wmCardio.step.why}`,
      },
    });
  } else if (cardio) {
    // cardio's own read, unless it only echoes energy balance (the nutrition item has it) or would pull the other way
    const own = [cardio.primary, ...cardio.others].find((r) => {
      if (r.kind === "maintain" || r.kind === "adjust_nutrition") return false;
      if (food && r.kind === "increase") return false;
      return true;
    });
    if (own) items.push(cardioItem(own));
    // strength down with nothing on the cardio side: the program and recovery are where to look
    if (cardio.primary.kind === "collect_data" && /strength/i.test(cardio.primary.title)) {
      items.push({
        domain: "training",
        title: "Look at the program and recovery",
        observation: cardio.primary.observation,
        recommendation: "Review lower-body volume and recent fatigue before changing cardio or food.",
        reason: cardio.primary.reason,
        confidence: cardio.primary.confidence,
        action: { kind: "review", tab: "training" },
      });
    }
  }
  for (const a of wm?.actions ?? []) {
    if (a.kind === "digestion" || a.kind === "medical" || a.kind === "target" || a.kind === "ask") {
      items.push({
        domain: "overall",
        title: a.kind === "medical" ? "A health concern first" : a.kind === "digestion" ? "Digestion first" : a.kind === "target" ? "Check the target" : "Ask them first",
        observation: wmReason || wm!.headline,
        recommendation: a.kind === "digestion" ? a.suggestions.slice(0, 2).join(" ") : a.text,
        reason: wm!.headline,
        confidence: conf,
        action: { kind: "review", tab: "nutrition" },
      });
    }
  }

  if (!items.length) {
    const why = wm && wm.limiting === "none" ? wm.headline : cardio?.primary.kind === "maintain" ? cardio.primary.observation : wm?.headline ?? "Nothing in this check-in calls for a change.";
    return {
      headline: "Keep the current plan",
      hold: true,
      items: [
        {
          domain: "overall",
          title: "Keep the current plan",
          observation: why,
          recommendation: "Hold training, nutrition and cardio as they are.",
          reason: "Changing something that's working, or too early to judge, makes the next weeks harder to read.",
          confidence: wm ? conf : cardio?.primary.confidence ?? "low",
          action: { kind: "none" },
        },
      ],
    };
  }
  const order: RecDomain[] = ["overall", "nutrition", "cardio", "training"];
  items.sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain));
  return { headline: items[0].title, hold: false, items: items.slice(0, 3) };
}

/** A stable fingerprint of what was recommended (one record per check-in and read). */
export function recommendationHash(r: CoachingRecommendation): string {
  const s = JSON.stringify(r.items.map((i) => [i.domain, i.title, i.recommendation]));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
