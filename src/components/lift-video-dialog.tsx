import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  TRAINING_DAY_OPTIONS, LIFT_VIDEO_TAGS, createLiftVideo, updateLiftVideo, uploadVideoFile,
  type LiftVideo,
} from "@/lib/lift-videos";
import { createClientLiftVideo } from "@/lib/lift-videos.functions";
import { uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { friendlyDriveError } from "@/lib/drive-errors";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2, Video as VideoIcon, Send, X, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  userId: string | null;
  clientName?: string | null;
  initial?: LiftVideo | null;
  onSaved?: () => void;
  /** "client" = simplified flow (video + notes); "admin" = full form. Defaults to "admin". */
  role?: "client" | "admin";
};

export function LiftVideoDialog({ open, onOpenChange, clientId, userId, clientName, initial, onSaved, role = "admin" }: Props) {
  const createClientLiftVideoFn = useServerFn(createClientLiftVideo);
  const [tab, setTab] = useState<"link" | "upload">("upload");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const recordInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<any>({
    exercise: "",
    training_day: "Day 1",
    custom_training_day: "",
    program_day: "",
    date_performed: new Date().toISOString().slice(0, 10),
    set_number: "",
    reps: "",
    load_text: "",
    rpe: "",
    client_notes: "",
    question_for_coach: "",
    tag: "Normal Review",
    custom_tag: "",
    is_urgent: false,
    video_url: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  // ---- Multi-clip client state ----
  type Clip = {
    id: string;
    kind: "file" | "link";
    file?: File;
    url?: string;
    previewUrl?: string;
    note: string;
  };
  const [clips, setClips] = useState<Clip[]>([]);
  const [noteMode, setNoteMode] = useState<"batch" | "perClip">("batch");
  const [batchNote, setBatchNote] = useState("");
  const [pasteLink, setPasteLink] = useState("");
  const [urgentText, setUrgentText] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const multiUploadRef = useRef<HTMLInputElement | null>(null);
  const multiRecordRef = useRef<HTMLInputElement | null>(null);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [sendError, setSendError] = useState<{ stage?: string; message: string } | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({
        exercise: initial.exercise ?? "",
        training_day: initial.training_day ?? "Day 1",
        custom_training_day: initial.custom_training_day ?? "",
        program_day: initial.program_day ?? "",
        date_performed: initial.date_performed ?? new Date().toISOString().slice(0, 10),
        set_number: initial.set_number ?? "",
        reps: initial.reps ?? "",
        load_text: initial.load_text ?? "",
        rpe: initial.rpe ?? "",
        client_notes: initial.client_notes ?? "",
        question_for_coach: initial.question_for_coach ?? "",
        tag: initial.tag ?? "Normal Review",
        custom_tag: initial.custom_tag ?? "",
        is_urgent: initial.is_urgent ?? false,
        video_url: initial.video_url ?? "",
      });
      setTab(initial.video_source === "upload" ? "upload" : "link");
    } else if (open) {
      setFile(null);
      setTab("upload");
      setClips([]);
      setBatchNote("");
      setNoteMode("batch");
      setPasteLink("");
      setUrgentText("");
      setShowLinkInput(false);
      setSent(false);
    }
  }, [initial, open]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    // Client multi-clip flow handled separately below.
    if (role === "client" && !initial) return handleClientBatchSend();
    if (role === "client" && initial) {
      // Editing a single existing clip — keep using the simple per-clip form below.
    } else {
      if (!form.exercise.trim()) return toast.error("Add an exercise name.");
      if (tab === "link" && !form.video_url.trim() && !initial) return toast.error("Paste a video link or switch to upload.");
      if (tab === "upload" && !file && !initial) return toast.error("Choose a video file.");
    }

    setSaving(true);
    try {
      let videoUrl: string | null = form.video_url || null;
      let storagePath: string | null = initial?.video_storage_path ?? null;
      let source: "link" | "upload" = file ? "upload" : (form.video_url ? "link" : tab);

      if (file && userId) {
        const res = await uploadVideoFile(file, userId);
        storagePath = res.path;
        videoUrl = res.url;
        source = "upload";
      }

      const payload: any = {
        client_id: clientId,
        uploaded_by: userId,
        exercise: form.exercise.trim(),
        training_day: form.training_day,
        custom_training_day: form.training_day === "Custom" ? form.custom_training_day : null,
        program_day: form.program_day || null,
        date_performed: form.date_performed || null,
        set_number: form.set_number === "" ? null : Number(form.set_number),
        reps: form.reps === "" ? null : Number(form.reps),
        load_text: form.load_text || null,
        rpe: form.rpe === "" ? null : Number(form.rpe),
        client_notes: form.client_notes || null,
        question_for_coach: form.question_for_coach || null,
        tag: form.tag,
        custom_tag: form.tag === "Custom" ? form.custom_tag : null,
        is_urgent: !!form.is_urgent || form.tag === "Pain / Discomfort",
        video_url: videoUrl,
        video_storage_path: storagePath,
        video_source: source,
        preview_status: storagePath ? "ready" : "not_generated",
        file_type: file?.type || null,
        file_size_bytes: file?.size ?? null,
        upload_status: storagePath ? "App storage fallback" : "Submitted",
      };

      if (initial) {
        await updateLiftVideo(initial.id, payload);
        toast.success("Updated");
      } else {
        await createLiftVideo(payload);
        toast.success(role === "client" ? "Video sent to Coach Jared." : "Video submitted");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ---------- Multi-clip client send ----------
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

  const moveClip = (id: string, dir: -1 | 1) => {
    setClips((c) => {
      const i = c.findIndex((k) => k.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.length) return c;
      const copy = c.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const updateClipNote = (id: string, note: string) => {
    setClips((c) => c.map((k) => (k.id === id ? { ...k, note } : k)));
  };

  const handleClientBatchSend = async () => {
    if (clips.length === 0) return toast.error("Add at least one video.");

    setSaving(true);
    setSendError(null);
    try {
      const batchId = crypto.randomUUID();
      const total = clips.length;
      const sharedNote = noteMode === "batch" ? batchNote.trim() : "";
      const isUrgent = !!form.is_urgent;
      const urgentNote = isUrgent ? urgentText.trim() : "";
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        let videoUrl: string | null = null;
        let storagePath: string | null = null;
        let source: "link" | "upload" = "link";
        let storageMeta: { mimeType: string; sizeBytes: number } | null = null;

        if (clip.kind === "file" && clip.file) {
          // PRIMARY upload path: stream straight into Supabase Storage. The
          // background Drive archive picks it up later — we don't block the
          // client on Drive succeeding.
          if (!userId) throw new Error("Sign in to upload videos.");
          const res = await uploadLiftFileToStorage({ file: clip.file, userId });
          storagePath = res.path;
          storageMeta = { mimeType: res.mimeType, sizeBytes: res.sizeBytes };
          source = "upload";
        } else if (clip.kind === "link" && clip.url) {
          videoUrl = clip.url;
          source = "link";
        }

        const perClipNote = noteMode === "perClip" ? clip.note.trim() : "";
        const combinedQuestion = [urgentNote && `⚠️ Pain / discomfort / urgent: ${urgentNote}`]
          .filter(Boolean)
          .join("\n");

        const liftVideoPayload = {
          client_id: clientId,
          exercise: "",
          tag: isUrgent ? "Pain / Discomfort" : "Normal Review",
          is_urgent: isUrgent,
          client_notes: perClipNote || null,
          question_for_coach: combinedQuestion || null,
          video_url: videoUrl,
          video_storage_path: storagePath,
          video_source: source,
          thumbnail_url: null,
          original_drive_file_id: null,
          original_drive_url: null,
          drive_embed_url: null,
          preview_url: null,
          preview_status: storagePath ? "ready" : "not_generated",
          file_type: storageMeta?.mimeType ?? clip.file?.type ?? null,
          file_size_bytes: storageMeta?.sizeBytes ?? clip.file?.size ?? null,
          upload_status: storagePath ? "Uploaded" : "Submitted",
          archive_status: storagePath ? "pending" : "not_archived",
          archive_next_attempt_at: storagePath ? new Date().toISOString() : null,
          status: "New Upload",
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
      toast.error(friendlyDriveError(e, role === "client" ? "client" : "admin"));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Client (multi-clip DM-style) view ----------
  if (role === "client" && !initial) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          className="max-h-[92vh] focus:outline-none"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto w-full max-w-md">
            <DrawerHeader className="text-center pb-2">
              <DrawerTitle className="text-lg">{sent ? "Sent" : "Send Lift Video"}</DrawerTitle>
              {!sent && (
                <DrawerDescription className="text-sm">
                  Upload a lift for Coach Jared to review.
                </DrawerDescription>
              )}
            </DrawerHeader>

            {sent ? (
              <div className="px-5 py-8 text-center space-y-3">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                <div className="text-base font-semibold">Sent to Coach Jared</div>
                <div className="text-sm text-muted-foreground">
                  You'll see feedback here once it's reviewed.
                </div>
                <Button className="mt-2 w-full" onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            ) : (
              <div className="space-y-5 px-5 pb-4 overflow-y-auto">
                {/* 1. Add Video */}
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

                {/* Selected clips — compact attachment list */}
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

                {/* 2. Note — message-style */}
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

                {/* 3. Urgent toggle — compact */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Needs coach attention?</div>
                      <div className="text-xs text-muted-foreground">Pain, discomfort, or urgent.</div>
                    </div>
                    <Switch checked={!!form.is_urgent} onCheckedChange={(v) => set("is_urgent", v)} />
                  </div>
                  {form.is_urgent && (
                    <Textarea
                      rows={2}
                      className="rounded-xl text-sm"
                      placeholder="What's going on? (e.g. left hip pinched during this set)"
                      value={urgentText}
                      onChange={(e) => setUrgentText(e.target.value)}
                    />
                  )}
                </div>
              </div>
            )}

            {!sent && (
              <DrawerFooter className="pt-2">
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
                <Button
                  onClick={handleSave}
                  disabled={saving || clips.length === 0}
                  className="h-12 w-full rounded-full bg-gradient-primary text-base font-bold"
                >
                  {saving ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
                  ) : (
                    <><Send className="mr-2 h-4 w-4" /> {sendError ? "Retry send" : `Send ${clips.length > 1 ? "Videos" : "Video"}`}</>
                  )}
                </Button>
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving} className="h-10">
                  Cancel
                </Button>
              </DrawerFooter>
            )}
          </div>
        </DrawerContent>
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
      </Drawer>
    );
  }

  // ---------- Client edit (single existing clip) view ----------
  if (role === "client" && initial) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit lift video</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Note for Coach Jared</Label>
              <Textarea
                rows={6}
                className="min-h-[140px] text-base"
                placeholder="Add or update your note for this clip."
                value={form.client_notes}
                onChange={(e) => set("client_notes", e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 p-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Pain, discomfort, or urgent?
                </div>
                <div className="text-xs text-muted-foreground">Flag this for coach attention.</div>
              </div>
              <Switch checked={!!form.is_urgent} onCheckedChange={(v) => set("is_urgent", v)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-gradient-primary font-bold uppercase">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ---------- Admin (full) view ----------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit lift video" : "Upload lift video"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Exercise *</Label>
              <Input placeholder="e.g. Low-Bar Squat" value={form.exercise} onChange={(e) => set("exercise", e.target.value)} />
            </div>
            <div>
              <Label>Training day</Label>
              <Select value={form.training_day} onValueChange={(v) => set("training_day", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_DAY_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.training_day === "Custom" && (
              <div>
                <Label>Custom training day</Label>
                <Input value={form.custom_training_day} onChange={(e) => set("custom_training_day", e.target.value)} />
              </div>
            )}
            <div className="col-span-2">
              <Label>Program day (from your program sheet)</Label>
              <Input placeholder="e.g. Week 3 Day 2 — Secondary Bench" value={form.program_day} onChange={(e) => set("program_day", e.target.value)} />
            </div>
            <div>
              <Label>Date performed</Label>
              <Input type="date" value={form.date_performed} onChange={(e) => set("date_performed", e.target.value)} />
            </div>
            <div>
              <Label>Tag</Label>
              <Select value={form.tag} onValueChange={(v) => set("tag", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIFT_VIDEO_TAGS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.tag === "Custom" && (
              <div className="col-span-2">
                <Label>Custom tag</Label>
                <Input value={form.custom_tag} onChange={(e) => set("custom_tag", e.target.value)} />
              </div>
            )}
            <div>
              <Label>Set #</Label>
              <Input type="number" value={form.set_number} onChange={(e) => set("set_number", e.target.value)} />
            </div>
            <div>
              <Label>Reps</Label>
              <Input type="number" value={form.reps} onChange={(e) => set("reps", e.target.value)} />
            </div>
            <div>
              <Label>Load / weight</Label>
              <Input placeholder="e.g. 405 lbs" value={form.load_text} onChange={(e) => set("load_text", e.target.value)} />
            </div>
            <div>
              <Label>RPE</Label>
              <Input type="number" step="0.5" min="1" max="10" value={form.rpe} onChange={(e) => set("rpe", e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Notes for coach</Label>
            <Textarea rows={3} placeholder="Add notes for Coach Jared. Example: top set felt heavy off the floor, not sure if my hips shot up too early." value={form.client_notes} onChange={(e) => set("client_notes", e.target.value)} />
          </div>
          <div>
            <Label>Specific question for coach</Label>
            <Textarea rows={2} placeholder="What do you want feedback on?" value={form.question_for_coach} onChange={(e) => set("question_for_coach", e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 p-3">
            <div>
              <div className="text-sm font-semibold">Pain / discomfort or urgent?</div>
              <div className="text-xs text-muted-foreground">Flag this for coach attention.</div>
            </div>
            <Switch checked={form.is_urgent} onCheckedChange={(v) => set("is_urgent", v)} />
          </div>

          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={tab === "link" ? "default" : "outline"} onClick={() => setTab("link")}>
                <LinkIcon className="mr-1 h-3 w-3" /> Paste link
              </Button>
              <Button type="button" size="sm" variant={tab === "upload" ? "default" : "outline"} onClick={() => setTab("upload")}>
                <Upload className="mr-1 h-3 w-3" /> Upload file
              </Button>
            </div>
            {tab === "link" ? (
              <div>
                <Label>Video link (Google Drive, YouTube unlisted, etc.)</Label>
                <Input placeholder="https://drive.google.com/..." value={form.video_url} onChange={(e) => set("video_url", e.target.value)} />
              </div>
            ) : (
              <div>
                <Label>Video file (MP4, MOV, M4V)</Label>
                <Input type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file && <p className="mt-1 text-xs text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-primary font-bold uppercase">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {initial ? "Save" : "Submit Video"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}