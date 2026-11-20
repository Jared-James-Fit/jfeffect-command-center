import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Node test env: a localStorage-backed window, no document, no AudioContext.
const store = new Map<string, string>();
(globalThis as any).window ??= {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
};
const sounds = await import("@/lib/app-sounds");
const {
  admitSound, cleanSoundPrefs, countdownPlan, DEFAULT_SOUND_PREFS, readSoundPrefs, reserveSound, scheduleAppSound,
  setAppSoundsEnabled, setSoundPrefs, soundAllowed, soundCategory, volumeGain,
} = sounds;
const { reachesWaterTarget } = await import("@/lib/water");

const read = (f: string) => readFileSync(f, "utf8");

describe("sound settings: per device, every switch on and full volume to start", () => {
  it("defaults, and anything stored wrong falls back to them", () => {
    expect(DEFAULT_SOUND_PREFS).toEqual({ effects: true, timers: true, countdown: true, notifications: true, volume: 100 });
    expect(cleanSoundPrefs(null)).toEqual(DEFAULT_SOUND_PREFS);
    expect(cleanSoundPrefs({ effects: "no", volume: 250 })).toMatchObject({ effects: true, volume: 100 });
    expect(cleanSoundPrefs({ volume: -4 }).volume).toBe(0);
    expect(cleanSoundPrefs({ volume: 37.6 }).volume).toBe(38);
  });

  it("remembers a change and tells every screen", () => {
    const seen: number[] = [];
    const off = sounds.subscribeSoundPrefs((p) => seen.push(p.volume));
    setSoundPrefs({ volume: 60 });
    expect(readSoundPrefs().volume).toBe(60);
    expect(seen).toEqual([60]);
    off();
    setSoundPrefs({ ...DEFAULT_SOUND_PREFS });
  });

  it("each sound belongs to one switch; the master and volume 0 silence everything", () => {
    expect(soundCategory("set")).toBe("effects");
    expect(soundCategory("pr")).toBe("effects");
    expect(soundCategory("start")).toBe("effects");
    expect(soundCategory("timer")).toBe("timers");
    expect(soundCategory("count")).toBe("timers");
    expect(soundCategory("message")).toBe("notifications");
    const p = { ...DEFAULT_SOUND_PREFS };
    expect(soundAllowed("pr", p, true)).toBe(true);
    expect(soundAllowed("pr", p, false)).toBe(false);
    expect(soundAllowed("pr", { ...p, volume: 0 }, true)).toBe(false);
    expect(soundAllowed("pr", { ...p, effects: false }, true)).toBe(false);
    expect(soundAllowed("message", { ...p, effects: false }, true)).toBe(true);
    // the 3-2-1 is its own choice under timer alerts
    expect(soundAllowed("count", { ...p, countdown: false }, true)).toBe(false);
    expect(soundAllowed("go", { ...p, countdown: false }, true)).toBe(true);
    expect(soundAllowed("go", { ...p, timers: false }, true)).toBe(false);
  });

  it("volume moves evenly by ear (squared): half way is about 12 dB down", () => {
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(50)).toBeCloseTo(0.25);
    expect(20 * Math.log10(volumeGain(50))).toBeCloseTo(-12, 0);
  });

  it("the master switch still lives where it always did (old installs keep their choice)", () => {
    setAppSoundsEnabled(false);
    expect(store.get("jf-app-sounds")).toBe("0");
    setAppSoundsEnabled(true);
  });
});

describe("countdown: 3, 2, 1 and the go, on the audio clock", () => {
  it("pips only for the seconds still ahead, the go on zero", () => {
    expect(countdownPlan(10_000, 6_000, { countdown: true, go: true })).toEqual({ pips: [7_000, 8_000, 9_000], go: 10_000 });
    // came back with 2.4 s left: the 3 is gone
    expect(countdownPlan(10_000, 7_600, { countdown: true, go: true })).toEqual({ pips: [8_000, 9_000], go: 10_000 });
    expect(countdownPlan(10_000, 6_000, { countdown: false, go: true })).toEqual({ pips: [], go: 10_000 });
    expect(countdownPlan(10_000, 10_500, { countdown: true, go: true })).toEqual({ pips: [], go: null });
  });

  it("a scheduled go keeps the tock of the set that logs itself at zero from piling on, never an exercise's cue or a PR", () => {
    const gate = { lastAny: 0, lastAnyPriority: 0, lastBy: {} };
    const release = reserveSound("go", 50_000, gate);
    expect(admitSound("set", 49_000, gate)).toBe(true); // before the go: fine
    expect(admitSound("set", 50_600, gate)).toBe(false); // the hold's own tock
    expect(admitSound("exercise", 50_700, gate)).toBe(true);
    expect(admitSound("pr", 50_800, gate)).toBe(true);
    release();
    const g2 = { lastAny: 0, lastAnyPriority: 0, lastBy: {} };
    reserveSound("go", 60_000, g2)();
    expect(admitSound("set", 60_300, g2)).toBe(true); // cancelled countdown: nothing held
  });

  it("the workout's start takes the first set's tock with it", () => {
    const gate = { lastAny: 0, lastAnyPriority: 0, lastBy: {} };
    expect(admitSound("start", 100_000, gate)).toBe(true);
    expect(admitSound("set", 100_900, gate)).toBe(false);
    expect(admitSound("set", 101_600, gate)).toBe(true);
  });

  it("a PR right after a set's tock is never swallowed", () => {
    const gate = { lastAny: 0, lastAnyPriority: 0, lastBy: {} };
    expect(admitSound("set", 5_000, gate)).toBe(true);
    expect(admitSound("pr", 5_150, gate)).toBe(true);
  });
});

describe("the sounds themselves: synthesized, short, one family", () => {
  function fakeContext() {
    let nodes = 0;
    let latestStop = 0;
    const freqs: number[] = [];
    function param(track = false) {
      const p: any = { value: 0 };
      p.setValueAtTime = (v: number) => { if (track) freqs.push(v); return p; };
      for (const m of ["linearRampToValueAtTime", "exponentialRampToValueAtTime", "cancelScheduledValues"]) p[m] = () => p;
      return p;
    }
    const node = (extra: Record<string, unknown> = {}) => {
      nodes++;
      return { connect: (n: unknown) => n, disconnect() {}, start() {}, stop(t: number) { latestStop = Math.max(latestStop, t); }, ...extra };
    };
    const c: any = {
      sampleRate: 44100,
      currentTime: 0,
      destination: node(),
      createOscillator: () => node({ type: "", frequency: param(true), detune: param() }),
      createGain: () => node({ gain: param() }),
      createBiquadFilter: () => node({ type: "", frequency: param(), Q: param() }),
      createBufferSource: () => node({ buffer: null }),
      createBuffer: (_ch: number, len: number, sr: number) => ({ length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }),
    };
    return { c, nodes: () => nodes, latestStop: () => latestStop, freqs };
  }

  it("every new cue schedules and is gone within a second and a half", () => {
    for (const name of ["start", "count", "go", "goal", "pr", "exercise", "timer", "milestone"] as const) {
      const f = fakeContext();
      scheduleAppSound(f.c, f.c.destination, 0, name);
      expect(f.nodes(), name).toBeGreaterThan(1);
      expect(f.latestStop(), name).toBeLessThan(1.5);
    }
  });

  it("the countdown's pip is a G under the go's C (the finish sting's key)", () => {
    const pip = fakeContext();
    scheduleAppSound(pip.c, pip.c.destination, 0, "count");
    expect(pip.freqs).toContain(783.99);
    const go = fakeContext();
    scheduleAppSound(go.c, go.c.destination, 0, "go");
    expect(go.freqs).toContain(1046.5);
    expect(pip.latestStop()).toBeLessThan(0.25);
  });

  it("the set's tock is unchanged (it works), and nothing is a file", () => {
    const f = fakeContext();
    scheduleAppSound(f.c, f.c.destination, 0, "set");
    expect(f.latestStop()).toBeLessThan(0.15);
    expect(f.nodes()).toBeLessThan(10);
    expect(read("src/lib/app-sounds.ts")).not.toMatch(/\.(mp3|wav|ogg|m4a|aac)\b/);
  });
});

describe("where the new sounds play", () => {
  it("rest, set and Workout Tools timers count down on the audio clock and never chime twice", () => {
    const rest = read("src/components/workout-day/RestTimerButton.tsx");
    expect(rest).toContain("useEffect(() => { syncCountdown(countdownKey, countdownEnd); });");
    expect(rest).toContain('if (!countdownSoundedEnd(countdownKey, mine.endsAt)) playAppSound("timer");');
    const hold = read("src/components/workout-day/set-timer-input.tsx");
    expect(hold).toContain("syncCountdown(countdownKey, state?.endsAt ?? null)");
    expect(hold).toContain('!countdownSoundedEnd(countdownKey, endedAt)) playAppSound("timer")');
    const tools = read("src/components/workout-tools/workout-tools.tsx");
    expect(tools).toContain("syncCountdown(countdownKey, state.timer.endsAt)");
    expect(tools).toContain('if (!countdownSoundedEnd(countdownKey, state.timer.endsAt)) playAppSound("timer");');
  });

  it("the workout clock: one start cue, only when a fresh session begins (there is no pause control in the logger, so no pause sounds)", () => {
    const timer = read("src/components/workout-day/WorkoutTimer.tsx");
    expect(timer.split('playAppSound("start");').length - 1).toBe(1);
    const begin = timer.slice(timer.indexOf("export function beginWorkoutSession("), timer.indexOf("export function pauseWorkoutSession("));
    expect(begin).toContain('playAppSound("start");\n  return next;');
    expect(read("src/lib/app-sounds.ts")).not.toMatch(/\b(pause|resume): \(c, o, t\)/);
    // a finished workout's sets never start the clock again
    expect(read("src/components/workout-day/WorkoutDayView.tsx")).toContain("startsWorkout={!cardioRow && !completion?.completed_at}");
  });

  it("a daily water target reached is a goal, once, on the drink that gets there", () => {
    expect(reachesWaterTarget(2_500, 500, 3_000)).toBe(true);
    expect(reachesWaterTarget(2_400, 500, 3_000)).toBe(false);
    expect(reachesWaterTarget(3_000, 250, 3_000)).toBe(false);
    expect(read("src/components/home/home-water-card.tsx")).toContain('if (reachesWaterTarget(summary.total, ml, targetMl)) playAppSound("goal");');
    expect(read("src/components/progress/water-tracker-card.tsx")).toContain('playAppSound("goal")');
  });

  it("a set video landing says so; a checkbox is just a tap", () => {
    expect(read("src/lib/set-videos/uploader.ts")).toContain('playAppSound("sent");');
    expect(read("src/components/ui/checkbox.tsx")).not.toMatch(/playUiSound|playAppSound/);
  });

  it("settings: one component for Account and Workout Tools, neutral volume, every row heard before it's kept", () => {
    const ui = read("src/components/sound-settings.tsx");
    expect(read("src/components/push/push-notification-card.tsx")).toContain("<SoundSettings");
    expect(read("src/components/workout-tools/workout-tools.tsx")).toContain('<SoundSettings variant="workout" />');
    expect(ui).toContain("bg-foreground");
    expect(ui).not.toMatch(/bg-primary/);
    expect(ui).toContain("onValueCommit={onCommit}");
    expect(ui).toContain("if (v) hear(SOUND_PREVIEWS[r.key]);");
  });
});
