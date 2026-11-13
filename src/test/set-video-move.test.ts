// A set video on the wrong set moves to the set it really is: the clip, its
// chat message and its film caption together, from the clip's ⋯.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moveChoices } from "@/lib/set-videos/move";
import { filmSetValues } from "@/lib/workout-film";

const read = (p: string) => readFileSync(p, "utf8");
const set = (row_id: string, set_index: number, value: number, reps: number, rpe: number) => ({
  row_id, set_index, entered_value: value, entered_unit: "lb", actual_reps: reps, actual_rpe_num: rpe, load_type: "external",
});

describe("the sets a clip can move to", () => {
  const rows = [
    { id: "hip", sort_order: 1, sets: 3, name: "Hip Thrust - Barbell" },
    { id: "belt", sort_order: 0, sets: 3, name: "Belt Squat" },
    { id: "walk", sort_order: 5, sets: null, name: "Treadmill Walk" },
  ];
  const results = [set("belt", 1, 65, 12, 8), set("belt", 2, 65, 12, 8), set("belt", 3, 65, 12, 8), set("hip", 1, 65, 12, 8), set("hip", 4, 75, 10, 9)];
  const choices = moveChoices(rows, results);

  it("lists the workout's exercises in order, each with as many sets as written or logged", () => {
    expect(choices.map((e) => e.name)).toEqual(["Belt Squat", "Hip Thrust - Barbell", "Treadmill Walk"]);
    expect(choices[1].sets.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(choices[2].sets.map((s) => s.n)).toEqual([1]);
  });
  it("labels a logged set by its own numbers, like the upload's, and an unlogged one with nothing", () => {
    expect(choices[0].sets[2]).toEqual({ n: 3, logged: true, label: "65 lb × 12 @ RPE 8", labelNoLoad: expect.stringContaining("12") });
    expect(choices[1].sets[1]).toEqual({ n: 2, logged: false, label: "", labelNoLoad: "" });
  });
  it("reads a logged set's numbers the same way the film does", () => {
    expect(filmSetValues({ entered_value: "65", entered_unit: "lb", actual_reps: 12, actual_rpe: "8", load_type: "external" })).toEqual({
      load: 65, unit: "lb", reps: 12, rpe: 8, rir: null, loadType: "external", durationSec: null,
    });
    expect(filmSetValues({ actual_load: 100, actual_load_unit: "kg", load_type: "bodyweight" }).loadType).toBe("bodyweight");
  });
});

describe("moving it", () => {
  const sql = read("supabase/migrations/20270310090000_set_video_move.sql");
  const sheet = read("src/components/workout-day/set-video-sheet.tsx");
  const picker = read("src/components/workout-day/set-video-move.tsx");
  const cell = read("src/components/workout-day/set-video-cell.tsx");

  it("is for the athlete, whoever sent it, their coach and admins, and only within the same workout", () => {
    expect(sql).toContain("OR v.client_id IN (SELECT public.coached_client_ids())");
    expect(sql).toContain("WHERE r.id = _row_id AND r.day_id = v.day_id;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text) FROM PUBLIC, anon;");
  });
  it("moves the clip, relabels its chat message as the server and fixes its film caption", () => {
    expect(sql).toContain("SET row_id = _row_id, result_id = v_result, set_index = _set_index,");
    expect(sql).toContain("left('🎥 ' || v_ex || ' · Set ' || _set_index || coalesce(' · ' || nullif(v_label, ''), ''), 200)");
    expect(sql).toContain("PERFORM set_config('request.jwt.claims', '', true);");
    expect(sql).toContain("PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);");
    expect(sql).toContain("UPDATE public.community_posts p");
  });
  it("lives in the clip's ⋯ (Move to another set, Remove), never as more buttons", () => {
    expect(sheet).toContain("data-set-video-more");
    expect(sheet).toContain("Move to another set");
    expect(sheet).toContain("<Trash2 className=\"h-4 w-4\" /> Remove");
    expect(sheet).not.toContain('aria-label="Remove this video"');
    expect(picker).toContain('db.rpc("set_video_move"');
    expect(picker).toContain('label: "Undo"');
  });
  it("a moved clip never lingers on the set it left", () => {
    expect(cell).toContain("!(data ?? []).some((v) => v.id === j.setVideoId)");
  });
});
