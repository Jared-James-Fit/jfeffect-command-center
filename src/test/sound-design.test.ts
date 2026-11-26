import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
const { admitSound, scheduleAppSound, appSoundsEnabled, setAppSoundsEnabled } = await import("@/lib/app-sounds");
const { scheduleSting } = await import("@/lib/achievement-music");
const ui = await import("@/lib/ui-sounds");

// A stand-in AudioContext that records what a sound schedules.
function fakeContext() {
  let nodes = 0;
  let latestStop = 0;
  function param() {
    const p: any = { value: 0 };
    for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "cancelScheduledValues"]) p[m] = () => p;
    return p;
  }
  const node = (extra: Record<string, unknown> = {}) => {
    nodes++;
    return {
      connect: (n: unknown) => n,
      disconnect() {},
      start() {},
      stop(t: number) { latestStop = Math.max(latestStop, t); },
      ...extra,
    };
  };
  const c: any = {
    sampleRate: 44100,
    currentTime: 0,
    destination: node(),
    createOscillator: () => node({ type: "", frequency: param(), detune: param() }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: "", frequency: param(), Q: param() }),
    createBufferSource: () => node({ buffer: null }),
    createBuffer: (_ch: number, len: number, sr: number) => ({ length: len, sampleRate: sr, getChannelData: () => new Float32Array(len), copyToChannel() {} }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
  };
  return { c, nodes: () => nodes, latestStop: () => latestStop };
}

describe("sounds: synthesized, nothing downloaded", () => {
  it("every short sound schedules and stays short", () => {
    for (const name of ["tick", "confirm", "set", "exercise", "pr", "timer", "rest", "upload", "workout", "milestone", "message", "sent", "notify", "success", "celebrate", "reply", "error", "warning"] as const) {
      const f = fakeContext();
      scheduleAppSound(f.c, f.c.destination, 0, name);
      expect(f.nodes()).toBeGreaterThan(1);
      expect(f.latestStop()).toBeLessThan(1.5);
    }
  });
  it("the logging tock is tiny (few nodes, under 0.15 s)", () => {
    const f = fakeContext();
    scheduleAppSound(f.c, f.c.destination, 0, "set");
    expect(f.latestStop()).toBeLessThan(0.15);
    expect(f.nodes()).toBeLessThan(10);
  });
  it("stings: a short finish and a ~4.5 s PR build-and-drop", () => {
    const w = fakeContext();
    const workout = scheduleSting(w.c, w.c.destination, 0, "workout");
    const p = fakeContext();
    const pr = scheduleSting(p.c, p.c.destination, 0, "pr");
    expect(workout).toBeGreaterThan(2);
    expect(workout).toBeLessThan(3);
    expect(pr).toBeGreaterThan(4);
    expect(pr).toBeLessThan(5);
    expect(p.latestStop()).toBeLessThan(pr + 0.5);
    // Shared drum filters keep the graph small enough to build in one frame.
    expect(p.nodes()).toBeLessThan(220);
  });
  it("no audio files anywhere in the sound code", () => {
    for (const f of ["src/lib/app-sounds.ts", "src/lib/achievement-music.ts", "src/lib/ui-sounds.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\.(mp3|wav|ogg|m4a|aac)\b/);
    }
  });
});

describe("spacing: never a pile-up, but a PR is never swallowed", () => {
  const fresh = () => ({ lastAny: 0, lastAnyPriority: 0, lastBy: {} });
  it("a PR right after its set's tock still plays; the reverse doesn't", () => {
    const g = fresh();
    expect(admitSound("set", 10_000, g)).toBe(true);
    expect(admitSound("pr", 10_200, g)).toBe(true);
    expect(admitSound("set", 10_300, g)).toBe(false);
  });
  it("the same tock can't machine-gun (a fill-down completing 3 sets is one sound)", () => {
    const g = fresh();
    expect(admitSound("set", 20_000, g)).toBe(true);
    expect(admitSound("set", 20_050, g)).toBe(false);
    expect(admitSound("set", 20_700, g)).toBe(true);
  });
});

describe("one sound system, one setting", () => {
  it("the old UI sounds follow the same toggle", () => {
    setAppSoundsEnabled(false);
    expect(ui.uiSoundsEnabled()).toBe(false);
    ui.setUiSoundsEnabled(true);
    expect(appSoundsEnabled()).toBe(true);
    expect(readFileSync("src/lib/ui-sounds.ts", "utf8")).not.toMatch(/AudioContext/);
  });
  it("the home milestone reveal has no private audio context any more", () => {
    expect(readFileSync("src/components/portal/achievements-card.tsx", "utf8")).not.toMatch(/AudioContext/);
  });
});

describe("where the sounds play", () => {
  const recap = readFileSync("src/components/workout-submission-summary.tsx", "utf8");
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("recap: the PR sting on a headline PR day (Nov 18 2026), the finish sting otherwise, waits for records and the main lift, stops on close, has a mute", () => {
    expect(recap).toContain('stingRef.current = bigMoment ? "pr" : "workout";');
    expect(recap).toContain("if (!usesRecords || (records !== null && (!completionId || shareStats !== undefined))) { fire(); return; }");
    expect(recap).toContain("stopStingRef.current();");
    expect(recap).toContain("<SoundToggleButton");
  });
  it("logging: one sound per completed-set increase (each set once, while fresh), its chime on the last set; genuine PRs celebrate", () => {
    // through feedback(): each moment's sound and its haptic together (feedback.ts)
    expect(wdv).toContain('const moment = feedback(completedSetCount >= setCount ? "exercise" : "set", {');
    expect(wdv).toContain("key: `${row.id}:${newestCompleted.set_index}:${newestCompleted.completed_at}`,");
    // the rest starts with a set that's really new, never with a refetch's replay
    expect(wdv).toContain("if (moment && restAuto && restOrder && effectiveRest && effectiveRest > 0)");
    expect(wdv).toContain("if (readonly || !existing?.completed_at || !genuinePr) return;");
    expect(wdv).not.toContain("playUiSound");
  });
  it("rest over is two gentle bells, once per rest (iPhone web can't vibrate); Workout Tools has the sounds switch", () => {
    expect(readFileSync("src/components/workout-day/RestTimerButton.tsx", "utf8")).toContain('feedback("rest", { key: `${scopeKey}:${mine.startedAt}:${mine.endsAt}`, at: mine.endsAt });');
    expect(readFileSync("src/components/workout-tools/workout-tools.tsx", "utf8")).toContain("<SoundsRow />");
  });
  it("the music code is fetched lazily and warmed in idle time", () => {
    expect(wdv).toContain('import("@/lib/achievement-music").then((m) => idle(() => m.warmUpStings()))');
    expect(wdv).not.toMatch(/^import .*achievement-music/m);
  });
});
