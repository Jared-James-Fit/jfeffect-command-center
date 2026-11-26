import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

/** A small browser: storage (local + session), visibility, an audio context that records what plays. */
type Rec = { buffers: unknown[]; oscillators: number; gains: number; started: number; disconnected: number };
function fakeBrowser(opts: { hidden?: boolean; offline?: boolean } = {}) {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const rec: Rec = { buffers: [], oscillators: 0, gains: 0, started: 0, disconnected: 0 };
  const param = () => {
    const p: any = { value: 0 };
    for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "cancelScheduledValues", "setTargetAtTime"]) p[m] = () => p;
    return p;
  };
  const node = (extra: Record<string, unknown> = {}) => ({
    connect: (n: unknown) => n,
    disconnect: () => void rec.disconnected++,
    start: () => void rec.started++,
    stop() {},
    ...extra,
  });
  class Ctx {
    state = "running";
    currentTime = 0;
    sampleRate = 48000;
    destination = node();
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    createGain() { rec.gains++; return node({ gain: param() }); }
    createOscillator() { rec.oscillators++; return node({ type: "", frequency: param() }); }
    createBiquadFilter() { return node({ type: "", frequency: param(), Q: param() }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createBuffer(_ch: number, len: number) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    createBufferSource() {
      const src: any = node({ buffer: null });
      const start = src.start;
      src.start = () => { rec.buffers.push(src.buffer); start(); };
      return src;
    }
  }
  class Offline extends Ctx {
    constructor(_ch: number, public length: number, rate: number) { super(); this.sampleRate = rate; }
    startRendering() { return Promise.resolve({ rendered: true, length: this.length }); }
  }
  const idleQueue: Array<() => void> = [];
  const window: any = {
    localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) },
    sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    matchMedia: () => ({ matches: false }),
    AudioContext: Ctx,
    requestIdleCallback: (fn: () => void) => { idleQueue.push(fn); return 1; },
  };
  if (!opts.offline) window.OfflineAudioContext = Offline;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", { visibilityState: opts.hidden ? "hidden" : "visible", addEventListener() {} });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: 0 });
  return { local, session, rec, idleQueue, runIdle: async () => { while (idleQueue.length) { idleQueue.shift()!(); await new Promise((r) => setTimeout(r, 0)); } } };
}

async function engines() {
  vi.resetModules();
  const sounds = await import("@/lib/app-sounds");
  const fb = await import("@/lib/feedback");
  return { sounds, fb };
}

describe("priority: the cue that matters more wins the moment", () => {
  const fresh = () => ({ lastAny: -Infinity, lastAnyPriority: 0, lastBy: {} });

  it("a confirm tick never covers the set it completed: the pop preempts it; a tick right after a pop is dropped", async () => {
    const { soundDecision } = await import("@/lib/app-sounds");
    const g = fresh();
    expect(soundDecision("confirm", 10_000, g)).toBe("play");
    expect(soundDecision("set", 10_060, g)).toBe("preempt");
    expect(soundDecision("confirm", 10_100, g)).toBe("drop");
  });

  it("the PR over its set's pop and the exercise's chime; the signature over everything but a milestone", async () => {
    const { soundDecision } = await import("@/lib/app-sounds");
    const g = fresh();
    expect(soundDecision("set", 0, g)).toBe("play");
    expect(soundDecision("exercise", 40, g)).toBe("preempt");
    expect(soundDecision("pr", 200, g)).toBe("preempt");
    expect(soundDecision("set", 260, g)).toBe("drop");
    expect(soundDecision("upload", 300, g)).toBe("drop");
    expect(soundDecision("workout", 340, g)).toBe("preempt");
    expect(soundDecision("milestone", 360, g)).toBe("preempt");
  });

  it("rapid logging never machine-guns: ten sets tapped 200 ms apart are a few pops, and a PR in the middle still lands", async () => {
    const { soundDecision } = await import("@/lib/app-sounds");
    const g = fresh();
    const played: Array<{ name: string; at: number; d: string }> = [];
    const ask = (name: "confirm" | "set" | "pr", at: number) => {
      const d = soundDecision(name, at, g);
      if (d !== "drop") played.push({ name, at, d });
    };
    for (let i = 0; i < 10; i++) {
      const t = 50_000 + i * 200;
      ask("confirm", t);
      ask("set", t + 30);
      if (i === 5) ask("pr", t + 120);
    }
    const sets = played.filter((p) => p.name === "set").length;
    expect(sets).toBeGreaterThanOrEqual(3);
    expect(sets).toBeLessThanOrEqual(4);
    expect(played.some((p) => p.name === "pr")).toBe(true);
    // two seconds of hammering is a handful of cues, never one per tap (30 asked)
    expect(played.length).toBeLessThanOrEqual(9);
    // anything closer than the same-moment window to the cue before it is one that matters more (it fades the earlier)
    for (let i = 1; i < played.length; i++) {
      if (played[i].at - played[i - 1].at < 350) expect(played[i].d, `${played[i - 1].name} → ${played[i].name}`).toBe("preempt");
    }
  });

  it("a sting holding the floor keeps lesser cues out until it's done, a milestone still lands", async () => {
    const { soundDecision } = await import("@/lib/app-sounds");
    const g = { ...fresh(), holdUntil: 5_000, holdPriority: 8 };
    expect(soundDecision("message", 1_000, g)).toBe("drop");
    expect(soundDecision("pr", 2_000, g)).toBe("drop");
    expect(soundDecision("milestone", 3_000, g)).not.toBe("drop");
    expect(soundDecision("message", 6_000, g)).not.toBe("drop");
  });

  it("every cue has a priority, a ring length under 1.5 s, and logging cues are ordered by value", async () => {
    const { SOUND_PRIORITY: P, SOUND_SECONDS } = await import("@/lib/app-sounds");
    for (const [name, s] of Object.entries(SOUND_SECONDS)) {
      expect(P[name as keyof typeof P], name).toBeTypeOf("number");
      expect(s, name).toBeLessThan(1.5);
    }
    expect(P.confirm).toBeLessThan(P.set);
    expect(P.set).toBeLessThan(P.exercise);
    expect(P.exercise).toBeLessThanOrEqual(P.upload);
    expect(P.upload).toBeLessThan(P.pr);
    expect(P.pr).toBeLessThan(P.workout);
  });
});

describe("volume: one level for every sound, kept on the device", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is on by default at a level under the tuned one, remembered, clamped, and heard on release", async () => {
    const b = fakeBrowser();
    const { sounds } = await engines();
    expect(sounds.appSoundVolume()).toBe(sounds.DEFAULT_SOUND_VOLUME);
    expect(sounds.volumeToGain(sounds.DEFAULT_SOUND_VOLUME)).toBeLessThan(1);
    expect(sounds.volumeToGain(0)).toBe(0);
    // perceptual: the first half of the slider does less than half the gain
    expect(sounds.volumeToGain(0.5)).toBeLessThan(sounds.volumeToGain(1) / 2);
    for (let v = 0.05; v <= 1; v += 0.05) expect(sounds.volumeToGain(v)).toBeGreaterThan(sounds.volumeToGain(v - 0.05));
    const heard: number[] = [];
    sounds.subscribeAppSoundVolume((v) => heard.push(v));
    sounds.setAppSoundVolume(0.35);
    expect(b.local.get("jf-app-sounds-volume")).toBe("0.35");
    expect(heard).toEqual([0.35]);
    sounds.setAppSoundVolume(4);
    expect(sounds.appSoundVolume()).toBe(1);
    // a new session reads it back
    const again = await engines();
    expect(again.sounds.appSoundVolume()).toBe(1);
    // release previews a set's pop
    const before = b.rec.started;
    again.sounds.setAppSoundVolume(0.6, { preview: true });
    expect(b.rec.started).toBeGreaterThan(before);
  });

  it("at zero nothing is built or played; switched off, the same", async () => {
    const b = fakeBrowser();
    const { sounds } = await engines();
    sounds.setAppSoundVolume(0);
    const before = b.rec.oscillators + b.rec.started;
    sounds.playAppSound("pr");
    expect(b.rec.oscillators + b.rec.started).toBe(before);
    sounds.setAppSoundVolume(0.8);
    sounds.setAppSoundsEnabled(false);
    const before2 = b.rec.oscillators + b.rec.started;
    sounds.playAppSound("set");
    expect(b.rec.oscillators + b.rec.started).toBe(before2);
  });

  it("a hidden app makes no sound", async () => {
    const b = fakeBrowser({ hidden: true });
    const { sounds } = await engines();
    sounds.playAppSound("set");
    expect(b.rec.oscillators).toBe(0);
  });
});

describe("the cache: hot cues rendered once, played as one buffer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the logging cues in idle time, one at a time, then plays a set from its buffer (no graph built mid-tap)", async () => {
    const b = fakeBrowser();
    const { sounds, fb } = await engines();
    fb.primeFeedback();
    // nothing renders until the phone is idle
    expect(sounds.preloadedAppSounds()).toEqual([]);
    await b.runIdle();
    for (const n of ["confirm", "set", "exercise", "pr", "rest", "upload", "workout", "warning"] as const) {
      expect(sounds.preloadedAppSounds()).toContain(n);
    }
    const oscBefore = b.rec.oscillators;
    sounds.playAppSound("set");
    expect(b.rec.oscillators).toBe(oscBefore);
    expect(b.rec.buffers.at(-1)).toMatchObject({ rendered: true });
  });

  it("without OfflineAudioContext (an old browser) cues still play, synthesized live", async () => {
    const b = fakeBrowser({ offline: true });
    const { sounds } = await engines();
    sounds.preloadAppSounds();
    await b.runIdle();
    expect(sounds.preloadedAppSounds()).toEqual([]);
    sounds.playAppSound("set");
    expect(b.rec.oscillators).toBeGreaterThan(0);
  });

  it("no audio files: everything is synthesized here (nothing to download, license or pay for)", () => {
    for (const f of ["src/lib/app-sounds.ts", "src/lib/feedback.ts", "src/lib/achievement-music.ts"]) {
      expect(read(f)).not.toMatch(/\.(mp3|wav|ogg|m4a|aac|caf)\b/);
      expect(read(f)).not.toMatch(/fetch\(/);
    }
  });
});

describe("once per moment, and only while it's news", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a keyed moment is felt once: a re-render, a refetch or a remount never repeats it (kept for the session)", async () => {
    const b = fakeBrowser();
    const { fb } = await engines();
    expect(fb.feedback("set", { key: "row1:2:2027-01-01T00:00:00Z" })).toBe(true);
    expect(fb.feedback("set", { key: "row1:2:2027-01-01T00:00:00Z" })).toBe(false);
    // the same set's PR is a different moment
    expect(fb.feedback("pr", { key: "row1:2:2027-01-01T00:00:00Z" })).toBe(true);
    expect(b.session.get("jf-feedback-seen")).toContain("set:row1:2:");
    // a reload in the same tab: the ledger comes back
    const again = await engines();
    expect(again.fb.feedback("set", { key: "row1:2:2027-01-01T00:00:00Z" })).toBe(false);
    expect(again.fb.feedback("set", { key: "row1:3:2027-01-01T00:00:00Z" })).toBe(true);
  });

  it("history says nothing: an old set, PR or rest end; a clock a little ahead still counts; an unknown time counts", async () => {
    fakeBrowser();
    const { fb } = await engines();
    const now = Date.now();
    expect(fb.isFreshMoment(new Date(now - 10_000).toISOString(), now, 60_000)).toBe(true);
    expect(fb.isFreshMoment(new Date(now - 10 * 60_000).toISOString(), now, 2 * 60_000)).toBe(false);
    expect(fb.isFreshMoment(now + 60_000, now, 1000)).toBe(true);
    expect(fb.isFreshMoment("not a date", now, 1000)).toBe(true);
    expect(fb.isFreshMoment(null, now, 1000)).toBe(true);
    // a PR from last week, opened today
    expect(fb.feedback("pr", { key: "old", at: now - 7 * 86_400_000 })).toBe(false);
    // a rest that ran out a minute ago (the app was away)
    expect(fb.feedback("rest", { key: "r", at: now - 60_000 })).toBe(false);
    expect(fb.feedback("pr", { key: "new", at: now - 5_000 })).toBe(true);
  });

  it("feedback never throws, and a moment counts whatever the switches say (a rest can start with its set while sounds are off)", async () => {
    fakeBrowser();
    const { fb, sounds } = await engines();
    sounds.setAppSoundsEnabled(false);
    expect(fb.feedback("set", { key: "k" })).toBe(true);
    expect(fb.feedback("nope" as any)).toBe(false);
  });
});

describe("a genuine PR", () => {
  it("is an all-time record at 10 reps or fewer, or the heaviest weight yet; never a block or program best or a 15-rep accessory", async () => {
    const { isGenuineSetPr, GENUINE_PR_MAX_REPS } = await import("@/lib/set-pr-items");
    expect(isGenuineSetPr({ record: { reps: 5, atpr: true } })).toBe(true);
    expect(isGenuineSetPr({ record: { reps: 10, atpr: true } })).toBe(true);
    expect(isGenuineSetPr({ record: { reps: 15, atpr: true } })).toBe(false);
    expect(isGenuineSetPr({ record: { reps: 5, atpr: false } })).toBe(false);
    expect(isGenuineSetPr({ loadRecord: { atpr: true } })).toBe(true);
    expect(isGenuineSetPr({ loadRecord: { atpr: false } })).toBe(false);
    expect(isGenuineSetPr({ localPr: { reps: 3 } })).toBe(true);
    expect(isGenuineSetPr({ localPr: { reps: 12 } })).toBe(false);
    // the server's records win over the phone's guess
    expect(isGenuineSetPr({ record: { reps: 5, atpr: false }, localPr: { reps: 5 } })).toBe(false);
    expect(isGenuineSetPr({})).toBe(false);
    // the same line the Crew's headline PR draws
    expect(read("src/lib/community.ts")).toContain(`export const HEADLINE_PR_MAX_REPS = ${GENUINE_PR_MAX_REPS};`);
  });
});

describe("where each moment fires", () => {
  const wdv = read("src/components/workout-day/WorkoutDayView.tsx");

  it("a confirmed rep count, weight or RPE ticks (only a changed value, never a clear or a keystroke); a value that won't do is a soft warning", () => {
    const typed = read("src/components/workout-day/typed-value-input.tsx");
    expect(typed).toContain('if (next !== value) {\n      if (next !== "") feedback("confirm");');
    expect(typed).toContain('if (!res.ok) { setError(res.error); feedback("warning"); return; }');
    expect(typed).not.toMatch(/onChange=\{[^}]*feedback/);
    const weight = read("src/components/workout-day/weight-value-input.tsx");
    expect(weight).toContain('if (next.load !== "" || next.bodyweight) feedback("confirm");');
    expect(weight).toContain('if (!res.ok) { setError(res.error); feedback("warning"); return; }');
  });

  it("a set's pop and an exercise's chime are keyed by the set and when it was logged; the logger primes the cues on open", () => {
    expect(wdv).toContain("at: newestCompleted.completed_at,");
    expect(wdv).toContain("const t = window.setTimeout(() => primeFeedback(), 1200);");
  });

  it("a PR celebrates only a genuine, fresh, unseen PR, never in a read-only view", () => {
    expect(wdv).toContain("const genuinePr = isGenuineSetPr({");
    expect(wdv).toContain("if (readonly || !existing?.completed_at || !genuinePr) return;");
  });

  it("footage: the upload sound only once the clip is on the set and with the coach (attached), once per clip, never on a retry or failure", () => {
    const up = read("src/lib/set-videos/uploader.ts");
    const done = up.indexOf('state: "done",');
    const sound = up.indexOf('feedback("upload", { key: id });');
    const toastAt = up.indexOf("toast.success(`${setTitle(job.setIndex)} video sent to your coach`);");
    expect(done).toBeGreaterThan(-1);
    expect(sound).toBeGreaterThan(done);
    expect(sound).toBeLessThan(toastAt);
    // inside the "not already attached" branch, and nowhere near the failure path
    expect(up.slice(up.lastIndexOf("if (!res.existed) {", sound), sound)).not.toContain("}");
    expect(up.match(/feedback\("upload"/g)?.length).toBe(1);
    const fail = up.indexOf('set({ state: "failed"');
    expect(sound).toBeLessThan(fail);
  });

  it("the finish's sting plays for the workout just finished, once; 'View score' later is a silent reveal", () => {
    const recap = read("src/components/workout-submission-summary.tsx");
    expect(recap).toContain("if (!open || !celebrate || revealStage < 1 || stingPlayedRef.current) return;");
    expect(recap).toContain("if (!moment) return;");
    expect(wdv).toContain("celebrate={recapFromSubmitRef.current}");
  });

  it("a failed action (an error toast) is heard as the soft warning; a success toast only felt", async () => {
    const { toastSound } = await import("@/lib/toast-policy");
    expect(toastSound("error")).toBe(true);
    for (const k of ["success", "info", "message", "warning", "loading"] as const) expect(toastSound(k)).toBe(false);
    expect(read("src/lib/toast-system.ts")).toContain("if (ev) feedback(ev, { sound: toastSound(kind) });");
  });

  it("the settings: sounds on / off, a volume while they're on, haptics where the device can", () => {
    const card = read("src/components/push/push-notification-card.tsx");
    expect(card).toContain("data-sounds-volume");
    expect(card).toContain('onValueCommit={([v]) => setAppSoundVolume(v / 100, { preview: true })}');
    expect(card).toContain("{on && (");
  });
});
