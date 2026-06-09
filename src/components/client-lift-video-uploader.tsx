import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClientLiftVideo } from "@/lib/lift-videos.functions";
import { initMediaUpload, finalizeMediaUpload, createSubmission } from "@/lib/drive.functions";
import { updateClientLiftVideoUpload } from "@/lib/lift-videos.functions";
import { enqueueLiftUpload } from "@/lib/lift-upload-queue";
import { friendlyDriveError } from "@/lib/drive-errors";
import { createLiftVideo } from "@/lib/lift-videos";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2, Video as VideoIcon, Send, X, AlertTriangle, CheckCircle2, ChevronDown, MessageSquare, Play, Film } from "lucide-react";
import { useLiftUploadActiveCount } from "@/lib/lift-upload-queue";

type DiagSample = {
  pickerOpenedAt: number | null;
  pickerOpenedSource: "photos" | "record" | null;
  fileHandoffAt: number | null;
  detailsRenderedAt: number | null;
  handoffToDetailsMs: number | null;
  fileSizes: number[];
  fileTypes: string[];
  clipCount: number;
  anyPreviewPending: boolean;
};

function useDiagnosticsEnabled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("diag") === "1") {
        localStorage.setItem("lift_upload_diag", "1");
      }
      if (url.searchParams.get("diag") === "0") {
        localStorage.removeItem("lift_upload_diag");
      }
      setOn(localStorage.getItem("lift_upload_diag") === "1");
    } catch {
      setOn(false);
    }
  }, []);
  return on;
}

type Clip = {
  id: string;
  kind: "file" | "link";
  file?: File;
  url?: string;
  previewUrl?: string;
  previewStatus?: "pending" | "ready" | "failed";
  isImage?: boolean;
  note: string;
  duration?: number;
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
  const updateClientLiftVideoFn = useServerFn(updateClientLiftVideoUpload);

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showOverall, setShowOverall] = useState(false);

  const multiUploadRef = useRef<HTMLInputElement | null>(null);
  const multiRecordRef = useRef<HTMLInputElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const pickerOpenedAtRef = useRef<{ source: "photos" | "record"; at: number } | null>(null);
  const diagEnabled = useDiagnosticsEnabled();
  const [diag, setDiag] = useState<DiagSample>({
    pickerOpenedAt: null,
    pickerOpenedSource: null,
    fileHandoffAt: null,
    detailsRenderedAt: null,
    handoffToDetailsMs: null,
    fileSizes: [],
    fileTypes: [],
    clipCount: 0,
    anyPreviewPending: false,
  });
  const handoffStampRef = useRef<number | null>(null);
  // When clips count rises after a fresh handoff, mark details-rendered on
  // the very next paint to measure handoff -> details-render latency.
  useEffect(() => {
    if (handoffStampRef.current == null) return;
    const handoffAt = handoffStampRef.current;
    handoffStampRef.current = null;
    const raf = requestAnimationFrame(() => {
      const now = performance.now();
      setDiag((d) => ({
        ...d,
        detailsRenderedAt: now,
        handoffToDetailsMs: Math.round(now - handoffAt),
        clipCount: clips.length,
        anyPreviewPending: clips.some((c) => c.kind === "file" && c.previewStatus === "pending"),
      }));
    });
    return () => cancelAnimationFrame(raf);
  }, [clips]);

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
    setActiveId(null);
    setShowOverall(false);
  };

  const openPicker = (source: "photos" | "record") => {
    pickerOpenedAtRef.current = { source, at: performance.now() };
    if (diagEnabled) {
      setDiag((d) => ({
        ...d,
        pickerOpenedAt: pickerOpenedAtRef.current!.at,
        pickerOpenedSource: source,
        fileHandoffAt: null,
        detailsRenderedAt: null,
        handoffToDetailsMs: null,
      }));
    }
    if (source === "photos") multiUploadRef.current?.click();
    else multiRecordRef.current?.click();
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const handoff = pickerOpenedAtRef.current;
    if (handoff) {
      console.info("[lift-video-picker] Files reached the app after native picker handoff", {
        source: handoff.source,
        handoffMs: Math.round(performance.now() - handoff.at),
        fileCount: files.length,
        totalBytes: Array.from(files).reduce((sum, file) => sum + file.size, 0),
      });
      pickerOpenedAtRef.current = null;
    }
    const now = performance.now();
    handoffStampRef.current = now;
    if (diagEnabled) {
      const arr = Array.from(files);
      setDiag((d) => ({
        ...d,
        fileHandoffAt: now,
        fileSizes: arr.map((f) => f.size),
        fileTypes: arr.map((f) => f.type || "(unknown)"),
      }));
    }
    const next: Clip[] = [];
    for (const f of Array.from(files)) {
      // Basic guards only — never block on preview/metadata generation.
      if (!f || f.size === 0) {
        toast.error("That file looks empty. Try selecting it again.");
        continue;
      }
      const looksVideo = (f.type || "").startsWith("video/") || /\.(mov|mp4|m4v|hevc|avi|3gp)$/i.test(f.name || "");
      const looksImage = (f.type || "").startsWith("image/");
      if (!looksVideo && !looksImage) {
        toast.error(`Unsupported file: ${f.name || "selected item"}`);
        continue;
      }
      // createObjectURL is synchronous and effectively free — it does NOT
      // read or decode the file. This gives an instant visual preview
      // (image tag for photos, muted <video> for videos) without blocking
      // the file handoff or the Send button.
      let previewUrl: string | undefined;
      try {
        previewUrl = URL.createObjectURL(f);
      } catch {
        previewUrl = undefined;
      }
      next.push({
        id: crypto.randomUUID(),
        kind: "file",
        file: f,
        previewUrl,
        previewStatus: previewUrl ? "ready" : "pending",
        isImage: looksImage,
        note: "",
      });
    }
    if (next.length === 0) return;
    setClips((c) => [...c, ...next]);
    if (!activeId) setActiveId(next[0].id);
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
    setClips((c) => {
      const merged = [...c, ...next];
      if (!activeId && merged.length) setActiveId(next[0].id);
      return merged;
    });
    setPasteLink("");
    setShowLinkInput(false);
  };

  const removeClip = (id: string) => {
    setClips((c) => {
      const x = c.find((k) => k.id === id);
      if (x?.previewUrl) URL.revokeObjectURL(x.previewUrl);
      const next = c.filter((k) => k.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  // Revoke any outstanding object URLs on unmount to avoid leaks.
  const clipsRef = useRef<Clip[]>([]);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => {
    return () => {
      for (const c of clipsRef.current) {
        if (c.previewUrl) {
          try { URL.revokeObjectURL(c.previewUrl); } catch { /* noop */ }
        }
      }
    };
  }, []);

  const updateClipNote = (id: string, note: string) => {
    setClips((c) => c.map((k) => (k.id === id ? { ...k, note } : k)));
  };

  const activeClip = clips.find((c) => c.id === activeId) ?? clips[0] ?? null;

  useEffect(() => {
    if (clips.length && !clips.find((c) => c.id === activeId)) {
      setActiveId(clips[0].id);
    }
  }, [clips, activeId]);

  const handleSend = async () => {
    if (clips.length === 0) return toast.error("Add at least one video.");

    setSaving(true);
    setSendError(null);
    try {
      const batchId = crypto.randomUUID();
      const total = clips.length;
      const sharedNote = batchNote.trim();
      const urgentNote = isUrgent ? urgentText.trim() : "";
      const combinedQuestion = isUrgent && urgentNote
        ? `⚠️ Pain / discomfort / urgent: ${urgentNote}`
        : "";

      // 1) Create lift_videos rows immediately so the submission appears in
      //    the client list as "Uploading" before Drive does any work.
      const created: Array<{ row: any; clip: Clip; index: number }> = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipNote = clip.note.trim();
        const combinedNote = [clipNote, sharedNote].filter(Boolean).join("\n\n") || null;
        const isFile = clip.kind === "file" && !!clip.file;
        const payload: any = {
          client_id: clientId,
          exercise: "",
          tag: isUrgent ? "Pain / Discomfort" : "Normal Review",
          is_urgent: isUrgent,
          client_notes: combinedNote,
          question_for_coach: combinedQuestion || null,
          video_url: isFile ? null : (clip.url ?? null),
          video_storage_path: null,
          video_source: isFile ? "upload" : "link",
          thumbnail_url: null,
          preview_url: null,
          preview_status: "not_generated",
          file_type: clip.file?.type ?? null,
          file_size_bytes: clip.file?.size ?? null,
          upload_status: isFile ? "Uploading" : "Submitted",
          status: isFile ? "New Upload" : "New Upload",
          batch_id: batchId,
          batch_note: sharedNote || null,
          batch_size: total,
          batch_index: i + 1,
        };
        let row: any;
        try {
          row = await createClientLiftVideoFn({ data: payload });
        } catch (saveError) {
          console.warn("Server lift video save failed; falling back to client insert", saveError);
          if (!userId) throw saveError;
          row = await createLiftVideo({ ...payload, uploaded_by: userId } as any);
        }
        created.push({ row, clip, index: i + 1 });
      }

      // 2) Kick off background Drive uploads for file clips. The row already
      //    exists in the DB — the queue patches it with Drive metadata when
      //    each upload finishes (or marks it "Upload Failed" on error).
      for (const item of created) {
        if (item.clip.kind !== "file" || !item.clip.file) continue;
        const perClipNote = item.clip.note.trim() || sharedNote || null;
        enqueueLiftUpload({
          videoId: item.row.id,
          clientId,
          clientName,
          file: item.clip.file,
          index: item.index,
          total,
          batchNote: sharedNote || null,
          perClipNote,
          urgent: isUrgent,
          painNote: isUrgent ? urgentNote || null : null,
          submissionId: null,
          initFn, finalizeFn, createSubFn,
          updateFn: updateClientLiftVideoFn,
        });
      }

      const fileCount = created.filter((c) => c.clip.kind === "file").length;
      if (fileCount > 0) {
        toast.success(`Submission sent — uploading ${fileCount} clip${fileCount === 1 ? "" : "s"} in the background.`);
      } else {
        toast.success("Submission sent to Coach Jared.");
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
    const fileClipCount = clips.filter((c) => c.kind === "file").length;
    return <SentState fileClipCount={fileClipCount} onReset={reset} />;
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
        {/* Header */}
        <div className="space-y-0.5">
          <div className="text-base font-semibold">Send Lift Video</div>
          <div className="text-xs text-muted-foreground">Upload or record lifts for Coach Jared to review.</div>
        </div>

        {/* Hidden inputs */}
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

        {/* Compact action row */}
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" variant="outline" size="sm" className="h-10 rounded-xl gap-1.5" onClick={() => openPicker("photos")}>
            <Upload className="h-4 w-4" />
            <span className="text-xs font-medium">Photos</span>
          </Button>
          <Button type="button" variant="default" size="sm" className="h-10 rounded-xl gap-1.5" onClick={() => openPicker("record")}>
            <VideoIcon className="h-4 w-4" />
            <span className="text-xs font-medium">Record Now</span>
          </Button>
          <Button type="button" variant={showLinkInput ? "secondary" : "outline"} size="sm" className="h-10 rounded-xl gap-1.5" onClick={() => setShowLinkInput((v) => !v)}>
            <LinkIcon className="h-4 w-4" />
            <span className="text-xs font-medium">Paste Link</span>
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Record Now is usually fastest. Short clips send fastest. Videos stored in iCloud may take a moment to prepare before this screen opens.
        </div>

        {showLinkInput && (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Paste Drive / YouTube link"
              value={pasteLink}
              onChange={(e) => setPasteLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLinks(pasteLink); } }}
              className="h-10"
            />
            <Button type="button" size="sm" onClick={() => addLinks(pasteLink)} disabled={!pasteLink.trim()}>
              Add
            </Button>
          </div>
        )}

        {/* Media carousel or empty state */}
        {clips.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
            <Film className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <div className="mt-2 text-sm font-medium">No lift videos selected yet.</div>
            <div className="text-xs text-muted-foreground">Choose or record a clip to send.</div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                {clips.length} clip{clips.length === 1 ? "" : "s"} selected
                {clips.some((c) => c.kind === "file" && c.previewStatus === "pending") && (
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground/80">
                    · ready to send
                  </span>
                )}
              </div>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => { clips.forEach((c) => c.previewUrl && URL.revokeObjectURL(c.previewUrl)); setClips([]); setActiveId(null); }}
              >
                Clear all
              </button>
            </div>

            <div
              ref={carouselRef}
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x snap-mandatory scrollbar-none"
              style={{ scrollbarWidth: "none" }}
            >
              {clips.map((clip, idx) => {
                const isActive = clip.id === (activeClip?.id ?? "");
                const hasNote = clip.note.trim().length > 0;
                return (
                  <div
                    key={clip.id}
                    className={`group relative shrink-0 snap-start overflow-hidden rounded-xl border bg-muted transition ${isActive ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
                    style={{ width: 112, height: 148 }}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveId(clip.id)}
                      className="block h-full w-full text-left"
                      aria-label={`Select clip ${idx + 1}`}
                    >
                      {clip.kind === "file" && clip.previewUrl && clip.isImage ? (
                        <img
                          src={clip.previewUrl}
                          alt={clip.file?.name || `Clip ${idx + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          onError={() => {
                            setClips((cs) => cs.map((k) => k.id === clip.id ? { ...k, previewStatus: "failed" } : k));
                          }}
                        />
                      ) : clip.kind === "file" && clip.previewUrl ? (
                        <video
                          src={`${clip.previewUrl}#t=0.1`}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                          onError={() => {
                            setClips((cs) => cs.map((k) => k.id === clip.id ? { ...k, previewStatus: "failed" } : k));
                          }}
                        />
                      ) : clip.kind === "file" ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-muted to-muted/60 px-2 text-center">
                          <Film className="h-5 w-5 text-muted-foreground/70" />
                          <span className="text-[9px] font-medium text-muted-foreground">
                            {clip.previewStatus === "failed" ? "Preview unavailable" : "Preview loading…"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/60">
                          <LinkIcon className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                        <div className="flex items-center justify-between gap-1 text-[10px] font-medium text-white">
                          <span className="truncate">
                            {clip.kind === "file" ? (clip.file?.name || `Clip ${idx + 1}`) : "Link"}
                          </span>
                          {hasNote && <MessageSquare className="h-3 w-3 shrink-0" />}
                        </div>
                      </div>
                    </button>
                    {clip.kind === "file" && clip.previewUrl && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPreviewClip(clip); }}
                        className="absolute inset-0 m-auto grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100"
                        aria-label="Preview clip"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeClip(clip.id); }}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:bg-destructive"
                      aria-label="Remove clip"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {activeClip && (
              <div className="space-y-1.5">
                <Input
                  value={activeClip.note}
                  onChange={(e) => updateClipNote(activeClip.id, e.target.value)}
                  placeholder='Add note for this clip (optional) — e.g. "355 x 5, top set"'
                  className="h-10 rounded-xl text-sm"
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {clips.length > 1
                      ? `Note attached to clip ${clips.findIndex((c) => c.id === activeClip.id) + 1} of ${clips.length}`
                      : "Optional"}
                  </span>
                  {clips.length > 1 && (
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => setShowOverall((v) => !v)}
                    >
                      {showOverall ? "Hide overall note" : "+ Overall note"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {(showOverall || (clips.length === 1 && batchNote)) && clips.length > 1 && (
              <Textarea
                rows={2}
                value={batchNote}
                onChange={(e) => setBatchNote(e.target.value)}
                placeholder='Overall note (optional) — e.g. "Week 4 Day 2, please review squat & bench"'
                className="rounded-xl text-sm resize-none"
              />
            )}
          </div>
        )}

        {/* What to include - collapsible */}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            What to include
          </summary>
          <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-[11px] text-muted-foreground">
            <li>Lift name</li>
            <li>Top set / backoff</li>
            <li>Weight × reps</li>
            <li>What you want reviewed</li>
          </ul>
        </details>

        {/* Compact urgent flag */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Needs coach attention?</div>
            <div className="text-[11px] text-muted-foreground">Pain, discomfort, or urgent.</div>
          </div>
          <Switch checked={isUrgent} onCheckedChange={setIsUrgent} />
        </div>
        {isUrgent && (
          <Textarea
            rows={2}
            className="rounded-xl text-sm resize-none"
            placeholder="What's going on? (e.g. left hip pinched during this set)"
            value={urgentText}
            onChange={(e) => setUrgentText(e.target.value)}
          />
        )}

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

        {diagEnabled && (
          <details className="group rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px]">
            <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              Upload diagnostics (admin)
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              <span>Picker source</span><span className="text-foreground">{diag.pickerOpenedSource ?? "—"}</span>
              <span>Picker opened</span><span className="text-foreground">{diag.pickerOpenedAt != null ? `${Math.round(diag.pickerOpenedAt)}ms` : "—"}</span>
              <span>File handoff</span><span className="text-foreground">{diag.fileHandoffAt != null ? `${Math.round(diag.fileHandoffAt)}ms` : "—"}</span>
              <span>Picker → handoff</span><span className="text-foreground">{diag.fileHandoffAt != null && diag.pickerOpenedAt != null ? `${Math.round(diag.fileHandoffAt - diag.pickerOpenedAt)}ms (iOS)` : "—"}</span>
              <span>Details rendered</span><span className="text-foreground">{diag.detailsRenderedAt != null ? `${Math.round(diag.detailsRenderedAt)}ms` : "—"}</span>
              <span>Handoff → details</span><span className="text-foreground">{diag.handoffToDetailsMs != null ? `${diag.handoffToDetailsMs}ms (app)` : "—"}</span>
              <span>Clip count</span><span className="text-foreground">{diag.clipCount}</span>
              <span>Preview pending</span><span className="text-foreground">{String(diag.anyPreviewPending)}</span>
              <span>File sizes</span><span className="text-foreground break-all">{diag.fileSizes.length ? diag.fileSizes.map((b) => `${(b / 1024 / 1024).toFixed(1)}MB`).join(", ") : "—"}</span>
              <span>File types</span><span className="text-foreground break-all">{diag.fileTypes.length ? diag.fileTypes.join(", ") : "—"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>Enabled via ?diag=1 or localStorage.lift_upload_diag</span>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  const payload = JSON.stringify(diag, null, 2);
                  navigator.clipboard?.writeText(payload);
                  toast.success("Diagnostics copied to clipboard.");
                }}
              >
                Copy
              </button>
            </div>
          </details>
        )}
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
            previewClip.isImage ? (
              <img
                src={previewClip.previewUrl}
                alt={previewClip.file?.name || "Preview"}
                className="w-full rounded-lg bg-black object-contain"
              />
            ) : (
              <video
                src={previewClip.previewUrl}
                className="w-full rounded-lg bg-black"
                controls
                autoPlay
                playsInline
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SentState({ fileClipCount, onReset }: { fileClipCount: number; onReset: () => void }) {
  const active = useLiftUploadActiveCount();
  const isUploading = fileClipCount > 0 && active > 0;

  if (isUploading) {
    return (
      <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/5 p-6 text-center space-y-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-500/20">
          <Loader2 className="h-7 w-7 animate-spin text-amber-600" />
        </div>
        <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
          Do Not Leave This Screen
        </div>
        <div className="space-y-2 text-sm text-foreground/90">
          <p>Your video is still uploading.</p>
          <p className="text-muted-foreground">
            If you close the app, lock your phone, switch apps, or leave this screen before the upload finishes, the upload may fail.
          </p>
        </div>
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          {active} clip{active === 1 ? "" : "s"} uploading. Stay here until upload is complete.
        </div>
        <Button disabled className="mt-2 w-full">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Upload in Progress…
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
      <div className="text-base font-semibold">
        {fileClipCount > 0 ? "Upload Complete" : "Sent to Coach Jared"}
      </div>
      <div className="text-sm text-muted-foreground">
        {fileClipCount > 0
          ? "All videos uploaded successfully. Sent to Coach Jared — awaiting review."
          : "You'll see feedback here once it's reviewed."}
      </div>
      <Button className="mt-2" onClick={onReset}>Send another video</Button>
    </div>
  );
}
