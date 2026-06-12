import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Mic, Square, Upload, X, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  createBroadcast,
  updateBroadcast,
  setBroadcastSelectedClients,
  getBroadcastSelectedClients,
  uploadBroadcastFile,
  BROADCAST_TYPES,
  BROADCAST_AUDIENCE_LABELS,
  type Broadcast,
  type BroadcastAudience,
  type BroadcastStatus,
  type BroadcastType,
} from "@/lib/broadcasts";
import { runJob } from "@/lib/progress-jobs";
import { RecipeAccessPicker } from "@/components/recipe-access-picker";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Broadcast | null;
  quick?: boolean;
  onSaved?: (b: Broadcast) => void;
};

export function BroadcastComposer({ open, onOpenChange, initial, quick, onSaved }: Props) {
  const { user } = useAuth();
  const isEdit = !!initial;

  const [title, setTitle] = useState("");
  const [type, setType] = useState<BroadcastType>("Message");
  const [body, setBody] = useState("");
  const [transcript, setTranscript] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("everyone");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [publishAt, setPublishAt] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [scheduleNow, setScheduleNow] = useState(true);

  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voicePreview, setVoicePreview] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setType(initial.type);
      setBody(initial.body);
      setTranscript(initial.transcript ?? "");
      setVideoUrl(initial.video_url ?? "");
      setLinkUrl(initial.link_url ?? "");
      setLinkLabel(initial.link_label ?? "");
      setAudience(initial.audience_scope);
      setPublishAt(initial.publish_at?.slice(0, 16) ?? "");
      setExpiresAt(initial.expires_at?.slice(0, 16) ?? "");
      setScheduleNow(false);
      getBroadcastSelectedClients(initial.id).then(setSelectedClients);
    } else {
      setTitle("");
      setType("Message");
      setBody("");
      setTranscript("");
      setVideoUrl("");
      setLinkUrl("");
      setLinkLabel("");
      setAudience("everyone");
      setSelectedClients([]);
      setPublishAt("");
      setExpiresAt("");
      setScheduleNow(true);
      setVoiceBlob(null);
      setVoicePreview(null);
      setVideoFile(null);
    }
  }, [open, initial]);

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setVoiceBlob(blob);
        setVoicePreview(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Microphone access denied");
    }
  }

  function stopRec() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function clearVoice() {
    setVoiceBlob(null);
    setVoicePreview(null);
  }

  async function save(asStatus: BroadcastStatus) {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    
    const steps = ["Preparing", "Sending", "Saving delivery record", "Completed"];
    
    await runJob({ 
      title: isEdit ? "Updating broadcast" : "Creating broadcast", 
      steps 
    }, async (job) => {
      job.completeStep(0); // Preparing
      let voicePath: string | null = initial?.voice_path ?? null;
      let videoPath: string | null = initial?.video_path ?? null;
      if (voiceBlob) {
        const f = new File([voiceBlob], "voice-"+Date.now()+".webm", { type: "audio/webm" });
        voicePath = await uploadBroadcastFile(f, "voice");
      }
      if (videoFile) {
        videoPath = await uploadBroadcastFile(videoFile, "video");
      }

      const publish_at = scheduleNow || !publishAt ? new Date().toISOString() : new Date(publishAt).toISOString();
      const expires_at = expiresAt ? new Date(expiresAt).toISOString() : null;
      const finalStatus: BroadcastStatus = (() => {
        if (asStatus === "Draft" || asStatus === "Archived") return asStatus;
        if (new Date(publish_at).getTime() > Date.now()) return "Scheduled";
        return "Active";
      })();

      const payload = {
        title,
        type,
        body,
        voice_path: voicePath,
        transcript: transcript || null,
        video_url: videoUrl || null,
        video_path: videoPath,
        link_url: linkUrl || null,
        link_label: linkLabel || null,
        audience_scope: audience,
        publish_at,
        expires_at,
        status: finalStatus,
      };

      job.completeStep(1); // Sending
      let row: Broadcast;
      if (isEdit && initial) {
        row = await updateBroadcast(initial.id, payload);
      } else {
        row = await createBroadcast({ ...payload, authorId: user?.id });
      }
      
      job.completeStep(2); // Saving delivery record
      if (audience === "selected_clients") {
        await setBroadcastSelectedClients(row.id, selectedClients);
      }
      
      job.completeStep(3); // Completed
      toast.success(finalStatus === "Active" ? "Published" : finalStatus);
      onSaved?.(row);
      onOpenChange(false);
      return row;
    }).catch((e: any) => {
      toast.error(e.message ?? "Save failed");
    }).finally(() => {
      setSaving(false);
    });
  }

  const isVoice = type === "Voice Message";
  const isVideo = type === "Video";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{quick ? "Quick Broadcast" : isEdit ? "Edit Broadcast" : "New Broadcast"}</DialogTitle>
          <DialogDescription>Reach clients and members with a quick message.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quote of the day" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as BroadcastType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BROADCAST_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={isVoice || isVideo ? 3 : 5} placeholder={type === "Quote" ? "\"The work you do today…\"" : "Write your message…"} />
          </div>

          {isVoice && (
            <Card className="space-y-2 p-3">
              <Label className="text-xs">Voice Message</Label>
              {voicePreview ? (
                <div className="flex items-center gap-2">
                  <audio src={voicePreview} controls className="flex-1" />
                  <Button variant="ghost" size="icon" onClick={clearVoice}><X className="h-4 w-4" /></Button>
                </div>
              ) : initial?.voice_path && !voiceBlob ? (
                <p className="text-xs text-muted-foreground">Existing voice file attached. Record again to replace.</p>
              ) : null}
              <div className="flex gap-2">
                {!recording ? (
                  <Button type="button" variant="outline" size="sm" onClick={startRec}><Mic className="mr-1 h-4 w-4" /> Record</Button>
                ) : (
                  <Button type="button" variant="destructive" size="sm" onClick={stopRec}><Square className="mr-1 h-4 w-4" /> Stop</Button>
                )}
                <label className="cursor-pointer">
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    setVoiceBlob(f);
                    setVoicePreview(URL.createObjectURL(f));
                  }} />
                  <span className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs hover:bg-muted">
                    <Upload className="h-3.5 w-3.5" /> Upload
                  </span>
                </label>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Transcript (optional)</Label>
                <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} placeholder="Type the transcript so clients can read along." />
              </div>
            </Card>
          )}

          {isVideo && (
            <Card className="space-y-2 p-3">
              <Label className="text-xs">Video</Label>
              <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="YouTube / Vimeo / link" />
              <div className="text-[11px] text-muted-foreground">Or upload a file:</div>
              <Input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} />
            </Card>
          )}

          {(type === "Link" || type === "Update" || type === "Reminder") && (
            <div className="grid gap-2 md:grid-cols-[1fr_180px]">
              <div className="space-y-1.5">
                <Label className="text-xs">Link URL (optional)</Label>
                <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Link label</Label>
                <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Open" />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Audience</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as BroadcastAudience)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(BROADCAST_AUDIENCE_LABELS) as BroadcastAudience[]).map((k) => (
                  <SelectItem key={k} value={k}>{BROADCAST_AUDIENCE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {audience === "selected_clients" && (
              <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="mt-1">
                <Users className="mr-1 h-4 w-4" /> {selectedClients.length ? `${selectedClients.length} selected` : "Select Clients"}
              </Button>
            )}
          </div>

          {!quick && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Publish</Label>
                <Select value={scheduleNow ? "now" : "later"} onValueChange={(v) => setScheduleNow(v === "now")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">Now</SelectItem>
                    <SelectItem value="later">Schedule</SelectItem>
                  </SelectContent>
                </Select>
                {!scheduleNow && (
                  <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expires (optional)</Label>
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!quick && (
            <Button variant="outline" onClick={() => save("Draft")} disabled={saving}>Save Draft</Button>
          )}
          <Button onClick={() => save("Active")} disabled={saving} className="bg-gradient-primary font-bold">
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {scheduleNow ? "Publish Now" : "Save"}
          </Button>
        </DialogFooter>

        <RecipeAccessPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initial={selectedClients}
          onSave={async (ids) => setSelectedClients(ids)}
        />
      </DialogContent>
    </Dialog>
  );
}