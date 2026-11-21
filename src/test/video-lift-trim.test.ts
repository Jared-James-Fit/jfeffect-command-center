import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIFT_BUDGET_MS, liftSamplePlan, liftSampleTimes } from "@/lib/video-edit/lift";
import { liftNotFound, liftNoteFor, liftTransferNote, noteLift } from "@/lib/video-edit/lift-note";
import { RECORDER_KEYFRAME_MS, recorderKeyframes } from "@/lib/camera/film-settings";
import { fixedTrim, type TrimRequest } from "@/lib/video-edit/pick";
import { videoLimit } from "@/lib/video-edit/limits";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the lift finder reads few, tiny frames", () => {
  it("reads a phone's keyframes (about one a second) as they are, with nothing to fill in", () => {
    const keys = Array.from({ length: 31 }, (_, i) => i);
    const plan = liftSamplePlan(keys, 31);
    expect(plan.mode).toBe("keys");
    expect(plan.first).toEqual(keys);
    expect(plan.fill).toEqual([]);
    expect(plan.keyGap).toBe(1);
    expect(liftSampleTimes(keys, 31)).toEqual(keys);
  });

  it("thins keyframes that come every few frames to about one a second", () => {
    const keys = Array.from({ length: 300 }, (_, i) => i / 10);
    const t = liftSamplePlan(keys, 30).first;
    expect(t.length).toBeLessThanOrEqual(40);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(0.79);
  });

  it("keyframes every two seconds (a clip filmed in the app): the keyframes first, then a frame between each pair", () => {
    const keys = Array.from({ length: 18 }, (_, i) => i * 2);
    const plan = liftSamplePlan(keys, 35.4);
    expect(plan.mode).toBe("keys+fill");
    expect(plan.first).toEqual(keys);
    // one in the middle of each gap (the last 1.4 s after the final keyframe needs none)
    expect(plan.fill.slice(0, 3)).toEqual([1, 3, 5]);
    expect(plan.fill.length).toBe(17);
    // together: never further apart than FILL_OVER, never closer than lift-window reads
    const all = [...plan.first, ...plan.fill].sort((a, b) => a - b);
    for (let i = 1; i < all.length; i++) {
      expect(all[i] - all[i - 1]).toBeLessThanOrEqual(1.6);
      expect(all[i] - all[i - 1]).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("keyframes three and a bit seconds apart get two frames in each gap", () => {
    const keys = [0, 3.3, 6.6, 9.9, 13.2, 16.5];
    const plan = liftSamplePlan(keys, 19);
    expect(plan.mode).toBe("keys+fill");
    expect(plan.fill.slice(0, 2)).toEqual([1.1, 2.2]);
  });

  it("hardly any keyframes: a frame a second straight through, on a clip short enough to decode", () => {
    const plan = liftSamplePlan([0, 10, 20], 30);
    expect(plan.mode).toBe("grid");
    expect(plan.first.length).toBe(30);
    expect(plan.first[1] - plan.first[0]).toBe(1);
    // keyframes that stop well before the end don't cover the clip either
    expect(liftSamplePlan([0, 1, 2, 3], 40).mode).toBe("grid");
    // a long clip with sparse keyframes would mean decoding straight through all of it: no suggestion
    expect(liftSamplePlan([0, 30, 60, 90], 600)).toMatchObject({ mode: "none", first: [], fill: [] });
  });

  it("never reads more than 240 frames, however long the clip", () => {
    const keys = Array.from({ length: 1200 }, (_, i) => i);
    const plan = liftSamplePlan(keys, 1200);
    expect(plan.first.length + plan.fill.length).toBeLessThanOrEqual(240);
    const sparse = Array.from({ length: 400 }, (_, i) => i * 3);
    const p2 = liftSamplePlan(sparse, 1200);
    expect(p2.first.length + p2.fill.length).toBeLessThanOrEqual(240);
  });

  it("ignores times outside the clip", () => {
    expect(liftSampleTimes([-1, 0, 1, 2, 3, 4, 99], 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("is held to a budget, uses what a cut-short fill-in read, and nothing ever waits on it", () => {
    expect(LIFT_BUDGET_MS).toBeLessThanOrEqual(15000);
    const lift = read("lib/video-edit/lift.ts");
    expect(lift).toContain("const SIDE = 64;");
    expect(lift).toContain('fit: "fill"');
    // out of time in the first pass: no suggestion, and it says so; in the fill-in: what's read is read
    expect(lift).toContain('if (!(await readAt(plan.first))) return done(stopped() ? "stopped" : "slow");');
    expect(lift).toMatch(/if \(plan\.fill\.length\) \{\s*filled = await readAt\(plan\.fill\);/);
    expect(lift).toContain('return done(!filled && res.why === "sparse" ? "slow" : res.why, res.window);');
    // never throws: anything that goes wrong is a reason, kept with the file
    expect(lift).toContain('return done("error");');
    expect(lift).toContain("noteLift(file, note);");
  });
});

describe("what the finder did is kept with the clip", () => {
  const file = new File([new Uint8Array(4)], "jf-film-1.mp4");

  it("the trimmer says so when it looked and couldn't pick the lift out, never when there's just nothing to cut", () => {
    expect(liftNotFound(null)).toBe(false);
    noteLift(file, { ms: 900, n: 30, mode: "keys", key_s: 1, why: "nothing-to-cut", win: null });
    expect(liftNotFound(liftNoteFor(file))).toBe(false);
    noteLift(file, { ms: 900, n: 30, mode: "keys", key_s: 1, why: "handheld", win: null });
    expect(liftNotFound(liftNoteFor(file))).toBe(true);
    noteLift(file, { ms: 12004, n: 20, mode: "grid", key_s: null, why: "slow", win: null });
    expect(liftNotFound(liftNoteFor(file))).toBe(true);
    const trimmer = read("components/video-trimmer.tsx");
    expect(trimmer).toContain("setLiftMissed(liftNotFound(liftNoteFor(req.file)));");
    expect(trimmer).toContain("Couldn't pick out the lift in this one. Drag the ends to trim it yourself.");
  });

  it("a set video's upload carries one line of it: how the clip was read, how long, what was suggested and whether that's what went", () => {
    noteLift(file, { ms: 12004, n: 20, mode: "grid", key_s: null, why: "slow", win: null });
    expect(liftTransferNote(file, null, 35)).toBe("slow grid key- n20 12004ms");
    noteLift(file, { ms: 3140, n: 52, mode: "keys+fill", key_s: 2, why: "found", win: [3.1, 14.2] });
    expect(liftTransferNote(file, { start: 3.1, end: 14.2 }, 35)).toBe("found keys+fill key2 n52 3140ms 3.1-14.2 kept");
    expect(liftTransferNote(file, { start: 18, end: 35 }, 35)).toBe("found keys+fill key2 n52 3140ms 3.1-14.2 changed");
    expect(liftTransferNote(file, null, 35)).toContain("changed");
    expect(liftTransferNote(new File([], "other.mov"), null, 35)).toBeNull();
    const up = read("lib/set-videos/uploader.ts");
    expect(up).toContain("lift: liftTransferNote(picked.file, picked.trim, picked.info.duration),");
    // the note itself never loads the video engine
    expect(read("lib/video-edit/lift-note.ts")).not.toMatch(/mediabunny|video-edit\/probe/);
  });

  it("the in-app cameras ask for a keyframe a second, so their clips read without decoding every frame", () => {
    expect(RECORDER_KEYFRAME_MS).toBe(1000);
    expect(recorderKeyframes()).toEqual({ videoKeyFrameIntervalDuration: 1000 });
    expect(read("components/camera/film-camera.tsx")).toContain("audioBitsPerSecond: 128_000, ...recorderKeyframes() });");
    expect(read("components/community/clip-recorder.ts")).toContain("audioBitsPerSecond: 128_000, ...recorderKeyframes() });");
  });
});

describe("the trimmer suggests the lift", () => {
  const pick = read("lib/video-edit/pick.ts");
  const trimmer = read("components/video-trimmer.tsx");

  it("is loaded only when asked for, and fails quietly", () => {
    expect(pick).toContain('import("@/lib/video-edit/lift").then((m) => m.findLift(file)).catch(() => null)');
    expect(pick).not.toMatch(/^import .*video-edit\/lift"/m);
  });

  it("opens on a clip that fits only when a quick look is offered", () => {
    expect(pick).toContain("if (!must && !(opts.offer && opts.trim)) return { ok: true, video: base };");
    expect(pick).toContain("suggest: opts.offer?.suggestLift || must ? liftFinder(file) : null,");
    // re-opened: offered, never moved to on its own
    expect(pick).toMatch(/initial: v\.trim \?\? \{ start: 0, end: v\.info\.duration \},[\s\S]*suggest: liftFinder\(v\.file\)/);
  });

  it("glides to it once found, unless the clip was re-opened or a handle was already moved", () => {
    expect(trimmer).toContain("const auto = !req.initial;");
    expect(trimmer).toContain("if (auto && !touched.current) moveTo(n);");
    expect(trimmer).toContain('"(prefers-reduced-motion: reduce)"');
    // every hand on the strip, the nudges and the overview counts as touched
    expect((trimmer.match(/touched\.current = true;/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("says what it's doing and keeps the whole clip one tap away", () => {
    expect(trimmer).toContain("Finding the lift…");
    expect(trimmer).toContain("Trimmed to the lift");
    expect(trimmer).toContain("data-trim-whole");
    expect(trimmer).toContain("data-trim-to-lift");
    expect(trimmer).toContain("Cut to the lift, from stepping up to the bar to racking it. Drag the ends to change it.");
    expect(trimmer).toContain("req.title ??");
    expect(trimmer).toContain("req.doneLabel ??");
  });
});

describe("one tap holds to the trimmer's rules", () => {
  const req = (over: Partial<TrimRequest> = {}): TrimRequest => ({
    file: new File([], "lift.mov"),
    info: { duration: 300, bytes: 300 * 1_000_000, width: 1080, height: 1920 } as TrimRequest["info"],
    canEncode: true,
    context: "post",
    initial: null,
    ...over,
  });

  it("a lift that fits goes as it is", async () => {
    expect(await fixedTrim({ start: 12, end: 40 })(req())).toEqual({ start: 12, end: 40 });
  });

  it("a lift longer than the place allows is cut to its limit (the server would refuse it)", async () => {
    const story = (await fixedTrim({ start: 10, end: 150 })(req({ context: "story" })))!;
    expect(story.start).toBe(10);
    expect(story.end - story.start).toBeLessThanOrEqual(videoLimit("story"));
  });

  it("the whole clip back is the clip's real length", async () => {
    expect(await fixedTrim({ start: 0, end: Number.MAX_SAFE_INTEGER })(req({ info: { duration: 31, bytes: 31_000_000, width: 1080, height: 1920 } as TrimRequest["info"] }))).toEqual({ start: 0, end: 31 });
  });

  it("on a clip this phone cuts only at keyframes, the start moves back to one (never losing a chosen frame)", async () => {
    const snapped = await fixedTrim({ start: 12.4, end: 40 })(req({ snapStart: async () => 11 }));
    expect(snapped).toEqual({ start: 11, end: 40 });
    // a keyframe right on it, or a lookup that fails, leaves it be
    expect(await fixedTrim({ start: 12, end: 40 })(req({ snapStart: async () => 12 }))).toEqual({ start: 12, end: 40 });
    expect(await fixedTrim({ start: 12, end: 40 })(req({ snapStart: async () => Promise.reject(new Error("x")) }))).toEqual({ start: 12, end: 40 });
  });
});

describe("where it's offered", () => {
  it("a set video: a quick look titled with the set, then Send", () => {
    const flow = read("components/workout-day/set-video-flow.tsx");
    expect(flow).toContain('offer: { suggestLift: true, title: `${start.exerciseName} · ${setTitle(start.setIndex)}`, doneLabel: "Send" }');
    const up = read("lib/set-videos/uploader.ts");
    expect(up).toContain("pickVideo(input.file, CONTEXT, { trim: input.trim, offer: input.offer })");
    // backing out of the quick look leaves nothing on the set
    expect(up).toMatch(/if \(!picked\.ok\) \{\s*dropSetVideoJob\(id\);/);
  });

  it("a Crew post: found in the background as the clip is added, one chip to cut it and one to put it back", () => {
    const tray = read("components/community/slide-tray.tsx");
    expect(tray).toContain("findLiftFor");
    expect(tray).toContain("trimToLift");
    expect(tray).toContain("undoLift");
    expect(tray).toContain("retrimPicked(old, to ? fixedTrim(to) : trimmer.request, videoContext)");
    // trimmed by hand afterwards: Whole clip no longer has a "before"
    expect(tray).toContain("...(to ? {} : { liftBefore: undefined })");
    const studio = read("components/community/share-studio.tsx");
    expect(studio).toContain("data-studio-trim-lift");
    expect(studio).toContain("data-studio-whole");
    expect(studio).toContain("Trim to the lift · {formatClock(coverClip.lift.end - coverClip.lift.start)}");
    // never on a clip already on the post being edited
    expect(studio).toContain("coverClip?.lift && !coverClip.existing");
  });
});
