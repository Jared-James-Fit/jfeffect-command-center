import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askForMicAgain, clipMicNote, isBluetoothMic, micNote, micRefused, micToName, noteClipMic, openVideoMic, pickOwnMic, resetVideoMicForTests, videoAudioConstraints } from "@/lib/video-mic";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const g = globalThis as any;
const withNavigator = (nav: unknown) => Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true });
afterEach(() => {
  withNavigator(undefined);
  resetVideoMicForTests();
});
const mic = (deviceId: string, label: string) => ({ deviceId, label, kind: "audioinput" as const });

/**
 * Nov 19 2026: in-app videos sounded muffled, squeezed or distorted next to the
 * phone's own camera. Every in-app recorder asked for the mic with the
 * browser's defaults, which are a call's: echo cancellation, noise suppression
 * and automatic gain on, in mono.
 *
 * Measured in Chromium (the same audio processing as Chrome on Android and on
 * a computer), a 10 s test clip (gym music, a voice, three barbell clanks
 * peaking at −3.1 dBFS, a quiet room at −42.9 dBFS) recorded through the real
 * FilmCamera, before → after this change:
 *   level riding                  +15.0 dB (music), +18.3 dB (quiet room) → 0.0 / 0.0
 *   clank peak                    0.00 dBFS, clipped → −2.96 dBFS
 *   gain wander (10 ms std)       10.45 dB → 1.36 dB
 *   waveform fidelity (SNR)       music −19.9 dB, voice −31.7 dB → 23.5 / 22.8 dB (the codec's own limit)
 *   envelope match with source    0.922 → 0.993
 * On iOS the same default runs the capture through Apple's VoiceProcessingIO
 * unit (WebKit, CoreAudioCaptureUnit.cpp: `echoCancellation` on → VPIO, off →
 * RemoteIO), and with AirPods connected WebKit's PlayAndRecord session took
 * the AirPods' hands-free mic.
 */
describe("what a video asks of the microphone", () => {
  it("turns off each call process the browser supports, asks for stereo and 48 kHz without requiring them", () => {
    // Chrome / Firefox: every switch
    const chrome = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true, channelCount: true, sampleRate: true, deviceId: true };
    expect(videoAudioConstraints(chrome)).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48_000 },
    });
    // Safari (WebKit's supported constraints): echo cancellation is the one switch, and it bypasses VoiceProcessingIO
    const safari = { deviceId: true, groupId: true, echoCancellation: true, volume: true, sampleRate: true };
    expect(videoAudioConstraints(safari)).toEqual({ echoCancellation: false, sampleRate: { ideal: 48_000 } });
    // a browser that won't say: only the switch every engine knows
    expect(videoAudioConstraints(null)).toEqual({ echoCancellation: false });
    // a chosen microphone is named exactly (it was just listed)
    expect(videoAudioConstraints(safari, "mic-1").deviceId).toEqual({ exact: "mic-1" });
    // nothing is ever a hard requirement but the device: no `exact` on a quality
    expect(JSON.stringify(videoAudioConstraints(chrome))).not.toContain("exact");
  });

  it("knows a Bluetooth hands-free mic from the device's own", () => {
    for (const l of ["AirPods Pro", "Jared's AirPods", "Powerbeats Pro", "Galaxy Buds2 Pro", "Pixel Buds Pro", "Bluetooth headset", "Default - WH-1000XM4 (Bluetooth)", "Hands-Free Headset"]) expect(isBluetoothMic(l)).toBe(true);
    for (const l of ["iPhone Microphone", "iPad Microphone", "MacBook Pro Microphone (Built-in)", "Speakerphone", "Headset earpiece", "Default", "USB Audio Device", ""]) expect(isBluetoothMic(l)).toBe(false);
  });

  it("prefers the device's own mic over a hands-free headset, and leaves the system's pick alone otherwise", () => {
    // iOS: no "default" entry; a listed AirPods means a hands-free route the moment the mic opens
    expect(micToName([mic("a", "AirPods Pro"), mic("i", "iPhone Microphone")])).toBe("i");
    expect(micToName([mic("i", "iPhone Microphone")])).toBeNull();
    // Chrome: its "default" entry says what the system would use
    expect(micToName([mic("default", "Default - AirPods (Bluetooth)"), mic("b", "MacBook Pro Microphone (Built-in)"), mic("a", "AirPods (Bluetooth)")])).toBe("b");
    expect(micToName([mic("default", "Default - USB Audio Device"), mic("u", "USB Audio Device"), mic("a", "AirPods (Bluetooth)")])).toBeNull();
    // before the mic was ever allowed there are no labels: nothing to go by yet
    expect(micToName([mic("a", ""), mic("i", "")])).toBeNull();
    // never one of Chrome's aliases, never another Bluetooth device, a wired one when that's all there is
    expect(pickOwnMic([mic("default", "Default - X"), mic("communications", "Communications - X"), mic("a", "AirPods"), mic("w", "Headset Microphone")])).toBe("w");
    expect(pickOwnMic([mic("a", "AirPods")])).toBeNull();
  });

  it("notes what a recording's sound came from, never the device's name", () => {
    expect(micNote({ echoCancellation: false, channelCount: 2, sampleRate: 48_000 }, "iPhone Microphone")).toBe("raw 2ch 48k own");
    expect(micNote({ echoCancellation: true, channelCount: 1, sampleRate: 48_000 }, "AirPods Pro", "fallback")).toBe("voice 1ch 48k bt fallback");
    expect(micNote({ echoCancellation: false }, "Jared's iPhone Microphone", "switched")).toBe("raw ?ch ?k own switched");
    noteClipMic("jf-film-1.mp4", "raw 2ch 48k own");
    expect(clipMicNote("jf-film-1.mp4")).toBe("raw 2ch 48k own");
    expect(clipMicNote("IMG_0001.MOV")).toBeNull();
  });
});

describe("opening it", () => {
  const track = (label: string, settings: Record<string, unknown>) => ({ label, stop: vi.fn(), getSettings: () => settings });
  const stream = (t: ReturnType<typeof track>) => ({ getAudioTracks: () => [t], getTracks: () => [t] });

  it("asks without the processing and keeps what it gets", async () => {
    const own = track("iPhone Microphone", { echoCancellation: false, sampleRate: 48_000 });
    const getUserMedia = vi.fn().mockResolvedValue(stream(own));
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices: async () => [], getSupportedConstraints: () => ({ echoCancellation: true, sampleRate: true }) } });
    const got = await openVideoMic();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: { echoCancellation: false, sampleRate: { ideal: 48_000 } } });
    expect(got.note).toBe("raw ?ch 48k own");
  });

  it("swaps a hands-free headset it opened (the first time, before there were labels) for the device's own mic", async () => {
    const bt = track("AirPods Pro", { echoCancellation: false });
    const own = track("iPhone Microphone", { echoCancellation: false, sampleRate: 48_000 });
    let opened = false;
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(async () => ((opened = true), stream(bt)))
      .mockResolvedValueOnce(stream(own));
    // labels only once the mic was allowed
    const enumerateDevices = vi.fn(async () =>
      opened ? [mic("a", "AirPods Pro"), mic("i", "iPhone Microphone")] : [mic("a", ""), mic("i", "")],
    );
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices, getSupportedConstraints: () => ({ echoCancellation: true }) } });
    const got = await openVideoMic();
    expect(bt.stop).toHaveBeenCalled();
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: { echoCancellation: false, deviceId: { exact: "i" } } });
    expect(got.stream.getAudioTracks()[0].label).toBe("iPhone Microphone");
    expect(got.note).toBe("raw ?ch 48k own switched");
  });

  it("falls back to the plain request a browser takes, so sound is never lost to this", async () => {
    const plain = track("Default", { echoCancellation: true, channelCount: 1, sampleRate: 48_000 });
    const getUserMedia = vi.fn().mockRejectedValueOnce(Object.assign(new Error("no"), { name: "OverconstrainedError" })).mockResolvedValueOnce(stream(plain));
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices: async () => [], getSupportedConstraints: () => ({ echoCancellation: true }) } });
    const got = await openVideoMic();
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: true });
    expect(got.note).toBe("voice 1ch 48k own fallback");
  });

  it("a mic that isn't allowed stays a no (the camera films without sound and says so)", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices: async () => [], getSupportedConstraints: () => ({ echoCancellation: true }) } });
    await expect(openVideoMic()).rejects.toThrow("denied");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

/**
 * Nov 19 2026: "every time I record a workout video, I have to tap Allow Audio
 * Capture again". On an iPhone WebKit reuses an Allow without asking only for a
 * request made from a tap once nothing has been captured for a minute (and
 * forgets it 10 minutes after the camera and mic go off, on every platform);
 * the mic was asked for only after `await enumerateDevices()`, after the tap.
 */
describe("asked inside the tap, once", () => {
  const track = (label: string) => ({ label, stop: vi.fn(), getSettings: () => ({ echoCancellation: false }) });
  const stream = (t: ReturnType<typeof track>) => ({ getAudioTracks: () => [t], getTracks: () => [t] });
  const denied = () => Object.assign(new Error("denied"), { name: "NotAllowedError" });

  it("the request goes out in the same tick as the tap, before anything is listed", () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream(track("iPhone Microphone")));
    const enumerateDevices = vi.fn(async () => []);
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices, getSupportedConstraints: () => ({ echoCancellation: true }) } });
    void openVideoMic();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(enumerateDevices).not.toHaveBeenCalled();
  });

  it("names the device's own mic from the last recording's list, still in the tap", async () => {
    const getUserMedia = vi.fn().mockImplementation(async () => stream(track("iPhone Microphone")));
    const enumerateDevices = vi.fn(async () => [mic("a", "AirPods Pro"), mic("i", "iPhone Microphone")]);
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices, getSupportedConstraints: () => ({ echoCancellation: true }) } });
    await openVideoMic();
    getUserMedia.mockClear();
    void openVideoMic();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: { echoCancellation: false, deviceId: { exact: "i" } } });
  });

  it("a Don't Allow is remembered for the visit, and Ask again asks inside its own tap and lets go at once", async () => {
    const getUserMedia = vi.fn().mockRejectedValueOnce(denied());
    withNavigator({ mediaDevices: { getUserMedia, enumerateDevices: async () => [], getSupportedConstraints: () => ({ echoCancellation: true }) } });
    await expect(openVideoMic()).rejects.toThrow("denied");
    expect(micRefused()).toBe(true);
    const t = track("iPhone Microphone");
    getUserMedia.mockResolvedValueOnce(stream(t));
    const again = askForMicAgain();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(await again).toBe(true);
    expect(t.stop).toHaveBeenCalled();
    expect(micRefused()).toBe(false);
  });

  it("the recorders don't ask again after a no, and the camera's settings offer Ask again", () => {
    const cam = read("src/components/camera/film-camera.tsx");
    expect(cam).toContain("if (settingsRef.current.sound && !micRefused()) {");
    expect(cam).toContain("askForMicAgain()");
    expect(cam).toContain("data-mic-refused");
    expect(read("src/components/community/clip-recorder.ts")).toContain("if (withSoundRef.current() && !micRefused()) {");
  });
});

describe("where it's used", () => {
  it("every in-app video recorder; voice memos and dictation keep the call processing (speech into a mic)", () => {
    expect(read("src/components/camera/film-camera.tsx")).toContain("const got = await openVideoMic();");
    expect(read("src/components/camera/film-camera.tsx")).toContain("noteClipMic(file.name, micNote);");
    expect(read("src/components/community/clip-recorder.ts")).toContain("const got = await openVideoMic();");
    expect(read("src/components/chat-shared.tsx")).toContain("await getMicStream(true)");
    expect(read("src/hooks/use-summer-mic.ts")).toContain("getMicStream({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })");
    // a set video's upload says what its sound came from, so a real phone's recording can be checked
    expect(read("src/lib/set-videos/uploader.ts")).toContain("mic: clipMicNote(picked.file.name),");
  });

  it("progress videos and a chat's Video film in the app's own camera, where iOS's picker records 480 × 360", () => {
    const progress = read("src/components/progress/progress-section.tsx");
    expect(progress).toContain('if (mediaType === "video" && camera.start()) return;');
    expect(progress).toContain("onLibrary: () => fileRef.current?.click(),");
    const menu = read("src/components/composer-plus-menu.tsx");
    expect(menu).toContain('key: "video",');
    expect(menu).toContain("hidden: !onPickVideo,");
    for (const p of ["src/components/message-thread.tsx", "src/components/group-message-thread.tsx"]) {
      const t = read(p);
      expect(t).toContain("if (!filmCamera.start()) cameraInputRef.current?.click();");
      expect(t).toContain("onClip: (f) => void onPickFiles([f]),");
      expect(t).toContain("{filmCamera.element}");
    }
    // the camera takes its taps over a modal (the progress dialog's lock leaves the rest of the page untappable)
    expect(read("src/components/camera/film-camera.tsx")).toContain('className="pointer-events-auto fixed inset-0 z-[70]');
    // where a page can't film, the caller's picker, from the same tap
    expect(read("src/components/camera/use-film-camera.tsx")).toContain("if (!canFilmInApp()) return false;");
  });
});
