import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MeetingBusy, writeFresh } from "@/lib/coaching-sessions/fresh-write.server";
import { NOT_TRAINING_FILTER, isTrainingSessionType } from "@/lib/booking-types";

/** A one-row stand-in for coaching_sessions: updates match on every .eq, and move updated_at. */
function fakeDb(initial: Record<string, any>, onRead?: (row: Record<string, any>) => void) {
  let row = { ...initial };
  let tick = 0;
  const bump = () => `2026-11-26T00:00:0${++tick}.000000+00:00`;
  return {
    get row() {
      return row;
    },
    /** someone else writes in between */
    external(patch: Record<string, any>) {
      row = { ...row, ...patch, updated_at: bump() };
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  const copy = { ...row };
                  onRead?.(row); // a write that lands right after this read
                  return { data: copy, error: null };
                },
              };
            },
          };
        },
        update(patch: Record<string, any>) {
          const conds: Array<[string, any]> = [];
          const chain: any = {
            eq(col: string, v: any) {
              conds.push([col, v]);
              return chain;
            },
            select() {
              return chain;
            },
            maybeSingle: async () => {
              if (!conds.every(([c, v]) => row[c] === v)) return { data: null, error: null };
              row = { ...row, ...patch, updated_at: bump() };
              return { data: { ...row }, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
}

describe("a meeting's writes never undo each other", () => {
  it("a write that lost the race is worked out again from the row as it now is", async () => {
    const db = fakeDb({ id: "s1", updated_at: "2026-11-26T00:00:00.000000+00:00", live: { notes: "a" } });
    const stale = { ...db.row };
    // another tap lands after this one read the row
    db.external({ live: { notes: "a", decisions: ["Squat opener 105"] } });
    const res = await writeFresh(
      db,
      "s1",
      (row) => ({ live: { ...(row.live ?? {}), started_at: "2026-11-26T01:00:00Z" } }),
      { first: stale as any },
    );
    expect(res?.wrote).toBe(true);
    expect(db.row.live).toEqual({ notes: "a", decisions: ["Squat opener 105"], started_at: "2026-11-26T01:00:00Z" });
  });

  it("nothing to change writes nothing", async () => {
    const db = fakeDb({ id: "s1", updated_at: "x" });
    const res = await writeFresh(db, "s1", () => null);
    expect(res?.wrote).toBe(false);
  });

  it("a row that keeps changing gives up with a plain message instead of writing over it", async () => {
    const db: any = fakeDb({ id: "s1", updated_at: "x" }, () => db.external({}));
    await expect(writeFresh(db, "s1", () => ({ coach_notes: "n" }), { tries: 3 })).rejects.toBeInstanceOf(MeetingBusy);
  });
});

describe("calls are found before the limit, training sessions never take their place", () => {
  it("the filter names every training type, quoted, and keeps calls with no type", () => {
    expect(NOT_TRAINING_FILTER.startsWith("session_type.is.null,session_type.not.in.(")).toBe(true);
    for (const t of ["Personal Training Session", "Technique Session", "Powerlifting Session", "Bodybuilding Session", "Assessment Session", "Custom Session"]) {
      expect(isTrainingSessionType(t)).toBe(true);
      expect(NOT_TRAINING_FILTER).toContain(`"${t}"`);
    }
    for (const f of ["src/lib/coaching-sessions/worker.server.ts", "src/lib/coaching-sessions/automation.server.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src.indexOf(".or(NOT_TRAINING_FILTER)")).toBeGreaterThan(-1);
      expect(src.indexOf(".or(NOT_TRAINING_FILTER)")).toBeLessThan(src.indexOf(".limit(60)"));
    }
  });
});

describe("a recording never sits stuck", () => {
  const sql = readFileSync("supabase/migrations/20270530110000_meeting_recording_reliability.sql", "utf8");
  const audio = readFileSync("src/lib/coaching-sessions/audio.server.ts", "utf8");
  it("parts waiting on the client's AI permission are checked again, and wake the job", () => {
    expect(audio).toContain("and(status.eq.waiting_consent,updated_at.lt.");
    expect(sql).toContain("status = 'waiting_consent' AND updated_at < now() - interval '10 minutes'");
  });
  it("a part cut off on its last try is failed, so the recording can finish", () => {
    expect(audio).toMatch(/status: "failed"[\s\S]{0,200}\.eq\("status", "transcribing"\)[\s\S]{0,80}\.gte\("attempts", MAX_ATTEMPTS\)/);
  });
  it("audio that never became a transcript is deleted when its retention runs out", () => {
    expect(sql).toContain("FUNCTION public.coaching_audio_due()");
    expect(sql).toContain("OR EXISTS (SELECT 1 FROM public.coaching_audio_due())");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.coaching_audio_due\(\) FROM PUBLIC, anon, authenticated/);
    expect(readFileSync("src/routes/api/public/hooks/coaching-sessions-tick.ts", "utf8")).toContain('sb.rpc("coaching_audio_due")');
  });
});
