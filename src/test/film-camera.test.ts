import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FILM_SETTINGS,
  FILM_SETTINGS_KEY,
  availableFps,
  availableQualities,
  clampZoom,
  constraintLadder,
  describeTrack,
  filmFileName,
  fitSettings,
  lensesFrom,
  pickType,
  readFilmSettings,
  recordClock,
  recordLimitSeconds,
  recorderBitrate,
  recorderTypes,
  sanitizeFilmSettings,
  saveFilmSettings,
  videoConstraints,
} from "@/lib/camera/film-settings";
import { looksFilmedInApp } from "@/lib/set-videos/phone-copy";

const read = (p: string) => readFileSync(p, "utf8");

describe("what the app's camera asks for", () => {
  it("films 1080p at 30 by default, the back camera, with sound", () => {
    expect(DEFAULT_FILM_SETTINGS).toEqual({ quality: "1080p", fps: 30, sound: true, grid: false, facing: "environment" });
    expect(videoConstraints(DEFAULT_FILM_SETTINGS)).toEqual({ facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
  });
  it("a lens is asked for by its camera; 4K60 is asked for as ideal, never exact", () => {
    expect(videoConstraints({ quality: "4k", fps: 60, facing: "environment" }, "lens-1")).toEqual({ deviceId: { exact: "lens-1" }, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } });
  });
  it("steps down to asks any camera can answer", () => {
    const ladder = constraintLadder({ quality: "1080p", fps: 60, facing: "user" });
    expect(ladder).toHaveLength(3);
    expect(ladder[1]).not.toHaveProperty("frameRate");
    expect(ladder[2]).toEqual({ facingMode: "user" });
  });
});

describe("how hard it records and for how long", () => {
  it("about a phone camera's own bitrate: ~8 Mbps 1080p30, more at 60 and 4K, never under 4", () => {
    const p1080 = recorderBitrate(1080, 1920, 30);
    expect(p1080).toBeGreaterThan(7_000_000);
    expect(p1080).toBeLessThan(10_000_000);
    expect(recorderBitrate(1080, 1920, 60)).toBeGreaterThan(p1080 * 1.8);
    expect(recorderBitrate(2160, 3840, 30)).toBeGreaterThan(20_000_000);
    expect(recorderBitrate(480, 360, 30)).toBe(4_000_000);
    expect(recorderBitrate(4000, 4000, 60)).toBe(40_000_000);
  });
  it("stops before the phone runs out of memory: minutes at 1080p, about two at 4K", () => {
    expect(recordLimitSeconds(recorderBitrate(1080, 1920, 30), 300)).toBe(300);
    const k4 = recordLimitSeconds(recorderBitrate(2160, 3840, 30), 300);
    expect(k4).toBeGreaterThan(90);
    expect(k4).toBeLessThan(140);
    expect(recordLimitSeconds(1e12, 300)).toBe(15);
  });
  it("H.264 at the level the picture needs, then plainer MP4, then WebM (Android)", () => {
    expect(recorderTypes(1080, 1920, 30)[0]).toBe("video/mp4;codecs=avc1.640028,mp4a.40.2");
    expect(recorderTypes(1080, 1920, 60)[0]).toBe("video/mp4;codecs=avc1.64002a,mp4a.40.2");
    expect(recorderTypes(2160, 3840, 30)[0]).toBe("video/mp4;codecs=avc1.640033,mp4a.40.2");
    expect(recorderTypes(720, 1280, 30)[0]).toBe("video/mp4;codecs=avc1.64001f,mp4a.40.2");
    const all = recorderTypes(1080, 1920, 30);
    expect(all).toContain("video/mp4");
    expect(all.at(-1)).toBe("video/webm");
    expect(all.join(" ")).not.toMatch(/hvc1|hev1/);
    expect(pickType(all, (t) => t === "video/mp4")).toBe("video/mp4");
    expect(pickType(all, () => { throw new Error("unknown"); })).toBeNull();
  });
});

describe("what the camera can do decides the choices", () => {
  const iphone = { width: { max: 4032 }, height: { max: 3024 }, frameRate: { max: 60 }, zoom: { min: 1, max: 16 }, torch: true };
  it("offers 4K and 60 only where the camera says it can", () => {
    expect(availableQualities(iphone)).toEqual(["720p", "1080p", "4k"]);
    expect(availableFps(iphone)).toEqual([30, 60]);
    expect(availableQualities({ width: { max: 1280 }, height: { max: 720 } })).toEqual(["720p"]);
    expect(availableQualities(null)).toEqual(["720p", "1080p"]);
    expect(availableFps({ frameRate: { max: 30 } })).toEqual([30]);
  });
  it("a remembered 4K60 on a phone that can't is shown as the best it can", () => {
    expect(fitSettings({ ...DEFAULT_FILM_SETTINGS, quality: "4k", fps: 60 }, { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } })).toMatchObject({ quality: "1080p", fps: 30 });
  });
  it("says what it's really filming at, never what was asked", () => {
    expect(describeTrack({ width: 1080, height: 1920, frameRate: 29.97 })).toBe("1080p · 30");
    expect(describeTrack({ width: 3840, height: 2160, frameRate: 60 })).toBe("4K · 60");
    expect(describeTrack({ width: 480, height: 360 })).toBe("360p");
    expect(describeTrack(null)).toBe("");
  });
  it("names the iPhone's lenses (0.5 · 1× · Tele), never the combined cameras or the front one", () => {
    const devices = [
      { kind: "videoinput", deviceId: "f", label: "Front Camera" },
      { kind: "videoinput", deviceId: "b", label: "Back Camera" },
      { kind: "videoinput", deviceId: "u", label: "Back Ultra Wide Camera" },
      { kind: "videoinput", deviceId: "t", label: "Back Telephoto Camera" },
      { kind: "videoinput", deviceId: "tr", label: "Back Triple Camera" },
      { kind: "videoinput", deviceId: "dw", label: "Back Dual Wide Camera" },
      { kind: "audioinput", deviceId: "m", label: "iPhone Microphone" },
    ];
    expect(lensesFrom(devices).map((l) => [l.deviceId, l.label])).toEqual([["u", "0.5"], ["b", "1×"], ["t", "Tele"]]);
    // one camera, or no names yet (before it's allowed): no lens buttons
    expect(lensesFrom([{ kind: "videoinput", deviceId: "b", label: "Back Camera" }])).toEqual([]);
    expect(lensesFrom([{ kind: "videoinput", deviceId: "x", label: "" }, { kind: "videoinput", deviceId: "y", label: "" }])).toEqual([]);
  });
  it("a pinch stays inside the camera's zoom", () => {
    expect(clampZoom(0.4, { min: 1, max: 16 })).toBe(1);
    expect(clampZoom(2.345, { min: 1, max: 16 })).toBe(2.3);
    expect(clampZoom(40, { min: 1, max: 16 })).toBe(10);
  });
});

describe("the settings are remembered on the phone", () => {
  it("keeps what's valid field by field and drops the rest", () => {
    expect(sanitizeFilmSettings({ quality: "8k", fps: 120, sound: false, grid: "yes", facing: "user" })).toEqual({ quality: "1080p", fps: 30, sound: false, grid: false, facing: "user" });
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveFilmSettings({ ...DEFAULT_FILM_SETTINGS, quality: "4k", fps: 60, grid: true }, storage);
    expect(store.has(FILM_SETTINGS_KEY)).toBe(true);
    expect(readFilmSettings(storage)).toMatchObject({ quality: "4k", fps: 60, grid: true });
    expect(readFilmSettings({ getItem: () => "{nope" })).toEqual(DEFAULT_FILM_SETTINGS);
    expect(readFilmSettings(null)).toEqual(DEFAULT_FILM_SETTINGS);
  });
  it("a recording counts as filmed here (offered to Photos), with the clock as it runs", () => {
    expect(filmFileName("video/mp4", 5)).toBe("jf-film-5.mp4");
    expect(filmFileName("video/webm", 5)).toBe("jf-film-5.webm");
    expect(looksFilmedInApp({ name: filmFileName("video/mp4") })).toBe(true);
    expect(recordClock(65_400)).toBe("1:05");
  });
});

describe("filming a set opens the app's camera, never iOS's 480p Take Video", () => {
  const cell = read("src/components/workout-day/set-video-cell.tsx");
  const cam = read("src/components/camera/film-camera.tsx");
  it("the set's camera, the tip and Add another open it; Library and picking again open the phone's picker", () => {
    expect(cell).toContain("if (!canFilmInApp()) return openPicker();");
    expect(cell).toContain("onAdd={openCamera}");
    expect(cell).toContain("onPickFile={openPicker}");
    expect(cell).toContain("maxSeconds={SET_RECORD_MAX_SECONDS}");
    // a sheet over the workout is closed first: a modal would hold the camera's taps
    expect(cell).toContain("setSheetOpen(false);");
    expect(cell).toContain("loadCamera(),");
  });
  it("records the person's settings at a phone camera's bitrate, the mic only when filming and only with sound on", () => {
    expect(cam).toContain("videoBitsPerSecond: rate");
    expect(cam).toContain("if (settingsRef.current.sound) {");
    expect(cam).toContain("await getMicStream(true)");
    expect(cam).toContain('wl.request("screen")');
    expect(cam).toContain("data-film-lenses");
    expect(cam).toContain("data-film-torch");
    expect(cam).toContain("data-film-library");
    expect(cam).toContain("useEffect(() => holdCameraOpen(), []);");
  });
  it("the phone can turn on its side to film while the camera is up", () => {
    const portrait = read("src/components/portrait-only.tsx");
    expect(portrait).toContain("if (!sideways || camera) return null;");
    expect(portrait).toContain("window.addEventListener(CAMERA_OPEN_EVENT, onCamera);");
  });
  it("the Crew studio records at the picture's bitrate with the mic asked for the iOS way", () => {
    const rec = read("src/components/community/clip-recorder.ts");
    expect(rec).not.toContain("videoBitsPerSecond: 3_000_000");
    expect(rec).toContain("videoBitsPerSecond: recorderBitrate(w, h, fps)");
    expect(rec).toContain("const got = await getMicStream(true);");
  });
});
