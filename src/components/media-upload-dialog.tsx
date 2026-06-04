import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Trash2, Upload, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { CLIENT_MEDIA_TYPES, MEDIA_TYPES, type MediaType, uploadToDrive } from "@/lib/media";
import { initMediaUpload, finalizeMediaUpload, createSubmission } from "@/lib/drive.functions";

type Mode = "batch" | "per-clip";

export function MediaUploadDialog({
  open, onOpenChange, clientId, role, defaultType, onUploaded, restrictTypes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  role: "admin" | "client";
  defaultType?: MediaType;
  onUploaded?: () => void;
  restrictTypes?: MediaType[];
}) {
  const initFn = useServerFn(initMediaUpload);
  const finalizeFn = useServerFn(finalizeMediaUpload);
  const createSubFn = useServerFn(createSubmission);
  const types = restrictTypes ?? (role === "client" ? CLIENT_MEDIA_TYPES : (MEDIA_TYPES as readonly MediaType[]).slice());

  const [mediaType, setMediaType] = useState<MediaType>(defaultType ?? (types[0] as MediaType));
  const [files, setFiles] = useState<File[]>([]);
  const [perClipNotes, setPerClipNotes] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("batch");
  const [batchNote, setBatchNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [painNote, setPainNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number[]>([]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list);
    setFiles((prev) => [...prev, ...arr]);
    setPerClipNotes((prev) => [...prev, ...arr.map(() => "")]);
  }
  function removeFile(i: number) {
    setFiles((p) => p.filter((_, idx) => idx !== i));
    setPerClipNotes((p) => p.filter((_, idx) => idx !== i));
  }

  function reset() {
    setFiles([]); setPerClipNotes([]); setBatchNote(""); setUrgent(false); setPainNote("");
    setProgress([]); setUploading(false); setMode("batch");
  }

  async function submit() {
    if (files.length === 0) { toast.error("Add at least one file"); return; }
    setUploading(true);
    setProgress(files.map(() => 0));
    try {
      const sub = await createSubFn({ data: {
        clientId, submissionType: mediaType, batchNote: mode === "batch" ? batchNote : null,
        urgent, painNote: urgent ? painNote : null, clipCount: files.length, role,
      }});
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const init = await initFn({ data: {
          clientId, mediaType, fileName: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size,
        }});
        await uploadToDrive(init.uploadUrl, f, (pct) => {
          setProgress((prev) => { const c = [...prev]; c[i] = pct; return c; });
        });
        // Drive returns metadata in the PUT response; we fetch fresh via finalize using the file id.
        // The PUT response body contains the file id when uploadType=resumable completes — but our XHR helper
        // discards the body. Instead, ask Drive: we don't have id here. Workaround: use the upload URL's
        // `upload_id`. Easier: rely on finalize to look it up by name in folder — but we don't have id.
        // Pragmatic fix: parse the JSON body from a second XHR. We re-request the upload URL with no body to get
        // the existing session status (returns 200 + body with id once complete).
        const idRes = await fetch(init.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes */${f.size}` } }).catch(() => null);
        let driveFileId = "";
        if (idRes && idRes.ok) {
          const j = await idRes.json().catch(() => null);
          driveFileId = j?.id ?? "";
        }
        if (!driveFileId) {
          // As a last resort, we cannot identify the file — surface clear error
          throw new Error("Drive did not return a file id after upload");
        }
        await finalizeFn({ data: {
          clientId, submissionId: sub.id, mediaType, driveFileId,
          clipNote: mode === "per-clip" ? (perClipNotes[i] || null) : null,
          clipOrder: i, urgent, painNote: urgent ? painNote : null, uploadedByRole: role,
        }});
      }
      toast.success("Sent to coach");
      reset();
      onOpenChange(false);
      onUploaded?.();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!uploading) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload media</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Media type</Label>
            <Select value={mediaType} onValueChange={(v) => setMediaType(v as MediaType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Files</Label>
            <Input type="file" multiple accept={mediaType === "Progress Photos" ? "image/*" : mediaType.includes("Document") ? undefined : "video/*,image/*"} onChange={(e) => addFiles(e.target.files)} />
            {files.length > 0 && (
              <div className="mt-2 space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="rounded border border-border bg-card p-2 text-sm overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate min-w-0 flex-1 break-all">{f.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2" onClick={() => removeFile(i)} disabled={uploading}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                    {mode === "per-clip" && (
                      <Textarea className="mt-2" rows={2} placeholder="Note for this clip" value={perClipNotes[i] ?? ""} onChange={(e) => {
                        const v = e.target.value; setPerClipNotes((p) => { const c = [...p]; c[i] = v; return c; });
                      }} />
                    )}
                    {uploading && <Progress className="mt-2 h-1" value={progress[i] ?? 0} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {files.length > 1 && (
            <div className="flex items-center justify-between">
              <Label className="text-xs">Notes mode</Label>
              <div className="flex gap-2">
                <Button size="sm" variant={mode === "batch" ? "default" : "outline"} onClick={() => setMode("batch")}>One note</Button>
                <Button size="sm" variant={mode === "per-clip" ? "default" : "outline"} onClick={() => setMode("per-clip")}>Per clip</Button>
              </div>
            </div>
          )}

          {mode === "batch" && (
            <div>
              <Label>Note for Coach Jared</Label>
              <Textarea rows={4} placeholder="Tell Coach Jared what this is. Please include the lift, training day, load, reps, and RPE/RIR if you know it. Example: Week 3 Day 2 — Squat top set, 405 x 3 @ RPE 8. Felt slow out of the hole." value={batchNote} onChange={(e) => setBatchNote(e.target.value)} />
            </div>
          )}

          <div className="rounded border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className={`h-4 w-4 ${urgent ? "text-rose-400" : "text-muted-foreground"}`} />
                Pain, discomfort, or urgent?
              </div>
              <Switch checked={urgent} onCheckedChange={setUrgent} />
            </div>
            {urgent && (
              <Textarea className="mt-2" rows={3} placeholder="Example: left hip pinched during this set, or urgent technique concern before next session." value={painNote} onChange={(e) => setPainNote(e.target.value)} />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>Cancel</Button>
          <Button onClick={submit} disabled={uploading || files.length === 0}>
            <Upload className="mr-1 h-4 w-4" /> {uploading ? "Uploading…" : "Send to coach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}