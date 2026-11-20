/**
 * The microphone for a video, the way a phone's own camera records it (Nov 19 2026).
 *
 * Every in-app video recorder used to ask for the mic with the browser's
 * defaults (`getUserMedia({ audio: true })`), which are a call's: echo
 * cancellation, noise suppression and automatic gain all on, in mono.
 *
 * - iOS (WebKit, CoreAudioCaptureUnit.cpp): echo cancellation on means the
 *   capture runs through Apple's VoiceProcessingIO unit (the VoIP processor:
 *   echo cancelling, noise suppression and gain riding, built for a voice an
 *   arm's length away, ducking other audio); off means the plain RemoteIO
 *   microphone. Safari's only audio switch is `echoCancellation`
 *   (getSupportedConstraints: deviceId, groupId, echoCancellation, volume,
 *   sampleRate), so that one constraint is the whole difference there.
 * - Chrome (Android and desktop) and Firefox honour all three switches; with
 *   them on, Chrome's audio processing measured +15–18 dB of gain riding,
 *   loud transients (a bar set down) clipped to 0 dBFS, a quiet room pumped up
 *   ~18 dB and a waveform no longer close to what the mic heard
 *   (src/test/video-mic.test.ts has the numbers).
 *
 * A camera wants the room as it sounds, so a video asks for exactly that,
 * only through the constraints this browser says it supports, and never as a
 * hard requirement (a value that can't be met is just not met). If an engine
 * still refuses, the recording falls back to the plain request it always
 * used, so sound is never lost to this.
 *
 * Bluetooth: while the mic is open WebKit puts iOS in PlayAndRecord with the
 * "allow Bluetooth" (hands-free) option, so with AirPods connected a
 * recording took its sound from the AirPods' call microphone (16–24 kHz,
 * mono, the far side of the gym from the phone) instead of the iPhone's own
 * microphones the Camera app uses. A video prefers the device's own
 * microphone whenever a Bluetooth hands-free one is what it would get.
 * Voice memos and dictation keep the call processing (and the headset): that's
 * speech into a mic, which it's built for.
 */
import { getMicStream } from "@/lib/audio-session";

type Supported = Partial<Record<keyof MediaTrackSupportedConstraints | "voiceIsolation", boolean>>;

/**
 * What a video asks of the microphone: no call processing, stereo and 48 kHz
 * where there are, a particular microphone when one was chosen. Only the
 * switches this browser supports (an unknown browser gets just the
 * echo-cancellation switch, the one every engine knows).
 */
export function videoAudioConstraints(supported: Supported | null | undefined, deviceId?: string | null): MediaTrackConstraints {
  const has = (k: keyof Supported) => (supported ? !!supported[k] : k === "echoCancellation");
  const c: MediaTrackConstraints & { voiceIsolation?: boolean } = {};
  if (has("echoCancellation")) c.echoCancellation = false;
  if (has("noiseSuppression")) c.noiseSuppression = false;
  if (has("autoGainControl")) c.autoGainControl = false;
  if (has("voiceIsolation")) c.voiceIsolation = false;
  if (has("channelCount")) c.channelCount = { ideal: 2 };
  if (has("sampleRate")) c.sampleRate = { ideal: 48_000 };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

/** A Bluetooth headset's microphone (hands-free: narrowband, mono, on the lifter's head). */
export function isBluetoothMic(label: string | null | undefined): boolean {
  return /air\s?pods|beats|bluetooth|buds|hands[- ]?free|\bhfp\b|\bsco\b/i.test(label ?? "");
}

type Input = Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">;

/** Chrome lists the OS's default and communications devices again under these ids. */
const ALIASES = new Set(["default", "communications"]);

/** The device's own microphone among the inputs, or null (none named, or none that isn't Bluetooth). */
export function pickOwnMic(inputs: Input[]): string | null {
  const real = inputs.filter((d) => d.kind === "audioinput" && d.label && d.deviceId && !ALIASES.has(d.deviceId) && !isBluetoothMic(d.label));
  const own = real.find((d) => /iphone|ipad|built[- ]?in|internal|microphone array|macbook|speakerphone/i.test(d.label));
  return (own ?? real[0])?.deviceId ?? null;
}

/**
 * Before asking: which microphone a video should name, or null to let the
 * system pick as it always has. Only when a Bluetooth headset would be the
 * one used: Chrome says so with its "default" entry; Safari has no such entry
 * and iOS routes a hands-free mic in the moment the mic opens, so any
 * Bluetooth input listed counts. Labels only exist once the mic was allowed.
 */
export function micToName(inputs: Input[]): string | null {
  const mics = inputs.filter((d) => d.kind === "audioinput");
  if (!mics.some((d) => d.label)) return null;
  const def = mics.find((d) => d.deviceId === "default");
  const btWouldWin = def ? isBluetoothMic(def.label) : mics.some((d) => isBluetoothMic(d.label));
  return btWouldWin ? pickOwnMic(mics) : null;
}

/** "raw 2ch 48k own" / "voice 1ch 48k bt": what a recording's sound came from, for the upload's diagnostics. */
export function micNote(settings: MediaTrackSettings | null | undefined, label: string | null | undefined, how: "" | "switched" | "fallback" = ""): string {
  const s = settings ?? {};
  const processed = s.echoCancellation === true || (s as { autoGainControl?: boolean }).autoGainControl === true || (s as { noiseSuppression?: boolean }).noiseSuppression === true;
  const ch = s.channelCount ? `${s.channelCount}ch` : "?ch";
  const sr = s.sampleRate ? `${Math.round(s.sampleRate / 1000)}k` : "?k";
  const kind = isBluetoothMic(label) ? "bt" : "own";
  return [processed ? "voice" : "raw", ch, sr, kind, how].filter(Boolean).join(" ");
}

function isPermissionError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError";
}

async function listInputs(): Promise<Input[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  } catch {
    return [];
  }
}

function supportedNow(): Supported | null {
  try {
    return (navigator.mediaDevices.getSupportedConstraints?.() as Supported | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * The microphones as last listed, kept between recordings so the next request
 * can name one without listing them first: the request itself has to go out
 * in the tap (an `await` before it can cost it the tap, and on an iPhone a
 * request that isn't from a tap is asked about again once the camera and mic
 * have been off for a minute: WebKit's
 * inactiveMediaCaptureStreamRepromptWithoutUserGestureIntervalInMinutes).
 */
let knownInputs: Input[] = [];
let watchingDevices = false;
function rememberInputs(list: Input[]) {
  if (list.length) knownInputs = list;
  if (watchingDevices || typeof navigator === "undefined") return;
  watchingDevices = true;
  try {
    // a headset connected or gone between sets: the next recording names the right one
    navigator.mediaDevices?.addEventListener?.("devicechange", () => void listInputs().then((l) => { if (l.length) knownInputs = l; }));
  } catch {
    /* no device events */
  }
}

/**
 * "Don't Allow" is remembered for this visit: the camera films without sound
 * and nothing asks again on every recording (a request from a tap would show
 * the prompt each time). `allowMicAgain` (the camera's Ask again) clears it.
 */
let refused = false;
export function micRefused(): boolean {
  return refused;
}
export function allowMicAgain(): void {
  refused = false;
}

const stop = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

/**
 * Open the microphone for a video (the set camera, the Crew studio): the
 * sound as it is, from the device's own mic, iOS's audio session prepared
 * (getMicStream). The first request goes out at once, inside the tap that
 * started the recording (see `knownInputs`), so a microphone already allowed
 * on this page is used without asking again. Throws only when the mic isn't
 * allowed or there isn't one; anything else falls back to the plain request
 * the app always made.
 */
export async function openVideoMic(): Promise<{ stream: MediaStream; restore: () => void; note: string }> {
  const supported = supportedNow();
  const named = micToName(knownInputs);
  let how: "" | "switched" | "fallback" = "";
  let got: { stream: MediaStream; restore: () => void };
  try {
    try {
      got = await getMicStream(videoAudioConstraints(supported, named));
    } catch (e) {
      if (isPermissionError(e)) throw e;
      try {
        // the microphone named is gone since it was listed: the system's pick, still without call processing
        if (!named) throw e;
        got = await getMicStream(videoAudioConstraints(supported));
      } catch (e2) {
        if (isPermissionError(e2)) throw e2;
        // a browser that won't take the request at all: the plain mic, as before
        got = await getMicStream(true);
        how = "fallback";
      }
    }
  } catch (e) {
    if (isPermissionError(e)) refused = true;
    throw e;
  }
  refused = false;
  // allowed now, so the list has its names: kept for the next recording
  const listed = await listInputs();
  rememberInputs(listed);
  let track = got.stream.getAudioTracks()[0];
  // the first time on this page there were no names to go by: a hands-free headset it opened is swapped for the device's own mic
  if (!how && !named && track && isBluetoothMic(track.label)) {
    const own = pickOwnMic(listed);
    if (own) {
      stop(got.stream);
      got.restore();
      try {
        got = await getMicStream(videoAudioConstraints(supported, own));
        how = "switched";
      } catch (e) {
        if (isPermissionError(e)) throw e;
        got = await getMicStream(videoAudioConstraints(supported));
      }
      track = got.stream.getAudioTracks()[0];
    }
  }
  return { ...got, note: micNote(track?.getSettings?.(), track?.label, how) };
}

/**
 * The camera's Ask again, after a "Don't Allow": asked now, inside that tap,
 * and let go at once (nothing records and the music carries on), so the next
 * recording uses the answer without asking. True when it's allowed.
 */
export async function askForMicAgain(): Promise<boolean> {
  refused = false;
  try {
    const got = await openVideoMic();
    stop(got.stream);
    got.restore();
    return true;
  } catch {
    return false;
  }
}

/** For tests. */
export function resetVideoMicForTests(): void {
  knownInputs = [];
  refused = false;
}

/** What each clip filmed in the app recorded its sound from, by file name, for its upload's diagnostics. */
const notes = new Map<string, string>();
export function noteClipMic(fileName: string, note: string) {
  notes.set(fileName, note);
  // only the last few matter (a clip is uploaded right after it's filmed)
  if (notes.size > 20) notes.delete(notes.keys().next().value as string);
}
export function clipMicNote(fileName: string | null | undefined): string | null {
  return (fileName && notes.get(fileName)) || null;
}
