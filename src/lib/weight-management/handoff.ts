/** Window event that puts words in a client's Change it with AI box (PlanAiChange): detail { clientId, text }. */
export const PLAN_AI_PREFILL_EVENT = "jf:plan-ai-prefill";

/** Hand a recommended nutrition change to Change it with AI: it lands in the box, never applied on its own. */
export function prefillPlanAiChange(clientId: string, text: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAN_AI_PREFILL_EVENT, { detail: { clientId, text } }));
}

/** The coach's weight-management card's query. */
export const weightKey = (clientId: string) => ["weight-management", clientId] as const;
