/**
 * A clip played without a <video> (Nov 22 2026): decoded on the phone
 * (mediabunny + the phone's own WebCodecs decoder) and drawn onto a canvas,
 * muted, frame by frame on time.
 *
 * Why: an iPhone in Low Power Mode refuses every <video> that isn't started
 * from a tap, even a muted one, so Crew's clips sat on their first frame. A
 * decoder isn't a media element and no autoplay rule applies to it, so the
 * clip keeps moving; the first tap anywhere hands it to its own element (with
 * its sound) at the same moment (video-pool.ts `setRefusedClock`). Sound can't
 * come this way: a tap is what lets any sound play.
 *
 * The canvas is the clip's own size (its long side at most `DECODED_LONG_SIDE`),
 * so CSS object-fit / object-position lay it out exactly like the element it
 * stands in for. One clip at a time is decoded (the one on screen).
 */
type Mb = typeof import("mediabunny");
let mbP: Promise<Mb> | null = null;
function loadMb(): Promise<Mb> {
  if (!mbP)
    mbP = import("mediabunny").catch((e) => {
      mbP = null;
      throw e;
    });
  return mbP;
}

/** The decoded picture's long side (a 720p feed copy is drawn as is; an original 4K clip comes down to this). */
export const DECODED_LONG_SIDE = 1280;
/** A frame due this late (a slow connection, a busy phone) moves the clock on instead of racing to catch up. */
export const DECODED_LATE_MS = 250;
/** Given up on: no first frame this long after asking (a dead link, a decoder that never answers). */
export const DECODED_FIRST_FRAME_MS = 12_000;

export type PaceClock = { wall: number; media: number };

/**
 * When frame `ts` (seconds) is due, against the clock (`wall` ms when the
 * frame at `media` s was due): how long to wait, and the clock after it.
 * Late by more than DECODED_LATE_MS: the clock moves so this frame is due now
 * (playback slows for a stall, never fast-forwards through frames).
 */
export function paceFrame(
  clock: PaceClock,
  ts: number,
  now: number,
): { wait: number; clock: PaceClock } {
  const due = clock.wall + (ts - clock.media) * 1000;
  const wait = due - now;
  if (wait < -DECODED_LATE_MS) return { wait: 0, clock: { wall: now, media: ts } };
  return { wait: Math.max(0, wait), clock };
}

/** The canvas size for a clip shown `w` × `h` (its rotation applied), its long side at most `longSide`. */
export function decodedSize(
  w: number,
  h: number,
  longSide = DECODED_LONG_SIDE,
): { width: number; height: number } {
  const W = w > 0 ? w : 9;
  const H = h > 0 ? h : 16;
  const k = Math.min(1, longSide / Math.max(W, H));
  return { width: Math.max(2, Math.round(W * k)), height: Math.max(2, Math.round(H * k)) };
}

export type DecodedClipOptions = {
  url: string;
  canvas: HTMLCanvasElement;
  /** Where to start, in seconds into the clip. */
  from?: number;
  /** Start again at the end (a feed clip); else `onEnd`. */
  loop?: boolean;
  /** Stop this many seconds into the clip (a story shows a clip's first minute). */
  until?: number;
  onFirstFrame?: () => void;
  /** Each frame drawn: seconds into the clip, and how long it plays here. */
  onTime?: (t: number, length: number) => void;
  onEnd?: () => void;
  onFail?: (why: string) => void;
};

export type DecodedClip = {
  /** Seconds into the clip of the frame on screen. */
  time(): number;
  /** Stops decoding and drawing; the frame on screen stays. */
  stop(): void;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True where this can run at all: a decoder the page can use. */
export function canDecodeClips(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as { VideoDecoder?: unknown }).VideoDecoder === "function"
  );
}

export function startDecodedClip(o: DecodedClipOptions): DecodedClip {
  let stopped = false;
  let current = Math.max(0, o.from ?? 0);
  let input: { dispose?: () => void } | null = null;
  let drawn = false;
  const fail = (why: string) => {
    if (stopped) return;
    stopped = true;
    try {
      input?.dispose?.();
    } catch {
      /* already gone */
    }
    o.onFail?.(why);
  };
  const watchdog = setTimeout(() => {
    if (!drawn) fail("no-frame");
  }, DECODED_FIRST_FRAME_MS);

  const run = async () => {
    if (!canDecodeClips()) return fail("no-decoder");
    const mb = await loadMb();
    if (stopped) return;
    const inp = new mb.Input({
      source: new mb.UrlSource(o.url, {
        // a link that's gone or refused: give up after a few tries (the play button takes over)
        getRetryDelay: (n) => (n < 3 ? 0.5 * (n + 1) : null),
        maxCacheSize: 48 * 1024 * 1024,
        handleUnhandledError: () => undefined,
      }),
      formats: mb.ALL_FORMATS,
    });
    input = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (stopped) return;
    if (!track || !(await track.canDecode())) return fail("unsupported");
    const first = await track.getFirstTimestamp().catch(() => 0);
    const end = await track.computeDuration().catch(() => 0);
    if (stopped) return;
    const length = Math.max(0, Math.min(end - first, o.until ?? Infinity));
    const { width, height } = decodedSize(track.displayWidth, track.displayHeight);
    const canvas = o.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fail("no-canvas");
    const sink = new mb.VideoSampleSink(track);
    let from = first + Math.min(current, Math.max(0, length - 0.05));
    while (!stopped) {
      let clock: PaceClock | null = null;
      for await (const sample of sink.samples(from, first + length)) {
        try {
          if (stopped) break;
          const ts = sample.timestamp;
          const now = performance.now();
          clock ??= { wall: now, media: ts };
          const paced = paceFrame(clock, ts, now);
          clock = paced.clock;
          if (paced.wait > 0) await sleep(paced.wait);
          if (stopped) break;
          sample.drawWithFit(ctx, { fit: "fill" });
          current = Math.max(0, ts - first);
          if (!drawn) {
            drawn = true;
            clearTimeout(watchdog);
            o.onFirstFrame?.();
          }
          o.onTime?.(current, length);
        } finally {
          sample.close();
        }
      }
      if (stopped) break;
      if (!o.loop) {
        stopped = true;
        o.onEnd?.();
        break;
      }
      from = first;
    }
  };
  run()
    .catch((e: unknown) => fail(e instanceof Error ? e.message.slice(0, 80) : "error"))
    .finally(() => {
      clearTimeout(watchdog);
      try {
        input?.dispose?.();
      } catch {
        /* already gone */
      }
    });

  return {
    time: () => current,
    stop: () => {
      stopped = true;
      clearTimeout(watchdog);
      try {
        input?.dispose?.();
      } catch {
        /* already gone */
      }
    },
  };
}
