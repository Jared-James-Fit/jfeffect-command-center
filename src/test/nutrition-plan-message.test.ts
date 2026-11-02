import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { kcalChange, planMessageBody, planMessageCard } from "@/lib/nutrition-targets/plan-message";
import { postPlanMessage } from "@/lib/nutrition-targets/plan-message.server";
import { messagePreviewText } from "@/lib/message-preview";

const plan = {
  id: "new", client_id: "c1", status: "Active", start_date: "2026-11-01", end_date: "2026-12-01", phase: "Recomp", visible_to_client: true,
  last_updated_at: "2026-11-02T02:05:22.179+00:00",
  nutrition_target_days: [
    { day_label: "Non-Training Day", calories: 1881, protein: 156, carbs: 195, fats: 53, sort_order: 1 },
    { day_label: "Training Day", calories: 2041, protein: 156, carbs: 235, fats: 53, sort_order: 0 },
  ],
};
const old = {
  id: "old", client_id: "c1", status: "Archived", start_date: "2026-08-16", end_date: "2026-10-31", phase: "Fat Loss",
  nutrition_target_days: [{ day_label: "training day", calories: 2230 }, { day_label: "Non-Training Day", calories: 1881 }],
};

/** Just enough of the Supabase query builder for postPlanMessage. */
function fakeDb(tables: Record<string, any[]>) {
  const inserted: any[] = [];
  return {
    inserted,
    from(table: string) {
      const filters: Array<(r: any) => boolean> = [];
      let row: any = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
        contains: (c: string, v: any[]) => (filters.push((r) => v.every((want) => (r[c] ?? []).some((a: any) => Object.entries(want).every(([k, x]) => a?.[k] === x)))), api),
        order: () => api,
        limit: () => api,
        insert: (r: any) => ((row = { id: `m${inserted.length + 1}`, ...r }), inserted.push(row), (tables[table] ??= []).push(row), api),
        single: () => Promise.resolve({ data: row, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return api;
    },
  };
}

describe("the plan-updated message", () => {
  it("the card lists each day in order with how a new plan's calories moved, matched by day name", () => {
    const card = planMessageCard(plan as any, old as any, "new");
    expect(card).toMatchObject({ kind: "nutrition_plan", url: "/portal/nutrition-targets", target_id: "new", period: "Nov 1 – Dec 1, 2026", phase: "Recomp", update: "new" });
    expect(card.days.map((d) => [d.label, d.kcal, d.was_kcal ?? null])).toEqual([["Training Day", 2041, 2230], ["Non-Training Day", 1881, null]]);
    expect(kcalChange(card.days[0])).toBe("−189");
    expect(kcalChange(card.days[1])).toBeNull();
    expect(planMessageCard(plan as any, old as any, "changed").days.every((d) => d.was_kcal == null)).toBe(true);
  });

  it("reads like the coach, and the inbox previews it", () => {
    expect(planMessageBody("Marc Asugui", "new")).toBe("Hey Marc! Your new nutrition plan is live 🍽️ Here's where your numbers landed. Tap below for your meals and targets.");
    expect(planMessageBody(null, "changed")).toBe("I updated your nutrition plan 🍽️ Tap below to see the latest.");
    expect(messagePreviewText("", [{ kind: "nutrition_plan" }])).toBe("🍽️ Your nutrition plan");
  });

  it("posts once per plan version, from the coach who published, without counting as a reply", async () => {
    const db = fakeDb({
      clients: [{ id: "c1", first_name: "Marc", user_id: "u1", assigned_coach_id: null }],
      nutrition_targets: [plan, old],
      messages: [],
    });
    const now = Date.parse("2026-11-02T03:00:00Z");
    const first = await postPlanMessage(db, { clientId: "c1", actorUserId: "coach", now });
    expect(first.posted).toBe(true);
    expect(db.inserted[0]).toMatchObject({ client_id: "c1", sender_id: "coach", sender_role: "admin", is_automated: true, message_type: "Nutrition" });
    expect(db.inserted[0].attachments[0]).toMatchObject({ kind: "nutrition_plan", update: "new", version: plan.last_updated_at });
    db.inserted[0].created_at = new Date(now).toISOString();

    expect((await postPlanMessage(db, { clientId: "c1", actorUserId: "coach", now })).reason).toBe("already_sent");
    plan.last_updated_at = "2026-11-02T03:30:00+00:00";
    expect((await postPlanMessage(db, { clientId: "c1", actorUserId: "coach", now: now + 30 * 60_000 })).reason).toBe("recent");
    const later = await postPlanMessage(db, { clientId: "c1", actorUserId: "coach", now: now + 3 * 3_600_000 });
    expect(later.posted).toBe(true);
    expect(db.inserted[1].attachments[0].update).toBe("changed");
  });

  it("every publish path posts it: the app event (Update plan, the editor, Use again) and Cleo", () => {
    const events = readFileSync("src/lib/push/app-events.functions.ts", "utf8");
    expect(events).toContain('await postPlanMessage(sb, { clientId: data.id, actorUserId: userId });');
    const cleo = readFileSync("src/lib/cleo-program.server.ts", "utf8");
    expect(cleo).toContain("await postPlanMessage(supabaseAdmin as any, { clientId: p.client_id, actorUserId: actor.userId });");
    const thread = readFileSync("src/components/message-thread.tsx", "utf8");
    expect(thread).toContain('if (att.kind === "nutrition_plan") {');
  });
});
