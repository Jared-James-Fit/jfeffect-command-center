/**
 * The account headshot camera (full screen). A coaching client's private photo
 * for their coach, taken live with the camera: there is no way to pick a file.
 *
 *   intro    what it's for, who sees it, what the checks do; agreeing starts the
 *            guided capture, or they can take it without the checks, or ask
 *            their coach to take it with them in person
 *   camera   guided: the face model (on the device) guides them into the oval,
 *            asks for a blink and a slight head turn in the server's order, and
 *            takes the photo itself once they're centred, clear and still.
 *            live: a shutter, nothing measured (their coach reviews it). A coach
 *            taking it in person gets the live camera, rear-facing first.
 *   review   the photo, Use this photo or Retake
 *   done     saved automatically when checks pass, otherwise sent for review
 *
 * The photo and a strip of small frames go straight into the private bucket
 * under the server's capture session, then the server checks them itself
 * (headshots.server.ts). Never blocks the app: closing it at any point is fine.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Check, Loader2, RefreshCw, ShieldCheck, SwitchCamera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { holdCameraOpen } from "@/lib/camera/camera-presence";
import { CHALLENGE_WORDS, type ChallengeStep } from "@/lib/headshots/rules";
import { PHOTO_PX, TILE, frameStats, type DeviceChecks, type TileMeta } from "@/lib/headshots/evidence";
import { advanceStep, approxPitch, eyeBandIn, eyesClosed, faceCrop, faceMetrics, guidance, serverWouldRefuse, type FaceMetrics, type StepState } from "@/lib/headshots/face-geometry";
import { askCoachForHeadshot, startCoachHeadshotCapture, startMyHeadshotCapture, submitHeadshotCapture } from "@/lib/headshots/headshots.functions";

type Mode = "client" | "coach";
type Phase = "intro" | "camera" | "review" | "sending" | "done";
type Session = { id: string; clientId: string; method: "guided" | "live" | "coach_assisted"; challenge: ChallengeStep[]; photoPath: string; evidencePath: string };
type Captured = { photo: Blob; photoUrl: string; evidence: Blob; device: DeviceChecks | null };

/** How long the model may take before the person is offered the camera without it. */
const MODEL_PATIENCE_MS = 25_000;
/** Ready this long, without moving, before the photo is taken by itself. */
const HOLD_MS = 800;
const ALIGN_MS = 450;
const DETECT_EVERY_MS = 70;

export function HeadshotCapture({
  open,
  onOpenChange,
  mode = "client",
  clientId,
  clientName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode?: Mode;
  /** coach mode: whose headshot */
  clientId?: string;
  clientName?: string;
  onDone?: (r: { status: "pending" | "accepted" }) => void;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<CaptureFlow mode={mode} clientId={clientId} clientName={clientName} onClose={() => onOpenChange(false)} onDone={onDone} />, document.body);
}

function CaptureFlow({ mode, clientId, clientName, onClose, onDone }: { mode: Mode; clientId?: string; clientName?: string; onClose: () => void; onDone?: (r: { status: "pending" | "accepted" }) => void }) {
  const [phase, setPhase] = useState<Phase>(mode === "coach" ? "camera" : "intro");
  const [method, setMethod] = useState<"guided" | "live">(mode === "coach" ? "live" : "guided");
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpSent, setHelpSent] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<"pending" | "accepted" | null>(null);
  const uploadedSession = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const startMine = useServerFn(startMyHeadshotCapture);
  const startCoach = useServerFn(startCoachHeadshotCapture);
  const submit = useServerFn(submitHeadshotCapture);
  const askCoach = useServerFn(askCoachForHeadshot);

  // Escape closes; nothing here holds anyone in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => () => {
    if (captured) URL.revokeObjectURL(captured.photoUrl);
  }, [captured]);

  const newSession = useCallback(async (m: "guided" | "live"): Promise<Session> => {
    const s = mode === "coach"
      ? await startCoach({ data: { clientId: clientId! } })
      : await startMine({ data: { method: m, consent: true } });
    const out = s as Session;
    setSession(out);
    return out;
  }, [mode, clientId, startCoach, startMine]);

  const onCaptured = (c: Captured) => {
    setCaptured(c);
    setPhase("review");
  };

  const send = async () => {
    if (!captured || !session || sendingRef.current) return;
    sendingRef.current = true;
    setPhase("sending");
    setError(null);
    try {
      const bucket = supabase.storage.from("account-headshots");
      const up = async (path: string, blob: Blob, type: string) => {
        const { error: e } = await bucket.upload(path, blob, { contentType: type, upsert: false });
        // a retry after a dropped connection: the file is already there
        if (e && !/exists|duplicate/i.test(e.message)) throw e;
      };
      // Once storage has accepted both files, retry only finalization. The server
      // no longer allows uploads after the session becomes pending or accepted.
      if (uploadedSession.current !== session.id) {
        await up(session.photoPath, captured.photo, "image/jpeg");
        if (session.method !== "coach_assisted") await up(session.evidencePath, captured.evidence, "image/png");
        uploadedSession.current = session.id;
      }
      const r = (await submit({ data: { headshotId: session.id, device: captured.device as any } })) as
        | { ok: true; status: "pending" | "accepted" }
        | { ok: false; message: string };
      if (!r.ok) {
        feedback("error");
        setError(r.message);
        setPhase("review");
        setSession(null);
        return;
      }
      feedback("success");
      setResult(r.status);
      setPhase("done");
      onDone?.({ status: r.status });
    } catch (e: any) {
      feedback("error");
      setError(e?.message ? `Couldn't send it: ${e.message}` : "Couldn't send it. Check your connection and try again.");
      setPhase("review");
    } finally {
      sendingRef.current = false;
    }
  };

  const retake = () => {
    if (captured) URL.revokeObjectURL(captured.photoUrl);
    setCaptured(null);
    uploadedSession.current = null;
    setError(null);
    setSession(null);
    setAttempt((a) => a + 1);
    setPhase("camera");
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[70] flex select-none flex-col overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "coach" ? "Take an account headshot" : "Account headshot"}
      data-headshot-capture
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(calc(env(safe-area-inset-top)_+_var(--ios-edge-room,0px)),12px)]">
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:bg-white/20" aria-label="Close" data-headshot-close>
          <X className="h-5 w-5" />
        </button>
        <div className="text-[15px] font-semibold">{mode === "coach" ? `Headshot${clientName ? ` · ${clientName}` : ""}` : "Account headshot"}</div>
        <div className="h-10 w-10" />
      </div>

      {phase === "intro" && (
        <Intro
          onGuided={() => {
            setMethod("guided");
            setPhase("camera");
          }}
          onLive={() => {
            setMethod("live");
            setPhase("camera");
          }}
          helpSent={helpSent}
          onAskCoach={async () => {
            try {
              await askCoach();
              setHelpSent(true);
              feedback("complete");
            } catch {
              setHelpSent(true);
            }
          }}
          onLater={onClose}
        />
      )}

      {phase === "camera" && (
        <LiveCamera
          key={`${method}:${attempt}`}
          mode={mode}
          method={method}
          newSession={newSession}
          onCaptured={onCaptured}
          onSwitchToLive={() => {
            setMethod("live");
            setAttempt((a) => a + 1);
          }}
          onClose={onClose}
          onAskCoach={mode === "client" ? async () => {
            await askCoach().catch(() => undefined);
            setHelpSent(true);
            setPhase("intro");
          } : undefined}
        />
      )}

      {(phase === "review" || phase === "sending") && captured && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6" data-headshot-review>
          <img src={captured.photoUrl} alt="Your new headshot" className="aspect-square w-full max-w-[300px] rounded-[28px] object-cover" />
          {error ? (
            <p className="max-w-sm text-center text-[14px] text-amber-300" role="alert" data-headshot-error>{error}</p>
          ) : (
            <p className="max-w-sm text-center text-[14px] text-white/70">
              {mode === "coach" ? "Saved as their account headshot when you tap Use this photo." : method === "guided" ? "Your headshot saves automatically when the checks pass." : "Your coach will review this photo before it replaces your current one."}
            </p>
          )}
          <div className="flex w-full max-w-sm flex-col gap-2 pb-[max(env(safe-area-inset-bottom),16px)]">
            {!error || session ? (
              <Button size="lg" className="h-12 rounded-full" onClick={() => void send()} disabled={phase === "sending"} data-headshot-use>
                {phase === "sending" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
                {phase === "sending" ? "Saving…" : error && session ? "Retry save" : "Use this photo"}
              </Button>
            ) : null}
            <Button size="lg" variant="secondary" className="h-12 rounded-full" onClick={retake} disabled={phase === "sending"} data-headshot-retake>
              <RefreshCw className="mr-2 h-4 w-4" />
              {error && !session ? "Try again" : "Retake"}
            </Button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-headshot-done>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
            <Check className="h-8 w-8" />
          </div>
          <h2 className="text-[22px] font-semibold">{result === "accepted" ? "Headshot saved" : "Sent for review"}</h2>
          <p className="max-w-sm text-[15px] text-white/70">
            {result === "accepted"
              ? mode === "coach" ? "It’s on their account now." : "Your account headshot is updated."
              : "Thanks! Your coach will look at it soon. Your current photo stays on your account until it's approved."}
          </p>
          <Button size="lg" className="mt-2 h-12 w-full max-w-sm rounded-full" onClick={onClose} data-headshot-finish>Done</Button>
        </div>
      )}
    </div>
  );
}

/* ---- intro: what it's for, consent ---------------------------------- */

function Intro({ onGuided, onLive, onAskCoach, helpSent, onLater }: { onGuided: () => void; onLive: () => void; onAskCoach: () => void; helpSent: boolean; onLater: () => void }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-[max(env(safe-area-inset-bottom),16px)]" data-headshot-intro>
      <div className="mx-auto mt-6 grid h-16 w-16 place-items-center rounded-full bg-white/10">
        <Camera className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-center text-[22px] font-semibold">A quick headshot for your coach</h2>
      <ul className="mx-auto mt-5 w-full max-w-sm space-y-3 text-[14px] leading-snug text-white/80">
        <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/60" /><span>Private: only your coach and JF Effect admins see it, never the Crew. Your Crew picture stays whatever you like.</span></li>
        <li className="flex gap-3"><Camera className="mt-0.5 h-4 w-4 shrink-0 text-white/60" /><span>Taken live with your camera (not from your photos), in good light, face straight on.</span></li>
        <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-white/60" /><span>While you take it, this phone checks your face is centred and clear and asks you to blink and turn your head slightly. That runs on your phone: no face template or biometric ID is created or stored.</span></li>
      </ul>
      <p className="mx-auto mt-4 max-w-sm text-center text-[12px] text-white/50">
        By continuing you agree to these on-device checks. Small still frames from the capture are kept for review and deleted within 30 days.
      </p>
      <div className="mx-auto mt-auto flex w-full max-w-sm flex-col gap-2 pt-6">
        <Button size="lg" className="h-12 rounded-full" onClick={onGuided} data-headshot-agree>Agree and start</Button>
        <Button size="lg" variant="secondary" className="h-12 rounded-full" onClick={onLive} data-headshot-simple>Take it without checks (requires review)</Button>
        <button type="button" onClick={onAskCoach} disabled={helpSent} className="h-11 text-[14px] font-semibold text-white/80 disabled:text-emerald-400" data-headshot-ask-coach>
          {helpSent ? "Your coach knows. They can take it with you in person." : "Ask my coach to take it with me"}
        </button>
        <button type="button" onClick={onLater} className="h-11 text-[14px] text-white/60" data-headshot-later>Not now</button>
      </div>
    </div>
  );
}

/* ---- the live camera ---------------------------------------------------- */

type CamStatus = "starting" | "loading_model" | "running" | "denied" | "no_camera" | "error";

function LiveCamera({
  mode,
  method,
  newSession,
  onCaptured,
  onSwitchToLive,
  onClose,
  onAskCoach,
}: {
  mode: Mode;
  method: "guided" | "live";
  newSession: (m: "guided" | "live") => Promise<Session>;
  onCaptured: (c: Captured) => void;
  onSwitchToLive: () => void;
  onClose: () => void;
  onAskCoach?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">(mode === "coach" ? "environment" : "user");
  const [status, setStatus] = useState<CamStatus>("starting");
  const [hint, setHint] = useState("Getting the camera ready…");
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(-1);
  const [challenge, setChallenge] = useState<ChallengeStep[]>([]);
  const [slowModel, setSlowModel] = useState(false);
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const doneRef = useRef(false);

  useEffect(() => holdCameraOpen(), []);

  // the camera
  useEffect(() => {
    let cancelled = false;
    setStatus("starting");
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
        setStatus("no_camera");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        setStatus(method === "guided" ? "loading_model" : "running");
      } catch (e: any) {
        const name = e?.name ?? "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "no_camera" : "error");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, method, tries]);

  // the capture session (a fresh one each time the camera opens)
  useEffect(() => {
    if (status !== "running" && status !== "loading_model") return;
    if (sessionRef.current) return;
    let cancelled = false;
    newSession(method)
      .then((s) => {
        if (cancelled) return;
        sessionRef.current = s;
        setChallenge(s.challenge);
      })
      .catch((e: any) => !cancelled && setSessionErr(e?.message ?? "Couldn't start. Try again."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === "running" || status === "loading_model"]);

  const mirrored = facing === "user";

  /** A square of the current video frame, drawn (mirrored like the preview) to `px`. */
  const grab = useCallback((crop: { sx: number; sy: number; side: number }, px: number): HTMLCanvasElement | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = px;
    c.height = px;
    const ctx = c.getContext("2d", { willReadFrequently: px <= TILE });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    if (mirrored) {
      ctx.translate(px, 0);
      ctx.scale(-1, 1);
    }
    // mirroring flips the crop's x too
    const sx = mirrored ? v.videoWidth - crop.sx - crop.side : crop.sx;
    ctx.drawImage(v, sx, crop.sy, crop.side, crop.side, 0, 0, px, px);
    return c;
  }, [mirrored]);

  const centreCrop = useCallback(() => {
    const v = videoRef.current!;
    const side = Math.min(v.videoWidth, v.videoHeight);
    return { sx: Math.round((v.videoWidth - side) / 2), sy: Math.round((v.videoHeight - side) / 2), side };
  }, []);

  const finish = useCallback(async (photoCanvas: HTMLCanvasElement, tiles: ImageData[], device: DeviceChecks | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const strip = document.createElement("canvas");
    strip.width = TILE * tiles.length;
    strip.height = TILE;
    const sctx = strip.getContext("2d")!;
    tiles.forEach((t, i) => sctx.putImageData(t, i * TILE, 0));
    const [photo, evidence] = await Promise.all([
      new Promise<Blob | null>((res) => photoCanvas.toBlob(res, "image/jpeg", 0.9)),
      new Promise<Blob | null>((res) => strip.toBlob(res, "image/png")),
    ]);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (!photo || !evidence) {
      doneRef.current = false;
      return;
    }
    feedback("press");
    onCaptured({ photo, photoUrl: URL.createObjectURL(photo), evidence, device });
  }, [onCaptured]);

  // live: the shutter
  const shoot = () => {
    const v = videoRef.current;
    if (!v?.videoWidth || !sessionRef.current) return;
    const crop = centreCrop();
    const tile = grab(crop, TILE);
    const photo = grab(crop, PHOTO_PX);
    if (!tile || !photo) return;
    const data = tile.getContext("2d")!.getImageData(0, 0, TILE, TILE);
    const stats = frameStats(toGray(data));
    if (serverWouldRefuse(stats)) {
      setHint(stats.mean < 60 ? "It's too dark. Face a window or a light." : stats.mean > 200 ? "Too bright: step out of direct light." : "We couldn't make out your face. Try again.");
      feedback("error");
      return;
    }
    void finish(photo, [data], null);
  };

  // guided: the face model, the guidance and the challenge
  useEffect(() => {
    if (method !== "guided" || (status !== "loading_model" && status !== "running")) return;
    let alive = true;
    let raf = 0;
    const slow = window.setTimeout(() => alive && setSlowModel(true), MODEL_PATIENCE_MS);
    (async () => {
      let lm: Awaited<ReturnType<typeof import("@/lib/headshots/face-model").loadFaceLandmarker>>;
      let blinkScores: typeof import("@/lib/headshots/face-model").blinkScores;
      try {
        const mod = await import("@/lib/headshots/face-model");
        lm = await mod.loadFaceLandmarker();
        blinkScores = mod.blinkScores;
      } catch {
        if (alive) setSlowModel(true);
        return;
      }
      if (!alive) return;
      window.clearTimeout(slow);
      setSlowModel(false);
      setStatus("running");

      type Phase2 = "align" | "challenge" | "final";
      let phase: Phase2 = "align";
      let readySince = 0;
      let lastDetect = 0;
      let openBase: number | null = null;
      const openSamples: number[] = [];
      let step: StepState | null = null;
      let idx = 0;
      const stepTiles: (ImageData | null)[] = [];
      const stepMeta: (TileMeta | null)[] = [];
      const stepsOut: DeviceChecks["steps"] = [];
      const started = performance.now();
      let lastCentre: { x: number; y: number } | null = null;

      const loop = () => {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        const v = videoRef.current;
        const s = sessionRef.current;
        if (!v || !v.videoWidth || v.readyState < 2 || document.hidden) return;
        const now = performance.now();
        if (now - lastDetect < DETECT_EVERY_MS) return;
        lastDetect = now;
        let r;
        try {
          r = lm.lm.detectForVideo(v, now);
        } catch {
          return;
        }
        const faces = r.faceLandmarks?.length ?? 0;
        const pts = faces ? r.faceLandmarks[0]! : null;
        const m: FaceMetrics | null = pts ? faceMetrics(pts, v.videoWidth, v.videoHeight) : null;
        let stats: { mean: number; std: number; sharpness: number } | null = null;
        let eyeShade: number | null = null;
        let tileData: ImageData | null = null;
        let meta: TileMeta | null = null;
        let crop: { sx: number; sy: number; side: number } | null = null;
        if (m && pts) {
          crop = faceCrop(m, v.videoWidth, v.videoHeight);
          const t = grab(crop, TILE);
          if (t) {
            tileData = t.getContext("2d")!.getImageData(0, 0, TILE, TILE);
            const g = toGray(tileData);
            stats = frameStats(g);
            meta = eyeBandIn(pts, crop, v.videoHeight);
            eyeShade = shade(g, meta);
          }
        }
        const g = guidance({ faces, metrics: m, stats, eyeShade });
        const blink = faces ? blinkScores(r as any, 0) : null;
        // a steady head: the face's centre hasn't jumped since the last reading
        const steady = !!m && (!lastCentre || Math.hypot(m.cx - lastCentre.x, m.cy - lastCentre.y) < 0.02);
        if (m) lastCentre = { x: m.cx, y: m.cy };

        if (!s) {
          setHint("Getting ready…");
          return;
        }
        if (phase === "align") {
          setStepIdx(-1);
          if (g.ready && m) {
            openSamples.push(m.eyeOpen);
            if (!readySince) readySince = now;
            setReady(true);
            setHint("That's it. Hold still");
            if (now - readySince >= ALIGN_MS && openSamples.length >= 3) {
              openBase = openSamples.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, openSamples.length);
              if (s.challenge.length) {
                phase = "challenge";
                idx = 0;
                step = { step: s.challenge[0]!, startedAt: now, peak: 0, captured: false, done: false };
                setStepIdx(0);
                feedback("tap");
              } else {
                phase = "final";
              }
              readySince = 0;
            }
          } else {
            readySince = 0;
            openSamples.length = 0;
            setReady(false);
            setHint(g.hint);
          }
          return;
        }
        if (phase === "challenge" && step) {
          if (faces !== 1 || !m || !tileData || !meta) {
            setHint(faces > 1 ? "Only you in the frame, please" : "Keep your face in the oval");
            return;
          }
          const closure = blink ? Math.min(blink.left, blink.right) : openBase ? Math.max(0, 1 - m.eyeOpen / openBase) : 0;
          const closed = eyesClosed(blink, m.eyeOpen, openBase);
          const res = advanceStep(step, { yaw: m.yaw, closed, closure });
          step = res.state;
          if (res.keepFrame) {
            stepTiles[idx] = tileData;
            stepMeta[idx] = meta;
          }
          setHint(step.captured && !step.done ? (step.step === "blink" ? "Now open your eyes" : "Now face the camera again") : CHALLENGE_WORDS[step.step]);
          if (step.done) {
            stepsOut.push({ step: step.step, ms: Math.round(now - step.startedAt), peak: Math.round(step.peak * 100) / 100 });
            feedback("tap");
            idx += 1;
            if (idx < s.challenge.length) {
              step = { step: s.challenge[idx]!, startedAt: now, peak: 0, captured: false, done: false };
              setStepIdx(idx);
            } else {
              phase = "final";
              step = null;
              setStepIdx(s.challenge.length);
            }
          }
          return;
        }
        if (phase === "final") {
          if (g.ready && steady && m && pts && crop && tileData && meta) {
            if (!readySince) readySince = now;
            const p = Math.min(1, (now - readySince) / HOLD_MS);
            setProgress(p);
            setReady(true);
            setHint("Hold still");
            if (p >= 1) {
              const photo = grab(crop, PHOTO_PX);
              if (!photo) return;
              alive = false;
              cancelAnimationFrame(raf);
              const device: DeviceChecks = {
                model: "face_landmarker",
                delegate: lm.delegate,
                steps: stepsOut,
                final: {
                  faces,
                  faceShare: Math.round(m.share * 1000) / 1000,
                  yaw: Math.round(m.yaw * 10) / 10,
                  pitch: approxPitch(m.noseRatio),
                  roll: Math.round(m.roll * 10) / 10,
                  brightness: Math.round(stats?.mean ?? 0),
                  sharpness: Math.round(stats?.sharpness ?? 0),
                },
                tiles: [meta, ...stepMeta.map((x) => x ?? {})],
                durationMs: Math.round(now - started),
              };
              const tiles = [tileData, ...s.challenge.map((_, i) => stepTiles[i] ?? tileData!)];
              void finish(photo, tiles, device);
            }
          } else {
            readySince = 0;
            setProgress(0);
            setReady(false);
            setHint(g.ready ? "Hold still" : g.hint);
          }
        }
      };
      raf = requestAnimationFrame(loop);
    })();
    return () => {
      alive = false;
      window.clearTimeout(slow);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, status === "loading_model" || status === "running"]);

  const blocked = status === "denied" || status === "no_camera" || status === "error";
  return (
    <div className="relative flex flex-1 flex-col" data-headshot-camera data-headshot-method={method}>
      <div className="relative mx-auto w-full max-w-[520px] flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline autoPlay className={cn("absolute inset-0 h-full w-full object-cover", mirrored && "-scale-x-100")} />
        {/* the oval: everything outside it dimmed */}
        {!blocked && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <defs>
              <mask id="headshot-oval">
                <rect width="100" height="133" fill="white" />
                <ellipse cx="50" cy="62" rx="31" ry="40" fill="black" />
              </mask>
            </defs>
            <rect width="100" height="133" fill="rgba(0,0,0,0.55)" mask="url(#headshot-oval)" />
            <ellipse
              cx="50"
              cy="62"
              rx="31"
              ry="40"
              fill="none"
              strokeWidth="0.9"
              className={cn("transition-colors duration-200", ready ? "stroke-emerald-400" : "stroke-white/80")}
            />
            {progress > 0 && (
              <ellipse cx="50" cy="62" rx="31" ry="40" fill="none" strokeWidth="1.6" className="stroke-emerald-400" pathLength={100} strokeDasharray={`${progress * 100} 100`} />
            )}
          </svg>
        )}
        {/* the challenge's steps */}
        {method === "guided" && challenge.length > 0 && !blocked && (
          <div className="absolute inset-x-0 top-3 flex justify-center gap-1.5" aria-hidden data-headshot-steps>
            {[...challenge, "photo" as const].map((st, i) => (
              <span key={i} className={cn("h-1.5 w-8 rounded-full transition-colors", i < stepIdx || (st === "photo" && progress >= 1) ? "bg-emerald-400" : i === stepIdx ? "bg-white" : "bg-white/30")} />
            ))}
          </div>
        )}
        {blocked && (
          <CameraBlocked status={status} onRetry={() => setTries((t) => t + 1)} onAskCoach={onAskCoach} onClose={onClose} />
        )}
      </div>

      {!blocked && (
        <div className="flex flex-col items-center gap-3 px-6 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
          <p className="min-h-[2.75rem] text-center text-[18px] font-semibold" aria-live="polite" data-headshot-hint>
            {sessionErr ?? (status === "starting" ? "Getting the camera ready…" : status === "loading_model" && method === "guided" ? "Getting the camera checks ready…" : method === "live" ? (hint.startsWith("Getting") ? "Face the camera, then take the photo" : hint) : hint)}
          </p>
          {method === "guided" && status === "loading_model" && !slowModel && <Loader2 className="h-5 w-5 animate-spin text-white/60" aria-hidden />}
          {method === "guided" && slowModel && (
            <button type="button" onClick={onSwitchToLive} className="h-11 rounded-full bg-white/10 px-5 text-[14px] font-semibold active:bg-white/20" data-headshot-fallback>
              Continue without the automatic checks
            </button>
          )}
          {method === "live" && (
            <div className="flex items-center gap-8">
              {mode === "coach" ? (
                <button type="button" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 active:bg-white/20" aria-label="Switch camera">
                  <SwitchCamera className="h-5 w-5" />
                </button>
              ) : <span className="h-12 w-12" />}
              <button
                type="button"
                onClick={shoot}
                disabled={status !== "running" || !sessionRef.current}
                className="grid h-[72px] w-[72px] place-items-center rounded-full border-4 border-white/90 disabled:opacity-40"
                aria-label="Take photo"
                data-headshot-shutter
              >
                <span className="h-[56px] w-[56px] rounded-full bg-white active:scale-95" />
              </button>
              <span className="h-12 w-12" />
            </div>
          )}
          {method === "guided" && <p className="text-center text-[12px] text-white/50">The photo takes itself once you're centred and still.</p>}
        </div>
      )}
    </div>
  );
}

function CameraBlocked({ status, onRetry, onAskCoach, onClose }: { status: CamStatus; onRetry: () => void; onAskCoach?: () => void; onClose: () => void }) {
  const denied = status === "denied";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-8 text-center" data-headshot-blocked={status}>
      <Camera className="h-8 w-8 text-white/60" />
      <h3 className="text-[18px] font-semibold">{denied ? "Camera access is off" : status === "no_camera" ? "No camera here" : "The camera didn't open"}</h3>
      <p className="max-w-xs text-[14px] text-white/70">
        {denied
          ? "Allow camera access for JF Effect in your phone's settings (or your browser's site settings), then try again."
          : status === "no_camera"
            ? "The headshot is taken live, so it needs a camera. Try on your phone."
            : "Close other apps using the camera, then try again."}
      </p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
        <Button className="h-11 rounded-full" variant="secondary" onClick={onRetry} data-headshot-camera-retry>Try again</Button>
        {onAskCoach && <button type="button" onClick={onAskCoach} className="h-11 text-[14px] font-semibold text-white/80">Ask my coach to take it with me</button>}
        <button type="button" onClick={onClose} className="h-11 text-[14px] text-white/60">Not now</button>
      </div>
    </div>
  );
}

/* ---- pixels -------------------------------------------------------------- */

function toGray(d: ImageData): Uint8Array {
  const n = d.width * d.height;
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = Math.round(0.299 * d.data[i * 4]! + 0.587 * d.data[i * 4 + 1]! + 0.114 * d.data[i * 4 + 2]!);
  return g;
}

/** Eye band brightness against the band just under it (sunglasses read very dark). */
function shade(g: Uint8Array, meta: TileMeta): number | null {
  const band = (top: number, bottom: number) => {
    const y0 = Math.max(0, Math.floor(TILE * top));
    const y1 = Math.min(TILE, Math.ceil(TILE * bottom));
    const x0 = Math.round(TILE * 0.25);
    const x1 = TILE - x0;
    let s = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      s += g[y * TILE + x]!;
      n++;
    }
    return n ? s / n : 0;
  };
  if (meta.eyeTop == null || meta.eyeBottom == null) return null;
  const eye = band(meta.eyeTop, meta.eyeBottom);
  const h = meta.eyeBottom - meta.eyeTop;
  const cheek = band(meta.eyeBottom + h * 0.4, meta.eyeBottom + h * 1.4);
  return cheek > 0 ? eye / cheek : null;
}

