/**
 * "Your new nutrition plan is live" in the client's coach chat: the message
 * that goes out when a coach publishes or updates their plan, with a card of
 * each day's numbers (and how they moved from the plan before). Pure; the
 * server writes it (plan-message.server.ts), the thread draws it
 * (NutritionPlanChatCard).
 */
import { planPeriod, type PlanRow } from "@/lib/nutrition-targets/plan-history";
import { textHash } from "@/lib/plan-changes";

export const PLAN_MESSAGE_KIND = "nutrition_plan";
/** The page a client opens from the card (and the push). */
export const CLIENT_PLAN_URL = "/portal/nutrition-targets";
/** Saving the same plan again within this long doesn't post another message. */
export const PLAN_MESSAGE_QUIET_MS = 2 * 60 * 60 * 1000;

export type PlanCardDay = { label: string; kcal: number | null; p: number | null; c: number | null; f: number | null; was_kcal?: number | null };

export type PlanMessageAttachment = {
  type: "link";
  kind: typeof PLAN_MESSAGE_KIND;
  url: string;
  name: string;
  target_id: string;
  /** The plan's last_updated_at when it was announced: one message per version. */
  version: string | null;
  /** What the client sees of the plan (`planContentKey`): a save that changes none of it isn't announced. */
  content?: string | null;
  update: "new" | "changed";
  period: string;
  phase: string | null;
  days: PlanCardDay[];
};

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const key = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** The card: each day's calories and macros, and for a new plan the calories it replaced, by day name. */
export function planMessageCard(plan: PlanRow, previous: PlanRow | null, update: "new" | "changed"): PlanMessageAttachment {
  const before = new Map((previous?.nutrition_target_days ?? []).map((d) => [key(d.day_label), num(d.calories)]));
  const days = (plan.nutrition_target_days ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((d) => {
      const was = update === "new" ? before.get(key(d.day_label)) ?? null : null;
      const kcal = num(d.calories);
      return {
        label: String(d.day_label ?? "Day"),
        kcal,
        p: num(d.protein),
        c: num(d.carbs),
        f: num(d.fats),
        ...(was != null && kcal != null && was !== kcal ? { was_kcal: was } : {}),
      };
    });
  return {
    type: "link",
    kind: PLAN_MESSAGE_KIND,
    url: CLIENT_PLAN_URL,
    name: "Your nutrition plan",
    target_id: plan.id,
    version: plan.last_updated_at ?? null,
    content: planContentKey(plan),
    update,
    period: planPeriod(plan),
    phase: (plan.custom_phase || plan.phase || null) as string | null,
    days,
  };
}

/**
 * A short hash of everything the client sees of a plan: each day's numbers,
 * steps, meals and when it's used, and the plan's phase, water, notes for
 * them, weighing rules, supplements and PDF. Never its dates, status or the
 * coach's private notes: re-saving, re-dating or a private note isn't news.
 */
export function planContentKey(plan: PlanRow): string {
  const t = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.replace(/\s+/g, " ").trim() : JSON.stringify(v));
  const days = (plan.nutrition_target_days ?? [])
    .map((d) =>
      [key(d.day_label), num(d.calories), num(d.protein), num(d.carbs), num(d.fats), num(d.fibre), num(d.steps), t(d.use_on), t(d.weekdays), textHash(d.notes) ?? ""].join("|"),
    )
    .sort();
  const head = [plan.phase, plan.custom_phase, plan.water, plan.client_notes, plan.food_weighing_rules, plan.supplements, plan.pdf_url, plan.visible_to_client === false ? "hidden" : ""].map(t);
  return textHash([...head, ...days].join("\n")) ?? "empty";
}

/** The words over the card, in the coach's voice. */
export function planMessageBody(firstName: string | null | undefined, update: "new" | "changed"): string {
  const hey = (firstName ?? "").trim().split(/\s+/)[0];
  const lead = hey ? `Hey ${hey}! ` : "";
  return update === "new"
    ? `${lead}Your new nutrition plan is live 🍽️ Here's where your numbers landed. Tap below for your meals and targets.`
    : `${lead}I updated your nutrition plan 🍽️ Tap below to see the latest.`;
}

/** "−189" / "+40" for the card, or nothing when there's no change to show. */
export function kcalChange(day: PlanCardDay): string | null {
  if (day.was_kcal == null || day.kcal == null) return null;
  const d = day.kcal - day.was_kcal;
  return d === 0 ? null : `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString("en-US")}`;
}
