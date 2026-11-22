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
  dispatchEvent() { return true; },
  setTimeout,
  clearTimeout,
};
const { scheduleAppSound } = await import("@/lib/app-sounds");
const { leagueTheme, hallTheme, LOOP_BARS, THEMES, THEME_VOLUME } = await import("@/lib/rankings-music");
const { FEEDBACK } = await import("@/lib/feedback");
const { holdBackgroundMusic, backgroundMusicHeld } = await import("@/lib/music-hold");

const read = (p: string) => readFileSync(p, "utf8");

/** A stand-in AudioContext that counts what gets scheduled and when the last note stops. */
function fakeContext() {
  let nodes = 0;
  let latestStop = 0;
  const param = () => {
    const p: any = { value: 0 };
    for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "cancelScheduledValues"]) p[m] = () => p;
    return p;
  };
  const node = (extra: Record<string, unknown> = {}) => {
    nodes++;
    return { connect: (n: unknown) => n, disconnect() {}, start() {}, stop(t: number) { latestStop = Math.max(latestStop, t); }, ...extra };
  };
  const c: any = {
    sampleRate: 44100,
    currentTime: 0,
    destination: node(),
    createOscillator: () => node({ type: "", frequency: param(), detune: param() }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: "", frequency: param(), Q: param() }),
    createBufferSource: () => node({ buffer: null, loop: false }),
    createBuffer: (_ch: number, len: number, sr: number) => ({ length: len, sampleRate: sr, getChannelData: () => new Float32Array(len), copyToChannel() {} }),
    createDelay: () => node({ delayTime: param() }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
  };
  return { c, nodes: () => nodes, latestStop: () => latestStop };
}

describe("Rankings theme music: two original themes, synthesized", () => {
  it("each theme is an 8-bar loop scheduled a bar at a time, light enough to build on a phone", () => {
    for (const [build, bpm] of [[leagueTheme, 124], [hallTheme, 76]] as const) {
      const bar = (60 / bpm) * 4;
      const f = fakeContext();
      const loop = build(f.c, f.c.destination, 0);
      loop.schedule(0.5);
      const firstBar = f.nodes();
      expect(firstBar).toBeGreaterThan(40);
      // a bar costs a few hundred nodes at most (they're let go as each note ends)
      expect(firstBar).toBeLessThan(420);
      // scheduling ahead to the same time adds nothing (no note is ever scheduled twice)
      loop.schedule(0.5);
      expect(f.nodes()).toBe(firstBar);
      // the whole loop and then the next bar
      loop.schedule(bar * LOOP_BARS + 0.01);
      expect(f.latestStop()).toBeGreaterThan(bar * LOOP_BARS);
    }
  });

  it("names and tempos are the ones the button and the docs say", () => {
    expect(THEMES.league).toEqual({ title: "Points on the Board", mood: "Monthly League theme", bpm: 124 });
    expect(THEMES.hall).toEqual({ title: "Iron Legacy", mood: "Hall of Strength theme", bpm: 76 });
    // mixed to sit under the screen (about −23 dBFS RMS, measured offline in Chromium)
    expect(THEME_VOLUME.league).toBeLessThan(0.5);
    expect(THEME_VOLUME.hall).toBeLessThan(0.55);
  });

  it("no audio files, and nothing a phone speaker can't play (a high-pass on each mix)", () => {
    const src = read("src/lib/rankings-music.ts");
    expect(src).not.toMatch(/\.(mp3|wav|ogg|m4a|aac)\b/);
    expect(src.match(/filt\(c, gainTo\(c, out, 1\), "highpass", 45\)/g)).toHaveLength(2);
    // on the shared engine: one context, one sounds switch, the silent switch
    expect(src).toContain('import { plateStrike, startAppMusic, type MusicLoop } from "@/lib/app-sounds";');
    expect(src).not.toMatch(/new (webkit)?AudioContext/);
  });
});

describe("Rankings sound effects", () => {
  it("whoosh, clash and clang schedule and stay short", () => {
    for (const name of ["whoosh", "clash", "clang"] as const) {
      const f = fakeContext();
      scheduleAppSound(f.c, f.c.destination, 0, name);
      expect(f.nodes()).toBeGreaterThan(1);
      expect(f.latestStop()).toBeLessThan(1.2);
    }
  });

  it("each moment has its feedback, through feedback() only", () => {
    expect(FEEDBACK.board).toEqual({ haptic: "selection", sound: "whoosh" });
    expect(FEEDBACK.versus).toEqual({ haptic: "medium", sound: "clash" });
    expect(FEEDBACK.reveal).toEqual({ haptic: "light", sound: "clang" });
    const hub = read("src/components/community/league-hub.tsx");
    expect(hub).toContain('feedback("board");');
    const view = read("src/components/portal/strength-split-view.tsx");
    expect(view).toContain('feedback("versus")');
    expect(view).toContain('feedback("reveal")');
  });
});

describe("the music button", () => {
  const hub = read("src/components/community/league-hub.tsx");
  const button = read("src/components/community/rankings-music.tsx");
  it("sits beside the board switch and plays the board you're on", () => {
    expect(hub).toContain('const music = useRankingsMusic(board === "strength" ? "hall" : "league");');
    expect(hub).toContain('<RankingsMusicButton theme={board === "strength" ? "hall" : "league"} on={music.on} playing={music.playing} onToggle={music.toggle} />');
  });
  it("is off until they turn it on (on this phone), and the music module loads only then", () => {
    expect(button).toContain('return window.localStorage.getItem(KEY) === "1";');
    expect(button).toContain('void import("@/lib/rankings-music")');
    expect(button).not.toMatch(/^import \{[^}]*\} from "@\/lib\/rankings-music"/m);
    // quiet in the background, with sounds off, and while another piece of music holds it
    expect(button).toContain("const playing = on && sounds && visible && !held;");
  });
  it("the Monthly Recap's music holds the theme while it plays", () => {
    const recap = read("src/lib/recap-music.ts");
    expect(recap).toContain("releaseHold ??= holdBackgroundMusic();");
    expect(recap).toContain("releaseHold?.();");
    const release = holdBackgroundMusic();
    expect(backgroundMusicHeld()).toBe(true);
    release();
    release();
    expect(backgroundMusicHeld()).toBe(false);
  });
});
