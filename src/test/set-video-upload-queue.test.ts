import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  PROGRESS_EMIT_MS,
  dropSetVideoJob,
  getSetVideoJobs,
  patchSetVideoJob,
  putSetVideoJob,
  sameJobs,
  subscribeSetVideoJobs,
  type SetVideoJob,
} from "@/lib/set-videos/jobs";
import { renderSlots } from "@/lib/video-edit/render-off-thread";

const job = (id: string, over: Partial<SetVideoJob> = {}): SetVideoJob => ({
  id, userId: "u", clientId: "c", rowId: "r", dayId: "d", resultId: null, setIndex: 1, exerciseName: "Squat",
  dayTitle: "Day", label: "", fileKey: id, fileName: "a.mp4", state: "uploading", progress: 5, createdAt: 0, ...over,
});

afterEach(() => {
  for (const j of getSetVideoJobs()) dropSetVideoJob(j.id);
  vi.useRealTimers();
});

describe("the upload queue never floods the logger with re-renders (T14)", () => {
  it("progress is told at most every PROGRESS_EMIT_MS; a state change at once", () => {
    vi.useFakeTimers();
    putSetVideoJob(job("a"));
    let told = 0;
    const off = subscribeSetVideoJobs(() => told++);
    for (let p = 6; p < 60; p++) patchSetVideoJob("a", { progress: p });
    expect(told).toBe(0);
    // the data itself is current at once (nothing waits on the batching)
    expect(getSetVideoJobs()[0].progress).toBe(59);
    vi.advanceTimersByTime(PROGRESS_EMIT_MS);
    expect(told).toBe(1);
    patchSetVideoJob("a", { state: "checking", progress: 95 });
    expect(told).toBe(2);
    off();
  });
  it("the same value again tells nobody and keeps the same array", () => {
    putSetVideoJob(job("a"));
    const before = getSetVideoJobs();
    let told = 0;
    const off = subscribeSetVideoJobs(() => told++);
    patchSetVideoJob("a", { progress: 5, state: "uploading" });
    expect(told).toBe(0);
    expect(getSetVideoJobs()).toBe(before);
    off();
  });
  it("one set's selection stays the same while another clip makes progress", () => {
    putSetVideoJob(job("a", { rowId: "r1" }));
    putSetVideoJob(job("b", { rowId: "r2" }));
    const mine = (all: SetVideoJob[]) => all.filter((j) => j.rowId === "r1");
    const first = mine(getSetVideoJobs());
    patchSetVideoJob("b", { progress: 40 });
    expect(sameJobs(first, mine(getSetVideoJobs()))).toBe(true);
    patchSetVideoJob("a", { progress: 40 });
    expect(sameJobs(first, mine(getSetVideoJobs()))).toBe(false);
  });
});

describe("clips are prepared off the page's thread, one or two at a time", () => {
  it("two at once only with cores to spare", () => {
    expect(renderSlots(8)).toBe(2);
    expect(renderSlots(6)).toBe(2);
    expect(renderSlots(4)).toBe(1);
    expect(renderSlots(2)).toBe(1);
  });
  it("the uploader prepares through the worker, the next clip ahead of its turn, and never cuts the Photos copy twice", () => {
    const src = readFileSync("src/lib/set-videos/uploader.ts", "utf8");
    expect(src).toContain('import { renderVideoOffThread as renderVideo } from "@/lib/video-edit/render-off-thread"');
    expect(src).toContain("prepareNext();");
    expect(src).toContain("outcomeOf(id).promise.then");
    const worker = readFileSync("src/lib/video-edit/render-off-thread.ts", "utf8");
    expect(worker).toContain('new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" })');
  });
});
