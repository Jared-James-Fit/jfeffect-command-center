import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  userId: string;
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  allowFileUpload?: boolean;
}

export function ProfilePictureCapture({ userId, currentUrl, onUploaded, allowFileUpload = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentUrl) { setSignedUrl(null); return; }
    (async () => {
      const { data } = await supabase.storage.from("avatars").createSignedUrl(currentUrl, 60 * 60);
      if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [currentUrl]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 640 }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Camera unavailable");
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
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
      <div className="flex items-start gap-4">
        <div className="h-24 w-24 overflow-hidden rounded-full border border-border bg-secondary/40">
          {preview ? (
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : signedUrl ? (
            <img src={signedUrl} alt="Current" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No photo</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!streaming && !preview && (
            <Button type="button" size="sm" onClick={startCamera}><Camera className="mr-2 h-4 w-4" />Take photo</Button>
          )}
          {allowFileUpload && !streaming && !preview && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Upload file</Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />
            </>
          )}
          {streaming && (
            <>
              <Button type="button" size="sm" onClick={capture}>Capture</Button>
              <Button type="button" size="sm" variant="outline" onClick={stopCamera}><X className="mr-2 h-4 w-4" />Cancel</Button>
            </>
          )}
          {preview && (
            <>
              <Button type="button" size="sm" onClick={upload} disabled={busy}>{busy ? "Uploading…" : "Save photo"}</Button>
              <Button type="button" size="sm" variant="outline" onClick={retake}><RefreshCw className="mr-2 h-4 w-4" />Retake</Button>
            </>
          )}
        </div>
      </div>
      {streaming && (
        <div className="overflow-hidden rounded-md border border-border bg-black">
          <video ref={videoRef} playsInline muted className="aspect-square w-full max-w-xs object-cover" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}