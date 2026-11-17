import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { jobOnSet, videoOnSet, UNLINKED_SET_VIDEO_MS } from "@/lib/set-videos/jobs";
import { setTitle, setVideoMessageBody, setWord } from "@/lib/set-videos/label";
import { WarmupRows, warmupEffortText, warmupRpeFrom } from "@/components/workout-day/final-warmup-input";
import { QUICK_LOG_BEATS, QuickLogTips, quickLogSteps } from "@/components/workout-day/quick-log-tips";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-11-16T18:00:00Z");
const recent = new Date(NOW - 60_000).toISOString();

describe("a warm-up's video is set 0, on the warm-up itself", () => {
  const warmClip = { row_id: "r1", result_id: null, warmup_id: "w1", set_index: 0, created_at: recent };
  const setClip = { row_id: "r1", result_id: "x1", warmup_id: null, set_index: 1, created_at: recent };

  it("a warm-up's clip is only ever on that warm-up, a set's only on its set", () => {
    expect(videoOnSet(warmClip, { rowId: "r1", setIndex: 0, resultId: "w1" }, NOW)).toBe(true);
    expect(videoOnSet(warmClip, { rowId: "r1", setIndex: 0, resultId: "w2" }, NOW)).toBe(false);
    expect(videoOnSet(warmClip, { rowId: "r1", setIndex: 1, resultId: "w1" }, NOW)).toBe(false);
    expect(videoOnSet(setClip, { rowId: "r1", setIndex: 0, resultId: "x1" }, NOW)).toBe(false);
    expect(videoOnSet(setClip, { rowId: "r1", setIndex: 1, resultId: "x1" }, NOW)).toBe(true);
  });

  it("one filmed on the open warm-up before it was saved is on its row's warm-up for 18 hours", () => {
    const loose = { ...warmClip, warmup_id: null };
    expect(videoOnSet(loose, { rowId: "r1", setIndex: 0, resultId: null }, NOW)).toBe(true);
    expect(videoOnSet(loose, { rowId: "r2", setIndex: 0, resultId: null }, NOW)).toBe(false);
    const old = { ...loose, created_at: new Date(NOW - UNLINKED_SET_VIDEO_MS - 1000).toISOString() };
    expect(videoOnSet(old, { rowId: "r1", setIndex: 0, resultId: null }, NOW)).toBe(false);
  });

  it("an upload in flight is on a warm-up or a set, never both", () => {
    expect(jobOnSet({ rowId: "r1", resultId: null, setIndex: 0 }, { rowId: "r1", setIndex: 0, resultId: null })).toBe(true);
    expect(jobOnSet({ rowId: "r1", resultId: null, setIndex: 0 }, { rowId: "r1", setIndex: 1, resultId: null })).toBe(false);
    expect(jobOnSet({ rowId: "r1", resultId: "w1", setIndex: 0 }, { rowId: "r1", setIndex: 0, resultId: "w1" })).toBe(true);
  });

  it("it reads as the warm-up everywhere: the cell, the sheet, toasts and the coach chat", () => {
    expect(setWord(0)).toBe("warm-up");
    expect(setWord(3)).toBe("set 3");
    expect(setTitle(0)).toBe("Warm-up");
    expect(setVideoMessageBody("Back Squat", 0, "245 lb × 3 · RPE 7")).toBe("Back Squat · Warm-up · 245 lb × 3 · RPE 7");
  });

  it("the database takes set 0 as a warm-up, ties a clip filmed first, and never puts one in the film", () => {
    const sql = read("supabase/migrations/20270329090000_warmup_videos.sql");
    expect(sql).toContain("CHECK (set_index BETWEEN 0 AND 50)");
    expect(sql).toContain("(set_index = 0 AND result_id IS NULL) OR (set_index > 0 AND warmup_id IS NULL)");
    expect(sql).toContain("v_name := CASE WHEN _set_index = 0 THEN 'Warm-up' ELSE public.pl_set_name(_row_id, _set_index) END;");
    expect(sql).toContain("AFTER INSERT ON public.pl_warmup_sets");
    expect(sql).toContain("IF NEW.set_index > 0 THEN NEW.warmup_id := NULL; END IF;");
    // the film reads clips on a working set's record; warm-ups get no Crew copy
    expect(read("src/lib/workout-film.functions.ts")).toContain("v.result_id && v.storage_path");
    expect(read("src/lib/set-videos/uploader.ts")).toContain("if (feedPlan && job.setIndex > 0) feedSources.set(");
    expect(read("src/lib/set-videos/catch-up.ts")).toContain('.gt("set_index", 0)');
    expect(read("src/lib/workout-film-client.ts")).toContain("j.setIndex > 0 && isActiveJob(j)");
  });
});

describe("the last warm-up is open on the card, and optional", () => {
  const base = {
    sets: [],
    unit: "lb" as const,
    gridTemplate: "34px 1fr 1fr 1.35fr 30px",
    form: null,
    onFormChange: () => {},
    onSave: () => {},
    onRemove: () => {},
    canEdit: true,
    prompt: { suggested: { load: 250, reps: 2 }, tunes: true },
    seed: { load: 250, reps: 2 },
    columns: { showReps: true, showTimer: false, showCalories: false, showVelocity: false, videoColumn: true },
    video: () => createElement("span", { "data-video-cell": "" }),
  };

  it("before set 1 on a barbell main lift: reps pre-filled, RPE 7, the weight empty, a camera", () => {
    const html = renderToStaticMarkup(createElement(WarmupRows, { ...base, openRow: true, suggestOn: true }));
    expect(html).toContain('data-testid="warmup-open"');
    expect(html).toContain('data-warmup-saved="false"');
    expect(html).toContain("Last warm-up reps");
    expect(html).toContain(">2<");
    expect(html).toContain(">7<");
    expect(html).toContain("Last warm-up weight in lb");
    expect(html).toContain("data-video-cell");
    expect(html).toContain("Last warm-up · optional");
    expect(html).toContain("tunes Suggested");
    // never the old one-line prompt beside it
    expect(html).not.toContain('data-testid="warmup-prompt"');
  });

  it("with Suggest off it says it sets today's weight", () => {
    const html = renderToStaticMarkup(createElement(WarmupRows, { ...base, openRow: true, suggestOn: false }));
    expect(html).toContain("sets today&#x27;s weight");
  });

  it("other compound lifts keep the one-line prompt, so a workout isn't a stack of open rows", () => {
    const html = renderToStaticMarkup(createElement(WarmupRows, { ...base, openRow: false }));
    expect(html).not.toContain('data-testid="warmup-open"');
    expect(html).toContain('data-testid="warmup-prompt"');
  });

  it("once it can't tune today's weight (a working set is in), there's no open row to fill", () => {
    const html = renderToStaticMarkup(createElement(WarmupRows, { ...base, openRow: true, prompt: { suggested: null, tunes: false } }));
    expect(html).not.toContain('data-testid="warmup-open"');
  });

  it("a saved warm-up keeps its own camera in the video column", () => {
    const html = renderToStaticMarkup(
      createElement(WarmupRows, {
        ...base,
        openRow: false,
        prompt: { suggested: null, tunes: false },
        sets: [{ id: "w1", row_id: "r1", load: 245, unit: "lb", reps: 3, rpe: 7, created_at: recent } as any],
      }),
    );
    expect(html).toContain('data-testid="warmup-row"');
    expect(html).toContain("data-video-cell");
    expect(html).toContain("grid-column:2 / -2");
  });

  it("an RIR card shows RIR and stores the RPE it means", () => {
    expect(warmupEffortText(7, "rir")).toBe("3");
    expect(warmupEffortText(7, "rpe")).toBe("7");
    expect(warmupRpeFrom("3", "rir")).toBe(7);
    expect(warmupRpeFrom("8", "rpe")).toBe(8);
    expect(warmupRpeFrom("", "rpe")).toBeNull();
  });

  it("the card opens it only on a barbell squat, bench or deadlift, and keeps a clip filmed on it", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("openRow={rangeLift(family, name, exercise?.equipment)}");
    expect(wdv).toContain("suggestOn={showSuggestionCard}");
    expect(wdv).toContain("looseClip={looseWarmupClip}");
    expect(wdv).toContain("setIndex={0}");
  });
});

describe("one tap on set 1's number logs the exercise, like a typed weight", () => {
  it("logged at the strip's weight, the untouched sets below fill in with it and log too", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain('? Number((await onCascadeFromSet?.(setIndex, { load: quick, loadType: "external", unit, reps, rpe }, { announce: true })) ?? 0)');
    // several sets from one tap say so, with Undo; a typed weight is deliberate (no toast)
    expect(wdv).toContain("toast.success(`${targets.length + 1} sets logged at ${payload.load} ${payload.unit}`");
    expect(wdv).toContain('action: { label: "Undo", onClick: () => void runCardHistory("undo") },');
    // the chip logs through the first open set's own number
    expect(wdv).toContain("logAt: (w: number) => saveStatusRef.current({ weight: fmtLoad(w) }),");
    // a typed weight already does: the pick cascades downward
    expect(wdv).toContain("// Manual change → cascade downward into eligible sets below.");
  });
});

describe("a tap on a set's number with nothing to log at opens its weight box", () => {
  const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
  it("only the weight missing: the box opens inside the tap (the phone raises the keyboard)", () => {
    expect(wdv).toContain('!isConfirmed && !hideWeight && !bw && loadType === "external" && load === "" && !quickWeight &&');
    expect(wdv).toContain("if (weightOnlyMissing && weightEditRef.current) {\n        weightEditRef.current();\n        return 0;\n      }");
    expect(wdv).toContain("editRef={weightEditRef}");
    expect(wdv).toContain("`Type set ${setIndex}'s weight`");
    expect(read("src/components/workout-day/weight-value-input.tsx")).toContain("if (editRef) editRef.current = disabled ? null : () => startEditing();");
  });
});

describe("Fastest way to log", () => {
  it("teaches the quickest path first, the camera only to a coaching client", () => {
    expect(quickLogSteps(false).map((s) => s.key)).toEqual(["prefilled", "type", "suggest", "warmup"]);
    expect(quickLogSteps(true).map((s) => s.key)).toEqual(["prefilled", "type", "suggest", "warmup", "video"]);
    for (const s of quickLogSteps(true)) expect(QUICK_LOG_BEATS[s.key].length).toBeGreaterThan(0);
  });

  it("opens on its first step with a demo card, Next and a close", () => {
    const html = renderToStaticMarkup(createElement(QuickLogTips, { onClose: () => {}, videoOn: true, unit: "lb" }));
    expect(html).toContain('aria-label="Fastest way to log"');
    expect(html).toContain("Reps and RPE are filled in");
    expect(html).toContain("1 of 5");
    expect(html).toContain('data-testid="quick-log-mock"');
    expect(html).toContain(">Next<");
    expect(html).toContain('data-testid="quick-log-tips-close"');
  });

  it("opens by itself once per account on their own unfinished workout, and from Log faster any time", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("focusKnown && !loggingTipsSeen && !isImpersonating && !readonly && !!client?.id &&");
    expect(wdv).toContain('data-testid="quick-log-tips-open"');
    expect(wdv).toContain("Log faster");
    // one intro at a time: Focus's own tips and invite wait for it
    expect(wdv).toContain("!isImpersonating && !quickLogDue && !quickLogOpen) setFocusTipsOpen(true);");
    expect(wdv).toContain("!quickLogDue && !quickLogOpen && !quickLogShownHere,");
    const view = read("src/lib/use-workout-view.ts");
    expect(view).toContain('.select("view, tried_at, focus_tips_at, logging_tips_at")');
    expect(view).toContain('db.rpc("workout_view_logging_tips_seen")');
    expect(read("supabase/migrations/20270329091000_quick_log_tips.sql")).toContain("SET logging_tips_at = now();");
  });
});
