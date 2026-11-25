/**
 * One voice recorder for the whole app (Nov 25 2026): one engine
 * (lib/voice/voice-capture.ts), one level meter and waveform from the
 * microphone's real loudness, one mic owner, one dictation hook, one set of
 * controls, used by every place that records a voice.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import {
  barHeights,
  downsamplePeaks,
  formatClock,
  isIosWebKit,
  levelFromRms,
  micErrorMessage,
  pickRecorderMime,
  rmsOf,
  smoothLevel,
} from "@/lib/voice/voice-meter";
import { _resetMicOwner, claimMic, micInUse } from "@/lib/voice/mic-owner";

const read = (p: string) => readFileSync(p, "utf8");

describe("the level meter reads the mic's real loudness", () => {
  it("silence is 0, a voice fills the bar, nothing clips past 1", () => {
    expect(rmsOf(new Uint8Array(512).fill(128))).toBe(0);
    expect(levelFromRms(0)).toBe(0);
    // room noise at or under the floor stays calm
    expect(levelFromRms(0.01, 0.01)).toBe(0);
    const speech = levelFromRms(0.12, 0.005);
    expect(speech).toBeGreaterThan(0.4);
    expect(speech).toBeLessThan(1);
    expect(levelFromRms(2)).toBe(1);
  });

  it("a full-scale square wave reads as full loudness", () => {
    const buf = new Uint8Array(64).map((_, i) => (i % 2 ? 255 : 1));
    expect(rmsOf(buf)).toBeGreaterThan(0.98);
  });

  it("rises quickly and falls back slowly, settling to exactly 0", () => {
    const up = smoothLevel(0, 1);
    const down = smoothLevel(1, 0);
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeGreaterThan(0.8);
    let v = 0.5;
    for (let i = 0; i < 200; i++) v = smoothLevel(v, 0);
    expect(v).toBe(0);
  });

  it("bars: newest on the right, a calm minimum, whole pixels", () => {
    expect(barHeights([], 4, 30, 3)).toEqual([3, 3, 3, 3]);
    expect(barHeights([0, 1], 3, 30, 3)).toEqual([3, 3, 30]);
    expect(barHeights([0.5], 1, 23, 3)).toEqual([13]);
  });

  it("a voice message keeps its waveform as 48 bars, each the loudest of its slice", () => {
    const raw = Array.from({ length: 96 }, (_, i) => (i % 2 ? 0.8 : 0.1));
    const peaks = downsamplePeaks(raw, 48);
    expect(peaks).toHaveLength(48);
    expect(peaks.every((p) => p === 0.8)).toBe(true);
    expect(downsamplePeaks([], 48)).toEqual([]);
    expect(downsamplePeaks([0.5], 4)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("the clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7_400)).toBe("0:07");
    expect(formatClock(102_000)).toBe("1:42");
  });
});

describe("the recorder format", () => {
  it("iPhones get MP4 first, everything else WebM/Opus", () => {
    const all = () => true;
    expect(pickRecorderMime(all, true)).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickRecorderMime(all, false)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((m) => m === "audio/mp4", false)).toBe("audio/mp4");
    expect(pickRecorderMime(() => false, true)).toBe("");
    expect(pickRecorderMime(() => { throw new Error("x"); }, true)).toBe("");
    expect(isIosWebKit("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIosWebKit("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(isIosWebKit("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });
});

describe("why the mic couldn't be used", () => {
  it("names what to do", () => {
    expect(micErrorMessage({ name: "NotAllowedError" })).toMatch(/microphone is off/);
    expect(micErrorMessage({ name: "NotFoundError" })).toMatch(/No microphone/);
    expect(micErrorMessage({ name: "NotReadableError" })).toMatch(/audio is busy/);
    expect(micErrorMessage({ name: "NotSupportedError" })).toMatch(/can't record/);
    expect(micErrorMessage(null)).toMatch(/Couldn't use the microphone/);
  });
});

describe("one recorder holds the mic", () => {
  beforeEach(() => _resetMicOwner());

  it("a new recording finishes the one that was running; a release is only its own", () => {
    const ended: string[] = [];
    const releaseA = claimMic(() => ended.push("a"));
    expect(micInUse()).toBe(true);
    const releaseB = claimMic(() => ended.push("b"));
    expect(ended).toEqual(["a"]);
    releaseA(); // A's late release never frees B's mic
    expect(micInUse()).toBe(true);
    releaseB();
    expect(micInUse()).toBe(false);
  });
});

describe("every voice recording goes through the one system", () => {
  const engine = read("src/lib/voice/voice-capture.ts");

  it("the engine: one analyser into a meter object (no per-frame React state), lets go of the mic, keeps the take on interruptions", () => {
    expect(engine).toContain("analyser.getByteTimeDomainData(buf);");
    expect(engine).toContain("meter.level = smoothLevel(meter.level, levelFromRms(rms, floor));");
    expect(engine).not.toMatch(/setState|useState/);
    expect(engine).toContain('if (document.visibilityState === "hidden") finish(true, "hidden");');
    expect(engine).toContain('t.addEventListener("ended", () => finish(true, "interrupted"), { once: true })');
    expect(engine).toContain('limit = window.setTimeout(() => finish(true, "limit"), opts.maxMs);');
    expect(engine).toContain("stream.getTracks().forEach((t) => t.stop());");
    expect(engine).toContain("const releaseMic = claimMic(() => onReplaced());");
    // dictation keeps the call processing: speech into a mic is what it's for
    expect(engine).toContain("{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }");
  });

  it("the waveform and timer draw on animation frames from refs", () => {
    const wave = read("src/components/voice/voice-waveform.tsx");
    expect(wave).toContain("<canvas");
    expect(wave).toContain("requestAnimationFrame(draw)");
    expect(wave).not.toMatch(/useState/);
    expect(wave).toContain("el.textContent = text;");
  });

  it("the old recorders, five-dot indicators and fake loops are gone", () => {
    expect(existsSync("src/hooks/use-summer-mic.ts")).toBe(false);
    for (const f of [
      "src/components/message-thread.tsx",
      "src/components/group-message-thread.tsx",
      "src/components/chat-shared.tsx",
      "src/components/community/voice-memo.tsx",
      "src/components/cleo/cleo-composer.tsx",
      "src/components/program-ai/coach-voice.tsx",
      "src/components/pain/pain-map.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toContain("new MediaRecorder(");
      expect(src, f).not.toContain("createAnalyser(");
      expect(src, f).not.toContain("[0.55, 0.85, 1, 0.85, 0.55]");
      expect(src, f).not.toContain("useSummerMic");
    }
  });

  it("dictation everywhere is useVoiceDictation; voice messages are useVoiceCapture with the plain mic", () => {
    expect(read("src/components/cleo/cleo-composer.tsx")).toContain("useVoiceDictation({");
    expect(read("src/components/program-ai/coach-voice.tsx")).toContain("useVoiceDictation({");
    expect(read("src/components/pain/pain-map.tsx")).toContain("useVoiceDictation({");
    const shared = read("src/components/chat-shared.tsx");
    expect(shared).toContain("useVoiceCapture({ maxMs: (opts.maxSeconds ?? 300) * 1000, constraints: true })");
    expect(read("src/components/message-thread.tsx")).toContain("useVoiceRecorder({ onAutoStop: (take) => showPreviewRef.current(take) })");
    expect(read("src/components/group-message-thread.tsx")).toContain("useVoiceRecorder({ onAutoStop: (take) => showPreviewRef.current(take) })");
    expect(read("src/components/community/voice-memo.tsx")).toContain("useVoiceRecorder({ maxSeconds: VOICE_MAX_SECONDS, onAutoStop: deliver })");
  });

  it("a failed transcription keeps the take in memory for Try again; it's never stored", () => {
    const d = read("src/hooks/use-voice-dictation.ts");
    expect(d).toContain("kept.current = take;");
    expect(d).toContain("if (kept.current) void hear(kept.current);");
    expect(d).not.toMatch(/upload|storage\.from|localStorage|indexedDB/i);
  });
});
