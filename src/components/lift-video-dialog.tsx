import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2, Video as VideoIcon, Send, X, AlertTriangle, ArrowUp, ArrowDown, Plus } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  userId: string | null;
  initial?: LiftVideo | null;
  onSaved?: () => void;
  /** "client" = simplified flow (video + notes); "admin" = full form. Defaults to "admin". */
  role?: "client" | "admin";
};

export function LiftVideoDialog({ open, onOpenChange, clientId, userId, initial, onSaved, role = "admin" }: Props) {
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
  const multiUploadRef = useRef<HTMLInputElement | null>(null);
  const multiRecordRef = useRef<HTMLInputElement | null>(null);

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
    if (noteMode === "batch" && !batchNote.trim()) {
      return toast.error("Add a note for Coach Jared, or switch to per-clip notes.");
    }

    setSaving(true);
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

        if (clip.kind === "file" && clip.file && userId) {
          const res = await uploadVideoFile(clip.file, userId);
          storagePath = res.path;
          videoUrl = res.url;
          source = "upload";
        } else if (clip.kind === "link" && clip.url) {
          videoUrl = clip.url;
          source = "link";
        }

        const perClipNote = noteMode === "perClip" ? clip.note.trim() : "";
        const combinedQuestion = [urgentNote && `⚠️ Pain / discomfort / urgent: ${urgentNote}`]
          .filter(Boolean)
          .join("\n");

        await createLiftVideo({
          client_id: clientId,
          uploaded_by: userId,
          exercise: "",
          tag: isUrgent ? "Pain / Discomfort" : "Normal Review",
          is_urgent: isUrgent,
          client_notes: perClipNote || null,
          question_for_coach: combinedQuestion || null,
          video_url: videoUrl,
          video_storage_path: storagePath,
          video_source: source,
          status: "New Upload",
          batch_id: batchId,
          batch_note: sharedNote || null,
          batch_size: total,
          batch_index: i + 1,
        } as any);
      }

      toast.success(
        clips.length === 1
          ? "Video sent to Coach Jared."
          : `${clips.length} clips sent to Coach Jared.`
      );
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send");
    } finally {
      setSaving(false);
    }
  };

  // ---------- Client (multi-clip DM-style) view ----------
  if (role === "client" && !initial) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Lift Video</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Add video buttons */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Add Video</Label>
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
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-3" onClick={() => multiUploadRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  <span className="text-[11px] font-semibold leading-tight">Upload from phone</span>
                </Button>
                <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-3" onClick={() => multiRecordRef.current?.click()}>
                  <VideoIcon className="h-4 w-4" />
                  <span className="text-[11px] font-semibold leading-tight">Record now</span>
                </Button>
                <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-3" onClick={() => { const el = document.getElementById("clip-paste-link") as HTMLInputElement | null; el?.focus(); }}>
                  <LinkIcon className="h-4 w-4" />
                  <span className="text-[11px] font-semibold leading-tight">Paste link</span>
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  id="clip-paste-link"
                  placeholder="Paste link(s) — Drive, YouTube, etc. Separate with space or comma"
                  value={pasteLink}
                  onChange={(e) => setPasteLink(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLinks(pasteLink); } }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => addLinks(pasteLink)} disabled={!pasteLink.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Selected clips */}
            {clips.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Selected clips ({clips.length})
                </Label>
                <div className="space-y-2">
                  {clips.map((clip, idx) => (
                    <div key={clip.id} className="rounded-md border border-border bg-card p-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                          {clip.kind === "file" && clip.previewUrl ? (
                            <video src={clip.previewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                          ) : (
                            <LinkIcon className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">Clip {idx + 1}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {clip.kind === "file"
                              ? `${clip.file?.name} · ${((clip.file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB`
                              : clip.url}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveClip(clip.id, -1)} disabled={idx === 0}>
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveClip(clip.id, 1)} disabled={idx === clips.length - 1}>
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeClip(clip.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {noteMode === "perClip" && (
                        <Textarea
                          rows={2}
                          className="text-sm"
                          placeholder="Add note for this clip. Example: Squat top set, 405 x 3 @ RPE 8. Felt slow out of the hole."
                          value={clip.note}
                          onChange={(e) => updateClipNote(clip.id, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes mode toggle */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Notes</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={noteMode === "batch" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNoteMode("batch")}
                >
                  One message for all
                </Button>
                <Button
                  type="button"
                  variant={noteMode === "perClip" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNoteMode("perClip")}
                >
                  Note per clip
                </Button>
              </div>
              {noteMode === "batch" && (
                <Textarea
                  rows={5}
                  className="min-h-[120px] text-base"
                  placeholder={`Tell Coach Jared what these videos are.\n\nExample: Week 3 Day 2. First video is squat top set 405 x 3 @ RPE 8, second video is backoff set, third video is bench. Squat felt slow out of the hole.`}
                  value={batchNote}
                  onChange={(e) => setBatchNote(e.target.value)}
                />
              )}
            </div>

            {/* Pain / urgent toggle */}
            <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    Pain, discomfort, or urgent?
                  </div>
                  <div className="text-xs text-muted-foreground">Flag this for coach attention.</div>
                </div>
                <Switch checked={!!form.is_urgent} onCheckedChange={(v) => set("is_urgent", v)} />
              </div>
              {form.is_urgent && (
                <Textarea
                  rows={3}
                  className="text-sm"
                  placeholder="Example: left hip pinched during this set, or urgent technique concern before next session."
                  value={urgentText}
                  onChange={(e) => setUrgentText(e.target.value)}
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || clips.length === 0} className="bg-gradient-primary font-bold uppercase">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {clips.length > 1 ? `Send ${clips.length} clips` : "Send Video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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