import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_CLIENT_EMAIL,
  DEFAULT_DEMO_MEMBER_EMAIL,
  DEMO_DELETE_ORDER,
  chunk,
  daysAgoAt,
  demoCardio,
  demoCheckIn,
  demoCompletion,
  demoLoad,
  demoRefusal,
  demoSets,
  escapeIlike,
  groupByTable,
  parseDemoConfig,
  repsFromText,
  summarize,
} from "@/lib/app-review-demo";

const read = (p: string) => readFileSync(p, "utf8");
const fresh = { programs: 0, checkIns: 0, cardio: 0 };
const client = { id: "c1", user_id: "u1", service_tier: "coaching", archived: false };
const member = { id: "c2", user_id: "u2", service_tier: "self_serve", archived: false };

describe("which two logins are the demo accounts", () => {
  it("defaults to the two appreview addresses, and reads app_settings JSON, lowercased", () => {
    expect(parseDemoConfig(null)).toEqual({ clientEmail: DEFAULT_DEMO_CLIENT_EMAIL, memberEmail: DEFAULT_DEMO_MEMBER_EMAIL });
    expect(parseDemoConfig("not json")).toEqual(parseDemoConfig(null));
    expect(parseDemoConfig(JSON.stringify({ client_email: " Demo.Client@Example.com ", member_email: "demo.member@example.com" }))).toEqual({
      clientEmail: "demo.client@example.com",
      memberEmail: "demo.member@example.com",
    });
    expect(parseDemoConfig('{"client_email":"nope","member_email":42}')).toEqual(parseDemoConfig(null));
  });

  it("never the same login twice", () => {
    const c = parseDemoConfig('{"client_email":"a@b.co","member_email":"a@b.co"}');
    expect(c.clientEmail).not.toBe(c.memberEmail);
  });

  it("an email can't act as a wildcard", () => {
    expect(escapeIlike("a_b%c\\d@x.co")).toBe("a\\_b\\%c\\\\d@x.co");
  });
});

describe("real clients are never touched", () => {
  it("refuses a login that doesn't exist, has no login, is archived or is on the wrong plan", () => {
    expect(demoRefusal("client", "x@y.co", null, fresh, 0)).toMatch(/No client account/);
    expect(demoRefusal("member", "x@y.co", null, fresh, 0)).toMatch(/No member account/);
    expect(demoRefusal("client", "x@y.co", { ...client, user_id: null }, fresh, 0)).toMatch(/no login/);
    expect(demoRefusal("client", "x@y.co", { ...client, archived: true }, fresh, 0)).toMatch(/archived/);
    expect(demoRefusal("client", "x@y.co", member, fresh, 0)).toMatch(/must be on coaching/);
    expect(demoRefusal("member", "x@y.co", client, fresh, 0)).toMatch(/must be on self_serve/);
  });

  it("refuses an account that already has training, check-ins or cardio of its own", () => {
    for (const own of [{ ...fresh, programs: 1 }, { ...fresh, checkIns: 2 }, { ...fresh, cardio: 1 }]) {
      expect(demoRefusal("client", "x@y.co", client, own, 0)).toMatch(/already has its own training data/);
    }
  });

  it("a blank demo login passes; one the demo already seeded passes the data guard (it is then reported as already there)", () => {
    expect(demoRefusal("client", "x@y.co", client, fresh, 0)).toBeNull();
    expect(demoRefusal("member", "x@y.co", member, fresh, 0)).toBeNull();
    expect(demoRefusal("client", "x@y.co", client, { programs: 1, checkIns: 1, cardio: 1 }, 40)).toBeNull();
  });
});

describe("the made-up training", () => {
  const now = new Date("2026-11-25T12:00:00Z");

  it("dates are whole days back at 17:30 UTC", () => {
    expect(daysAgoAt(now, 3)).toBe("2026-11-22T17:30:00.000Z");
  });

  it("reps come from the first number; AMRAP and time give none", () => {
    expect(repsFromText("5")).toBe(5);
    expect(repsFromText("8-10")).toBe(8);
    expect(repsFromText("6 each side")).toBe(6);
    expect(repsFromText("AMRAP")).toBeNull();
    expect(repsFromText(null)).toBeNull();
  });

  it("loads use the program's number when it has one, are loadable, and follow the unit", () => {
    expect(demoLoad({ load_lb: 135 }, "lb", 1)).toBe(135);
    expect(demoLoad({ load_kg: 60 }, "kg", 1)).toBe(60);
    expect(demoLoad({}, "lb", 1)).toBe(95);
    expect(demoLoad({}, "kg", 1) % 2.5).toBe(0);
    expect(demoLoad({ load_lb: 1 }, "lb", 1)).toBeGreaterThanOrEqual(5);
  });

  it("sets: only plain weight-and-reps rows, one result per set, capped, with both units filled", () => {
    const rows = [
      { id: "r1", sets: 3, reps_text: "5", load_lb: 185 },
      { id: "r2", sets: 20, reps_text: "10" },
      { id: "r3", sets: 3, reps_text: "AMRAP" },
      { id: "r4", sets: 3, reps_text: "30", measurement_type: "time" },
      { id: "r5", sets: 2, reps_text: "8", duration_seconds: 60 },
    ];
    const out = demoSets(rows, { clientId: "c1", unit: "lb", completedAt: "2026-11-20T17:30:00.000Z" });
    expect(out.filter((s) => s.row_id === "r1")).toHaveLength(3);
    expect(out.filter((s) => s.row_id === "r2")).toHaveLength(6);
    expect(out.some((s) => ["r3", "r4", "r5"].includes(String(s.row_id)))).toBe(false);
    const first = out[0] as any;
    expect(first).toMatchObject({ client_id: "c1", set_index: 1, actual_load: 185, actual_load_unit: "lb", actual_reps: 5 });
    expect(first.actual_load_kg).toBeCloseTo(83.91, 1);
    expect(new Set(out.filter((s) => s.row_id === "r1").map((s) => s.set_index)).size).toBe(3);
  });

  it("a finished workout, a completed check-in and a cardio plan, all plainly synthetic", () => {
    expect(demoCompletion({ dayId: "d1", clientId: "c1", completedAt: "x" })).toMatchObject({ day_id: "d1", client_id: "c1", client_notes: "Demo data for App Review" });
    const ci = demoCheckIn({ clientId: "c1", submittedAt: "x" }) as any;
    expect(ci).toMatchObject({ task_type: "weekly_checkin", status: "completed", ai_status: "ready" });
    expect(ci.ai_analysis.fallback).toBe(true);
    const cardio = demoCardio({ clientId: "c1", startDate: "2026-11-11" });
    expect(cardio).toMatchObject({ client_id: "c1", status: "Active", frequency_per_week: 3, visible_to_client: true });
    expect(cardio.admin_notes).toMatch(/App Review demo/);
  });
});

describe("removal deletes only what was listed, children first", () => {
  it("logged sets and finished workouts go before the program (the history guard)", () => {
    const o = [...DEMO_DELETE_ORDER];
    expect(o.indexOf("pl_row_results")).toBeLessThan(o.indexOf("pl_blocks"));
    expect(o.indexOf("pl_day_completions")).toBeLessThan(o.indexOf("pl_blocks"));
    expect(o.indexOf("pl_blocks")).toBeLessThan(o.indexOf("pl_preps"));
  });

  it("groups the registry by table and ignores a table it doesn't know", () => {
    const g = groupByTable([
      { table_name: "pl_blocks", record_id: "b1" },
      { table_name: "pl_row_results", record_id: "s1" },
      { table_name: "pl_row_results", record_id: "s2" },
      { table_name: "clients", record_id: "NEVER" },
    ]);
    expect(g.pl_row_results).toEqual(["s1", "s2"]);
    expect(g.pl_blocks).toEqual(["b1"]);
    expect(Object.values(g).flat()).not.toContain("NEVER");
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("the words say what is there", () => {
    expect(summarize({ counts: {} })).toBe("nothing yet");
    expect(summarize({ counts: { pl_blocks: 1, pl_day_completions: 3, pl_row_results: 40, messenger_checkins: 1, cardio_targets: 1 } })).toBe("1 program, 3 logged workouts, 40 sets, 1 check-in, 1 cardio plan");
  });
});

describe("what the server function and the migration are allowed to do", () => {
  const fn = read("src/lib/app-review-demo.functions.ts");
  const mig = read("supabase/migrations/20270527109600_app_review_demo_data.sql");

  it("never creates a user or sets a password", () => {
    expect(fn).not.toMatch(/auth\.admin|createUser|updateUserById|inviteUserByEmail|password/i);
    expect(mig).not.toMatch(/auth\.users|crypt\(|encrypted_password/i);
  });

  it("every action is admin-only", () => {
    expect(fn.match(/await assertAdmin\(context\)/g)?.length).toBe(3);
    expect(fn).toContain('_role: "admin"');
  });

  it("writes only the tables it lists, never clients or profiles, and removes only listed ids", () => {
    expect(fn).not.toMatch(/from\("(clients|profiles|app_members|user_roles)"\)\s*\.(insert|update|delete|upsert)/);
    expect(fn).toContain('.delete().in("id", part)');
    expect(mig).toContain("ENABLE ROW LEVEL SECURITY");
    expect(mig).toContain("(SELECT public.has_role((SELECT auth.uid()), 'admin'))");
    expect(mig).toContain("table_name IN ('pl_blocks', 'pl_preps', 'pl_row_results', 'pl_day_completions', 'messenger_checkins', 'cardio_targets')");
  });

  it("the settings page has the two buttons, for admins", () => {
    const card = read("src/components/admin/app-review-demo-card.tsx");
    expect(card).toContain("Prepare App Review demo data");
    expect(card).toContain("Remove demo data");
    expect(read("src/routes/_authenticated/admin/settings.tsx")).toContain("{isAdmin && <AppReviewDemoCard />}");
  });
});
