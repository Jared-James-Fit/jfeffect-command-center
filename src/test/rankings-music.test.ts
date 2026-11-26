import { existsSync, readFileSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

// ── a stand-in AudioContext: records sources and gain automation ────────────

type FakeSource = {
  buffer: unknown;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  started: [number, number] | null;
  stopped: boolean;
  connect: (n: unknown) => unknown;
  disconnect: () => void;
  start: (when: number, offset: number) => void;
  stop: () => void;
};
function fakeContext(state: "running" | "suspended" = "running") {
  const listeners = new Set<() => void>();
  const sources: FakeSource[] = [];
  const gains: { gain: { value: number; events: [string, number, number][] } }[] = [];
  const c = {
    state,
    currentTime: 10,
    sampleRate: 48000,
    destination: { connect: (n: unknown) => n },
    decodes: 0,
    addEventListener: (_t: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => void listeners.delete(fn),
    fire() {
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
    createBufferSource() {
      const s: FakeSource = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        started: null,
        stopped: false,
        connect: (n) => n,
        disconnect() {},
        start(when, offset) {
          this.started = [when, offset];
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(s);
      return s;
    },
    createGain() {
      const g = {
        gain: {
          value: 0,
          events: [] as [string, number, number][],
          setValueAtTime(v: number, t: number) {
            g.gain.events.push(["set", v, t]);
            g.gain.value = v;
          },
          linearRampToValueAtTime(v: number, t: number) {
            g.gain.events.push(["ramp", v, t]);
          },
          cancelScheduledValues() {},
        },
        connect: (n: unknown) => n,
        disconnect() {},
      };
      gains.push(g);
      return g;
    },
    decodeAudioData(_b: ArrayBuffer, ok: (b: unknown) => void) {
      c.decodes++;
      const buf = { duration: 54.333 };
      ok(buf);
      return Promise.resolve(buf);
    },
  };
  return { c, sources, gains };
}

let ctx = fakeContext();
const wake = vi.fn();
vi.mock("@/lib/app-sounds", () => ({
  appAudioContext: () => ctx.c,
  appSoundBus: () => ctx.c.destination,
  wakeAppAudio: () => wake(),
}));
vi.mock("@/assets/music/main-event.m4a?url", () => ({ default: "/assets/main-event.m4a" }));

const music = await import("@/lib/rankings-music");
const { RANKINGS_TRACK, BAR_SECONDS, FADE_IN, RESUME_MS, loopPosition, fileTimeOf, freshStartOffset, startOffset, preloadAllowed, setRankingsMusic, rankingsMusicStatus, resetRankingsMusicForTests } = music;
const { holdBackgroundMusic, backgroundMusicHeld, installMediaMusicHold } = await import("@/lib/music-hold");

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
let fetches = 0;

beforeEach(() => {
  vi.useFakeTimers();
  resetRankingsMusicForTests();
  ctx = fakeContext();
  wake.mockClear();
  fetches = 0;
  vi.stubGlobal("fetch", async () => {
    fetches++;
    const res = { ok: true, arrayBuffer: async () => new ArrayBuffer(16), clone: () => res };
    return res;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the track", () => {
  it("is one 32-bar loop at 144 BPM, whole samples at 44.1 and 48 kHz, with half a second either side", () => {
    expect(RANKINGS_TRACK.title).toBe("Main Event");
    expect(BAR_SECONDS).toBeCloseTo(5 / 3, 9);
    const loop = RANKINGS_TRACK.loopEnd - RANKINGS_TRACK.loopStart;
    expect(loop).toBeCloseTo(RANKINGS_TRACK.bars * BAR_SECONDS, 9);
    expect(Number.isInteger(Math.round(loop * 48000 * 1e6) / 1e6)).toBe(true);
    expect(Number.isInteger(Math.round(loop * 44100 * 1e6) / 1e6)).toBe(true);
    expect(RANKINGS_TRACK.loopStart).toBe(0.5);
    // the render and the encoder say the same
    expect(read("scripts/rankings-music/render.py")).toContain("BPM = 144");
    expect(read("scripts/rankings-music/render.py")).toContain("BARS = 32");
    expect(read("scripts/rankings-music/encode.py")).toContain("PRE = 0.5");
    // the rotation the encoder printed for the shipped file
    expect(Math.round(RANKINGS_TRACK.rotation * 48000)).toBe(265755);
  });

  it("ships compressed (AAC, under 1.2 MB) with its licence on file", () => {
    const f = "src/assets/music/main-event.m4a";
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThan(1_200_000);
    const head = readFileSync(f).subarray(0, 64).toString("latin1");
    expect(head).toContain("ftyp");
    const lic = read("docs/licenses/rankings-music.md");
    expect(lic).toMatch(/CC0 1\.0/);
    expect(lic).toContain("VSCO-2-CE");
    expect(existsSync("docs/licenses/rankings-music/VSCO-2-CE-LICENSE.txt")).toBe(true);
  });

  it("is played at a level under the screen (mastered -16 LUFS, played near -25)", () => {
    expect(RANKINGS_TRACK.gain).toBeGreaterThan(0.3);
    expect(RANKINGS_TRACK.gain).toBeLessThan(0.6);
  });
});

describe("where it plays from", () => {
  it("loops inside the loop's range", () => {
    expect(loopPosition(10, 5)).toBe(15);
    const end = RANKINGS_TRACK.loopEnd;
    const start = RANKINGS_TRACK.loopStart;
    expect(loopPosition(end - 1, 3)).toBeCloseTo(start + 2, 9);
    expect(loopPosition(start, (end - start) * 3 + 1)).toBeCloseTo(start + 1, 9);
  });
  it("a fresh start is the bar before the downbeat; a recent stop carries on", () => {
    // the file starts mid-loop (the loop point is its quietest instant): the downbeat is where rotation says
    const len = RANKINGS_TRACK.loopEnd - RANKINGS_TRACK.loopStart;
    expect(fileTimeOf(RANKINGS_TRACK.rotation)).toBeCloseTo(RANKINGS_TRACK.loopStart, 9);
    expect(fileTimeOf(0)).toBeCloseTo(RANKINGS_TRACK.loopStart + len - RANKINGS_TRACK.rotation, 9);
    expect(freshStartOffset()).toBeCloseTo(fileTimeOf(len - BAR_SECONDS), 9);
    expect(freshStartOffset()).toBeGreaterThanOrEqual(RANKINGS_TRACK.loopStart);
    expect(freshStartOffset()).toBeLessThan(RANKINGS_TRACK.loopEnd);
    expect(startOffset(1000, null)).toBe(freshStartOffset());
    expect(startOffset(1000 + RESUME_MS - 1, { offset: 20, at: 1000 })).toBe(20);
    expect(startOffset(1000 + RESUME_MS + 1, { offset: 20, at: 1000 })).toBe(freshStartOffset());
  });
  it("isn't fetched ahead on a data-saving or 2G connection", () => {
    expect(preloadAllowed(undefined)).toBe(true);
    expect(preloadAllowed({ connection: { saveData: true } } as unknown as Navigator)).toBe(false);
    expect(preloadAllowed({ connection: { effectiveType: "slow-2g" } } as unknown as Navigator)).toBe(false);
    expect(preloadAllowed({ connection: { effectiveType: "2g" } } as unknown as Navigator)).toBe(false);
    expect(preloadAllowed({ connection: { effectiveType: "4g" } } as unknown as Navigator)).toBe(true);
  });
});

describe("the controller: one voice, gapless, faded", () => {
  it("starts one looping voice, fading in from the bar before the downbeat", async () => {
    setRankingsMusic(true);
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const s = ctx.sources[0];
    expect(s.loop).toBe(true);
    expect(s.loopStart).toBe(RANKINGS_TRACK.loopStart);
    expect(s.loopEnd).toBeCloseTo(RANKINGS_TRACK.loopEnd, 9);
    expect(s.started?.[1]).toBeCloseTo(freshStartOffset(), 9);
    const ramp = ctx.gains[0].gain.events.find((e) => e[0] === "ramp");
    expect(ramp?.[1]).toBe(RANKINGS_TRACK.gain);
    expect(ramp![2] - s.started![0]).toBeCloseTo(FADE_IN, 9);
    expect(rankingsMusicStatus()).toBe("playing");
  });

  it("asking again never starts a second copy, and coming back mid-fade brings the same voice up", async () => {
    setRankingsMusic(true);
    await flush();
    setRankingsMusic(true);
    await flush();
    expect(ctx.sources).toHaveLength(1);
    setRankingsMusic(false, 0.7);
    expect(rankingsMusicStatus()).toBe("off");
    expect(ctx.gains[0].gain.events.at(-1)).toEqual(["ramp", 0, expect.any(Number)]);
    vi.advanceTimersByTime(300);
    setRankingsMusic(true);
    await flush();
    vi.advanceTimersByTime(2000);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].stopped).toBe(false);
    expect(ctx.gains[0].gain.events.at(-1)?.[1]).toBe(RANKINGS_TRACK.gain);
  });

  it("stops after the fade and picks up where it was when it comes back soon", async () => {
    setRankingsMusic(true);
    await flush();
    const first = ctx.sources[0];
    ctx.c.currentTime = first.started![0] + 4; // four seconds in
    setRankingsMusic(false, 0.5);
    vi.advanceTimersByTime(1000);
    expect(first.stopped).toBe(true);
    setRankingsMusic(true);
    await flush();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1].started?.[1]).toBeCloseTo(loopPosition(first.started![1], 4.5), 6);
    // the file is decoded once and fetched once
    expect(ctx.c.decodes).toBe(1);
    expect(fetches).toBe(1);
  });

  it("waits for the first tap when the browser wants one, then starts once", async () => {
    ctx = fakeContext("suspended");
    setRankingsMusic(true);
    await flush();
    expect(ctx.sources).toHaveLength(0);
    expect(rankingsMusicStatus()).toBe("waiting");
    expect(wake).toHaveBeenCalled();
    ctx.c.state = "running";
    ctx.c.fire();
    ctx.c.fire();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.c.listenerCount()).toBe(0);
  });

  it("muted (or gone) before the tap: nothing ever plays", async () => {
    ctx = fakeContext("suspended");
    setRankingsMusic(true);
    await flush();
    setRankingsMusic(false);
    ctx.c.state = "running";
    ctx.c.fire();
    expect(ctx.sources).toHaveLength(0);
  });

  it("let go before the file decoded: it never starts", async () => {
    setRankingsMusic(true);
    setRankingsMusic(false);
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });
});

describe("other sounds come first", () => {
  it("a video or voice memo with its sound on holds the music; muted ones don't", () => {
    const handlers: Record<string, (e: Event) => void> = {};
    const doc = { addEventListener: (t: string, fn: (e: Event) => void) => void (handlers[t] = fn) } as unknown as Document;
    installMediaMusicHold(doc);
    const elListeners: Record<string, () => void> = {};
    const el = {
      paused: false,
      ended: false,
      muted: true,
      volume: 1,
      addEventListener: (t: string, fn: () => void) => void (elListeners[t] = fn),
      removeEventListener: (t: string) => void delete elListeners[t],
    };
    handlers.play({ target: el } as unknown as Event);
    expect(backgroundMusicHeld()).toBe(false);
    el.muted = false;
    handlers.volumechange({ target: el } as unknown as Event);
    expect(backgroundMusicHeld()).toBe(true);
    el.paused = true;
    elListeners.pause.call(el);
    expect(backgroundMusicHeld()).toBe(false);
  });

  it("anything holding the page's playback session (a demo, a voice memo) holds the music too", async () => {
    const { holdPlaybackSession } = await import("@/lib/audio-session");
    const release = holdPlaybackSession();
    expect(backgroundMusicHeld()).toBe(true);
    release();
    expect(backgroundMusicHeld()).toBe(false);
    const r = holdBackgroundMusic();
    r();
    r();
    expect(backgroundMusicHeld()).toBe(false);
  });

  it("the Monthly Recap's music holds it while it plays", () => {
    const recap = read("src/lib/recap-music.ts");
    expect(recap).toContain("releaseHold ??= holdBackgroundMusic();");
    expect(recap).toContain("releaseHold?.();");
  });
});

describe("Rankings: on by default, a plain mute, one track for every board", () => {
  const hub = read("src/components/community/league-hub.tsx");
  const button = read("src/components/community/rankings-music.tsx");
  it("the hub asks for the music without naming a board, so switching boards or audiences never restarts it", () => {
    expect(hub).toContain("const music = useRankingsMusic();");
    expect(hub).toContain("<RankingsMusicButton on={music.on} status={music.status} onToggle={music.toggle} />");
    expect(hub).not.toMatch(/useRankingsMusic\(board/);
  });
  it("plays unless muted on this phone; quiet in the background, with sounds off and while something else plays", () => {
    expect(button).toContain('return window.localStorage.getItem(KEY) === "0";');
    expect(button).toContain("const on = !muted && sounds;");
    expect(button).toContain("const playing = on && visible && !held;");
    // the controller loads with Rankings, never in Crew's first chunk
    expect(button).toContain('void import("@/lib/rankings-music")');
    expect(button).not.toMatch(/^import \{[^}]*\} from "@\/lib\/rankings-music"/m);
    // no "now playing" toast: the button shows it
    expect(button).not.toContain("Now playing");
  });
  it("is fetched in Crew's idle time and decoded as a finger lands on the Rankings tab", () => {
    expect(read("src/components/community/community-screen.tsx")).toContain("m.prefetchRankingsMusicIfOn()");
    expect(read("src/components/community/crew-header.tsx")).toContain('onPointerDown={k === "rankings" ? warmRankingsMusic : undefined}');
  });
  it("the old synthesized themes are gone (no second engine to start)", () => {
    const lib = read("src/lib/rankings-music.ts");
    expect(lib).not.toMatch(/leagueTheme|hallTheme|startAppMusic/);
    expect(read("src/lib/app-sounds.ts")).not.toContain("export function startAppMusic");
  });
});

describe("Rankings sound effects", () => {
  it("each moment has its feedback, through feedback() only", async () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    });
    const { FEEDBACK } = await import("@/lib/feedback");
    expect(FEEDBACK.board).toEqual({ haptic: "selection", sound: "whoosh" });
    expect(FEEDBACK.versus).toEqual({ haptic: "medium", sound: "clash" });
    expect(FEEDBACK.reveal).toEqual({ haptic: "light", sound: "clang" });
    expect(read("src/components/community/league-hub.tsx")).toContain('feedback("board");');
    const view = read("src/components/portal/strength-split-view.tsx");
    expect(view).toContain('feedback("versus")');
    expect(view).toContain('feedback("reveal")');
  });
});
