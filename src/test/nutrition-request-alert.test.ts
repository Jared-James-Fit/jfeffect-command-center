import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentRequest, planMissing, sentSinceAsked } from "@/lib/form-request-state";

const read = (f: string) => readFileSync(f, "utf8");

describe("a sent Nutrition Update Request reaches the coach", () => {
  it("the coach hears the moment it's sent, and the AI plan is written on the server, not the phone", () => {
    const events = read("src/lib/push/app-events.functions.ts");
    expect(events).toContain('await notifyAppEvent(sb, "nutrition_submitted", { clientId: s.client_id, sourceId: data.id, actorUserId: userId });');
    expect(events).toContain("return startNutritionPlan(sb, data.id);");
    expect(events).not.toContain("s.form_id === NUTRITION_REQUEST_FORM_ID) return { skipped: true }");
    expect(read("src/lib/push/app-events.server.ts")).toContain("title: (n) => `Nutrition update from ${n}`,");
    // the phone no longer starts it (a lazy file that 404s after a publish, or a closed app, dropped it silently)
    const form = read("src/components/forms/client-form-renderer.tsx");
    expect(form).not.toContain("generateNutritionPlanFn");
    expect(form).toContain('fireAppEvent("form_submitted", submission.id);');
  });

  it("writes the plan's row first, so a failure anywhere shows up as an error the coach can retry", () => {
    const server = read("src/lib/nutrition-ai-plans.server.ts");
    const row = server.indexOf('{ submission_id: submissionId, client_id: subRow.client_id, status: "generating", error: null, updated_at: startedAt }');
    const work = server.indexOf("const { sub, qas } = await loadQAs(sb, submissionId);");
    const tryAt = server.indexOf("  try {", row);
    expect(row).toBeGreaterThan(0);
    expect(tryAt).toBeGreaterThan(row);
    expect(work).toBeGreaterThan(tryAt);
    expect(server).toContain("if (rowError) throw new Error(rowError.message);");
    // once per submission
    expect(server).toContain("if (planBusy(existing)) return { status: \"generating\" as const };");
  });

  it("after Submit the form stays sent (no blank copy that reads as 'it didn't go through') until it's asked for again", () => {
    const asked = { created_at: "2026-10-04T23:27:49Z", updated_at: "2026-10-04T23:27:49Z" };
    expect(sentSinceAsked({ submitted_at: "2026-10-19T00:10:42Z", created_at: "2026-10-19T00:08:26Z" }, asked)).toBe(true);
    // asked again since: a fresh form
    expect(sentSinceAsked({ submitted_at: "2026-10-19T00:10:42Z", created_at: "2026-10-19T00:08:26Z" }, { ...asked, updated_at: "2026-11-16T15:00:00Z" })).toBe(false);
    // a form nobody asked for keeps opening fresh
    expect(sentSinceAsked({ submitted_at: "2026-10-19T00:10:42Z", created_at: "2026-10-19T00:08:26Z" }, null)).toBe(false);
    expect(read("src/lib/native-forms.ts")).toContain('if (last && last.status !== "in_progress" && sentSinceAsked(last, asked)) return last as NfSubmission;');
  });

  it("the coach's panel shows the request they answered, not a blank form opened after it, and writes a missing plan", () => {
    const reqs = [
      { id: "draft", status: "in_progress", submitted_at: null },
      { id: "sent", status: "pending_review", submitted_at: "2026-10-19T00:10:42Z" },
    ];
    expect(currentRequest(reqs, "2026-10-04T23:27:49Z")?.id).toBe("sent");
    // asked again after it: the new one (being filled in) is the one that matters
    expect(currentRequest(reqs, "2026-11-16T15:00:00Z")?.id).toBe("draft");
    expect(currentRequest([], null)).toBeNull();
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(planMissing(null, now)).toBe(true);
    expect(planMissing({ status: "generating", updated_at: "2026-10-19T11:59:00Z" }, now)).toBe(false);
    expect(planMissing({ status: "generating", updated_at: "2026-10-19T11:50:00Z" }, now)).toBe(true);
    expect(planMissing({ status: "ready", updated_at: "2026-10-19T11:00:00Z" }, now)).toBe(false);
    expect(planMissing({ status: "error", updated_at: "2026-10-19T11:00:00Z" }, now)).toBe(false);
    const panel = read("src/components/nutrition/NutritionRequestPanel.tsx");
    expect(panel).toContain("const latest = currentRequest(requests, data?.requestedAt ?? null);");
    expect(panel).toContain("if (!latest || !submitted || !planMissing(plan) || kicked.current === latest.id) return;");
    expect(read("src/lib/nutrition-ai-plans.functions.ts")).toContain("requestedAt: assignment?.updated_at ?? assignment?.created_at ?? null,");
  });
});
