/**
 * Program history: Cleo's program changes keep a restore point and Undo puts
 * the day back, without ever touching a day the client has trained.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};

/** A tiny in-memory stand-in for the Supabase query builder (what these paths use). */
function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" | "delete" | "insert" = "select";
      let patch: Row | Row[] = {};
      let order: string | null = null;
      let limit = Infinity;
      const rowsOf = () => (tables[table] ??= []);
      const matches = () => rowsOf().filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (op === "insert") {
          const list = (Array.isArray(patch) ? patch : [patch]).map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 9)}`, created_at: new Date().toISOString(), ...r }));
          rowsOf().push(...list);
          return list;
        }
        const hit = matches();
        if (op === "update") hit.forEach((r) => Object.assign(r, patch));
        if (op === "delete") tables[table] = rowsOf().filter((r) => !hit.includes(r));
        let out = [...hit];
        if (order) out.sort((a, b) => (a[order!] ?? 0) - (b[order!] ?? 0));
        // A real database hands back copies, never the stored rows.
        return out.slice(0, limit).map((r) => structuredClone(r));
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
        neq: (k: string, v: any) => (filters.push((r) => r[k] !== v), q),
        is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), q),
        in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), q),
        gt: (k: string, v: any) => (filters.push((r) => r[k] > v), q),
        gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), q),
        order: (k: string) => ((order = k), q),
        limit: (n: number) => ((limit = n), q),
        update: (p: Row) => ((op = "update"), (patch = p), q),
        delete: () => ((op = "delete"), q),
        insert: (p: Row | Row[]) => ((op = "insert"), (patch = p), q),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => ({ data: run()[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

const db = fakeDb();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));

const DAY = "day-1";
const row = (id: string, sort_order: number, exercise_id: string, extra: Row = {}) => ({ id, day_id: DAY, sort_order, exercise_id, sets: 3, reps_text: "8", created_at: "x", updated_at: "x", ...extra });

beforeEach(() => {
  tables = {
    clients: [{ id: "c1" }],
    pl_blocks: [{ id: "b1", client_id: "c1", client_visible: true }],
    pl_weeks: [{ id: "w1", block_id: "b1", week_index: 1 }],
    pl_days: [{ id: DAY, week_id: "w1", day_index: 1, title: "Monday", is_custom: false }],
    pl_exercise_rows: [row("r1", 0, "squat"), row("r2", 1, "bench")],
    pl_day_completions: [],
    pl_row_results: [],
    pl_program_versions: [],
  };
});

describe("Cleo program history", () => {
  it("keeps a restore point for an edit and Undo puts the day back exactly", async () => {
    const h = await import("@/lib/cleo-history.server");
    const cap = await h.captureBefore(db, "edit_program_day", { day_id: DAY, scope: "this", changes: [] });
    expect(cap?.clientId).toBe("c1");

    // What the edit did: added calf raises as the 3rd exercise and changed bench to 5 sets.
    tables.pl_exercise_rows.push(row("r3", 2, "calf"));
    tables.pl_exercise_rows.find((r) => r.id === "r2")!.sets = 5;
    await h.saveVersion(db, cap!, "edit_program_day", { day_id: DAY }, "Add calf raises", "action-1", "u1");
    const v = tables.pl_program_versions[0];
    expect(v).toMatchObject({ client_id: "c1", kind: "edit_program_day", cleo_action_id: "action-1" });

    const out = await h.restoreVersion({ supabase: db, userId: "u1" }, v.id);
    expect(out).toMatch(/Put back 1 day/);
    expect(tables.pl_exercise_rows.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    expect(tables.pl_exercise_rows.find((r) => r.id === "r2")!.sets).toBe(3);
    // Marked undone, and the state before the undo is itself a restore point.
    expect(tables.pl_program_versions.find((x) => x.id === v.id)!.restored_at).toBeTruthy();
    expect(tables.pl_program_versions.some((x) => x.source === "restore")).toBe(true);
    await expect(h.restoreVersion({ supabase: db, userId: "u1" }, v.id)).rejects.toThrow(/already undone/);
  });

  it("never rewrites a day the client has since trained", async () => {
    const h = await import("@/lib/cleo-history.server");
    const cap = await h.captureBefore(db, "edit_program_day", { day_id: DAY, scope: "this", changes: [] });
    tables.pl_exercise_rows.push(row("r3", 2, "calf"));
    await h.saveVersion(db, cap!, "edit_program_day", { day_id: DAY }, "Add calf raises", null, "u1");
    tables.pl_row_results.push({ row_id: "r3", client_id: "c1" });

    const v = tables.pl_program_versions[0];
    await expect(h.restoreVersion({ supabase: db, userId: "u1" }, v.id)).rejects.toThrow(/stays as trained/);
    expect(tables.pl_exercise_rows.map((r) => r.id)).toContain("r3");
    // A failed undo can be tried again later.
    expect(tables.pl_program_versions[0].restored_at).toBeNull();
  });

  it("only versions program and nutrition changes", async () => {
    const h = await import("@/lib/cleo-history.server");
    expect(h.isVersionedKind("edit_program_day")).toBe(true);
    expect(h.isVersionedKind("set_nutrition_targets")).toBe(true);
    expect(h.isVersionedKind("send_message")).toBe(false);
    expect(await h.captureBefore(db, "send_message" as any, {})).toBeNull();
  });
});

describe("Cleo's models", () => {
  it("tries the strongest model first, then falls back", async () => {
    const { cleoModels } = await import("@/lib/summer.server");
    const list = cleoModels("anthropic/x", "google/gemini-3-flash-preview");
    expect(list[0]).toBe("anthropic/x");
    expect(list).toContain("google/gemini-3-flash-preview");
    expect(list[list.length - 1]).toBe("google/gemini-2.5-flash");
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("Cleo's voices", () => {
  it("maps picker values to server voices, defaulting to Neutral", async () => {
    const { serverVoiceOf, serverVoiceValue } = await import("@/lib/cleo-voices");
    expect(serverVoiceOf("summer")).toBe("neutral");
    expect(serverVoiceOf("summer:deep")).toBe("deep");
    expect(serverVoiceOf("summer:nope")).toBe("neutral");
    expect(serverVoiceOf("com.apple.voice.Samantha")).toBeNull();
    expect(serverVoiceValue("neutral")).toBe("summer");
    expect(serverVoiceValue("soft")).toBe("summer:soft");
  });

  it("asks for a voice that sounds neither male nor female", async () => {
    const { SUMMER_VOICE_STYLE } = await import("@/lib/summer.server");
    expect(SUMMER_VOICE_STYLE).toMatch(/neither male nor female/);
    expect(SUMMER_VOICE_STYLE).not.toMatch(/woman/);
  });
});
