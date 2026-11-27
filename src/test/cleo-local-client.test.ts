import { beforeEach, describe, expect, it, vi } from "vitest";
import { localClientIntent, contextualLocalClientIntent } from "@/lib/cleo-local-intent";
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(), access: vi.fn(), readers: vi.fn(), attempt: vi.fn(), nutrition: vi.fn(), training: vi.fn(), purchases: vi.fn(),
}));
vi.mock("@/lib/cleo-actions.server", () => ({ assertRequesterReaches: mocks.access }));
vi.mock("@/lib/cleo-local-attempts.server", () => ({ localAttemptAnswer: mocks.attempt }));
vi.mock("@/lib/cleo-tools.server", () => ({ cleoReadTools: mocks.readers, loadCatalog: mocks.catalog }));
import { localClientReply } from "@/lib/cleo-local-client.server";

describe("Cleo internal client mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(undefined);
    mocks.attempt.mockResolvedValue("Existing attempt numbers");
    mocks.nutrition.mockResolvedValue("Current and previous nutrition plans");
    mocks.training.mockResolvedValue("Training logs");
    mocks.purchases.mockResolvedValue("Billing records");
    mocks.readers.mockReturnValue({
      nutrition: { execute: mocks.nutrition },
      training_log: { execute: mocks.training },
      purchases: { execute: mocks.purchases },
    });
  });
  const ctx = { db: {}, admin: {}, requester: "staff", clientId: "selected-client", coach: true };
  it.each([
    ["How did you come up with the temp selection?", "attempts"],
    ["What is her current calorie target?", "nutrition"],
    ["How much has her bodyweight changed?", "weight"],
    ["What are her cardio targets?", "cardio"],
    ["Show me the training plan", "program"],
    ["What's still missing?", "setup"],
    ["Can you tell me what they discussed on the call?", "meetings"],
    ["Show me the latest messages", "messages"],
    ["Is her strength progressing?", "strength"],
    ["What PRs has she hit?", "records"],
    ["When is her competition?", "competition"],
    ["What did she report in the last check-in?", "checkins"],
    ["Show the goal ledger", "goals"],
    ["What's her phone number?", "profile"],
    ["What payments are outstanding?", "purchases"],
  ])("routes natural wording: %s", (q, topic) => {
    expect(localClientIntent(q).topics).toContain(topic);
  });
  it("resolves the exact reported follow-up and chained follow-ups", async () => {
    const question = "How’d you get those numbers";
    const intent = contextualLocalClientIntent(question, ["Why?", "Explain attempt selection"]);
    expect(intent).toMatchObject({ topics: ["attempts"], followup: true, action: false });
    const reply = await localClientReply({ ...ctx, question, intent });
    expect(mocks.attempt).toHaveBeenCalledWith(ctx.admin, ctx.requester, ctx.clientId);
    expect(reply.text).toContain("Existing attempt numbers");
    expect(reply.text).toContain("fresh read");
    expect(reply.choices).toBeUndefined();
  });
  it("does not override new subjects, inherit across unrelated turns, or enable actions", () => {
    expect(contextualLocalClientIntent("What are her calories?", ["Explain attempt selection"]).topics).toEqual(["nutrition"]);
    expect(contextualLocalClientIntent("How'd you get those numbers?", ["Hello", "Explain attempt selection"]).topics).toEqual([]);
    expect(contextualLocalClientIntent("Send those numbers", ["Explain attempt selection"]).action).toBe(true);
    expect(contextualLocalClientIntent("Why?", ["Change her attempts", "Explain attempt selection"]).topics).toEqual([]);
    expect(contextualLocalClientIntent("Where did those numbers come from?", ["Show sumo deadlift history over the last 4 weeks"])).toMatchObject({ topics: ["training"], days: 28, exercise: "sumo deadlift", followup: true });
  });
  it("uses bounded dates and lift filters", () => {
    expect(localClientIntent("show her sumo deadlift history over the last 12 weeks")).toMatchObject({ days: 84, exercise: "sumo deadlift" });
    expect(localClientIntent("show her program on 2026-11-26").date).toBe("2026-11-26");
  });
  it("reuses existing reads and fixes scope to the selected client", async () => {
    const reply = await localClientReply({ ...ctx, question: "Compare her calorie targets and training history over the last 4 weeks" });
    expect(mocks.access).toHaveBeenCalledWith(ctx.admin, "staff", "selected-client");
    expect(mocks.readers).toHaveBeenCalledWith(expect.objectContaining({ db: ctx.db, money: false, scopeClientId: "selected-client" }));
    expect(mocks.training).toHaveBeenCalledWith(expect.objectContaining({ client_id: "selected-client", days: 28 }), expect.anything());
    expect(mocks.nutrition).toHaveBeenCalledWith({ client_id: "selected-client" }, expect.anything());
    expect(reply.text).toContain("Current and previous nutrition plans");
    expect(reply.text).toContain("Training logs");
    expect(reply.text).toContain("Source checked: Nutrition");
    expect(reply.text).toContain("Source checked: Training log");
  });
  it("discovers additional admin evidence without expanding the selected client or exposing secret fields", async () => {
    mocks.catalog.mockResolvedValue([
      { t: "client_equipment", c: [["id", "uuid"], ["client_id", "uuid"], ["equipment_name", "text"], ["private_token", "text"]] },
      { t: "other_equipment", c: [["id", "uuid"], ["equipment_name", "text"]] },
    ]);
    const limit = vi.fn().mockResolvedValue({ data: [{ equipment_name: "Rack" }], count: 1, error: null });
    const eq = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const reply = await localClientReply({ ...ctx, coach: false, db: { from }, question: "What equipment does she have?" });
    expect(reply.text).toContain("Rack");
    expect(reply.text).toContain("Source: client_equipment");
    expect(from).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("client_id", ctx.clientId);
    expect(select.mock.calls[0][0]).not.toContain("private_token");
    mocks.catalog.mockClear();
    await localClientReply({ ...ctx, db: { from }, question: "What equipment does she have?" });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("denies unauthorized targets before loading any data", async () => {
    mocks.access.mockRejectedValueOnce(new Error("not authorized"));
    await expect(localClientReply({ ...ctx, question: "Current nutrition" })).rejects.toThrow("not authorized");
    expect(mocks.readers).not.toHaveBeenCalled();
    expect(mocks.nutrition).not.toHaveBeenCalled();
  });
  it("does not expose billing to coaches", async () => {
    const reply = await localClientReply({ ...ctx, question: "How much does she owe?" });
    expect(mocks.purchases).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/authorized admins/);
    await localClientReply({ ...ctx, coach: false, question: "Show billing" });
    expect(mocks.purchases).toHaveBeenCalledWith({ client_id: "selected-client" }, expect.anything());
  });
  it("does not execute actions, new file reads or arbitrary external processing", async () => {
    for (const request of [
      { question: "Change her nutrition plan" },
      { question: "Show the attempts and send them to Gemini" },
      { question: "Current nutrition", attachments: true },
      { question: "Answer this obscure hypothetical" },
    ]) {
      const result = await localClientReply({ ...ctx, ...request });
      expect(result.text).toBeTruthy();
      expect(result.choices?.length).toBeGreaterThan(0);
    }
    expect(mocks.readers).not.toHaveBeenCalled();
    expect(mocks.attempt).not.toHaveBeenCalled();
    expect(mocks.nutrition).not.toHaveBeenCalled();
  });
});
