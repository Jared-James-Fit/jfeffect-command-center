import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILM_SETTINGS,
  FILM_SETTINGS_KEY,
  defaultFilmSound,
  readFilmSettings,
  saveFilmSettings,
} from "@/lib/camera/film-settings";
import { installMediaPlaybackSession } from "@/lib/audio-session";
import { setVideoLabel } from "@/lib/set-videos/label";

const read = (p: string) => readFileSync(p, "utf8");

function memory(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return { store, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filming keeps the music in their earbuds playing (Nov 21 2026)", () => {
  it("a phone films without the mic until they turn sound on; a computer records sound", () => {
    expect(defaultFilmSound(true)).toBe(false);
    expect(defaultFilmSound(false)).toBe(true);
    expect(readFilmSettings(memory(), true).sound).toBe(false);
    expect(readFilmSettings(memory(), false).sound).toBe(true);
    // nothing readable: still the device's default
    expect(readFilmSettings({ getItem: () => "{nope" }, true)).toEqual({ ...DEFAULT_FILM_SETTINGS, sound: false });
    expect(readFilmSettings(null, true).sound).toBe(false);
  });

  it("an old save's sound: on was the old default, never a choice; an off was", () => {
    const old = memory({ [FILM_SETTINGS_KEY]: JSON.stringify({ quality: "4k", fps: 60, sound: true, grid: true, facing: "environment" }) });
    expect(readFilmSettings(old, true)).toEqual({ quality: "4k", fps: 60, sound: false, grid: true, facing: "environment" });
    expect(readFilmSettings(old, false).sound).toBe(true);
    const off = memory({ [FILM_SETTINGS_KEY]: JSON.stringify({ sound: false }) });
    expect(readFilmSettings(off, false).sound).toBe(false);
  });

  it("a choice is saved as one and kept on every device kind, the other settings untouched", () => {
    const m = memory();
    saveFilmSettings({ ...DEFAULT_FILM_SETTINGS, quality: "720p", sound: true }, m);
    expect(JSON.parse(m.store.get(FILM_SETTINGS_KEY)!)).toMatchObject({ audio: "sound", sound: true, quality: "720p" });
    expect(readFilmSettings(m, true).sound).toBe(true);
    saveFilmSettings({ ...readFilmSettings(m, true), sound: false }, m);
    expect(JSON.parse(m.store.get(FILM_SETTINGS_KEY)!)).toMatchObject({ audio: "music", sound: false, quality: "720p" });
    expect(readFilmSettings(m, false)).toMatchObject({ sound: false, quality: "720p" });
  });
});

describe("the cameras keep the music playing by themselves", () => {
  const cam = read("src/components/camera/film-camera.tsx");
  const studio = read("src/components/community/share-studio.tsx");
  const recorder = read("src/components/community/clip-recorder.ts");

  it("nothing to tap: the mic opens only when sound is switched on in the camera's settings", () => {
    expect(cam).toContain("if (settingsRef.current.sound && !micRefused()) {");
    expect(cam).toContain("Pauses your music while you film.");
    expect(cam).not.toContain("FilmSoundToggle");
  });

  it("the Crew studio's held clips follow the same setting, read when the clip starts", () => {
    expect(studio).toContain("withSound: () => readFilmSettings().sound,");
    expect(recorder).toContain("if (withSoundRef.current() && !micRefused()) {");
  });
});

describe("the camera shows the set they're about to lift", () => {
  it("weight × reps @ effort under the exercise and set, kept on screen while it films", () => {
    const cam = read("src/components/camera/film-camera.tsx");
    expect(cam).toContain("data-film-detail");
    // the exercise line hides while filming; the numbers stay
    expect(cam).toContain("{title && !recording && <p");
    expect(cam).toContain("{detail && (");
    const cell = read("src/components/workout-day/set-video-cell.tsx");
    expect(cell).toContain("detail={props.aim ?? props.label}");
    // an empty weight box shows the weight a tap on the set's number would log
    const row = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(row).toContain("load ? Number(load) : quickWeight && quickLoad != null ? quickLoad : null,");
    expect(
      setVideoLabel({ load: 140, unit: "kg", reps: 3, rpe: 7, rir: null, loadType: "external", durationSec: null }),
    ).toBe("140 kg × 3 @ RPE 7");
    // no weight yet and nothing to log at: still the reps and effort to aim for
    expect(
      setVideoLabel({ load: null, unit: "lb", reps: 3, rpe: 7, rir: null, loadType: "external", durationSec: null }),
    ).toBe("3 reps @ RPE 7");
  });
});

describe("watching back a clip with no sound never pauses their music", () => {
  function setup() {
    const session = { type: "ambient" };
    vi.stubGlobal("navigator", { audioSession: session });
    const listeners = new Map<string, (e: Event) => void>();
    const page = { addEventListener: (type: string, fn: (e: Event) => void) => listeners.set(type, fn) } as unknown as Document;
    installMediaPlaybackSession(page);
    return { session, fire: (type: string, target: unknown) => listeners.get(type)?.({ type, target } as unknown as Event) };
  }

  it("no sound track: stays on ambient; a play before its header waits for it, then holds for a clip with sound", () => {
    const { session, fire } = setup();
    const silent = Object.assign(new EventTarget(), { paused: false, muted: false, ended: false, volume: 1, readyState: 1, audioTracks: { length: 0 } });
    fire("play", silent);
    fire("playing", silent);
    expect(session.type).toBe("ambient");

    const early = Object.assign(new EventTarget(), { paused: false, muted: false, ended: false, volume: 1, readyState: 0, audioTracks: { length: 0 } });
    fire("play", early);
    expect(session.type).toBe("ambient");
    early.readyState = 1;
    early.audioTracks = { length: 1 };
    early.dispatchEvent(new Event("loadedmetadata"));
    expect(session.type).toBe("playback");
    early.paused = true;
    early.dispatchEvent(new Event("pause"));
    expect(session.type).toBe("ambient");
  });
});
