import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClientLiftVideo } from "@/lib/lift-videos.functions";
import { initMediaUpload, finalizeMediaUpload, createSubmission } from "@/lib/drive.functions";
import { uploadLiftClipToDrive } from "@/lib/lift-video-drive-upload";
import { friendlyDriveError } from "@/lib/drive-errors";
import { createLiftVideo } from "@/lib/lift-videos";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2, Video as VideoIcon, Send, X, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";

type Clip = {
  id: string;
  kind: "file" | "link";
  file?: File;
  url?: string;
  previewUrl?: string;
  note: string;
};

type Props = {
  clientId: string;
  clientName?: string | null;
  userId: string | null;
  onSaved?: () => void;
};

export function ClientLiftVideoUploader({ clientId, clientName, userId, onSaved }: Props) {
  const initFn = useServerFn(initMediaUpload);
  const finalizeFn = useServerFn(finalizeMediaUpload);
  const createSubFn = useServerFn(createSubmission);
  const createClientLiftVideoFn = useServerFn(createClientLiftVideo);

  const [clips, setClips] = useState<Clip[]>([]);
  const [batchNote, setBatchNote] = useState("");
  const [pasteLink, setPasteLink] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentText, setUrgentText] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<{ stage?: string; message: string } | null>(null);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);

  const multiUploadRef = useRef<HTMLInputElement | null>(null);
  const multiRecordRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setClips([]);
    setBatchNote("");
    setPasteLink("");
    setShowLinkInput(false);
    setIsUrgent(false);
    setUrgentText("");
    setSaving(false);
    setSent(false);
    setSendError(null);
    setPreviewClip(null);
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: Clip[] = [];
    for (const f of Array.from(files)) {
      next.push({
        id: crypto.randomUUID(),
        kind: "file",
        file: f,
        previewUrl: URL.createObjectURL(f),
        note: "",
      });
    }
    setClips((c) => [...c, ...next]);
  };

  const addLinks = (raw: string) => {
    const parts = raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    if (parts.length === 0) return toast.error("Paste a valid http(s) link.");
    const next: Clip[] = parts.map((url) => ({
      id: crypto.randomUUID(),
      kind: "link",
      url,
      note: "",
    }));
    setClips((c) => [...c, ...next]);
    setPasteLink("");
  };

  const removeClip = (id: string) => {
    setClips((c) => {
      const x = c.find((k) => k.id === id);
      if (x?.previewUrl) URL.revokeObjectURL(x.previewUrl);
      return c.filter((k) => k.id !== id);
    });
  };

  const handleSend = async () => {
    if (clips.length === 0) return toast.error("Add at least one video.");

    setSaving(true);
    setSendError(null);
    try {
      const batchId = crypto.randomUUID();
      const total = clips.length;
      const sharedNote = batchNote.trim();
      const urgentNote = isUrgent ? urgentText.trim() : "";
      let driveSubmissionId: string | null = null;

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        let videoUrl: string | null = null;
        let storagePath: string | null = null;
        let source: "link" | "upload" = "link";

        if (clip.kind === "file" && clip.file) {
          const perClipNote = sharedNote || null;
          try {
            const res = await uploadLiftClipToDrive({
              clientId, clientName, file: clip.file,
              index: i + 1, total,
              batchNote: sharedNote || null,
              perClipNote,
              urgent: isUrgent,
              painNote: isUrgent ? urgentNote || null : null,
              submissionId: driveSubmissionId,
              initFn, finalizeFn, createSubFn,
            });
            driveSubmissionId = res.submissionId;
            videoUrl = res.driveUrl ?? res.url;
            storagePath = null;
            (clip as any).driveMeta = res;
          } catch (driveError) {
            console.warn("Drive upload failed; lift video was not saved without Drive metadata", driveError);
            throw driveError;
          }
          source = "upload";
        } else if (clip.kind === "link" && clip.url) {
          videoUrl = clip.url;
          source = "link";
        }

        const combinedQuestion = [isUrgent && urgentNote ? `⚠️ Pain / discomfort / urgent: ${urgentNote}` : ""]
          .filter(Boolean)
          .join("\n");

        const driveMeta = (clip as any).driveMeta;
        const liftVideoPayload = {
          client_id: clientId,
          exercise: "",
          tag: isUrgent ? "Pain / Discomfort" : "Normal Review",
          is_urgent: isUrgent,
          client_notes: sharedNote || null,
          question_for_coach: combinedQuestion || null,
          video_url: videoUrl,
          video_storage_path: storagePath,
          video_source: source,
          thumbnail_url: driveMeta?.thumbnailUrl ?? null,
          original_drive_file_id: driveMeta?.driveFileId ?? null,
          original_drive_url: driveMeta?.driveUrl ?? null,
          drive_embed_url: driveMeta?.driveEmbedUrl ?? null,
          preview_url: null,
          preview_status: driveMeta ? "not_generated" : (storagePath ? "ready" : "not_generated"),
          file_type: driveMeta?.mimeType ?? clip.file?.type ?? null,
          file_size_bytes: driveMeta?.sizeBytes ?? clip.file?.size ?? null,
          upload_status: driveMeta ? "Drive uploaded" : (storagePath ? "App storage fallback" : "Submitted"),
          status: "New Upload" as const,
          batch_id: batchId,
          batch_note: sharedNote || null,
          batch_size: total,
          batch_index: i + 1,
        };

        try {
          await createClientLiftVideoFn({ data: liftVideoPayload });
        } catch (saveError) {
          console.warn("Server lift video save failed; falling back to client insert", saveError);
          if (!userId) throw saveError;
          await createLiftVideo({ ...liftVideoPayload, uploaded_by: userId } as any);
        }
      }

      setSent(true);
      onSaved?.();
    } catch (e: any) {
      console.error(e);
      const stage = (e as any)?.stage as string | undefined;
      const rawMsg = (e?.message ?? String(e ?? "Unknown error")).replace(/^\[[^\]]+\]\s*/, "");
      setSendError({ stage, message: rawMsg });
      toast.error(friendlyDriveError(e, "client"));
    } finally {
      setSaving(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <div className="text-base font-semibold">Sent to Coach Jared</div>
        <div className="text-sm text-muted-foreground">
          You'll see feedback here once it's reviewed.
        </div>
        <Button className="mt-2" onClick={reset}>Send another video</Button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
        {/* Upload options */}
        <div className="space-y-2.5">
          <input
            ref={multiUploadRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-m4v,video/*"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); if (multiUploadRef.current) multiUploadRef.current.value = ""; }}
          />
          <input
            ref={multiRecordRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); if (multiRecordRef.current) multiRecordRef.current.value = ""; }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-auto flex-col gap-1.5 py-5 rounded-xl" onClick={() => multiUploadRef.current?.click()}>
              <Upload className="h-5 w-5" />
              <span className="text-sm font-semibold">Upload from phone</span>
            </Button>
            <Button type="button" variant="outline" className="h-auto flex-col gap-1.5 py-5 rounded-xl" onClick={() => multiRecordRef.current?.click()}>
              <VideoIcon className="h-5 w-5" />
              <span className="text-sm font-semibold">Record now</span>
            </Button>
          </div>

          {!showLinkInput ? (
            <div className="text-center">
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setShowLinkInput(true)}
              >
                Use a video link instead
              </button>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Input
                autoFocus
                placeholder="Paste Drive / YouTube link"
                value={pasteLink}
                onChange={(e) => setPasteLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLinks(pasteLink); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => addLinks(pasteLink)} disabled={!pasteLink.trim()}>
                Add
              </Button>
            </div>
          )}
        </div>

        {/* Selected clips */}
        {clips.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              {clips.length} video{clips.length === 1 ? "" : "s"} attached
            </div>
            <div className="space-y-1.5">
              {clips.map((clip, idx) => (
                <div key={clip.id} className="rounded-xl border border-border bg-card/50 p-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => { if (clip.kind === "file" && clip.previewUrl) setPreviewClip(clip); else if (clip.kind === "link" && clip.url) window.open(clip.url, "_blank", "noopener"); }}
                      className="group relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted hover:ring-2 hover:ring-primary/50 transition"
                      aria-label="Preview video"
                    >
                      {clip.kind === "file" && clip.previewUrl ? (
                        <>
                          <video
                            src={`${clip.previewUrl}#t=0.1`}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                            preload="auto"
                          />
                          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                            <VideoIcon className="h-5 w-5 text-white" />
                          </div>
                        </>
                      ) : (
                        <LinkIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (clip.kind === "file" && clip.previewUrl) setPreviewClip(clip); else if (clip.kind === "link" && clip.url) window.open(clip.url, "_blank", "noopener"); }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium hover:underline">
                        {clip.kind === "file" ? (clip.file?.name || `Video ${idx + 1}`) : (clip.url || "Link")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {clip.kind === "file"
                          ? `${((clip.file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB`
                          : "Tap to open link"}
                      </div>
                    </button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeClip(clip.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Note */}
        <div className="space-y-2">
          <Textarea
            rows={3}
            className="min-h-[88px] rounded-xl text-base resize-none"
            placeholder="Squat top set — 135 x 5 @ RPE 8."
            value={batchNote}
            onChange={(e) => setBatchNote(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Note optional · tell Coach Jared what to review.</span>
          </div>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              What to include
            </summary>
            <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-[11px] text-muted-foreground">
              <li>Lift</li>
              <li>Training day</li>
              <li>Set or load if you know it</li>
              <li>RPE / RIR if you know it</li>
              <li>Anything that felt off</li>
            </ul>
          </details>
        </div>

        {/* Urgent toggle */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">Needs coach attention?</div>
              <div className="text-xs text-muted-foreground">Pain, discomfort, or urgent.</div>
            </div>
            <Switch checked={isUrgent} onCheckedChange={setIsUrgent} />
          </div>
          {isUrgent && (
            <Textarea
              rows={2}
              className="rounded-xl text-sm"
              placeholder="What's going on? (e.g. left hip pinched during this set)"
              value={urgentText}
              onChange={(e) => setUrgentText(e.target.value)}
            />
          )}
        </div>

        {/* Error */}
        {sendError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-left">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-semibold text-destructive">
                  Upload failed{sendError.stage ? ` at "${sendError.stage}"` : ""}
                </div>
                <div className="break-words text-xs text-muted-foreground">
                  {sendError.message}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    navigator.clipboard?.writeText(`stage=${sendError.stage ?? "unknown"} :: ${sendError.message}`);
                    toast.success("Error details copied — send to Coach Jared.");
                  }}
                >
                  Copy details to send to Coach Jared
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Send button */}
        <Button
          onClick={handleSend}
          disabled={saving || clips.length === 0}
          className="h-12 w-full rounded-full bg-gradient-primary text-base font-bold"
        >
          {saving ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
          ) : (
            <><Send className="mr-2 h-4 w-4" /> {sendError ? "Retry send" : `Send ${clips.length > 1 ? "Videos" : "Video"}`}</>
          )}
        </Button>
      </div>

      {/* Preview dialog */}
      <Dialog open={!!previewClip} onOpenChange={(o) => { if (!o) setPreviewClip(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {previewClip?.file?.name || "Video preview"}
            </DialogTitle>
          </DialogHeader>
          {previewClip?.previewUrl && (
            <video
              src={previewClip.previewUrl}
              className="w-full rounded-lg bg-black"
              controls
              autoPlay
              playsInline
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
