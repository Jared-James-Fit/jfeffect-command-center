// Set videos filmed in the app go to the phone too: iOS never puts a web page's
// recording in Photos, so the app offers Save Video right after filming, on the
// clip, before it's removed, and at the end of the workout.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PHONE_COPY_MAX_AGE_MS,
  _resetPhoneCopy,
  filmedFile,
  forgetFilmed,
  linkFilmed,
  looksFilmedInApp,
  noteFilmed,
  unsavedFilmed,
} from "@/lib/set-videos/phone-copy";

const read = (p: string) => readFileSync(p, "utf8");

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

describe("filmed in the app, or picked from Photos", () => {
  it("a pick from the phone's library keeps its own name, so it's already on the phone", () => {
    for (const name of [
      "IMG_5771.mov",
      "IMG_4702.MOV",
      "video-output-F1C4CCB0-6945-49F7-95A5-66ACF0360CC0-1.mov",
      "trim.6D1C2A4E-1B3C-4F5D-9E8F-0A1B2C3D4E5F.MOV",
      "RPReplay_Final1699999999.MP4",
      "1000019729.mp4",
      "PXL_20261112_183000123.mp4",
      "20261112_183000.mp4",
    ]) {
      expect(looksFilmedInApp({ name }), name).toBe(false);
    }
  });
  it("anything else counts as filmed here: an extra Save offer costs a tap, a missed one costs the clip", () => {
    for (const name of ["capturedvideo.MOV", "video.mov", "", "VID_20261112_183000.mp4", "clip.webm"]) {
      expect(looksFilmedInApp({ name }), name).toBe(true);
    }
    expect(looksFilmedInApp({})).toBe(true);
  });
});

describe("what the phone remembers until it's saved", () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
    _resetPhoneCopy();
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("keeps a clip filmed here until it's saved, per login, and the clip itself while the app is open", () => {
    const file = new File(["x"], "capturedvideo.MOV", { type: "video/quicktime" });
    noteFilmed("u1", { jobId: "j1", dayId: "d1", file });
    expect(unsavedFilmed("u1")).toEqual([expect.objectContaining({ jobId: "j1", dayId: "d1", setVideoId: null })]);
    expect(unsavedFilmed("u2")).toEqual([]);
    expect(filmedFile("j1")).toBe(file);

    // landed: a reload can fetch it from storage by its set video
    linkFilmed("u1", "j1", "sv1");
    expect(unsavedFilmed("u1")[0].setVideoId).toBe("sv1");

    // saved (or removed on purpose): no longer offered, by job or by set video
    forgetFilmed("u1", { setVideoIds: ["sv1"] });
    expect(unsavedFilmed("u1")).toEqual([]);
    expect(filmedFile("j1")).toBeNull();
  });

  it("survives a reload (the record), and stops offering a week-old one", () => {
    const now = Date.now();
    noteFilmed("u1", { jobId: "old", dayId: "d1" }, now - PHONE_COPY_MAX_AGE_MS - 1000);
    noteFilmed("u1", { jobId: "new", dayId: "d1" }, now);
    _resetPhoneCopy(); // the app was closed: the files are gone, the records stay
    expect(unsavedFilmed("u1").map((e) => e.jobId)).toEqual(["new"]);
    expect(filmedFile("new")).toBeNull();
    forgetFilmed("u1", { jobIds: ["new"] });
    expect(unsavedFilmed("u1")).toEqual([]);
  });
});

describe("where it's offered", () => {
  const cell = read("src/components/workout-day/set-video-cell.tsx");
  const flow = read("src/components/workout-day/set-video-flow.tsx");
  const ui = read("src/components/workout-day/set-video-phone-copy.tsx");
  const sheet = read("src/components/workout-day/set-video-sheet.tsx");
  const uploader = read("src/lib/set-videos/uploader.ts");
  const saveHook = read("src/components/messages/save-media.tsx");

  it("right after filming: the pick says where it came from, and a clip on its way from the camera is offered at once", () => {
    expect(cell).toContain("const filmedHere = looksFilmedInApp(f);");
    expect(cell).toContain("filmedHere={picked.filmedHere}");
    expect(flow).toContain("if (!res.ok || !res.id || !filmedHere || !isTouchDevice()) return;");
    expect(flow).toContain("noteFilmed(start.userId, { jobId: res.id, dayId: start.dayId, file });");
    expect(flow).toContain("offerPhoneCopy(start.userId, res.id, file);");
    // the share sheet opens from the toast's own button, with the clip as filmed
    expect(ui).toContain('label: "Save",');
    expect(ui).toContain("void saveFiles([file]).then((o) => {");
  });

  it("a landed clip is tied to its set video, so it can still be saved after the app closes", () => {
    expect(uploader).toContain("linkFilmed(job.userId, id, res.id);");
  });

  it("every clip saves from its sheet, and one that's only in the app warns before it's removed", () => {
    expect(sheet).toContain("data-set-video-save");
    expect(sheet).toContain("const onlyHere = mine && isUnsavedFilmed(v.id, unsaved);");
    expect(sheet).toContain("data-set-video-only-copy");
    expect(sheet).toContain('"Remove anyway"');
    expect(sheet).toContain("forgetFilmed(user.id, { setVideoIds: [v.id] });");
  });

  it("the end of the workout saves every clip filmed here in one go: the review, the finished card and the recap", () => {
    expect(read("src/components/workout/shared/workout-review-editor.tsx")).toContain("<PhoneCopyReminder dayId={ctx.dayId} />");
    expect(read("src/components/workout/shared/completed-workout-actions.tsx")).toContain("<PhoneCopyReminder");
    expect(read("src/components/workout-submission-summary.tsx")).toContain("<PhoneCopyReminder dayId={dayId ?? null}");
    // never a coach viewing as the athlete, never on a computer
    expect(ui).toContain("if (viewingAsClient || !dayId || !targets.length || !isTouchDevice()) return null;");
  });

  it("a save that went to the share sheet (or downloaded) stops the offers", () => {
    expect(saveHook).toContain('if (outcome === "shared" || outcome === "saved") opts.onSaved?.();');
  });
});
