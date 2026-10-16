import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { baseMediaType, MAX_VIDEO_SECONDS } from "@/lib/community";

/** The longest clip the camera records (a story / post clip's limit). */
export const MAX_RECORD_MS = MAX_VIDEO_SECONDS * 1000;
/** Holding the shutter this long starts recording; a shorter press is a photo. */
export const HOLD_TO_RECORD_MS = 260;
/** Anything shorter than this is a slip, not a clip. */
export const MIN_CLIP_MS = 600;

const TYPES = [
  // iPhone (Safari and the app's web view) records MP4 / H.264, which plays everywhere
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  // Chrome on Android records WebM
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/** The best clip format this phone can record, or null when it can't record video at all. */
export function pickRecorderType(isSupported: (type: string) => boolean = (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)): string | null {
  for (const t of TYPES) {
    try {
      if (isSupported(t)) return t;
    } catch {
      /* some web views throw for unknown types */
    }
  }
  return null;
}

export function canRecordClips(): boolean {
  return typeof window !== "undefined" && typeof (window as { MediaRecorder?: unknown }).MediaRecorder === "function" && !!pickRecorderType();
}

type Rec = { recorder: MediaRecorder; audio: MediaStream | null; startedAt: number; type: string };

/**
 * Hold the shutter to film (Instagram's camera): the live camera's picture and,
 * when the phone allows it, the mic. Recording starts once the hold is clear
 * of a tap and stops when the finger lifts, or at the clip limit. The mic is
 * only asked for the first time someone films: if that question takes the
 * finger off the button, it keeps recording until the shutter's tapped again.
 */
export function useClipRecorder({ getStream, onClip }: { getStream: () => MediaStream | null; onClip: (file: File) => void }) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Rec | null>(null);
  const starting = useRef(false);
  const released = useRef(false);
  const lockedRef = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;

  const stop = useCallback((keep = true) => {
    const r = rec.current;
    if (limit.current) clearTimeout(limit.current);
    limit.current = null;
    if (!r) return;
    rec.current = null;
    (r as Rec & { keep?: boolean }).keep = keep;
    try {
      if (r.recorder.state !== "inactive") r.recorder.stop();
    } catch {
      r.audio?.getTracks().forEach((t) => t.stop());
    }
    setStartedAt(null);
    setLocked(false);
    lockedRef.current = false;
  }, []);

  const start = useCallback(async () => {
    if (rec.current || starting.current) return;
    const stream = getStream();
    const type = pickRecorderType();
    if (!stream || !type) return;
    starting.current = true;
    released.current = false;
    // The mic, for the clip's sound. A no (or no mic) still films, silently.
    let audio: MediaStream | null = null;
    try {
      audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      audio = null;
    }
    starting.current = false;
    if (getStream() !== stream) {
      audio?.getTracks().forEach((t) => t.stop());
      return;
    }
    const mixed = new MediaStream([...stream.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(mixed, { mimeType: type, videoBitsPerSecond: 3_000_000 });
    } catch {
      try {
        recorder = new MediaRecorder(mixed);
      } catch {
        audio?.getTracks().forEach((t) => t.stop());
        toast.error("This phone can't film here. Pick a clip from your library instead.");
        return;
      }
    }
    const chunks: Blob[] = [];
    const t0 = performance.now();
    const entry: Rec & { keep?: boolean } = { recorder, audio, startedAt: t0, type };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      audio?.getTracks().forEach((t) => t.stop());
      const took = performance.now() - t0;
      if (entry.keep === false || took < MIN_CLIP_MS || !chunks.length) return;
      const mime = baseMediaType(recorder.mimeType || type) || "video/mp4";
      const blob = new Blob(chunks, { type: mime });
      onClipRef.current(new File([blob], `jf-clip-${Date.now()}.${mime.includes("mp4") ? "mp4" : "webm"}`, { type: mime }));
    };
    try {
      recorder.start(500);
    } catch {
      audio?.getTracks().forEach((t) => t.stop());
      toast.error("Couldn't start filming. Try again, or pick a clip from your library.");
      return;
    }
    rec.current = entry;
    setStartedAt(t0);
    setElapsed(0);
    limit.current = setTimeout(() => stop(), MAX_RECORD_MS);
    // the finger came off while the phone asked about the mic: keep filming until the shutter's tapped
    if (released.current) {
      lockedRef.current = true;
      setLocked(true);
      toast.message("Filming", { description: "Tap the button to stop." });
    }
  }, [getStream, stop]);

  /** The finger lifted: stop, unless it lifted while the mic question was up (then a tap stops it). */
  const release = useCallback(() => {
    if (starting.current) {
      released.current = true;
      return;
    }
    if (rec.current && !lockedRef.current) stop();
  }, [stop]);

  // the clock for the ring around the shutter
  useEffect(() => {
    if (startedAt == null) return;
    let raf = 0;
    const tick = () => {
      setElapsed(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt]);

  // leaving the camera mid-clip throws it away
  useEffect(() => () => stop(false), [stop]);

  return {
    recording: startedAt != null,
    locked,
    /** 0 → 1 of the clip limit. */
    progress: startedAt == null ? 0 : Math.min(1, elapsed / MAX_RECORD_MS),
    seconds: Math.floor(elapsed / 1000),
    start,
    release,
    stop,
  };
}
