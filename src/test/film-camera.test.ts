import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FILM_SETTINGS,
  FILM_ASK_KEY,
  FILM_SETTINGS_KEY,
  askOrder,
  availableFps,
  availableQualities,
  clampZoom,
  constraintLadder,
  describeTrack,
  filmFileName,
  fitSettings,
  lensesFrom,
  pickType,
  pictureFits,
  pictureMiss,
  readFilmAsk,
  readFilmSettings,
  recordClock,
  recordLimitSeconds,
  recorderBitrate,
  recorderTypes,
  sanitizeFilmSettings,
  saveFilmAsk,
  saveFilmSettings,
  videoConstraints,
} from "@/lib/camera/film-settings";
import { looksFilmedInApp } from "@/lib/set-videos/phone-copy";

const read = (p: string) => readFileSync(p, "utf8");

describe("what the app's camera asks for", () => {
  it("films 1080p at 30 by default, the back camera, with sound", () => {
    expect(DEFAULT_FILM_SETTINGS).toEqual({ quality: "1080p", fps: 30, sound: true, grid: false, facing: "environment" });
    expect(videoConstraints(DEFAULT_FILM_SETTINGS)).toEqual({ facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 1920 / 1080 }, frameRate: { ideal: 30 } });
  });
  it("a lens is asked for by its camera; 4K60 is asked for as ideal, never exact", () => {
    expect(videoConstraints({ quality: "4k", fps: 60, facing: "environment" }, "lens-1")).toEqual({ deviceId: { exact: "lens-1" }, width: { ideal: 3840 }, height: { ideal: 2160 }, aspectRatio: { ideal: 3840 / 2160 }, frameRate: { ideal: 60 } });
  });
  it("the size can be written either way round: the camera's way, or upright 9:16", () => {
    expect(videoConstraints(DEFAULT_FILM_SETTINGS, null, "portrait")).toEqual({ facingMode: { ideal: "environment" }, width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 1080 / 1920 }, frameRate: { ideal: 30 } });
    expect(constraintLadder(DEFAULT_FILM_SETTINGS, null, "portrait")[1]).toMatchObject({ width: { ideal: 1080 }, height: { ideal: 1920 } });
  });
  it("steps down to asks any camera can answer", () => {
    const ladder = constraintLadder({ quality: "1080p", fps: 60, facing: "user" });
    expect(ladder).toHaveLength(3);
    expect(ladder[1]).not.toHaveProperty("frameRate");
    expect(ladder[2]).toEqual({ facingMode: "user" });
  });
});

describe("full screen like a reel: the picture is 9:16 upright", () => {
  it("a 9:16 picture held upright fills the screen; 3:4, square or sideways doesn't", () => {
    expect(pictureFits(1080, 1920, true)).toBe(true);
    expect(pictureFits(720, 1280, true)).toBe(true);
    expect(pictureFits(2160, 3840, true)).toBe(true);
    // a 3:4 picture (an iPhone's 1440 × 1920) would play boxed in, with bars, in the feed
    expect(pictureFits(1440, 1920, true)).toBe(false);
    expect(pictureFits(1080, 1080, true)).toBe(false);
    // the right shape the wrong way round
    expect(pictureFits(1920, 1080, true)).toBe(false);
    // on its side: 16:9 the long way is right
    expect(pictureFits(1920, 1080, false)).toBe(true);
    expect(pictureFits(1080, 1920, false)).toBe(false);
    // not known yet: left as it is
    expect(pictureFits(0, 0, true)).toBe(true);
  });
  it("the closer of two pictures is the one kept when neither is 9:16", () => {
    expect(pictureMiss(1440, 1920, true)).toBeLessThan(pictureMiss(1920, 1080, true));
    expect(pictureMiss(1080, 1920, true)).toBe(0);
  });
  it("upright it tries what worked on this phone first, then the other way; on its side only the camera's way", () => {
    expect(askOrder(true, null)).toEqual(["landscape", "portrait"]);
    expect(askOrder(true, "portrait")).toEqual(["portrait", "landscape"]);
    expect(askOrder(true, "landscape")).toEqual(["landscape", "portrait"]);
    expect(askOrder(false, "portrait")).toEqual(["landscape"]);
  });
  it("what worked is kept on the phone", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readFilmAsk(storage)).toBeNull();
    saveFilmAsk("portrait", storage);
    expect(store.get(FILM_ASK_KEY)).toBe("portrait");
    expect(readFilmAsk(storage)).toBe("portrait");
    expect(readFilmAsk({ getItem: () => "sideways" })).toBeNull();
  });
  it("the camera checks the picture it got, asks the other way when it isn't 9:16, and never ends up with no camera for it", () => {
    const cam = read("src/components/camera/film-camera.tsx");
    expect(cam).toContain("askOrder(upright, readFilmAsk())");
    expect(cam).toContain("pictureFits(pic.w, pic.h, upright)");
    expect(cam).toContain("if (pic && upright) saveFilmAsk(shape);");
    expect(cam).toContain("if (!stream && best && !refused()) {");
    // the picture fills the screen, the controls over it
    expect(cam).toContain('className={cn("absolute inset-0 h-full w-full object-cover"');
  });
  it("while it's up the status bar and everything behind it are black, then the page's colour again", () => {
    const css = read("src/styles.css");
    expect(css).toContain("html[data-camera-open] [data-shell-root] { background-color: #000; }");
    expect(css).toContain("html[data-camera-open]:not([data-pov-banner-on]) .ios-status-band { background-color: #000; }");
    expect(read("src/lib/camera/camera-presence.ts")).toContain("if (was !== open > 0) paintThemeColor(open > 0);");
  });
});

describe("how hard it records and for how long", () => {
  it("clean and sized for Crew: ~6 Mbps 1080p30 (a minute fits a workout post's 50 MB whole), more at 60 and 4K, never under 4", () => {
    const p1080 = recorderBitrate(1080, 1920, 30);
    expect(p1080).toBeGreaterThan(5_500_000);
    expect(p1080).toBeLessThan(7_000_000);
    // a 60-second set at 1080p30 with sound goes into the film as it is
    expect(((p1080 + 128_000) * 60) / 8).toBeLessThan(50 * 1024 * 1024);
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
    expect(cam).toContain("if (settingsRef.current.sound && !micRefused()) {");
    // the room as it sounds, from the phone's own mic (video-mic.ts), never a call's processing
    expect(cam).toContain("const got = await openVideoMic();");
    expect(cam).not.toContain("getMicStream(true)");
    expect(cam).toContain('wl.request("screen")');
    expect(cam).toContain("data-film-lenses");
    expect(cam).toContain("data-film-torch");
    expect(cam).toContain("data-film-library");
    expect(cam).toContain("useEffect(() => holdCameraOpen(), []);");
  });
  it("the phone can turn on its side to film while the camera is up", () => {
    const portrait = read("src/components/portrait-only.tsx");
    // the lock is let go while the camera's up, and put back when it closes
    expect(portrait).toContain("const free = () => isCameraOpen() || fullscreenNow();");
    expect(portrait).toContain("if (free()) unlockPortrait();");
    expect(portrait).toContain("window.addEventListener(CAMERA_OPEN_EVENT, onCamera);");
  });
  it("the Crew studio records at the picture's bitrate with the mic asked for the iOS way", () => {
    const rec = read("src/components/community/clip-recorder.ts");
    expect(rec).not.toContain("videoBitsPerSecond: 3_000_000");
    expect(rec).toContain("videoBitsPerSecond: recorderBitrate(w, h, fps)");
    expect(rec).toContain("const got = await openVideoMic();");
    expect(rec).not.toContain("getMicStream(true)");
  });
});
