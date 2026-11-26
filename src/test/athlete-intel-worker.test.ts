import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";

/**
 * Athlete Intelligence end to end on an in-memory database: the real worker
 * reads uploads, stores deduped facts, re-evaluates the meet, raises (rarely)
 * and settles questions, and a deletion takes a file's facts out. The
 * competition re-read, the strength evidence, AI permission and pushes are
 * stubbed; everything else is the server code as it runs.
 */
const refreshed: string[] = [];
const pushed: any[] = [];
let consentOk = true;
vi.mock("@/lib/competition/worker.server", () => ({
  refreshLive: async (_sb: any, c: any) => {
    refreshed.push(c.id);
    return { before: 400, after: 412.5, queued: false };
  },
}));
vi.mock("@/lib/competition/load.server", () => ({
  loadLiftEvidence: async () => ({ squat: { nowKg: 150, hardSessions6w: 3 }, bench: { nowKg: 85, hardSessions6w: 3 }, deadlift: { nowKg: 180, hardSessions6w: 3 } }),
}));
vi.mock("@/lib/ai-consent/consent.server", () => ({ clientAllowsAi: async () => (consentOk ? { ok: true, name: "Mel" } : { ok: false, name: "Mel" }) }));
vi.mock("@/lib/push/push.server", () => ({ sendWebPushToUser: async (_sb: any, to: string, p: any) => void pushed.push({ to, ...p }) }));

const { runIntelTick } = await import("@/lib/athlete-intel/worker.server");
const { answerQuestion, loadIntel, afterChange, loadFacts } = await import("@/lib/athlete-intel/intel.server");

const CLIENT = "client-mel";
const COMP = "comp-prov";
let db: FakeDb;
let t = 0;
const source = (id: string, over: Record<string, any>) => {
  t++;
  db.rows("athlete_intel_sources").push({
    id,
    client_id: CLIENT,
    competition_id: COMP,
    kind: "text",
    file_name: null,
    file_path: null,
    provider: "primary_coach",
    provider_name: "Shaina",
    purposes: [],
    detected_purposes: [],
    status: "queued",
    attempts: 0,
    created_at: `2026-11-2${Math.min(5, t)}T1${t}:00:00Z`,
    updated_at: new Date().toISOString(),
    ...over,
  });
};
const src = (id: string) => db.rows("athlete_intel_sources").find((s) => s.id === id)!;
const facts = () => db.rows("athlete_intel_facts");
const openQs = () => db.rows("athlete_intel_questions").filter((q) => q.status === "open");

const LOG = {
  name: "Mel block 3",
  rows: [
    ["Date", "Exercise", "Sets", "Reps", "Prescribed load (kg)", "RPE target", "Actual load", "Actual RPE"],
    ["Nov 16", "Comp Squat", "1", "2", "150", "8", "152.5", "8.5"],
    ["", "Comp Squat", "3", "4", "135", "7", "135", "7"],
    ["", "Paused Bench", "3", "3", "80", "8", "", ""],
    ["Nov 18", "Deadlift", "1", "1", "160", "7", "", ""],
  ],
};
/** the same log with a heavy deadlift single prescribed and nothing saying it happened */
const HEAVY = { ...LOG, rows: LOG.rows.map((r) => (r[1] === "Deadlift" ? ["Nov 18", "Deadlift", "1", "1", "190", "9", "", ""] : r)) };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  refreshed.length = 0;
  pushed.length = 0;
  consentOk = true;
  t = 0;
  db = new FakeDb(
    {
      clients: [{ id: CLIENT, first_name: "Mel", user_id: null, assigned_coach_id: null, preferred_weight_unit: "kg", weight_unit_confirmed_at: "2026-01-01" }],
      competitions: [{ id: COMP, client_id: CLIENT, name: "Provincials", meet_date: "2026-12-12", status: "upcoming", federation: "CPU", rules: null, athlete_info: {} }],
      competition_handling: [{ id: "h1", competition_id: COMP, client_id: CLIENT, handler_user_id: "handler-1", status: "preparing", share_with_coach: "yes" }],
    },
    {
      athlete_intel_facts: [["client_id", "dedupe_key"]],
      athlete_intel_questions: [["client_id", "competition_id", "key"]],
    },
  );
});

describe("an external coach's file, read for the meet", () => {
  it("reads a training log: completed sets apart from prescribed ones, the meet re-read, nothing asked", async () => {
    source("s1", { kind: "xlsx", file_name: "Mel block 3.xlsx", sheets: [LOG] });
    const r = await runIntelTick(db as any, "s1");
    expect(r.status).toBe("ready");
    expect(src("s1").summary.line).toBe("Read 4 completed sets, 4 prescribed");
    expect(src("s1").summary.impact).toEqual({ competitionId: COMP, before: 400, after: 412.5 });
    const done = facts().filter((f) => f.data.completion === "completed");
    expect(done.map((f) => f.data.loadKg).sort()).toEqual([135, 152.5]);
    expect(facts().find((f) => f.lift === "deadlift")!.data.completion).toBe("prescribed");
    expect(facts().every((f) => f.provider === "primary_coach" && f.provider_name === "Shaina")).toBe(true);
    expect(refreshed).toEqual([COMP]);
    expect(openQs()).toEqual([]);
    expect(db.rows("athlete_intel_events").some((e) => e.action === "source_analyzed")).toBe(true);
  });

  it("asks once about a heavy single the plan prescribed, and the answer counts it", async () => {
    source("s1", { kind: "xlsx", file_name: "Mel block 3.xlsx", sheets: [HEAVY] });
    await runIntelTick(db as any, "s1");
    const qs = openQs();
    expect(qs).toHaveLength(1);
    expect(qs[0].text).toBe("The program prescribed a 190 kg deadlift single on Nov 18, but there's no recorded result. Was it completed?");
    // no login: the athlete can't be asked in the app; their coach can (they said yes to sharing)
    expect(qs[0].ask_who).toEqual(["handler", "primary_coach"]);
    await answerQuestion(db as any, qs[0], { value: "yes" }, { userId: "handler-1", role: "handler" });
    const dl = (await loadFacts(db as any, CLIENT)).filter((f) => f.lift === "deadlift" && f.kind === "training");
    expect(dl.some((f) => f.basis === "answer" && (f.data as any).completion === "completed" && (f.data as any).loadKg === 190)).toBe(true);
    expect(openQs()).toEqual([]);
    // read again later, nothing brings it back
    await afterChange(db as any, CLIENT);
    expect(openQs()).toEqual([]);
  });

  it("the same file twice is one set of facts, credited to both uploads", async () => {
    source("s1", { kind: "xlsx", file_name: "Mel block 3.xlsx", sheets: [LOG] });
    await runIntelTick(db as any, "s1");
    const before = facts().length;
    source("s2", { kind: "xlsx", file_name: "block 3 (1).xlsx", provider: "athlete", provider_name: null, sheets: [LOG] });
    await runIntelTick(db as any, "s2");
    expect(facts().length).toBe(before);
    expect(facts().every((f) => (f.also_sources ?? []).includes("s2"))).toBe(true);
    expect(src("s2").summary.notes).toContain("Everything in it was already on file");
  });

  it("two attempt plans that disagree: one question, answered once, never asked again", async () => {
    source("s1", { text: "Openers: squat 140, bench 75, deadlift 175", source_text: "Openers: squat 140, bench 75, deadlift 175" });
    await runIntelTick(db as any, "s1");
    source("s2", { source_text: "Openers: squat 142.5, bench 75, deadlift 175", created_at: "2026-11-21T10:20:00Z" });
    await runIntelTick(db as any, "s2");
    const qs = openQs();
    expect(qs.map((q) => q.key)).toEqual([`conflict:attempts:${COMP}:squat`]);
    // the time-sensitive push waits: the meet is more than a week away
    expect(pushed).toEqual([]);
    const keep = qs[0].fact_ids[1];
    await answerQuestion(db as any, qs[0], { value: keep }, { userId: "handler-1", role: "handler" });
    expect(db.rows("athlete_intel_questions").find((q) => q.id === qs[0].id)!.status).toBe("answered");
    expect(openQs()).toEqual([]);
    const squat = (await loadFacts(db as any, CLIENT)).filter((f) => f.kind === "attempt_plan" && f.lift === "squat");
    expect(squat.map((f) => f.id)).toEqual([keep]);
    await afterChange(db as any, CLIENT);
    expect(openQs()).toEqual([]);
  });

  it("a coach's short note stays in their words as a meet-day instruction, no AI needed", async () => {
    const text = "Bench warm-ups: bar x5, 50x3, 60x2, 70x1\nShe tends to rush the walkout, remind her to take her time on meet day.";
    source("s1", { source_text: text });
    await runIntelTick(db as any, "s1");
    const ins = facts().find((f) => f.kind === "instruction");
    expect(ins).toMatchObject({ scope: "meet", competition_id: COMP, provider: "primary_coach" });
    expect(ins!.data.text).toMatch(/^She tends to rush the walkout/);
    expect(facts().some((f) => f.kind === "warmup" && f.lift === "bench")).toBe(true);
  });

  it("long notes wait for AI permission; what could be read without it is in, and nothing is lost", async () => {
    consentOk = false;
    const text = `Squat rack 9 safeties 6\n${"Her bench gets loose off the chest when she's tired, and she loses her arch when the bar gets heavy on top singles. ".repeat(2)}`;
    db.rows("clients")[0].user_id = "mel-login";
    source("s1", { source_text: text });
    const r = await runIntelTick(db as any, "s1");
    expect(r.status).toBe("waiting_consent");
    expect(src("s1").error).toMatch(/hasn't allowed AI processing/);
    expect(facts().some((f) => f.kind === "equipment" && f.data.rackHeight === "9")).toBe(true);
    expect(facts().some((f) => f.kind === "note" || f.kind === "instruction")).toBe(true);
  });

  it("a deleted file stops counting, and the meet is read again", async () => {
    source("s1", { kind: "xlsx", file_name: "Mel block 3.xlsx", sheets: [LOG] });
    await runIntelTick(db as any, "s1");
    expect((await loadFacts(db as any, CLIENT)).length).toBeGreaterThan(0);
    src("s1").status = "deleted";
    refreshed.length = 0;
    await afterChange(db as any, CLIENT);
    expect(await loadFacts(db as any, CLIENT)).toEqual([]);
    expect(refreshed).toEqual([COMP]);
    const view = await loadIntel(db as any, CLIENT, COMP, { staffView: true });
    expect(view.sources).toEqual([]);
    expect(view.deleted.map((s: any) => s.id)).toEqual(["s1"]);
  });

  it("the handler's view: one finding per lift that matters, no questions, nothing pending", async () => {
    source("s1", { kind: "xlsx", file_name: "Mel block 3.xlsx", sheets: [LOG] });
    await runIntelTick(db as any, "s1");
    const view = await loadIntel(db as any, CLIENT, COMP, { staffView: true });
    expect(view.pending).toBe(0);
    expect(view.questions.now).toEqual([]);
    expect(view.findings.map((f: any) => f.key)).toContain("best:squat");
    expect(view.recommendations).toEqual([]);
  });
});
