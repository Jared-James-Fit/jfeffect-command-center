/**
 * The camera asked for inside the tap that opens it (Nov 19 2026).
 *
 * On an iPhone, WebKit reuses a camera / microphone "Allow" without asking
 * again only for a request made from a tap once nothing has been captured for
 * a minute (`inactiveMediaCaptureStreamRepromptWithoutUserGestureIntervalInMinutes`
 * is 1 on iOS, 10 elsewhere); every allowance is forgotten 10 minutes after
 * the camera and mic go off (`inactiveMediaCaptureStreamRepromptIntervalInMinutes`).
 * The film camera used to ask from an effect once it had opened, after the
 * tap, so every set filmed a couple of minutes apart could ask again. Now the
 * tap that opens it starts the request itself (`primeCamera`), with the same
 * first ask the camera would make, and the camera takes that answer
 * (`takePrimedCamera`). Nothing held is ever left on: an answer the camera
 * doesn't take is let go after `PRIME_TTL_MS`.
 */
import { askOrder, constraintLadder, readFilmAsk, readFilmSettings, type AskShape } from "@/lib/camera/film-settings";
import { isPhone, phoneOnItsSide, readOrientation } from "@/lib/portrait-only";

/** How long an answer waits for the camera to take it before it's let go. */
export const PRIME_TTL_MS = 8_000;

/** The phone's held upright (a computer or tablet never re-asks for a shape). */
export function phoneUpright(): boolean | null {
  const r = readOrientation();
  if (!r || !isPhone(r)) return null;
  return !phoneOnItsSide(r);
}

/** The first request the film camera makes when it opens: its saved settings, no lens picked, the shape it tries first. */
export function firstCameraAsk(): { shape: AskShape; ask: MediaTrackConstraints } | null {
  const s = readFilmSettings();
  const upright = phoneUpright();
  const shape = upright == null ? "landscape" : askOrder(upright, readFilmAsk())[0];
  const ask = constraintLadder({ quality: s.quality, fps: s.fps, facing: s.facing }, null, shape)[0];
  return ask ? { shape, ask } : null;
}

const keyOf = (ask: MediaTrackConstraints) => JSON.stringify(ask);
const release = (p: Promise<MediaStream>) => p.then((s) => s.getTracks().forEach((t) => t.stop()), () => undefined);

let primed: { key: string; promise: Promise<MediaStream>; timer: ReturnType<typeof setTimeout> } | null = null;

/** Call inside the tap that opens the film camera. Does nothing where a page can't use the camera. */
export function primeCamera(): void {
  if (primed || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
  const first = firstCameraAsk();
  if (!first) return;
  let promise: Promise<MediaStream>;
  try {
    promise = navigator.mediaDevices.getUserMedia({ video: first.ask, audio: false });
  } catch {
    return;
  }
  // an answer nobody takes is never an unhandled rejection
  promise.catch(() => undefined);
  const entry = {
    key: keyOf(first.ask),
    promise,
    timer: setTimeout(() => {
      if (primed !== entry) return;
      primed = null;
      void release(promise);
    }, PRIME_TTL_MS),
  };
  primed = entry;
}

/**
 * The camera's first request: the tap's answer when it asked for exactly
 * this (`stream`), or, when it asked for something else, that answer let go
 * first (`released`: a phone won't open a second camera while one is held),
 * else null.
 */
export function takePrimedCamera(ask: MediaTrackConstraints): { stream: Promise<MediaStream> } | { released: Promise<void> } | null {
  const p = primed;
  if (!p) return null;
  primed = null;
  clearTimeout(p.timer);
  if (p.key === keyOf(ask)) return { stream: p.promise };
  return { released: release(p.promise) };
}

/** For tests. */
export function primedCameraForTests(): { key: string } | null {
  return primed ? { key: primed.key } : null;
}
