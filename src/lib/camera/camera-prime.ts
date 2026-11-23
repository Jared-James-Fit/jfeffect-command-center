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
import { askOrder, constraintLadder, readFilmAsk, readFilmSettings, videoConstraints, type AskShape } from "@/lib/camera/film-settings";
import { isPhone, phoneOnItsSide, readOrientation } from "@/lib/portrait-only";
import { readCrewQuality, type CrewQuality } from "@/lib/camera/crew-quality";

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

/**
 * The Crew studio's first request (share-studio.tsx asks for exactly this
 * first), so the tap that opens it can ask the same (`primeCamera`).
 *
 * On a phone it's a story's picture (Nov 23 2026): 9:16 upright at 1080p,
 * written the way that worked on this phone before (the set camera's
 * `askOrder`, `readFilmAsk`), so the photo and the clip are exactly what the
 * 9:16 viewfinder shows. It used to ask every phone for 1920 × 1440, a 3:4
 * picture the viewfinder cropped: a clip came back 3:4 and a story showed it
 * boxed in. `shape` is the other way round, when the first one wasn't 9:16.
 * A tablet or a computer keeps 4:3 (a landscape webcam keeps more of its
 * height under the 9:16 crop that way).
 */
export function studioCameraAsk(facing: "environment" | "user", shape?: AskShape | null, quality: CrewQuality = readCrewQuality()): MediaTrackConstraints {
  const upright = phoneUpright();
  if (upright == null) return LEGACY_STUDIO_ASK(facing, quality);
  const s = shape ?? askOrder(upright, readFilmAsk())[0];
  // the quality picked in the camera (crew-quality.ts): HD, or 4K where the camera can
  const ask = videoConstraints({ quality: quality === "4k" ? "4k" : "1080p", fps: 30, facing }, null, s);
  return ptzAsk ? ({ ...ask, zoom: true } as MediaTrackConstraints) : ask;
}

/**
 * The studio's second ask, when the first one failed (a camera still busy a
 * moment after another app had it): the same size without the extras, never
 * a bare `{ facingMode }`, which an iPhone answers at 640 × 480 for the rest
 * of the visit.
 */
export function studioCameraRetryAsk(facing: "environment" | "user", quality: CrewQuality = readCrewQuality()): MediaTrackConstraints {
  const long = quality === "4k" ? 3840 : 1920;
  const short = quality === "4k" ? 2160 : 1080;
  const upright = phoneUpright();
  return upright
    ? { facingMode: facing, width: { ideal: short }, height: { ideal: long } }
    : { facingMode: facing, width: { ideal: long }, height: { ideal: short } };
}

/**
 * The camera's own zoom on Android (Nov 23 2026). Chrome shows a track's
 * `zoom` only to a page that asked for it (`zoom: true`, its pan-tilt-zoom
 * permission); without it the Crew camera zooms digitally. Asking adds that
 * permission to the camera's question, so it's asked only when it can't add
 * a question: the camera was never allowed here (one question either way), or
 * the zoom already was. Someone who allowed the camera before keeps the
 * digital zoom rather than being asked again. Read once the studio's about to
 * open (`refreshPtzAsk`); never on an iPhone (WebKit has no such permission).
 */
let ptzAsk = false;
export function refreshPtzAsk(): void {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent || "")) return;
  const q = navigator.permissions?.query?.bind(navigator.permissions);
  if (!q) return;
  void Promise.all([q({ name: "camera" as PermissionName }), q({ name: "camera", panTiltZoom: true } as unknown as PermissionDescriptor)])
    .then(([cam, ptz]) => {
      ptzAsk = ptz.state === "granted" || cam.state === "prompt";
    })
    .catch(() => {
      ptzAsk = false;
    });
}
/** For tests. */
export function setPtzAskForTests(on: boolean): void {
  ptzAsk = on;
}
/** The 4:3 ask, for a tablet or a computer (4K's: 3840 × 2880, where the webcam goes that far). */
const LEGACY_STUDIO_ASK = (facing: "environment" | "user", quality: CrewQuality = "hd"): MediaTrackConstraints =>
  quality === "4k" ? { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2880 } } : { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } };

/**
 * Call inside the tap that opens a camera: the film camera's first ask, or
 * `ask` for another camera (the Crew studio's, `studioCameraAsk`). Does
 * nothing where a page can't use the camera.
 */
export function primeCamera(ask?: MediaTrackConstraints): void {
  if (primed || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
  const first = ask ? { ask } : firstCameraAsk();
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
