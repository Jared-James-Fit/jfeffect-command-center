import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A Web Audio context as an iPhone hands it out: suspended until a tap, "interrupted" after the app was away. */
class FakeCtx {
  state: string = "suspended";
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  started = 0;
  resumes = 0;
  resume() {
    this.resumes++;
    if (fake.allowResume) this.state = "running";
    return Promise.resolve();
  }
  private node() {
    const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
    return {
      gain: { ...param }, frequency: { ...param }, Q: { ...param }, type: "",
      buffer: null as unknown,
      connect: (x: unknown) => x, disconnect() {},
      start: () => { this.started++; }, stop() {},
    };
  }
  createGain() { return this.node(); }
  createOscillator() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
}
const fake: { ctx: FakeCtx | null; allowResume: boolean; listeners: string[]; removed: string[] } = { ctx: null, allowResume: true, listeners: [], removed: [] };
const store = new Map<string, string>();

async function load() {
  vi.resetModules();
  fake.ctx = null;
  fake.listeners = [];
  fake.removed = [];
  (globalThis as any).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    addEventListener: (type: string) => void fake.listeners.push(type),
    removeEventListener: (type: string) => void fake.removed.push(type),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    AudioContext: function () { fake.ctx = new FakeCtx(); return fake.ctx; },
  };
  (globalThis as any).document = { visibilityState: "visible", addEventListener() {} };
  return await import("@/lib/app-sounds");
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("sounds play after the phone paused the audio (another app, a call, a tap that didn't count)", () => {
  beforeEach(() => {
    store.clear();
    fake.allowResume = true;
  });

  it("wakes on every tap a touch screen counts, and keeps listening", async () => {
    await load();
    for (const type of ["touchend", "pointerup", "click", "keydown"]) expect(fake.listeners).toContain(type);
    // pointerdown isn't the tap that may start audio on a touch screen
    expect(fake.listeners).not.toContain("pointerdown");
    expect(fake.removed).toEqual([]);
  });

  it("a sound asked for while the audio is paused plays once it wakes, instead of being dropped", async () => {
    const s = await load();
    s.playAppSound("set");
    const c = fake.ctx!;
    expect(c.resumes).toBeGreaterThan(0);
    const before = c.started;
    await flush();
    // the "set" tock (two voices) plays after the wake-up's silent blip
    expect(c.started - before).toBeGreaterThanOrEqual(2);
  });

  it("after the app was away (interrupted) the next sound wakes it and plays, again and again", async () => {
    const s = await load();
    s.playAppSound("set");
    await flush();
    const c = fake.ctx!;
    c.state = "interrupted";
    const before = c.started;
    s.playAppSound("timer");
    await flush();
    expect(c.state).toBe("running");
    expect(c.started - before).toBeGreaterThanOrEqual(2);
  });

  it("if the phone won't wake it yet, nothing is forced (and nothing throws)", async () => {
    const s = await load();
    fake.allowResume = false;
    s.playAppSound("pr");
    const before = fake.ctx!.started;
    await flush();
    // only the silent wake-up blip, no PR sparkle stacked up for later
    expect(fake.ctx!.started - before).toBe(0);
  });
});

describe("a sound someone taps to hear (chat sound effects, voice memos) isn't muted by the silent switch", () => {
  it("holds 'playback' from before it starts until it stops, and switching sounds keeps it held", async () => {
    vi.resetModules();
    const handlers = new Map<string, () => void>();
    class FakeAudio {
      paused = true;
      src = "";
      preload = "";
      currentTime = 0;
      addEventListener(type: string, fn: () => void) { handlers.set(type, fn); }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; handlers.get("pause")?.(); }
    }
    (globalThis as any).window = {};
    (globalThis as any).Audio = FakeAudio;
    const session = await import("@/lib/audio-session");
    const player = await import("@/lib/sound-player");
    await player.playSound("https://x/a.mp3");
    handlers.get("play")?.();
    expect(session.playbackHolds()).toBe(1);
    // straight to another sound: the old one's late pause must not let go
    await player.playSound("https://x/b.mp3");
    handlers.get("pause")?.();
    handlers.get("play")?.();
    expect(session.playbackHolds()).toBe(1);
    player.stopSound();
    expect(session.playbackHolds()).toBe(0);
  });

  it("voice memos hold it the same way", () => {
    const memo = readFileSync("src/components/community/voice-memo.tsx", "utf8");
    expect(memo).toContain("if (!session.current) session.current = holdPlaybackSession();");
    expect(memo).toMatch(/a\.onpause = \(\) => \{\n\s+setPlaying\(false\);\n\s+letGo\(\);/);
  });
});
