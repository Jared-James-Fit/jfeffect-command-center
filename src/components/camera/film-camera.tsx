import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChevronDown, Grid3x3, Images, RefreshCcw, X, Zap, ZapOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { baseMediaType } from "@/lib/community";
import { askForMicAgain, micRefused, noteClipMic, openVideoMic } from "@/lib/video-mic";
import { holdCameraOpen } from "@/lib/camera/camera-presence";
import { phoneUpright, takePrimedCamera } from "@/lib/camera/camera-prime";
import {
  FILM_QUALITIES,
  askOrder,
  availableFps,
  availableQualities,
  clampZoom,
  constraintLadder,
  describeTrack,
  filmFileName,
  fitSettings,
  lensesFrom,
  pickType,
  pictureFits,
  pictureMiss,
  readFilmAsk,
  readFilmSettings,
  recordClock,
  recordLimitSeconds,
  recorderBitrate,
  recorderKeyframes,
  recorderTypes,
  saveFilmAsk,
  saveFilmSettings,
  type AskShape,
  type CameraCaps,
  type FilmFps,
  type FilmQuality,
  type FilmSettings,
  type Lens,
} from "@/lib/camera/film-settings";

export { canFilmInApp } from "@/lib/camera/film-settings";

/** Recordings shorter than this are a slip of the thumb, not a clip. */
const MIN_RECORDING_MS = 700;
/** How long to wait for the first frame's size before judging the picture's shape. */
const PICTURE_WAIT_MS = 1_500;


/** The picture's size as it's shown (turned the way the phone is held), once the first frame is in. */
function pictureSize(v: HTMLVideoElement, ms: number): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const read = () => (v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
    const now = read();
    if (now) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      v.removeEventListener("loadedmetadata", finish);
      v.removeEventListener("resize", finish);
      resolve(read());
    };
    const t = setTimeout(finish, ms);
    v.addEventListener("loadedmetadata", finish);
    v.addEventListener("resize", finish);
  });
}

type Status = "starting" | "live" | "denied" | "unavailable";
type Rec = { recorder: MediaRecorder; mic: MediaStream | null; restore: (() => void) | null; startedAt: number; keep: boolean };

/**
 * The app's own video camera, full screen like TikTok's / a reel's (the
 * picture edge to edge, 9:16 upright, the controls over it; the page and the
 * status bar black behind it, camera-presence.ts): films at the quality picked (1080p by default, 4K or 60 fps where the phone
 * can), with its lenses (0.5 · 1× · Tele), pinch to zoom, the light, the front
 * camera, a grid and sound on or off, all remembered on the phone
 * (film-settings.ts). A phone films without the mic unless sound is switched
 * on in the settings, so the music in their earbuds keeps playing
 * (`defaultFilmSound`). One tap starts, one stops: a propped phone films the
 * whole set. The clip goes to `onClip` as a file, exactly as if it had been
 * picked, so the trimmer and the lift finder take it from there. Library
 * opens the phone's own picker instead (from the tap, as iOS requires).
 */
export function FilmCamera({
  onClose,
  onClip,
  onLibrary,
  maxSeconds,
  title,
  detail,
}: {
  onClose: () => void;
  onClip: (file: File) => void;
  /** Pick from the phone's library instead (called inside the tap). */
  onLibrary?: () => void;
  /** The place's limit (the recording also stops before the phone runs out of memory). */
  maxSeconds: number;
  /** What's being filmed ("Competition Squat · Top set"). */
  title?: string;
  /** The set to lift, "140 kg × 3 @ RPE 7": big enough to read from the bench, and kept on screen while it films. */
  detail?: string;
}) {
  const [settings, setSettings] = useState<FilmSettings>(() => readFilmSettings());
  const [lensId, setLensId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [caps, setCaps] = useState<CameraCaps | null>(null);
  const [actual, setActual] = useState<{ width?: number; height?: number; frameRate?: number } | null>(null);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [recordingAt, setRecordingAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [panel, setPanel] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [micBlocked, setMicBlocked] = useState(() => micRefused());

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<Rec | null>(null);
  const startingRef = useRef(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const recording = recordingAt != null;
  const track = () => streamRef.current?.getVideoTracks()[0] ?? null;

  // While it's up: the phone may turn to film sideways, and nothing else on the page takes the keys.
  useEffect(() => holdCameraOpen(), []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const releaseWake = useCallback(() => {
    const w = wakeRef.current;
    wakeRef.current = null;
    void w?.release().catch(() => undefined);
  }, []);

  const update = (next: Partial<FilmSettings>) => {
    setSettings((prev) => {
      const s = { ...prev, ...next };
      saveFilmSettings(s);
      return s;
    });
  };

  // The live camera: asked again whenever the quality, frame rate, side or lens changes.
  const facing = lensId ? "environment" : settings.facing;
  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    // one camera at a time: a phone won't open a second while the first is held
    stopStream();
    setStatus("starting");
    setTorch(false);
    setZoom(null);
    const want = { quality: settings.quality, fps: settings.fps, facing };
    let last: unknown = null;
    const refused = () => {
      const name = (last as { name?: string } | null)?.name;
      return name === "NotAllowedError" || name === "SecurityError";
    };
    // the first ask may already be on its way, from the tap that opened the camera (camera-prime.ts)
    let first = true;
    const open = async (shape: AskShape): Promise<MediaStream | null> => {
      for (const ask of constraintLadder(want, lensId, shape)) {
        try {
          const primed = first ? takePrimedCamera(ask) : null;
          first = false;
          if (primed && "released" in primed) await primed.released;
          return await (primed && "stream" in primed ? primed.stream : navigator.mediaDevices.getUserMedia({ video: ask, audio: false }));
        } catch (e) {
          last = e;
          if (refused()) return null;
        }
      }
      return null;
    };
    const show = (stream: MediaStream) => {
      const v = videoRef.current;
      if (!v) return;
      // iOS shows a live camera inline only when muted + playsinline are attributes
      v.muted = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.srcObject = stream;
      void v.play().catch(() => undefined);
    };
    void (async () => {
      // A reel's picture: 9:16 upright, filling the screen. Browsers read the size asked for against
      // different ways round, so the picture is checked and, when it isn't 9:16 (a 3:4 or sideways
      // picture would play boxed in), asked for the other way; what worked is kept on the phone.
      const upright = phoneUpright();
      const order = upright == null ? (["landscape"] as AskShape[]) : askOrder(upright, readFilmAsk());
      let stream: MediaStream | null = null;
      let best: { shape: AskShape; miss: number } | null = null;
      for (let i = 0; i < order.length; i++) {
        const shape = order[i];
        const got = await open(shape);
        if (cancelled) {
          got?.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!got) {
          if (refused()) break;
          continue;
        }
        show(got);
        const v = videoRef.current;
        const pic = v && upright != null ? await pictureSize(v, PICTURE_WAIT_MS) : null;
        if (cancelled) {
          got.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!pic || upright == null || pictureFits(pic.w, pic.h, upright)) {
          if (pic && upright) saveFilmAsk(shape);
          stream = got;
          break;
        }
        const miss = pictureMiss(pic.w, pic.h, upright);
        const lastTry = i === order.length - 1;
        if (lastTry && (!best || miss <= best.miss)) {
          stream = got;
          break;
        }
        // one camera at a time: this one goes before the next is asked for
        got.getTracks().forEach((t) => t.stop());
        if (!best || miss < best.miss) best = { shape, miss };
      }
      // neither way gave 9:16: the closest one again (never no camera because the shape was off)
      if (!stream && best && !refused()) {
        stream = await open(best.shape);
        if (cancelled) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        if (stream) show(stream);
      }
      if (!stream) {
        setStatus(refused() ? "denied" : "unavailable");
        return;
      }
      streamRef.current = stream;
      const t = stream.getVideoTracks()[0] ?? null;
      let c: CameraCaps | null = null;
      try {
        c = (t?.getCapabilities?.() as CameraCaps | undefined) ?? null;
      } catch {
        c = null;
      }
      setCaps(c);
      setActual(t?.getSettings?.() ?? null);
      if (c?.zoom) {
        const z = (t?.getSettings?.() as { zoom?: number } | undefined)?.zoom;
        setZoom(typeof z === "number" ? z : (c.zoom.min ?? 1));
      }
      if (videoRef.current?.srcObject !== stream) show(stream);
      setStatus("live");
      // the system ended it (another app took the camera, the phone locked): what's filmed is kept
      t?.addEventListener("ended", () => {
        if (streamRef.current !== stream) return;
        if (recRef.current) stopRecording(true);
        if (document.visibilityState === "visible") setAttempt((n) => n + 1);
      });
      // the lenses have names once the camera's allowed
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setLenses(lensesFrom(devices as Array<{ deviceId: string; label: string; kind: string }>));
      } catch {
        /* no list: one camera */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.quality, settings.fps, facing, lensId, attempt]);

  // Back from another app: a camera the system stopped starts again.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      const t = track();
      if (!t || t.readyState === "ended") setAttempt((n) => n + 1);
      else if (videoRef.current?.paused) void videoRef.current.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, []);

  // Closing: everything off (a recording still going is thrown away).
  useEffect(
    () => () => {
      if (limitTimer.current) clearTimeout(limitTimer.current);
      const r = recRef.current;
      if (r) {
        r.keep = false;
        try {
          if (r.recorder.state !== "inactive") r.recorder.stop();
        } catch {
          /* already stopped */
        }
        r.mic?.getTracks().forEach((t) => t.stop());
        r.restore?.();
      }
      releaseWake();
      stopStream();
    },
    [releaseWake, stopStream],
  );

  // the clock while filming
  useEffect(() => {
    if (recordingAt == null) return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(performance.now() - recordingAt), 250);
    return () => window.clearInterval(id);
  }, [recordingAt]);

  const dims = useMemo(() => {
    const w = actual?.width ?? FILM_QUALITIES[settings.quality].short;
    const h = actual?.height ?? FILM_QUALITIES[settings.quality].long;
    const fps = actual?.frameRate ?? settings.fps;
    return { w, h, fps };
  }, [actual, settings.quality, settings.fps]);
  const bitrate = recorderBitrate(dims.w, dims.h, dims.fps);
  const limitSeconds = recordLimitSeconds(bitrate, maxSeconds);

  function stopRecording(keep = true) {
    const r = recRef.current;
    if (limitTimer.current) clearTimeout(limitTimer.current);
    limitTimer.current = null;
    if (!r) return;
    r.keep = keep;
    try {
      if (r.recorder.state !== "inactive") r.recorder.stop();
      else r.recorder.onstop?.(new Event("stop"));
    } catch {
      r.mic?.getTracks().forEach((t) => t.stop());
      r.restore?.();
    }
  }

  const startRecording = async () => {
    if (recRef.current || startingRef.current) return;
    const stream = streamRef.current;
    const t = stream?.getVideoTracks()[0];
    if (!stream || !t) return;
    startingRef.current = true;
    setPanel(false);
    const s = t.getSettings?.() ?? {};
    const w = s.width ?? dims.w;
    const h = s.height ?? dims.h;
    const fps = s.frameRate ?? dims.fps;
    const rate = recorderBitrate(w, h, fps);
    const type = pickType(recorderTypes(w, h, fps), (x) => !!MediaRecorder.isTypeSupported?.(x));
    // the mic only now, and only when sound is on: opening it pauses the music in their earbuds
    let mic: MediaStream | null = null;
    let restore: (() => void) | null = null;
    let micNote = "off";
    // a "Don't Allow" this visit films without sound and asks nothing (the settings' Ask again)
    if (settingsRef.current.sound && !micRefused()) {
      try {
        // the room as it sounds, from the phone's own mic (video-mic.ts): never a call's processing or a
        // headset's mic. Asked inside this tap, so a mic already allowed is used without asking again.
        const got = await openVideoMic();
        mic = got.stream;
        restore = got.restore;
        micNote = got.note;
      } catch {
        setMicBlocked(micRefused());
        toast.message("Filming without sound", {
          description: micRefused()
            ? "The microphone isn't allowed. Ask again from the camera's settings."
            : "The microphone isn't available to JF Effect.",
        });
      }
    }
    startingRef.current = false;
    if (streamRef.current !== stream) {
      mic?.getTracks().forEach((x) => x.stop());
      restore?.();
      return;
    }
    const mixed = new MediaStream([...stream.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])]);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(mixed, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: rate, audioBitsPerSecond: 128_000, ...recorderKeyframes() });
    } catch {
      try {
        recorder = new MediaRecorder(mixed, type ? { mimeType: type } : undefined);
      } catch {
        mic?.getTracks().forEach((x) => x.stop());
        restore?.();
        toast.error("This phone can't film here. Pick a clip from your library instead.");
        return;
      }
    }
    const chunks: Blob[] = [];
    const t0 = performance.now();
    const entry: Rec = { recorder, mic, restore, startedAt: t0, keep: true };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      if (recRef.current !== entry) return;
      recRef.current = null;
      mic?.getTracks().forEach((x) => x.stop());
      restore?.();
      releaseWake();
      setRecordingAt(null);
      const took = performance.now() - t0;
      if (!entry.keep || took < MIN_RECORDING_MS || !chunks.length) return;
      const mime = baseMediaType(recorder.mimeType || type || "video/mp4") || "video/mp4";
      const file = new File([new Blob(chunks, { type: mime })], filmFileName(mime), { type: mime });
      noteClipMic(file.name, micNote);
      onClipRef.current(file);
    };
    try {
      recorder.start(1000);
    } catch {
      mic?.getTracks().forEach((x) => x.stop());
      restore?.();
      toast.error("Couldn't start filming. Try again, or pick a clip from your library.");
      return;
    }
    recRef.current = entry;
    setRecordingAt(t0);
    limitTimer.current = setTimeout(() => stopRecording(true), limitSeconds * 1000);
    // the screen stays on while it films (an auto-lock would end the recording)
    try {
      const wl = (navigator as { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wl) void wl.request("screen").then((l) => {
        if (recRef.current === entry) wakeRef.current = l;
        else void l.release().catch(() => undefined);
      }, () => undefined);
    } catch {
      /* no wake lock */
    }
  };

  const toggleTorch = async () => {
    const t = track();
    if (!t || !caps?.torch) return;
    const next = !torch;
    try {
      await t.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      toast.message("The light isn't available on this camera.");
    }
  };

  // Pinch to zoom, where the camera zooms.
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const pendingZoom = useRef<number | null>(null);
  const zoomFrame = useRef(0);
  const applyZoom = (z: number) => {
    pendingZoom.current = z;
    if (zoomFrame.current) return;
    zoomFrame.current = requestAnimationFrame(() => {
      zoomFrame.current = 0;
      const value = pendingZoom.current;
      const t = track();
      if (value == null || !t) return;
      void t.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).then(() => setZoom(value), () => undefined);
    });
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !caps?.zoom) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoom ?? caps.zoom.min ?? 1 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinch.current;
    if (!p || e.touches.length !== 2 || !caps?.zoom) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    applyZoom(clampZoom(p.z * (d / Math.max(1, p.d)), caps.zoom));
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinch.current = null;
  };

  const qualities = availableQualities(caps);
  const fpsChoices = availableFps(caps);
  const shown = fitSettings(settings, caps);
  const activeLens = lensId ?? (facing === "environment" ? (lenses.find((l) => l.zoom === 1)?.deviceId ?? null) : null);
  const label = describeTrack(actual);
  const remaining = recording ? Math.max(0, limitSeconds * 1000 - elapsed) : 0;

  const library = () => {
    if (recording) return;
    onLibrary?.();
  };

  const body = (
    <div
      // pointer-events-auto: opened over a modal (a progress video's dialog), whose lock leaves the rest of the page untappable
      className="pointer-events-auto fixed inset-0 z-[70] select-none overflow-hidden bg-black text-white"
      data-film-camera
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Film ${title}` : "Film a video"}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <video
        ref={videoRef}
        className={cn("absolute inset-0 h-full w-full object-cover", facing === "user" && "-scale-x-100")}
        muted
        playsInline
        autoPlay
        onResize={() => setActual(track()?.getSettings?.() ?? null)}
      />
      {settings.grid && status === "live" && (
        <div className="pointer-events-none absolute inset-0" aria-hidden data-film-grid>
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
        </div>
      )}

      {status !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          {status === "starting" ? (
            <p className="text-sm text-white/70">Starting the camera…</p>
          ) : (
            <>
              <p className="text-[17px] font-semibold">{status === "denied" ? "The camera is off for JF Effect" : "The camera didn't start"}</p>
              <p className="max-w-[30ch] text-sm text-white/70">
                {status === "denied"
                  ? "Turn it on in your phone's Settings to film here, or use your phone's camera for now."
                  : "Try again, or use your phone's camera for now."}
              </p>
              <div className="mt-2 flex gap-2">
                {status === "unavailable" && (
                  <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-10 rounded-full bg-white/15 px-4 text-sm font-semibold active:scale-95">
                    Try again
                  </button>
                )}
                {onLibrary && (
                  <button type="button" onClick={library} className="h-10 rounded-full bg-white px-4 text-sm font-semibold text-black active:scale-95" data-film-fallback>
                    Use the phone's camera
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* top: close, what it's filming at (the clock while recording), the light and settings */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-3 pb-6 pt-[max(calc(env(safe-area-inset-top)_+_var(--ios-edge-room,0px)),12px)]" data-film-top>
        <div className="flex h-11 items-center justify-between gap-2">
          {recording ? (
            <span className="w-10" />
          ) : (
            <button type="button" onClick={onClose} aria-label="Close the camera" className="grid h-10 w-10 place-items-center rounded-full bg-black/40 active:scale-95" data-film-close>
              <X className="h-5 w-5" />
            </button>
          )}
          {recording ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold tabular-nums" data-film-recording aria-live="off">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
              {recordClock(elapsed)}
              {remaining < 30_000 && <span className="text-white/70">· {recordClock(remaining)} left</span>}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setPanel((o) => !o)}
              className="inline-flex h-9 items-center rounded-full bg-black/40 px-3 text-[13px] font-semibold tabular-nums active:scale-95"
              aria-label={`Camera settings: ${label || FILM_QUALITIES[shown.quality].label}`}
              aria-expanded={panel}
              data-film-quality
            >
              {label || `${FILM_QUALITIES[shown.quality].label} · ${shown.fps}`}
              <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", panel && "rotate-180")} aria-hidden />
            </button>
          )}
          <div className="flex w-10 items-center justify-end">
            {caps?.torch && (
              <button type="button" onClick={() => void toggleTorch()} aria-label={torch ? "Light off" : "Light on"} aria-pressed={torch} className={cn("grid h-10 w-10 place-items-center rounded-full active:scale-95", torch ? "bg-white text-black" : "bg-black/40")} data-film-torch>
                {torch ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>
        {title && !recording && <p className="mt-1 truncate text-center text-[13px] font-medium text-white/80">{title}</p>}
        {detail && (
          <p
            className="mt-1 truncate text-center text-[20px] font-semibold tabular-nums text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]"
            data-film-detail
          >
            {detail}
          </p>
        )}
      </div>

      {/* settings: what to film at, all remembered on this phone */}
      {panel && !recording && (
        <div className="absolute inset-x-3 top-[calc(max(calc(env(safe-area-inset-top)_+_var(--ios-edge-room,0px)),12px)+3.75rem)] rounded-2xl bg-black/80 p-4 backdrop-blur-sm" data-film-panel>
          <p className="text-[13px] font-semibold text-white/70">Quality</p>
          <div className="mt-2 flex gap-1.5">
            {qualities.map((q) => (
              <Choice key={q} on={shown.quality === q} onClick={() => update({ quality: q as FilmQuality })} data-film-choice={q}>
                {FILM_QUALITIES[q].label}
              </Choice>
            ))}
          </div>
          {fpsChoices.length > 1 && (
            <>
              <p className="mt-3 text-[13px] font-semibold text-white/70">Frames a second</p>
              <div className="mt-2 flex gap-1.5">
                {fpsChoices.map((f) => (
                  <Choice key={f} on={shown.fps === f} onClick={() => update({ fps: f as FilmFps })} data-film-choice={`fps-${f}`}>
                    {f}
                  </Choice>
                ))}
              </div>
            </>
          )}
          <p className="mt-2 text-[12px] leading-snug text-white/60">
            {shown.quality === "4k"
              ? `4K is for saving to your Photos. It's big: up to ${recordClock(limitSeconds * 1000)} a clip here.`
              : shown.fps === 60
                ? "60 is smoother for fast lifts and slow motion."
                : "1080p is sharp for your coach and the Crew."}
          </p>
          <label className="mt-4 flex items-center justify-between gap-3 text-sm font-medium">
            <span>
              Record sound
              <span className="block text-[12px] font-normal text-white/60">Pauses your music while you film.</span>
            </span>
            <Switch checked={settings.sound} onCheckedChange={(v) => update({ sound: v })} aria-label="Record sound" />
          </label>
          {settings.sound && micBlocked && (
            <div className="mt-2 flex items-center justify-between gap-3 text-[12px] leading-snug text-white/70" data-mic-refused>
              <span>The microphone isn't allowed, so clips film without sound.</span>
              <button
                type="button"
                // asked inside this tap and let go at once: the next recording uses the answer
                onClick={() =>
                  void askForMicAgain().then((ok) => {
                    setMicBlocked(!ok && micRefused());
                    if (!ok) toast.message("Still not allowed", { description: "Allow the microphone for JF Effect in your phone's settings to film with sound." });
                  })
                }
                className="h-9 shrink-0 rounded-full bg-white/15 px-3 text-[13px] font-semibold text-white active:scale-[0.97]"
              >
                Ask again
              </button>
            </div>
          )}
          <label className="mt-3 flex items-center justify-between gap-3 text-sm font-medium">
            <span className="inline-flex items-center gap-2">
              <Grid3x3 className="h-4 w-4" aria-hidden /> Grid
            </span>
            <Switch checked={settings.grid} onCheckedChange={(v) => update({ grid: v })} aria-label="Grid" />
          </label>
          <button type="button" onClick={() => setPanel(false)} className="mt-4 h-10 w-full rounded-full bg-white text-sm font-semibold text-black active:scale-[0.98]">
            Done
          </button>
        </div>
      )}

      {/* bottom: the lenses, then library · shutter · flip */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-6 pb-[max(env(safe-area-inset-bottom),16px)] pt-10">
        {facing === "environment" && lenses.length > 1 && (
          <div className="mb-4 flex justify-center gap-2" data-film-lenses>
            {lenses.map((l) => (
              <button
                key={l.deviceId}
                type="button"
                disabled={recording}
                onClick={() => setLensId(l.deviceId)}
                aria-pressed={activeLens === l.deviceId}
                className={cn(
                  "grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-bold tabular-nums transition active:scale-95 disabled:opacity-50",
                  activeLens === l.deviceId ? "bg-white text-black" : "bg-black/45 text-white",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
        {zoom != null && caps?.zoom && zoom > (caps.zoom.min ?? 1) + 0.05 && (
          <p className="mb-2 text-center text-[12px] font-semibold tabular-nums text-white/80">{zoom.toFixed(1)}×</p>
        )}
        <div className="grid grid-cols-3 items-center">
          <div className="flex justify-start">
            {onLibrary && !recording && (
              <button type="button" onClick={library} className="flex h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold active:scale-95" data-film-library>
                <Images className="h-6 w-6" aria-hidden />
                Library
              </button>
            )}
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              disabled={status !== "live"}
              onClick={() => (recording ? stopRecording(true) : void startRecording())}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className="grid h-[76px] w-[76px] place-items-center rounded-full border-4 border-white transition active:scale-95 disabled:opacity-40"
              data-film-shutter={recording ? "recording" : "ready"}
            >
              <span className={cn("block bg-red-500 transition-all duration-200", recording ? "h-7 w-7 rounded-md" : "h-[60px] w-[60px] rounded-full")} />
            </button>
          </div>
          <div className="flex justify-end">
            {!recording && (
              <button
                type="button"
                onClick={() => {
                  setLensId(null);
                  update({ facing: facing === "user" ? "environment" : "user" });
                }}
                aria-label={facing === "user" ? "Use the back camera" : "Use the front camera"}
                className="grid h-12 w-12 place-items-center rounded-full bg-black/40 active:scale-95"
                data-film-flip
              >
                <RefreshCcw className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

function Choice({ on, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn("h-9 min-w-14 rounded-full px-3 text-sm font-semibold tabular-nums transition active:scale-95", on ? "bg-white text-black" : "bg-white/12 text-white", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
