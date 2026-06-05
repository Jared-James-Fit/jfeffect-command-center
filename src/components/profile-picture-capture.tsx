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
    <div className="space-y-4">
      {/* Title & instructions */}
      {isClient && !currentUrl && !preview && !streaming && (
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground">Add Your Profile Picture</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use good lighting. Face the camera. Make sure your face is visible.
          </p>
        </div>
      )}

      {/* Small status avatar (only when NOT actively capturing) */}
      {!hidePreviewThumbnail && !streaming && !preview && (
        <div className="flex justify-center">
          <div className="h-20 w-20 overflow-hidden rounded-full border border-border bg-secondary/40">
            {signedUrl ? (
              <img src={signedUrl} alt="Current" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No photo</div>
            )}
          </div>
        </div>
      )}

      {/* Live camera preview — large & centered */}
      {streaming && (
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border-2 border-border bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="aspect-square w-full object-cover"
          />
        </div>
      )}

      {/* Captured photo preview */}
      {preview && (
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border-2 border-border bg-black">
          <img src={preview} alt="Captured" className="aspect-square w-full object-cover" />
        </div>
      )}

      {/* Action buttons — centered below preview */}
      <div className="flex flex-col items-center gap-3 pb-2">
        {!streaming && !preview && (
          <Button
            type="button"
            size="lg"
            className="w-full max-w-sm"
            onClick={startCamera}
            disabled={opening}
          >
            {opening ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Camera className="mr-2 h-5 w-5" />
            )}
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
            <Button
              type="button"
              variant="outline"
              className="w-full max-w-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload file
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />
          </>
        )}

        {streaming && (
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Button type="button" size="lg" onClick={capture}>
              <Camera className="mr-2 h-5 w-5" />
              Take Photo
            </Button>
            <Button type="button" variant="outline" onClick={stopCamera}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </div>
        )}

        {preview && (
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Button type="button" size="lg" onClick={upload} disabled={busy}>
              {busy ? "Uploading…" : isClient ? "Save Profile Picture" : "Save photo"}
            </Button>
            <Button type="button" variant="outline" onClick={retake}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retake
            </Button>
          </div>
        )}
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

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}