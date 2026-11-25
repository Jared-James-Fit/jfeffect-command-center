import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChevronDown, Grid3x3, Images, RefreshCcw, Ruler, Timer, X, Zap, ZapOff } from "lucide-react";
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

import { PICTURE_WAIT_MS, pictureSize } from "@/lib/camera/picture-size";
import { SCREEN_FLASH_MS, TORCH_SETTLE_MS } from "@/lib/camera/torch";
import { feedback } from "@/lib/feedback";
import {
  CAPTURE_MODES,
  CAPTURE_MODE_LABEL,
  CAPTURE_RATIOS,
  CAPTURE_RATIO_LABEL,
  HOLD_TO_RECORD_MS,
  LEVEL_TOLERANCE,
  PURPOSES,
  captureCrop,
  captureProfile,
  focusAt,
  focusPoint,
  guideRect,
  levelAngle,
  purposeStart,
  ratioValue,
  readCaptureSettings,
  saveCaptureSettings,
  slideZoom,
  type CaptureMode,
  type CaptureRatio,
  type CaptureSettings,
  type CaptureTimer,
  type MediaPurpose,
  type Rect,
  type Size,
} from "@/lib/media/capture";
import { slideLocks } from "@/lib/camera/camera-zoom";

/** A photo from the capture camera: the camera's whole picture (kept as it is), and what the guide showed of it. */
export type CaptureShot = { file: File; picture: Size; crop: Rect; ratio: CaptureRatio };

/** The capture camera (photo and video, hold to record) for one place, with its defaults (media/capture.ts). */
export type CaptureOptions = { purpose: MediaPurpose; onShot: (shot: CaptureShot) => void };

export { canFilmInApp } from "@/lib/camera/film-settings";

/** Recordings shorter than this are a slip of the thumb, not a clip. */
const MIN_RECORDING_MS = 700;

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
  tip,
  capture,
}: {
  /** Photo and video for a place (New post, chat, progress, profile…): tap for a photo, hold to film. Without it: the set camera, video only. */
  capture?: CaptureOptions;
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
  /** One line on how to stand the phone (a barbell lift read for bar speed), until it films. */
  tip?: string;
}) {
  const purpose = capture?.purpose ?? null;
  const pd = purpose ? PURPOSES[purpose] : null;
  // the capture camera's own settings (mode, ratio, timer, level), remembered apart from the set camera's
  const [cs, setCs] = useState<CaptureSettings>(() => readCaptureSettings());
  const [settings, setSettings] = useState<FilmSettings>(() => {
    const film = readFilmSettings();
    if (!purpose) return film;
    const c = readCaptureSettings();
    const st = purposeStart(purpose, c);
    return { ...film, quality: c.quality ?? (c.mode === "max" ? "4k" : "1080p"), fps: c.fps, grid: st.grid, facing: st.facing };
  });
  const [ratio, setRatio] = useState<CaptureRatio>(() => (purpose ? purposeStart(purpose, readCaptureSettings()).ratio : "screen"));
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
  // the capture camera's hold let go before filming had started
  const releasedEarly = useRef(false);
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

  const saveCs = (patch: (c: CaptureSettings) => CaptureSettings) =>
    setCs((prev) => {
      const next = patch(prev);
      saveCaptureSettings(next);
      return next;
    });
  const update = (next: Partial<FilmSettings>) => {
    setSettings((prev) => {
      const s = { ...prev, ...next };
      if (!purpose) saveFilmSettings(s);
      else if ("sound" in next) saveFilmSettings({ ...readFilmSettings(), sound: s.sound });
      return s;
    });
    if (purpose && ("quality" in next || "fps" in next || "grid" in next || "facing" in next))
      saveCs((c) => ({
        ...c,
        ...(next.quality ? { quality: next.quality } : {}),
        ...(next.fps ? { fps: next.fps } : {}),
        ...(typeof next.grid === "boolean" ? { grid: next.grid } : {}),
        ...(next.facing ? { facing: { ...c.facing, [purpose]: next.facing } } : {}),
      }));
  };
  /** Auto / Maximum quality / Fast capture: the quality it asks for follows (only what this camera can do). */
  const setMode = (mode: CaptureMode) => {
    feedback("toggle");
    const prof = captureProfile({ mode, quality: null, fps: settings.fps }, caps, hasPhotoPath());
    saveCs((c) => ({ ...c, mode, quality: null }));
    setSettings((prev) => ({ ...prev, quality: prof.quality }));
  };
  const pickRatio = (r: CaptureRatio) => {
    feedback("toggle");
    setRatio(r);
    if (purpose) saveCs((c) => ({ ...c, ratios: { ...c.ratios, [purpose]: r } }));
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
    // the finger lifted while the mic was still opening: it stops as soon as it's started (too short is dropped)
    if (releasedEarly.current) {
      releasedEarly.current = false;
      stopRecording(true);
      return;
    }
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

  /* ---- the capture camera: photos, hold to film, focus, the guide, the level, the timer ---- */
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = videoRef.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const picture: Size | null = actual?.width && actual?.height ? { w: actual.width, h: actual.height } : null;
  const guideAspect = purpose && ratio !== "screen" && ratio !== "original" ? ratioValue(ratio, { screen: box, picture }) : null;
  const guide = guideRect(box, guideAspect);
  const [flash, setFlash] = useState(false);
  const [whiteout, setWhiteout] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const countTimer = useRef<number | null>(null);
  const [focusMark, setFocusMark] = useState<{ x: number; y: number; n: number } | null>(null);
  const [tilt, setTilt] = useState<number | null>(null);
  const shooting = useRef(false);
  const press = useRef<{ t: number; x: number; y: number; z: number; held: boolean } | null>(null);
  const [locked, setLocked] = useState(false);

  // the level: gravity across the screen while it's on (iOS asks for motion inside the tap that turns it on)
  useEffect(() => {
    if (!purpose || !cs.level) {
      setTilt(null);
      return;
    }
    let raf = 0;
    let last: { x: number; y: number } | null = null;
    const on = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      last = { x: g.x, y: g.y };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (last) setTilt(levelAngle(last.x, last.y));
      });
    };
    window.addEventListener("devicemotion", on);
    return () => {
      window.removeEventListener("devicemotion", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [purpose, cs.level]);
  const toggleLevel = (v: boolean) => {
    const DM = (typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null) as unknown as { requestPermission?: () => Promise<string> } | null;
    if (v && DM?.requestPermission) {
      void DM.requestPermission().then(
        (r) => (r === "granted" ? saveCs((c) => ({ ...c, level: true })) : toast.message("The level needs motion access", { description: "Allow Motion & Orientation for JF Effect to use it." })),
        () => undefined,
      );
      return;
    }
    saveCs((c) => ({ ...c, level: v }));
  };

  // the timer's count is cancelled with the camera
  useEffect(
    () => () => {
      if (countTimer.current) window.clearInterval(countTimer.current);
    },
    [],
  );

  /** Tap to focus and expose there, where the camera can (otherwise nothing is shown: a square that did nothing would lie). */
  const tapFocus = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!purpose || status !== "live" || (e.target as Element).closest("button,[data-film-panel],input,label")) return;
    const t = track();
    const r = e.currentTarget.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (!t || !picture) return;
    let supported: { pointsOfInterest?: boolean } | null = null;
    try {
      supported = (navigator.mediaDevices.getSupportedConstraints?.() as { pointsOfInterest?: boolean }) ?? null;
    } catch {
      supported = null;
    }
    const c = focusAt(focusPoint(at, box, picture, facing === "user"), caps as unknown as { focusMode?: string[]; exposureMode?: string[] }, supported);
    if (!c) return;
    setFocusMark({ ...at, n: Date.now() });
    void t.applyConstraints({ advanced: [c] }).catch(() => setFocusMark(null));
  };
  useEffect(() => {
    if (!focusMark) return;
    const id = window.setTimeout(() => setFocusMark(null), 1100);
    return () => window.clearTimeout(id);
  }, [focusMark]);

  /** The still: the camera's own photo path in Maximum quality (where the browser has one), else the frame on screen at once. */
  const grabStill = async (): Promise<{ blob: Blob; size: Size } | null> => {
    const v = videoRef.current;
    const t = track();
    if (!v || !t || !v.videoWidth) return null;
    const prof = captureProfile({ mode: cs.mode, quality: cs.quality, fps: settings.fps }, caps, hasPhotoPath());
    if (prof.still === "photo" && facing !== "user") {
      try {
        const IC = (window as unknown as { ImageCapture: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
        const blob = await new IC(t).takePhoto();
        const bmp = await createImageBitmap(blob);
        const size = { w: bmp.width, h: bmp.height };
        bmp.close?.();
        return { blob, size };
      } catch {
        /* the frame on screen instead */
      }
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    // the selfie preview is mirrored: kept the way it looked
    if (facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", cs.mode === "max" ? 0.95 : 0.92));
    const size = { w: c.width, h: c.height };
    c.width = c.height = 0;
    return blob ? { blob, size } : null;
  };

  const snap = async () => {
    if (!capture || shooting.current || status !== "live") return;
    shooting.current = true;
    const t = track();
    const light = flash && facing === "environment" && !!caps?.torch;
    try {
      if (light && t) {
        await t.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, TORCH_SETTLE_MS));
      }
      if (flash && facing === "user") {
        setWhiteout(true);
        await new Promise((r) => setTimeout(r, SCREEN_FLASH_MS));
      }
      const got = await grabStill();
      if (!got) {
        toast.error("Couldn't take that photo. Try again.");
        return;
      }
      feedback("tap");
      const file = new File([got.blob], `jf-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      capture.onShot({ file, picture: got.size, crop: captureCrop(got.size, box, ratio), ratio });
    } finally {
      if (light && t) void t.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
      setWhiteout(false);
      shooting.current = false;
    }
  };
  const shoot = () => {
    const timer = cs.timer;
    if (!timer) return void snap();
    if (countTimer.current) return;
    let n: number = timer;
    setCount(n);
    countTimer.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countTimer.current) window.clearInterval(countTimer.current);
        countTimer.current = null;
        setCount(null);
        void snap();
      } else setCount(n);
    }, 1000);
  };
  const cancelCount = () => {
    if (countTimer.current) window.clearInterval(countTimer.current);
    countTimer.current = null;
    setCount(null);
  };

  // the shutter: a tap takes a photo, a hold films (slide up to zoom, left to lock it hands-free), let go stops
  const canPhoto = !!pd?.photo;
  const canVideo = !purpose || !!pd?.video;
  const shutterDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!purpose || status !== "live") return;
    if (count != null) return cancelCount();
    if (recording) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    releasedEarly.current = false;
    const p = { t: 0, x: e.clientX, y: e.clientY, z: zoom ?? caps?.zoom?.min ?? 1, held: false };
    if (canVideo)
      p.t = window.setTimeout(() => {
        p.held = true;
        feedback("press");
        void startRecording();
      }, HOLD_TO_RECORD_MS);
    press.current = p;
  };
  const shutterMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p?.held || !recording) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!locked && slideLocks(dx, dy)) {
      setLocked(true);
      feedback("toggle");
      return;
    }
    if (caps?.zoom) applyZoom(slideZoom(p.z, dy, caps.zoom));
  };
  const shutterUp = () => {
    const p = press.current;
    press.current = null;
    if (!purpose) return;
    if (p) window.clearTimeout(p.t);
    if (p?.held) {
      if (locked) return;
      if (recRef.current) stopRecording(true);
      else releasedEarly.current = true;
      return;
    }
    if (recording) {
      // locked hands-free: a tap stops it
      setLocked(false);
      stopRecording(true);
      return;
    }
    if (p && canPhoto) shoot();
    else if (p && canVideo) void startRecording();
  };
  useEffect(() => {
    if (!recording) setLocked(false);
  }, [recording]);

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
      aria-label={purpose ? (title ?? pd?.title ?? "Camera") : title ? `Film ${title}` : "Film a video"}
      data-capture-purpose={purpose ?? undefined}
      onClick={tapFocus}
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
      {/* the capture ratio's guide: what's outside it is dimmed (Full screen and Original: nothing) */}
      {purpose && status === "live" && guideAspect != null && (guide.y > 1 || guide.x > 1) && (
        <div className="pointer-events-none absolute inset-0" aria-hidden data-capture-guide={ratio}>
          <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: guide.y }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: Math.max(0, box.h - guide.y - guide.h) }} />
          <div className="absolute left-0 bg-black/55" style={{ top: guide.y, height: guide.h, width: guide.x }} />
          <div className="absolute right-0 bg-black/55" style={{ top: guide.y, height: guide.h, width: guide.x }} />
        </div>
      )}
      {focusMark && (
        <span
          key={focusMark.n}
          className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-yellow-300 animate-in zoom-in-125 fade-in-0 duration-200"
          style={{ left: focusMark.x, top: focusMark.y }}
          aria-hidden
          data-capture-focus
        />
      )}
      {purpose && cs.level && tilt != null && status === "live" && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-40 -translate-x-1/2 -translate-y-1/2" aria-hidden data-capture-level>
          <div className={cn("h-full w-full rounded-full", Math.abs(tilt) <= LEVEL_TOLERANCE ? "bg-yellow-300" : "bg-white/80")} style={{ transform: `rotate(${-tilt}deg)` }} />
        </div>
      )}
      {count != null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-live="assertive" data-capture-count>
          <span className="text-[96px] font-bold tabular-nums text-white drop-shadow-lg">{count}</span>
        </div>
      )}
      {whiteout && <div className="pointer-events-none absolute inset-0 z-[5] bg-white" aria-hidden />}
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
              aria-label={`Camera settings: ${purpose ? `${CAPTURE_RATIO_LABEL[ratio]}, ` : ""}${label || FILM_QUALITIES[shown.quality].label}`}
              aria-expanded={panel}
              data-film-quality
            >
              {purpose && <span className="mr-1.5">{CAPTURE_RATIO_LABEL[ratio]} ·</span>}
              {cs.timer > 0 && purpose && <Timer className="mr-1 h-3.5 w-3.5" aria-hidden />}
              {label || `${FILM_QUALITIES[shown.quality].label} · ${shown.fps}`}
              <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", panel && "rotate-180")} aria-hidden />
            </button>
          )}
          <div className="flex w-10 items-center justify-end">
            {purpose ? (
              // the flash: the back camera's light for a moment (on while it films), the screen for a selfie; never where it can't fire
              (facing === "user" || caps?.torch) && !recording && (
                <button
                  type="button"
                  onClick={() => {
                    feedback("toggle");
                    setFlash((f) => !f);
                  }}
                  aria-label={flash ? "Flash on" : "Flash off"}
                  aria-pressed={flash}
                  className={cn("grid h-10 w-10 place-items-center rounded-full active:scale-95", flash ? "bg-white text-black" : "bg-black/40")}
                  data-capture-flash={flash ? "on" : "off"}
                >
                  {flash ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                </button>
              )
            ) : (
              caps?.torch && (
                <button type="button" onClick={() => void toggleTorch()} aria-label={torch ? "Light off" : "Light on"} aria-pressed={torch} className={cn("grid h-10 w-10 place-items-center rounded-full active:scale-95", torch ? "bg-white text-black" : "bg-black/40")} data-film-torch>
                  {torch ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                </button>
              )
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
        {tip && !recording && (
          <p className="mx-auto mt-1 max-w-[20rem] text-center text-[12px] leading-snug text-white/75 [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]" data-film-tip>
            {tip}
          </p>
        )}
      </div>

      {/* settings: what to film at, all remembered on this phone */}
      {panel && !recording && (
        <div className="absolute inset-x-3 top-[calc(max(calc(env(safe-area-inset-top)_+_var(--ios-edge-room,0px)),12px)+3.75rem)] max-h-[calc(100dvh-14rem)] overflow-y-auto overscroll-contain rounded-2xl bg-black/80 p-4 backdrop-blur-sm" data-film-panel>
          {purpose && (
            <>
              <p className="text-[13px] font-semibold text-white/70">Capture</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CAPTURE_MODES.map((m) => (
                  <Choice key={m} on={cs.mode === m} onClick={() => setMode(m)} data-capture-mode={m}>
                    {CAPTURE_MODE_LABEL[m]}
                  </Choice>
                ))}
              </div>
              <p className="mt-2 text-[12px] leading-snug text-white/60">
                {cs.mode === "max"
                  ? "The most this camera can give. Bigger files, a moment slower."
                  : cs.mode === "fast"
                    ? "Takes the moment on screen at once, at 1080p."
                    : "Sharp and quick, picked for you."}
              </p>
              <p className="mt-3 text-[13px] font-semibold text-white/70">Ratio</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CAPTURE_RATIOS.map((r) => (
                  <Choice key={r} on={ratio === r} onClick={() => pickRatio(r)} data-capture-ratio={r}>
                    {CAPTURE_RATIO_LABEL[r]}
                  </Choice>
                ))}
              </div>
              <p className="mt-2 text-[12px] leading-snug text-white/60">The whole photo is kept: you can move, zoom and turn it before you share.</p>
              {canPhoto && (
                <>
                  <p className="mt-3 text-[13px] font-semibold text-white/70">Timer</p>
                  <div className="mt-2 flex gap-1.5">
                    {([0, 3, 10] as CaptureTimer[]).map((t) => (
                      <Choice key={t} on={cs.timer === t} onClick={() => saveCs((c) => ({ ...c, timer: t }))} data-capture-timer={t}>
                        {t ? `${t}s` : "Off"}
                      </Choice>
                    ))}
                  </div>
                </>
              )}
              <label className="mt-3 flex items-center justify-between gap-3 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <Ruler className="h-4 w-4" aria-hidden /> Level
                </span>
                <Switch checked={cs.level} onCheckedChange={toggleLevel} aria-label="Level" />
              </label>
              {canVideo && <p className="mt-4 text-[13px] font-semibold text-white/70">Video</p>}
            </>
          )}
          {canVideo && <>
          <p className={cn("text-[13px] font-semibold text-white/70", purpose && "mt-2 text-[12px] text-white/55")}>Quality</p>
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
          </>}
          {canVideo && <>
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
          </>}
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
        {purpose && canPhoto && canVideo && status === "live" && !recording && (
          <p className="mb-2 text-center text-[12px] font-medium text-white/75 [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]" data-capture-hint>
            Tap for photo, hold for video
          </p>
        )}
        {purpose && recording && !locked && (
          <p className="mb-2 text-center text-[12px] font-medium text-white/75" data-capture-hint>
            Slide up to zoom, left to keep filming
          </p>
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
            {purpose ? (
              <button
                type="button"
                disabled={status !== "live"}
                onPointerDown={shutterDown}
                onPointerMove={shutterMove}
                onPointerUp={shutterUp}
                onPointerCancel={shutterUp}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (recording) stopRecording(true);
                    else if (canPhoto) shoot();
                    else void startRecording();
                  }
                }}
                aria-label={recording ? "Stop recording" : canPhoto && canVideo ? "Take a photo, or hold to film" : canPhoto ? "Take a photo" : "Start recording"}
                className={cn("grid h-[78px] w-[78px] touch-none place-items-center rounded-full border-4 transition active:scale-95 disabled:opacity-40", recording ? "border-red-500" : "border-white")}
                data-capture-shutter={recording ? (locked ? "locked" : "recording") : "ready"}
              >
                <span className={cn("block transition-all duration-200", recording ? "h-7 w-7 rounded-md bg-red-500" : "h-[62px] w-[62px] rounded-full bg-white")} />
              </button>
            ) : (
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
            )}
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

/** The browser can take a still through the camera's own photo path (ImageCapture; not Safari today). */
function hasPhotoPath(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === "function";
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
