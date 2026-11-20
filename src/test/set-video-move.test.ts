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

/**
 * Nov 20 2026: the coach put a clip on the wrong exercise and found the move
 * picker offered only working sets; warm-ups (set 0) weren't destinations, and
 * an exercise on two cards (a top set, then back-offs) read the same twice.
 */
describe("warm-ups and repeated exercises", () => {
  const rows = [
    { id: "top", sort_order: 0, sets: 1, reps_text: "3", name: "Competition Squat" },
    { id: "back", sort_order: 1, sets: 2, reps_text: "4", purpose_label: "Backoff", name: "Competition Squat" },
    { id: "curl", sort_order: 2, sets: 3, reps_text: "12", name: "Cable Curl" },
    { id: "walk", sort_order: 3, sets: 1, name: "Treadmill Walk" },
  ];
  const warmups = [
    { id: "w2", row_id: "top", load: 315, unit: "lb", reps: 1, rpe: 7, created_at: "2026-11-20T10:05:00Z" },
    { id: "w1", row_id: "top", load: 275, unit: "lb", reps: 3, rpe: null, created_at: "2026-11-20T10:00:00Z" },
  ];
  const choices = moveChoices(rows, [], warmups);

  it("names a repeated exercise by its role there, and keeps the exercise itself for the clip", () => {
    expect(choices.map((e) => e.name)).toEqual(["Competition Squat · Top set", "Competition Squat · Backoff", "Cable Curl", "Treadmill Walk"]);
    expect(choices[1].exercise).toBe("Competition Squat");
  });
  it("offers each logged warm-up in the order they were done, with its numbers", () => {
    expect(choices[0].warmups).toEqual([
      { id: "w1", logged: true, label: "275 lb × 3" },
      { id: "w2", logged: true, label: "315 lb × 1 · RPE 7" },
    ]);
  });
  it("offers the warm-up still to log on a lift with nothing logged yet, never on cardio done for time", () => {
    expect(choices[1].warmups).toEqual([{ id: null, logged: false, label: "" }]);
    expect(choices[3].warmups).toEqual([]);
  });
  it("a lift done with no weight takes no warm-up", () => {
    const bw = moveChoices([{ id: "pu", sort_order: 0, sets: 3, name: "Pull Up" }], [{ row_id: "pu", set_index: 1, actual_reps: 8, load_type: "bodyweight" } as any]);
    expect(bw[0].warmups).toEqual([]);
  });

  const sql = read("supabase/migrations/20270420090000_set_video_move_warmups.sql");
  const picker = read("src/components/workout-day/set-video-move.tsx");
  it("the move takes a warm-up: one of this athlete's on that exercise, or the one still to log", () => {
    expect(sql).toContain("IF _set_index IS NULL OR _set_index NOT BETWEEN 0 AND 50 THEN");
    expect(sql).toContain("WHERE w.id = _warmup_id AND w.row_id = _row_id AND w.client_id = v.client_id;");
    expect(sql).toContain("SET row_id = _row_id, result_id = v_result, warmup_id = v_warmup, set_index = _set_index,");
    expect(sql).toContain("v_name := 'Warm-up';");
  });
  it("its chat card says it's a warm-up, the film never holds one, and Undo knows where it came from", () => {
    expect(sql).toContain("(a -> 'set_video') - 'label' - 'warmup'");
    expect(sql).toContain("'warmup', CASE WHEN _set_index = 0 THEN true END");
    expect(sql).toContain("WHERE _set_index > 0 OR NOT (f ->> 'path' LIKE '%/' || v.id::text || '%')) AS new_film");
    expect(sql).toContain("'warmup_id', v.warmup_id));");
  });
  it("is the same function for every app version, guarded on the one it replaces", () => {
    expect(sql).toContain("IS DISTINCT FROM '23fbf99cbe3a6ec5dea5cc96735decdd' THEN");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.set_video_move(uuid, uuid, integer, text, text);");
    expect(sql).toContain("_warmup_id uuid DEFAULT NULL");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text, uuid) TO authenticated, service_role;");
  });
  it("the picker sends the warm-up and puts a warm-up's clip back on its warm-up", () => {
    expect(picker).toContain("...(spot.n === 0 ? { _warmup_id: spot.warmupId } : {}),");
    expect(picker).toContain('return { n: 0, label: w?.label ?? video.label ?? "", labelNoLoad: "", warmupId: video.warmup_id ?? null };');
    expect(picker).toContain("data-move-warmup");
  });
});

describe("an older clip only goes onto a logged set", () => {
  const picker = read("src/components/workout-day/set-video-move.tsx");
  it("leaves sets and warm-ups not logged yet out for a clip past the time it can wait on one", () => {
    expect(picker).toContain("const waitsOk = Date.now() - Date.parse(video.created_at) < UNLINKED_SET_VIDEO_MS;");
    expect(picker).toContain("disabled={here || !!busy || (!w.logged && !waitsOk)}");
    expect(picker).toContain("disabled={here || !!busy || (!s.logged && !waitsOk)}");
  });
});
