import { describe, it, expect } from "vitest";
import {
  CARDIO_EMPTY_METRICS,
  deleteCardioCompletion,
  saveCardioCompletion,
  type CardioCompletionRow,
} from "@/lib/cardio-completion";

const KEY = { client_id: "c1", cardio_target_id: "t1", completed_date: "2026-10-06" };
const ROW: CardioCompletionRow = { ...KEY, completed: true, skipped: false, duration_minutes: 25 };

type Result = { data: any; error: any };

/** Minimal chainable stand-in for supabase.from(...). Each call to a terminal
 *  method (maybeSingle / single / delete's await) pops the next queued result. */
function fakeDb(results: Result[]) {
  const calls: { op: string; payload?: any }[] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const chain = (op: string, payload?: any) => {
    calls.push({ op, payload });
    const c: any = {
      eq: () => c,
      select: () => c,
      maybeSingle: async () => next(),
      single: async () => next(),
      then: (res: any, rej: any) => Promise.resolve(next()).then(res, rej),
    };
    return c;
  };
  return {
    calls,
    from: () => ({
      update: (p: any) => chain("update", p),
      insert: (p: any) => chain("insert", p),
      delete: () => chain("delete"),
    }),
  };
}

describe("saveCardioCompletion", () => {
  it("updates the existing row without inserting", async () => {
    const db = fakeDb([{ data: { ...ROW, id: "r1" }, error: null }]);
    const saved = await saveCardioCompletion(db, ROW);
    expect(saved.id).toBe("r1");
    expect(db.calls.map((c) => c.op)).toEqual(["update"]);
    // key columns are matched on, never rewritten
    expect(db.calls[0].payload).not.toHaveProperty("client_id");
  });

  it("inserts when there is no row yet", async () => {
    const db = fakeDb([
      { data: null, error: null },
      { data: { ...ROW, id: "r2" }, error: null },
    ]);
    const saved = await saveCardioCompletion(db, ROW);
    expect(saved.id).toBe("r2");
    expect(db.calls.map((c) => c.op)).toEqual(["update", "insert"]);
  });

  it("throws a rejected write instead of reporting success", async () => {
    const dbErr = { code: "42P10", message: "no unique or exclusion constraint matching the ON CONFLICT specification" };
    const db = fakeDb([
      { data: null, error: null },
      { data: null, error: dbErr },
    ]);
    await expect(saveCardioCompletion(db, ROW)).rejects.toMatchObject({ code: "42P10" });
  });

  it("throws when the update itself fails (e.g. RLS)", async () => {
    const db = fakeDb([{ data: null, error: { code: "42501", message: "denied" } }]);
    await expect(saveCardioCompletion(db, ROW)).rejects.toMatchObject({ code: "42501" });
    expect(db.calls.map((c) => c.op)).toEqual(["update"]);
  });

  it("recovers when another device inserted first (unique violation)", async () => {
    const db = fakeDb([
      { data: null, error: null },
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { ...ROW, id: "r3" }, error: null },
    ]);
    const saved = await saveCardioCompletion(db, ROW);
    expect(saved.id).toBe("r3");
    expect(db.calls.map((c) => c.op)).toEqual(["update", "insert", "update"]);
  });
});

describe("deleteCardioCompletion", () => {
  it("throws on error", async () => {
    const db = fakeDb([{ data: null, error: { message: "nope" } }]);
    await expect(deleteCardioCompletion(db, KEY)).rejects.toMatchObject({ message: "nope" });
  });

  it("resolves when the delete succeeds", async () => {
    const db = fakeDb([{ data: null, error: null }]);
    await expect(deleteCardioCompletion(db, KEY)).resolves.toBeUndefined();
  });
});

describe("CARDIO_EMPTY_METRICS", () => {
  it("clears every metric a skip must not inherit", () => {
    for (const v of Object.values(CARDIO_EMPTY_METRICS)) expect(v).toBeNull();
  });
});
