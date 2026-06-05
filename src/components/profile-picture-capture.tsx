import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw, Upload, X, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  userId: string;
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  allowFileUpload?: boolean;
  /** "client" enforces camera-only capture, no delete, friendlier instructions. */
  mode?: "client" | "admin";
  /** Hides the inline preview slot — useful when the parent already shows the avatar. */
  hidePreviewThumbnail?: boolean;
  /** Override the source string saved alongside the picture. */
  source?: string;
  /** Called after successful upload with metadata. */
  onMeta?: (meta: { source: string; takenAt: string }) => void;
}

export function ProfilePictureCapture({
  userId,
  currentUrl,
  onUploaded,
  allowFileUpload = false,
  mode = "admin",
  hidePreviewThumbnail = false,
  source,
  onMeta,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const isClient = mode === "client";
  const effectiveAllowFileUpload = isClient ? false : allowFileUpload;

  useEffect(() => {
    let cancelled = false;
    if (!currentUrl) { setSignedUrl(null); return; }
    (async () => {
      const { data } = await supabase.storage.from("avatars").createSignedUrl(currentUrl, 60 * 60);
      if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [currentUrl]);

  useEffect(() => {
    if (streaming && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [streaming]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const triggerFallback = () => cameraInputRef.current?.click();

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      triggerFallback();
      return;
    }
    setOpening(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setStreaming(true);
    } catch (e: any) {
      const name = e?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCameraError("Camera access is blocked. Please allow camera access in your browser settings and try again.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        triggerFallback();
      } else if (name === "NotReadableError") {
        setCameraError("Camera is in use by another app. Close it and try again.");
        triggerFallback();
      } else {
        setCameraError("Camera could not open. Try again or contact Coach Jared.");
        triggerFallback();
      }
    } finally {
      setOpening(false);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  };

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, size, size);
    setPreview(canvas.toDataURL("image/jpeg", 0.9));
    stopCamera();
  };

  const retake = () => { setPreview(null); startCamera(); };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const upload = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const blob = await (await fetch(preview)).blob();
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      onUploaded(path);
      onMeta?.({ source: source ?? (isClient ? "camera" : "upload"), takenAt: new Date().toISOString() });
      toast.success("Profile picture updated");
      setPreview(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {isClient && !currentUrl && !preview && !streaming && (
        <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 text-sm font-semibold text-foreground">Add Your Profile Picture</div>
          Take a clear headshot so Coach Jared can easily identify your profile.
          Use good lighting. Face the camera. Make sure your face is visible.
          This should be quick — it only takes a few seconds.
        </div>
      )}
      <div className="flex items-start gap-4">
        {!hidePreviewThumbnail && (
          <div className="h-24 w-24 overflow-hidden rounded-full border border-border bg-secondary/40">
            {preview ? (
              <img src={preview} alt="Preview" className="h-full w-full object-cover" />
            ) : signedUrl ? (
              <img src={signedUrl} alt="Current" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No photo</div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!streaming && !preview && (
            <Button type="button" size="sm" onClick={startCamera} disabled={opening}>
              {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              {opening ? "Opening camera…" : isClient ? (currentUrl ? "Take New Profile Picture" : "Take Profile Picture") : "Take photo"}
            </Button>
          )}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={onFileChosen}
          />
          {effectiveAllowFileUpload && !streaming && !preview && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Upload file</Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />
            </>
          )}
          {streaming && (
            <>
              <Button type="button" size="sm" onClick={capture}>Take Photo</Button>
              <Button type="button" size="sm" variant="outline" onClick={stopCamera}><X className="mr-2 h-4 w-4" />Cancel</Button>
            </>
          )}
          {preview && (
            <>
              <Button type="button" size="sm" onClick={upload} disabled={busy}>{busy ? "Uploading…" : isClient ? "Save Profile Picture" : "Save photo"}</Button>
              <Button type="button" size="sm" variant="outline" onClick={retake}><RefreshCw className="mr-2 h-4 w-4" />Retake</Button>
            </>
          )}
        </div>
      </div>
      {cameraError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <div>{cameraError}</div>
            <Button type="button" size="sm" variant="outline" onClick={triggerFallback}>
              Use device camera instead
            </Button>
          </div>
        </div>
      )}
      {streaming && (
        <div className="overflow-hidden rounded-md border border-border bg-black">
          <video ref={videoRef} playsInline muted autoPlay className="aspect-square w-full max-w-xs object-cover" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}