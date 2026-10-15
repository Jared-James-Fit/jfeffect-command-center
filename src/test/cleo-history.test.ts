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

  it("deletes an extra workout card completely, and Undo puts it back", async () => {
    tables.pl_days.push({ id: "extra", week_id: "w1", day_index: 6, title: "Calf Finisher", is_custom: true, scheduled_date: "2026-10-12" });
    tables.pl_exercise_rows.push(row("rx", 0, "calf", { day_id: "extra" }));
    tables.pl_scheduled_workouts = [{ id: "s-extra", client_id: "c1", source_day_id: "extra", scheduled_date: "2026-10-12" }];
    const program = await import("@/lib/cleo-program.server");
    const h = await import("@/lib/cleo-history.server");

    const card = await program.describeProgramAction(db, "remove_workout", { workout_id: "s-extra" }, "2026-10-12");
    expect(card).toMatch(/Delete .*extra workout "Calf Finisher".*whole card/);

    const cap = await h.captureBefore(db, "remove_workout", { workout_id: "s-extra" });
    expect(await program.executeProgramAction({ supabase: db, userId: "u1" }, "remove_workout", { workout_id: "s-extra" }, "2026-10-12")).toBe("Workout card deleted.");
    expect(tables.pl_days.some((d) => d.id === "extra")).toBe(false);
    expect(tables.pl_scheduled_workouts).toHaveLength(0);
    // The Monday workout is untouched.
    expect(tables.pl_days.some((d) => d.id === DAY)).toBe(true);

    await h.saveVersion(db, cap!, "remove_workout", { workout_id: "s-extra" }, card, null, "u1");
    expect(await h.restoreVersion({ supabase: db, userId: "u1" }, tables.pl_program_versions[0].id)).toBe("Workout card put back.");
    expect(tables.pl_days.find((d) => d.id === "extra")?.title).toBe("Calf Finisher");
    expect(tables.pl_scheduled_workouts.map((x) => x.id)).toEqual(["s-extra"]);
  });

  it("won't delete a workout that was started", async () => {
    tables.pl_days.push({ id: "extra", week_id: "w1", day_index: 6, title: "Calf Finisher", is_custom: true });
    tables.pl_scheduled_workouts = [{ id: "s-extra", client_id: "c1", source_day_id: "extra", scheduled_date: "2026-10-12" }];
    tables.pl_day_completions.push({ day_id: "extra", scheduled_workout_id: "s-extra", started_at: "2026-10-12T20:00:00Z" });
    const program = await import("@/lib/cleo-program.server");
    await expect(program.describeProgramAction(db, "remove_workout", { workout_id: "s-extra" }, "2026-10-12")).rejects.toThrow(/started or logged/);
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
  it("uses a model the gateway takes on /v1/chat/completions (not Claude)", async () => {
    const { CLEO_PRIMARY_MODEL } = await import("@/lib/summer.server");
    expect(CLEO_PRIMARY_MODEL).not.toMatch(/^anthropic\//);
  });

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
  it("maps picker values to server voices, defaulting to Smooth (old saved picks too)", async () => {
    const { serverVoiceOf, serverVoiceValue } = await import("@/lib/cleo-voices");
    expect(serverVoiceOf("summer")).toBe("smooth");
    expect(serverVoiceOf("summer:warm")).toBe("warm");
    expect(serverVoiceOf("summer:deep")).toBe("smooth");
    expect(serverVoiceOf("summer:neutral")).toBe("smooth");
    expect(serverVoiceOf("com.apple.voice.Samantha")).toBeNull();
    expect(serverVoiceValue("smooth")).toBe("summer");
    expect(serverVoiceValue("soft")).toBe("summer:soft");
  });

  it("asks for a smooth, natural female voice", async () => {
    const { SUMMER_VOICE_STYLE } = await import("@/lib/summer.server");
    expect(SUMMER_VOICE_STYLE).toMatch(/smooth, warm, natural female voice/);
  });

  it("wraps Google's raw 24kHz audio as a playable WAV", async () => {
    const { pcmToWav } = await import("@/lib/summer.server");
    const pcm = btoa(String.fromCharCode(...new Uint8Array(480)));
    const wav = Uint8Array.from(atob(pcmToWav(pcm, 24000)), (c) => c.charCodeAt(0));
    expect(wav.length).toBe(44 + 480);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(480);
  });

  it("tries Google's voices first, then OpenAI's", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/summer.server.ts", "utf8");
    expect(src.indexOf('name: "lovable:google/gemini-tts"')).toBeLessThan(src.indexOf('name: "lovable:openai/gpt-4o-mini-tts"'));
    expect(src).toContain('smooth: { openai: ["marin", "nova"], gemini: "Despina"');
  });
});

describe("Cleo's thinking music", () => {
  it("is subtle lo-fi chill: soft seventh chords with a few rounded notes, fading in after a pause", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/app-sounds.ts", "utf8");
    expect(src).toContain("export function thinkingMusic(");
    expect(src).toMatch(/Dmaj7: A3 D4 F#4 A4 \| D5 F#5 A5 C#6/);
    expect(src).toMatch(/Gmaj7: G3 B3 D4 F#4/);
    // Sparse, unhurried notes with a soft attack (no plinky music box).
    expect(src).toContain("const STEP = 0.6;");
    expect(src).toContain("rand() < 0.3");
    expect(src).toContain("g.gain.linearRampToValueAtTime(vel * level, t + 0.06)");
    expect(src).toContain("master.gain.linearRampToValueAtTime(1, t0 + 1.2)");
    // Still follows the sounds toggle and stays quiet for quick answers.
    expect(src).toMatch(/startThinkingSound\(\): \(\) => void \{\n  if \(typeof window === "undefined" \|\| !appSoundsEnabled\(\)\) return/);
    expect(src).toMatch(/\}, 350\);/);
  });

  it("never puts two notes a semitone apart (inside a chord, or where one chord fades into the next)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/app-sounds.ts", "utf8");
    const pads = [...src.matchAll(/\{ pad: \[([\d., ]+)\], tones: \[([\d., ]+)\] \}/g)].map((m) => ({
      pad: m[1].split(",").map(Number),
      tones: m[2].split(",").map(Number),
    }));
    expect(pads).toHaveLength(4);
    const semis = (a: number, b: number) => Math.abs(Math.round(12 * Math.log2(a / b)));
    const clash = (notes: number[]) => notes.some((a, i) => notes.some((b, j) => i < j && semis(a, b) % 12 === 1 && semis(a, b) < 12));
    pads.forEach((p, i) => {
      expect(clash(p.pad)).toBe(false);
      expect(clash([...p.pad, ...p.tones])).toBe(false);
      expect(clash([...p.pad, ...pads[(i + 1) % pads.length].pad])).toBe(false);
    });
  });
});
