import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIFT_BUDGET_MS, liftSampleTimes } from "@/lib/video-edit/lift";
import { fixedTrim, type TrimRequest } from "@/lib/video-edit/pick";
import { videoLimit } from "@/lib/video-edit/limits";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the lift finder reads few, tiny frames", () => {
  it("reads a phone's keyframes (about one a second) as they are", () => {
    const keys = Array.from({ length: 31 }, (_, i) => i);
    expect(liftSampleTimes(keys, 31)).toEqual(keys);
  });

  it("thins keyframes that come every few frames, never closer than ~half a second", () => {
    const keys = Array.from({ length: 300 }, (_, i) => i / 10);
    const t = liftSampleTimes(keys, 30);
    expect(t.length).toBeLessThanOrEqual(70);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(0.44);
  });

  it("reads a grid instead when keyframes are far apart, on a short clip only", () => {
    const sparse = [0, 10, 20];
    const t = liftSampleTimes(sparse, 30);
    expect(t.length).toBeGreaterThan(30);
    expect(t[1] - t[0]).toBeCloseTo(0.7, 5);
    // a long clip with sparse keyframes would mean decoding straight through it: no suggestion
    expect(liftSampleTimes([0, 30, 60, 90], 600)).toEqual([]);
  });

  it("never reads more than 240 frames, however long the clip", () => {
    const keys = Array.from({ length: 1200 }, (_, i) => i);
    expect(liftSampleTimes(keys, 1200).length).toBeLessThanOrEqual(240);
  });

  it("ignores times outside the clip", () => {
    expect(liftSampleTimes([-1, 0, 1, 2, 3, 4, 99], 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives up in a few seconds; nothing ever waits on it", () => {
    expect(LIFT_BUDGET_MS).toBeLessThanOrEqual(8000);
    const lift = read("lib/video-edit/lift.ts");
    expect(lift).toContain("const SIDE = 64;");
    expect(lift).toContain('fit: "fill"');
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
    expect(flow).toContain('offer: { suggestLift: true, title: `${start.exerciseName} · Set ${start.setIndex}`, doneLabel: "Send" }');
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
