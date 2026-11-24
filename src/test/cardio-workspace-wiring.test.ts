import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLIENT_WORKSPACE_PRIMARY_TABS, LEGACY_WORKSPACE_TABS } from "@/components/clients/client-workspace-tab-model";
import { TAB_VALUES } from "@/components/clients/client-tab-values";
import { DEFAULT_ROUTES, resolveRoute } from "@/lib/ai/routing";
import { cardioMessageBody, cardioMessageCard, shouldAnnounce } from "@/lib/cardio/plan-message";
import { newSession, diffPlans } from "@/lib/cardio/plan";
import { readJsonObject } from "@/lib/cardio/cleo.server";

const read = (p: string) => readFileSync(p, "utf8");

describe("Cardio is its own tab", () => {
  it("sits beside Nutrition, and old cardio links land on it", () => {
    const order = CLIENT_WORKSPACE_PRIMARY_TABS.map((t) => t.value);
    expect(order.indexOf("cardio")).toBe(order.indexOf("nutrition") + 1);
    expect((TAB_VALUES as readonly string[]).includes("cardio")).toBe(true);
    expect(LEGACY_WORKSPACE_TABS.cardio).toBeUndefined();
  });

  it("the Nutrition tab no longer carries cardio; plan quality leads it and Cleo docks beside the plan", () => {
    const page = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    const nutrition = page.slice(page.indexOf('<TabsContent value="nutrition"'), page.indexOf('<TabsContent value="cardio"'));
    expect(nutrition).not.toMatch(/CardioTargetsPanel/);
    expect(nutrition).toMatch(/<NutritionQualityCard clientId=\{id\} className="md:col-span-3" \/>/);
    expect(nutrition).toMatch(/<NutritionCleoDock clientId=\{id\} \/>/);
    expect(nutrition).toMatch(/data-builder-page/);
    expect(page).toMatch(/<CardioWorkspace clientId=\{id\} \/>/);
  });

  it("Cleo is one identity: every specialty uses the same docked frame", () => {
    for (const f of ["src/components/cardio/cardio-workspace.tsx", "src/components/nutrition/nutrition-cleo-dock.tsx"]) {
      expect(read(f)).toMatch(/<CleoDockFrame/);
      expect(read(f)).toMatch(/useCleoAccess/);
      expect(read(f)).not.toMatch(/Sparkles|\bBot\b|Brain/);
    }
    expect(read("src/components/program-ai/cleo-dock.tsx")).toMatch(/<CleoDockFrame dock=\{dock\}/);
  });

  it("the Clients list's quick sheet shows cardio and sends edits to the tab (never edited live from a list)", () => {
    const sheet = read("src/components/clients/client-quick-sheet.tsx");
    expect(sheet).toMatch(/CardioQuickView/);
    expect(sheet).not.toMatch(/CardioTargetsPanel/);
  });
});

describe("no Lovable credits", () => {
  it("Cleo's cardio work is on the OpenAI key only, whatever an override names", () => {
    expect(DEFAULT_ROUTES.cardio_plan.models.every((m) => m.startsWith("openai:"))).toBe(true);
    const r = resolveRoute("cardio_plan", { cardio_plan: ["gateway:google/gemini-2.5-flash"] }, { openaiOnly: true });
    expect(r.models.every((m) => m.startsWith("openai:"))).toBe(true);
    expect(read("src/lib/cardio/cleo.server.ts")).toMatch(/openaiOnly: true/);
    expect(read("src/lib/nutrition-ai-plans.server.ts")).toMatch(/resolveRoute\(task, override, \{ openaiOnly: true \}\)/);
  });
});

describe("the client's update message", () => {
  const ctx = { trainingDays: ["Monday" as const, "Wednesday" as const], highDays: [] };
  it("says what changed, once per version, and only for a change they'd notice", () => {
    const before = { sessions: [{ ...newSession("treadmill_incline", "non_training", ctx), key: "a" }] };
    const after = { sessions: [{ ...before.sessions[0], minutes: 35 }] };
    const changes = diffPlans(before, after, ctx, "mph");
    const card = cardioMessageCard({ versionId: "v1", plan: after, ctx, unit: "mph", changes, update: "changed", effective: "2026-11-30", scheduled: true, weeklyMinutes: 175 });
    expect(card.kind).toBe("cardio_plan");
    expect(card.url).toBe("/portal/cardio");
    expect(card.changes[0]).toMatch(/20 → 35 min/);
    expect(card.sessions[0].days).toBe("Tue, Thu, Fri, Sat, Sun");
    expect(cardioMessageBody("Marc Asugui", { update: "changed", scheduled: true, effective: "2026-11-30", empty: false })).toMatch(/^Hey Marc! Your cardio plan has been updated\. .*It starts Monday, Nov 30\./);
    const noteOnly = diffPlans(before, { sessions: [{ ...before.sessions[0], coachNote: "private" }] }, ctx, "mph");
    expect(shouldAnnounce(noteOnly, true)).toBe(false);
    expect(shouldAnnounce(changes, false)).toBe(false);
    expect(shouldAnnounce(changes, true)).toBe(true);
  });

  it("is posted once per version from publishing, and a failed message never fails the publish", () => {
    const pub = read("src/lib/cardio/publish.server.ts");
    expect(pub).toMatch(/kind: CARDIO_MESSAGE_KIND, version_id: x\.versionId/);
    expect(pub).toMatch(/is_automated: true/);
    expect(pub).toMatch(/message_type: "Cardio"/);
    expect(pub).toMatch(/catch \(e: any\) \{\n    messageReason/);
  });
});

describe("Cleo reads its answer tolerantly and checks it in code", () => {
  it("finds the JSON in a fenced or chatty answer", () => {
    expect(readJsonObject('```json\n{"answer":"ok","change":false}\n```')).toEqual({ answer: "ok", change: false });
    expect(readJsonObject("Sure! {\"answer\":\"x\"} done")).toEqual({ answer: "x" });
    expect(readJsonObject("no json here")).toBeNull();
  });
  it("never writes a live plan: proposals only go to the draft", () => {
    const cleo = read("src/lib/cardio/cleo.server.ts");
    expect(cleo).not.toMatch(/from\("cardio_targets"\)/);
    expect(cleo).toMatch(/cleanPlan\(json\.sessions/);
    expect(cleo).toMatch(/planProblems\(plan/);
  });
});
