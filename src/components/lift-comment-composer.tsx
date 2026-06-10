import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Paperclip, Camera, Image as ImageIcon, File as FileIcon,
  Mic, Send, Loader2, X, Square, Play, Pause,
} from "lucide-react";
import { GifPicker } from "@/components/gif-picker";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LiftCommentAttachment } from "@/lib/lift-videos";

type Props = {
  clientId: string;
  placeholder?: string;
  disabled?: boolean;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  onSend: (body: string, attachments: LiftCommentAttachment[]) => Promise<void>;
};

function fileType(f: File): LiftCommentAttachment["type"] {
  const m = f.type.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  return "file";
}

async function uploadToBucket(clientId: string, file: File): Promise<LiftCommentAttachment> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const path = `${clientId}/lift/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? "." + ext : ""}`;
  const { error } = await supabase.storage
    .from("message-attachments")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return {
    type: fileType(file),
    storage_path: path,
    name: file.name,
    size: file.size,
    mime: file.type,
  };
}

export function LiftCommentComposer({
  clientId, placeholder, disabled, trailing, leading, onSend,
}: Props) {
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<LiftCommentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Voice recorder (simple — no waveform)
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [voicePreview, setVoicePreview] = useState<{
    blob: Blob; url: string; duration: number;
  } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const pickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const out: LiftCommentAttachment[] = [];
      for (const f of Array.from(files)) {
        out.push(await uploadToBucket(clientId, f));
      }
      setAttachments((p) => [...p, ...out]);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const startRecord = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Recording not supported on this device.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      mediaRef.current = mr;
      startedAtRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      tickRef.current = window.setInterval(
        () => setElapsed((Date.now() - startedAtRef.current) / 1000), 200,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start recording");
    }
  };

  const stopRecord = async () => {
    const mr = mediaRef.current;
    if (!mr) return;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const duration = (Date.now() - startedAtRef.current) / 1000;
    const done = new Promise<Blob>((resolve) => {
      mr.onstop = () => resolve(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }));
    });
    mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    setRecording(false);
    const blob = await done;
    const url = URL.createObjectURL(blob);
    setVoicePreview({ blob, url, duration });
  };

  const cancelVoice = () => {
    if (voicePreview?.url) URL.revokeObjectURL(voicePreview.url);
    setVoicePreview(null);
    setPreviewPlaying(false);
  };

  const togglePreviewPlay = () => {
    const a = previewAudioRef.current; if (!a) return;
    if (a.paused) { a.play(); setPreviewPlaying(true); }
    else { a.pause(); setPreviewPlaying(false); }
  };

  const handleSend = async () => {
    if (sending) return;
    let finalAttachments = [...attachments];
    // Upload voice if any
    if (voicePreview) {
      try {
        setUploading(true);
        const ext = voicePreview.blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([voicePreview.blob], `voice-${Date.now()}.${ext}`, { type: voicePreview.blob.type });
        const att = await uploadToBucket(clientId, file);
        finalAttachments.push({ ...att, type: "audio", kind: "voice", duration: voicePreview.duration });
      } catch (e: any) {
        toast.error(e?.message ?? "Voice upload failed");
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }
    if (!body.trim() && finalAttachments.length === 0) return;
    setSending(true);
    try {
      await onSend(body.trim(), finalAttachments);
      setBody("");
      setAttachments([]);
      cancelVoice();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60); const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-2">
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" hidden multiple
        onChange={(e) => { void pickFiles(e.target.files); if (e.target) e.target.value = ""; }} />
      <input ref={photoInputRef} type="file" hidden multiple accept="image/*,video/*"
        onChange={(e) => { void pickFiles(e.target.files); if (e.target) e.target.value = ""; }} />
      <input ref={cameraInputRef} type="file" hidden accept="image/*" capture="environment"
        onChange={(e) => { void pickFiles(e.target.files); if (e.target) e.target.value = ""; }} />

      {/* Pending attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs">
              <span className="truncate max-w-[160px]">{a.name ?? a.type}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Voice preview */}
      {voicePreview && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-xs">
          <Button size="icon" variant="ghost" type="button" className="h-7 w-7" onClick={togglePreviewPlay}>
            {previewPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <audio
            ref={previewAudioRef}
            src={voicePreview.url}
            onEnded={() => setPreviewPlaying(false)}
            className="hidden"
          />
          <span className="font-mono">{fmtTime(voicePreview.duration)}</span>
          <span className="text-muted-foreground">Voice memo ready</span>
          <button type="button" onClick={cancelVoice} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Recording indicator */}
      {recording && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" />
          <span className="font-mono">{fmtTime(elapsed)}</span>
          <span className="text-destructive">Recording…</span>
          <Button size="sm" variant="destructive" type="button" className="ml-auto h-7" onClick={stopRecord}>
            <Square className="mr-1 h-3 w-3" /> Stop
          </Button>
        </div>
      )}

      {/* Composer row */}
      <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-background p-1.5">
        {/* Attachment menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full"
              disabled={uploading || disabled || recording}>
              <Paperclip className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs">Attach</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" /> Take photo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => photoInputRef.current?.click()}>
              <ImageIcon className="mr-2 h-4 w-4" /> Photo or video
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileIcon className="mr-2 h-4 w-4" /> File / document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* GIF picker */}
        <GifPicker
          disabled={sending || uploading || disabled || recording}
          onPick={(g) => {
            setAttachments((p) => [...p, {
              type: g.media_type.startsWith("video") ? "video" : "image",
              url: g.media_url,
              name: g.title,
              mime: g.media_type,
              kind: "gif",
            }]);
          }}
        />

        {/* Voice */}
        <Button
          type="button"
          variant={recording ? "destructive" : "ghost"}
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          disabled={uploading || disabled}
          onClick={recording ? stopRecord : startRecord}
          title={recording ? "Stop recording" : "Record voice memo"}
        >
          {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        {leading}

        <Textarea
          rows={1}
          placeholder={placeholder ?? "Write a reply…"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          className="min-h-[36px] max-h-32 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
          disabled={disabled || recording}
        />

        {trailing}

        <Button
          type="button"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          onClick={handleSend}
          disabled={sending || uploading || disabled || (!body.trim() && attachments.length === 0 && !voicePreview)}
        >
          {sending || uploading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}