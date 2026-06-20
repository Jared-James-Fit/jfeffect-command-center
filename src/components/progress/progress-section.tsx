import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ImagePlus, VideoIcon, Camera, Scale, Ruler, Clock, Eye,
  CheckCircle2, AlertTriangle, Loader2, Trash2, X, ChevronRight, Plus,
  ArrowRight, MessageSquare,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress as ProgressBar } from "@/components/ui/progress";
import {
  PHOTO_ANGLES, ANGLE_LABEL, CHECK_IN_LABELS, MEASUREMENT_FIELDS,
  type ProgressAngle, type ProgressSubmission, type ProgressMedia,
  type ProgressBodyweight, type ProgressMeasurement, type ProgressReviewResponse,
  type ProgressOwnerType, type ProgressVideoFormat,
  listSubmissions, getSubmission, createSubmission, updateSubmission, deleteSubmission,
  submitForReview, listMediaForSubmission, createMedia, updateMedia, deleteMedia,
  uploadProgressFile, getSignedMediaUrl, listBodyweight, logBodyweight, deleteBodyweight,
  listMeasurements, logMeasurement, deleteMeasurement, bodyweightStats,
  listReviewResponses, addReviewResponse,
} from "@/lib/progress";
import { format, parseISO } from "date-fns";
import { WaterTrackerCard } from "./water-tracker-card";
import { convertWeight, type ProgressMetric } from "@/lib/progress-metrics";

/**
 * Mobile-safe date picker: defaults to today and shows a plain text
 * pill ("Today · Jun 18, 2026"). Native date input is hidden behind an
 * "Edit date" toggle so it cannot accidentally cover the upload form.
 */
function DateField({
  value, onChange, label = "Date",
}: { value: string; onChange: (v: string) => void; label?: string }) {
  const [editing, setEditing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = value === today;
  let pretty = value;
  try { pretty = format(parseISO(value), "MMM d, yyyy"); } catch { /* noop */ }
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {editing ? (
        <div className="flex gap-2">
          <Input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value || today)}
            className="flex-1"
            autoFocus
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2">
          <span className="text-sm font-semibold">
            {isToday ? "Today" : ""}{isToday ? " · " : ""}{pretty}
          </span>
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-wider text-primary hover:underline"
            onClick={() => setEditing(true)}
          >
            Edit date
          </button>
        </div>
      )}
    </div>
  );
}

export type ProgressContext = {
  userId: string;
  ownerType: ProgressOwnerType;
  clientId: string | null;
  memberId: string | null;
  assignedCoachId?: string | null;
  viewerRole: "owner" | "admin" | "coach";
  preferredWeightUnit?: "kg" | "lb";
  /** Coaching = can submit for review, Member = self-tracking only. */
  canRequestReview: boolean;
};

/** Quick-action requested from a Home dashboard via `?action=...`. */
export type ProgressInitialAction =
  | "photo"
  | "video"
  | "lift"
  | "weight"
  | "bodyweight"
  | "measure"
  | "history";

export function ProgressSection({
  ctx, initialAction,
}: { ctx: ProgressContext; initialAction?: ProgressInitialAction }) {
  const [tab, setTab] = useState<string>(initialAction === "history" ? "timeline" : initialAction === "bodyweight" || initialAction === "weight" ? "bodyweight" : "overview");
  const [photoDialog, setPhotoDialog] = useState(false);
  const [videoDialog, setVideoDialog] = useState(false);
  const [weightDialog, setWeightDialog] = useState(false);
  const [measureDialog, setMeasureDialog] = useState(false);
  const [compareDialog, setCompareDialog] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Auto-open the right dialog when navigated from a Home action button.
  useEffect(() => {
    if (!initialAction) return;
    if (initialAction === "photo") setPhotoDialog(true);
    else if (initialAction === "weight") { setTab("bodyweight"); setWeightDialog(true); }
    else if (initialAction === "bodyweight") setTab("bodyweight");
    else if (initialAction === "measure") setMeasureDialog(true);
    else if (initialAction === "history") setTab("timeline");
    else if (initialAction === "video") setVideoDialog(true);
    else if (initialAction === "lift") { setTab("videos"); setVideoDialog(true); }
  }, [initialAction]);

  return (
    <div className="space-y-4 p-3 pb-[max(5rem,env(safe-area-inset-bottom))] md:p-6 md:pb-12">
      {/* Always-visible quick actions so logging is one tap from any tab */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          className="h-12 flex-col gap-0.5 text-xs font-bold"
          onClick={() => setWeightDialog(true)}
        >
          <Scale className="h-4 w-4" />
          Log Weight
        </Button>
        <Button
          variant="outline"
          className="h-12 flex-col gap-0.5 text-xs font-bold"
          onClick={() => setPhotoDialog(true)}
        >
          <Camera className="h-4 w-4" />
          Add Photos
        </Button>
        <Button
          variant="outline"
          className="h-12 flex-col gap-0.5 text-xs font-bold"
          onClick={() => setMeasureDialog(true)}
        >
          <Ruler className="h-4 w-4" />
          Add Measurements
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 md:grid-cols-7 h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="videos">Videos</TabsTrigger>
          <TabsTrigger value="bodyweight">Weight</TabsTrigger>
          <TabsTrigger value="water">Water</TabsTrigger>
          <TabsTrigger value="measurements">Measure</TabsTrigger>
          <TabsTrigger value="timeline">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab ctx={ctx} onLogWeight={() => setWeightDialog(true)} onAddPhotos={() => setPhotoDialog(true)} onAddVideo={() => setVideoDialog(true)} onAddMeasurements={() => setMeasureDialog(true)} onViewTab={setTab} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotosTab ctx={ctx} onNew={() => setPhotoDialog(true)} onOpen={setDetailId} onCompare={() => setCompareDialog(true)} />
        </TabsContent>
        <TabsContent value="videos">
          <VideosTab ctx={ctx} onNew={() => setVideoDialog(true)} onOpen={setDetailId} />
        </TabsContent>
        <TabsContent value="bodyweight">
          <BodyweightTab
            ctx={ctx}
            onLog={() => setWeightDialog(true)}
            onOpenSubmission={setDetailId}
          />
        </TabsContent>
        <TabsContent value="water">
          <div className="max-w-md">
            <WaterTrackerCard
              userId={ctx.userId}
              currentUserId={ctx.userId}
              viewerRole={ctx.viewerRole}
            />
          </div>
        </TabsContent>
        <TabsContent value="measurements">
          <MeasurementsTab ctx={ctx} onAdd={() => setMeasureDialog(true)} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab ctx={ctx} onOpen={setDetailId} />
        </TabsContent>
      </Tabs>

      {photoDialog && <PhotoSubmissionDialog ctx={ctx} open={photoDialog} onOpenChange={setPhotoDialog} />}
      {videoDialog && <VideoSubmissionDialog ctx={ctx} open={videoDialog} onOpenChange={setVideoDialog} />}
      {weightDialog && <BodyweightDialog ctx={ctx} open={weightDialog} onOpenChange={setWeightDialog} />}
      {measureDialog && <MeasurementDialog ctx={ctx} open={measureDialog} onOpenChange={setMeasureDialog} />}
      {compareDialog && <ComparisonDialog ctx={ctx} open={compareDialog} onOpenChange={setCompareDialog} />}
      {detailId && <SubmissionDetailDialog ctx={ctx} submissionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}


// ============== Overview tab ==============

function OverviewTab({
  ctx, onLogWeight, onAddPhotos, onAddVideo, onAddMeasurements, onViewTab,
}: {
  ctx: ProgressContext;
  onLogWeight: () => void;
  onAddPhotos: () => void;
  onAddVideo: () => void;
  onAddMeasurements: () => void;
  onViewTab: (tab: string) => void;
}) {
  const { data: bwRows = [] } = useQuery({ queryKey: ["progress-bw", ctx.userId], queryFn: () => listBodyweight(ctx.userId) });
  const { data: photoSubs = [] } = useQuery({ queryKey: ["progress-subs-photo", ctx.userId], queryFn: () => listSubmissions({ userId: ctx.userId, type: "photo" }) });
  const { data: videoSubs = [] } = useQuery({ queryKey: ["progress-subs-video", ctx.userId], queryFn: () => listSubmissions({ userId: ctx.userId, type: "video" }) });
  const { data: measRows = [] } = useQuery({ queryKey: ["progress-meas", ctx.userId], queryFn: () => listMeasurements(ctx.userId) });

  const stats = bodyweightStats(bwRows);
  const latestPhotoSub = photoSubs[0];
  const latestVideoSub = videoSubs[0];
  const latestMeas = measRows[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <Button variant="outline" className="h-auto flex-col gap-1 py-3 text-[10px] font-bold" onClick={onLogWeight}>
          <Scale className="h-4 w-4" />
          Log Weight
        </Button>
        <Button variant="outline" className="h-auto flex-col gap-1 py-3 text-[10px] font-bold" onClick={onAddPhotos}>
          <Camera className="h-4 w-4" />
          Add Photos
        </Button>
        <Button variant="outline" className="h-auto flex-col gap-1 py-3 text-[10px] font-bold" onClick={onAddVideo}>
          <VideoIcon className="h-4 w-4" />
          Add Video
        </Button>
        <Button variant="outline" className="h-auto flex-col gap-1 py-3 text-[10px] font-bold" onClick={onAddMeasurements}>
          <Ruler className="h-4 w-4" />
          Add Measurements
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Weight</h3>
            <button onClick={() => onViewTab("bodyweight")} className="text-xs text-primary font-medium hover:underline">View all</button>
          </div>
          {stats?.latest ? (
            <div className="mt-2">
              <p className="text-2xl font-bold">{stats.latest} {stats.unit}</p>
              {stats.avg7 != null && <p className="text-xs text-muted-foreground">7-day avg {stats.avg7} {stats.unit}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No weight logged yet.</p>
          )}
        </Card>

        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Photos</h3>
            <button onClick={() => onViewTab("photos")} className="text-xs text-primary font-medium hover:underline">View all</button>
          </div>
          {latestPhotoSub ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">{fmtDate(latestPhotoSub.submission_date)}</p>
              <LatestMediaThumb sub={latestPhotoSub} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No photos yet.</p>
          )}
        </Card>

        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Videos</h3>
            <button onClick={() => onViewTab("videos")} className="text-xs text-primary font-medium hover:underline">View all</button>
          </div>
          {latestVideoSub ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">{fmtDate(latestVideoSub.submission_date)}</p>
              <LatestMediaThumb sub={latestVideoSub} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No videos yet.</p>
          )}
        </Card>

        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Measurements</h3>
            <button onClick={() => onViewTab("measurements")} className="text-xs text-primary font-medium hover:underline">View all</button>
          </div>
          {latestMeas ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">{fmtDate(latestMeas.measured_date)}</p>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-sm">
                {Object.entries(latestMeas.fields).filter(([, v]) => v != null && v !== "").slice(0, 4).map(([k, v]) => {
                  const label = MEASUREMENT_FIELDS.find((f) => f.key === k)?.label ?? k;
                  return <div key={k}><span className="text-muted-foreground text-xs">{label}</span> <strong>{String(v)}</strong></div>;
                })}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No measurements yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function LatestMediaThumb({ sub }: { sub: ProgressSubmission }) {
  const { data: media = [] } = useQuery({
    queryKey: ["progress-media", sub.id],
    queryFn: () => listMediaForSubmission(sub.id),
  });
  const firstReady = media.find((m) => m.upload_status !== "draft");
  if (!firstReady) return <div className="mt-2 text-xs text-muted-foreground">No preview available</div>;
  return (
    <div className="mt-2 aspect-square rounded bg-muted overflow-hidden max-h-[120px]">
      <MediaThumb m={firstReady} />
    </div>
  );
}

// ============== Photos tab ==============

function PhotosTab({
  ctx, onNew, onOpen, onCompare,
}: { ctx: ProgressContext; onNew: () => void; onOpen: (id: string) => void; onCompare: () => void }) {
  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["progress-subs-photo", ctx.userId],
    queryFn: () => listSubmissions({ userId: ctx.userId, type: "photo" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Progress Photos</h2>
        <div className="flex gap-2">
          {subs.length >= 2 && <Button variant="outline" size="sm" onClick={onCompare}><Eye className="h-4 w-4 mr-1" />Compare</Button>}
          <Button size="sm" onClick={onNew}><Plus className="h-4 w-4 mr-1" />New</Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !subs.length ? (
        <EmptyState
          icon={Camera} title="No progress photos yet"
          body="Upload front, left, back, and right photos."
          actionLabel="Take First Photos" onAction={onNew}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {subs.map((s) => <SubmissionCard key={s.id} sub={s} onOpen={() => onOpen(s.id)} />)}
        </div>
      )}
    </div>
  );
}

function VideosTab({
  ctx, onNew, onOpen,
}: { ctx: ProgressContext; onNew: () => void; onOpen: (id: string) => void }) {
  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["progress-subs-video", ctx.userId],
    queryFn: () => listSubmissions({ userId: ctx.userId, type: "video" }),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Progress Videos</h2>
        <Button size="sm" onClick={onNew}><Plus className="h-4 w-4 mr-1" />New</Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !subs.length ? (
        <EmptyState
          icon={VideoIcon} title="No progress videos yet"
          body="Record four angles separately, or one continuous all-angle video."
          actionLabel="Add First Video" onAction={onNew}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {subs.map((s) => <SubmissionCard key={s.id} sub={s} onOpen={() => onOpen(s.id)} />)}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ sub, onOpen }: { sub: ProgressSubmission; onOpen: () => void }) {
  const { data: media = [] } = useQuery({
    queryKey: ["progress-media", sub.id],
    queryFn: () => listMediaForSubmission(sub.id),
  });
  const complete = sub.submission_type === "photo"
    ? PHOTO_ANGLES.every((a) => media.find((m) => m.angle === a && m.upload_status !== "draft"))
    : sub.video_format === "continuous"
      ? media.some((m) => m.angle === "all" && m.upload_status !== "draft")
      : PHOTO_ANGLES.every((a) => media.find((m) => m.angle === a && m.upload_status !== "draft"));
  return (
    <Card className="p-3 cursor-pointer hover:bg-accent/50" onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{sub.check_in_label || (sub.submission_type === "photo" ? "Progress Photos" : "Progress Video")}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(sub.submission_date)} {sub.bodyweight ? `· ${sub.bodyweight} ${sub.weight_unit}` : ""}</p>
        </div>
        <Badge variant={complete ? "default" : "outline"}>{complete ? "Complete" : "Draft"}</Badge>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {(sub.submission_type === "video" && sub.video_format === "continuous" ? (["all"] as ProgressAngle[]) : PHOTO_ANGLES).map((a) => {
          const m = media.find((mm) => mm.angle === a);
          return (
            <div key={a} className="relative aspect-square rounded bg-muted overflow-hidden">
              {m ? <MediaThumb m={m} /> : <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">{ANGLE_LABEL[a]}</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Badge variant="outline" className="text-xs">{prettyStatus(sub.review_status)}</Badge>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Card>
  );
}

function MediaThumb({ m }: { m: ProgressMedia }) {
  const { data: url } = useQuery({
    queryKey: ["sig", m.thumbnail_path || m.storage_path],
    enabled: !!(m.thumbnail_path || m.storage_path),
    queryFn: () => getSignedMediaUrl(m.thumbnail_path || m.storage_path || ""),
    staleTime: 60 * 60 * 1000,
  });
  if (!url) {
    return <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">…</div>;
  }
  if (m.media_type === "video") {
    return (
      <div className="relative h-full w-full bg-black">
        <VideoIcon className="absolute inset-0 m-auto h-5 w-5 text-white/70" />
      </div>
    );
  }
  return <img src={url} alt={m.angle} loading="lazy" className="h-full w-full object-cover" />;
}

// ============== Photo submission dialog ==============

function PhotoSubmissionDialog({ ctx, open, onOpenChange }: { ctx: ProgressContext; open: boolean; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const [subId, setSubId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState("Weekly Check-In");
  const [bw, setBw] = useState("");
  const [notes, setNotes] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">(ctx.preferredWeightUnit ?? "lb");

  async function ensureSub() {
    if (subId) return subId;
    const s = await createSubmission({
      user_id: ctx.userId, owner_type: ctx.ownerType,
      client_id: ctx.clientId, member_id: ctx.memberId, assigned_coach_id: ctx.assignedCoachId ?? null,
      submission_type: "photo", submission_date: date, check_in_label: label,
    });
    setSubId(s.id);
    return s.id;
  }

  async function save(asDraft: boolean) {
    const id = await ensureSub();
    await updateSubmission(id, {
      submission_date: date, check_in_label: label,
      bodyweight: bw ? Number(bw) : null, weight_unit: bw ? unit : null,
      notes: notes || null,
      review_status: asDraft ? "draft" : ctx.canRequestReview ? "awaiting_review" : "self_tracking",
      submitted_at: asDraft ? null : new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ["progress-subs", ctx.userId] });
    qc.invalidateQueries({ queryKey: ["progress-subs-photo", ctx.userId] });
    toast.success(asDraft ? "Saved as draft" : ctx.canRequestReview ? "Submitted to your coach" : "Saved to your progress");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Progress Photos</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <DateField value={date} onChange={setDate} />
            <div>
              <Label className="text-xs">Label</Label>
              <Select value={label} onValueChange={setLabel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHECK_IN_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <details className="rounded-md border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Photo consistency tips</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Use similar lighting</li>
              <li>Use the same camera distance</li>
              <li>Same four angles, stand in a consistent position</li>
              <li>Take photos at a similar time of day</li>
            </ul>
          </details>

          <div className="grid grid-cols-2 gap-3">
            {PHOTO_ANGLES.map((a) => (
              <AngleUploadCard
                key={a} angle={a} mediaType="photo" ctx={ctx}
                getSubId={ensureSub} subId={subId}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Bodyweight (optional)</Label>
              <div className="flex gap-2">
                <Input type="number" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} placeholder="—" />
                <Select value={unit} onValueChange={(v: any) => setUnit(v)}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="kg">kg</SelectItem><SelectItem value="lb">lb</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => save(true)}>Save Draft</Button>
          <Button onClick={() => save(false)}>{ctx.canRequestReview ? "Submit for Coach Review" : "Save to My Progress"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AngleUploadCard({
  angle, mediaType, ctx, getSubId, subId,
}: {
  angle: ProgressAngle; mediaType: "photo" | "video"; ctx: ProgressContext;
  getSubId: () => Promise<string>; subId: string | null;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data: media = [] } = useQuery({
    queryKey: ["progress-media", subId],
    enabled: !!subId,
    queryFn: () => listMediaForSubmission(subId!),
  });
  const existing = media.find((m) => m.angle === angle);

  async function onFile(f: File) {
    setErr(null);
    try {
      const sid = await getSubId();
      // Pre-create media row in "uploading" state
      const m = await createMedia({
        submission_id: sid, user_id: ctx.userId, media_type: mediaType, angle,
        original_filename: f.name, file_size_bytes: f.size, mime_type: f.type,
        upload_status: "uploading",
      });
      qc.invalidateQueries({ queryKey: ["progress-media", sid] });
      setProgress(0);
      const res = await uploadProgressFile({
        file: f, userId: ctx.userId, onProgress: (p) => setProgress(p),
      });
      await updateMedia(m.id, {
        storage_path: res.path, thumbnail_path: res.path,
        mime_type: res.mimeType, file_size_bytes: res.sizeBytes,
        upload_status: "ready", drive_sync_status: "pending",
      } as any);
      setProgress(100);
      qc.invalidateQueries({ queryKey: ["progress-media", sid] });
      setTimeout(() => setProgress(null), 1500);
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
      setProgress(null);
    }
  }

  async function remove() {
    if (!existing) return;
    await deleteMedia(existing.id);
    qc.invalidateQueries({ queryKey: ["progress-media", subId] });
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">{ANGLE_LABEL[angle]}</p>
        {existing && existing.upload_status === "ready" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
      </div>
      <div className="aspect-square rounded bg-muted relative overflow-hidden">
        {existing ? (
          <MediaThumb m={existing} />
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <ImagePlus className="h-6 w-6" />
            Tap to upload
          </button>
        )}
        {progress != null && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 p-2">
            <ProgressBar value={progress} className="h-1" />
            <p className="text-[10px] text-white mt-1">{progress < 100 ? `Uploading ${progress}%` : "Saved"}</p>
          </div>
        )}
      </div>
      <input
        ref={fileRef} type="file"
        accept={mediaType === "photo" ? "image/*" : "video/*"}
        capture={mediaType === "video" ? undefined : "environment" as any}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => fileRef.current?.click()}>
          {existing ? "Replace" : "Upload"}
        </Button>
        {existing && (
          <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>
      {err && <p className="text-xs text-destructive mt-1">{err}</p>}
    </Card>
  );
}

// ============== Video submission dialog ==============

function VideoSubmissionDialog({ ctx, open, onOpenChange }: { ctx: ProgressContext; open: boolean; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<ProgressVideoFormat>("four_angle");
  const [subId, setSubId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState("Weekly Check-In");
  const [bw, setBw] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">(ctx.preferredWeightUnit ?? "lb");
  const [notes, setNotes] = useState("");

  async function ensureSub() {
    if (subId) return subId;
    const s = await createSubmission({
      user_id: ctx.userId, owner_type: ctx.ownerType,
      client_id: ctx.clientId, member_id: ctx.memberId, assigned_coach_id: ctx.assignedCoachId ?? null,
      submission_type: "video", video_format: format,
      submission_date: date, check_in_label: label,
    });
    setSubId(s.id);
    return s.id;
  }

  async function save(asDraft: boolean) {
    const id = await ensureSub();
    await updateSubmission(id, {
      video_format: format, submission_date: date, check_in_label: label,
      bodyweight: bw ? Number(bw) : null, weight_unit: bw ? unit : null,
      notes: notes || null,
      review_status: asDraft ? "draft" : ctx.canRequestReview ? "awaiting_review" : "self_tracking",
      submitted_at: asDraft ? null : new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ["progress-subs", ctx.userId] });
    qc.invalidateQueries({ queryKey: ["progress-subs-video", ctx.userId] });
    toast.success(asDraft ? "Saved as draft" : "Submitted");
    onOpenChange(false);
  }

  const angles: ProgressAngle[] = format === "continuous" ? ["all"] : PHOTO_ANGLES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Progress Video</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={format === "four_angle" ? "default" : "outline"} onClick={() => setFormat("four_angle")}>
              Four Angles
            </Button>
            <Button variant={format === "continuous" ? "default" : "outline"} onClick={() => setFormat("continuous")}>
              One Continuous
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DateField value={date} onChange={setDate} />
            <div>
              <Label className="text-xs">Label</Label>
              <Select value={label} onValueChange={setLabel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHECK_IN_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={`grid gap-3 ${angles.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {angles.map((a) => (
              <AngleUploadCard key={a} angle={a} mediaType="video" ctx={ctx} getSubId={ensureSub} subId={subId} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Bodyweight (optional)</Label>
              <div className="flex gap-2">
                <Input type="number" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} />
                <Select value={unit} onValueChange={(v: any) => setUnit(v)}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="kg">kg</SelectItem><SelectItem value="lb">lb</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => save(true)}>Save Draft</Button>
          <Button onClick={() => save(false)}>{ctx.canRequestReview ? "Submit for Coach Review" : "Save to My Progress"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Bodyweight ==============

function BodyweightTab({
  ctx, onLog, onOpenSubmission,
}: { ctx: ProgressContext; onLog: () => void; onOpenSubmission?: (id: string) => void }) {
  const qc = useQueryClient();
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "all">("all");
  const [selectedPoint, setSelectedPoint] = useState<{ date: string; value: number; unit: "kg" | "lb"; note?: string | null } | null>(null);
  const { data: rows = [] } = useQuery({
    queryKey: ["progress-bw", ctx.userId],
    queryFn: () => listBodyweight(ctx.userId),
  });
  const { data: metricRows = [] } = useQuery({
    queryKey: ["progress-metrics", ctx.clientId],
    enabled: !!ctx.clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress_metrics")
        .select("*")
        .eq("client_id", ctx.clientId!)
        .not("bodyweight", "is", null)
        .order("entry_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ProgressMetric[];
    },
  });
  const combinedRows = useMemo(() => {
    const byDate = new Map<string, { id: string; date: string; value: number; unit: "kg" | "lb"; note?: string | null; source: "progress_bodyweight" | "progress_metrics" }>();
    for (const r of metricRows) {
      if (r.bodyweight == null) continue;
      byDate.set(r.entry_date, {
        id: r.id,
        date: r.entry_date,
        value: Number(r.bodyweight),
        unit: ((r.bodyweight_unit as "kg" | "lb" | null) ?? ctx.preferredWeightUnit ?? "lb"),
        note: (r as any).notes ?? null,
        source: "progress_metrics",
      });
    }
    for (const r of rows) {
      byDate.set(r.logged_date, {
        id: r.id,
        date: r.logged_date,
        value: Number(r.weight_value),
        unit: r.weight_unit,
        note: r.note,
        source: "progress_bodyweight",
      });
    }
    return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [ctx.preferredWeightUnit, metricRows, rows]);

  const stats = bodyweightStats(combinedRows.map((r) => ({
    id: r.id,
    user_id: ctx.userId,
    logged_date: r.date,
    weight_value: r.value,
    weight_unit: r.unit,
    note: r.note ?? null,
    created_at: "",
  })));

  const unit = combinedRows[0]?.unit ?? ctx.preferredWeightUnit ?? "lb";
  const chartAll = useMemo(() => {
    return [...combinedRows]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        d: r.date,
        v: Number(convertWeight(r.value, r.unit, unit).toFixed(1)),
        unit,
        note: r.note,
      }));
  }, [combinedRows, unit]);
  const chart = useMemo(() => {
    if (range === "all") return chartAll;
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return chartAll.filter((p) => new Date(p.d) >= cutoff);
  }, [chartAll, range]);
  const yDomain = chart.length === 1 ? [chart[0].v - 1, chart[0].v + 1] : ["auto", "auto"];

  function handlePointClick(point?: { d: string; v: number; unit: "kg" | "lb"; note?: string | null }) {
    if (!point) return;
    setSelectedPoint({ date: point.d, value: point.v, unit: point.unit, note: point.note ?? null });
  }

  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    await deleteBodyweight(id);
    qc.invalidateQueries({ queryKey: ["progress-bw", ctx.userId] });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Weight</h2>
        <Button size="sm" onClick={onLog}><Plus className="h-4 w-4 mr-1" />Log</Button>
      </div>
      {stats && (
        <Card className="p-4 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-2xl font-semibold">{stats.latest}</p><p className="text-xs text-muted-foreground">Latest {stats.unit}</p></div>
          <div><p className="text-2xl font-semibold">{stats.avg7 ?? "—"}</p><p className="text-xs text-muted-foreground">7-day avg</p></div>
          <div><p className="text-2xl font-semibold">{stats.change > 0 ? "+" : ""}{stats.change}</p><p className="text-xs text-muted-foreground">Since start</p></div>
        </Card>
      )}
      {chartAll.length >= 1 && (
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Bodyweight ({unit})</div>
            <div className="flex gap-1">
              {(["7d", "30d", "90d", "all"] as const).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={range === r ? "default" : "outline"}
                  className="h-7 px-2 text-[11px] uppercase"
                  onClick={() => setRange(r)}
                >
                  {r === "all" ? "All" : r}
                </Button>
              ))}
            </div>
          </div>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chart}
                margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                onClick={(e: any) => handlePointClick(e?.activePayload?.[0]?.payload)}
              >
                <defs>
                  <linearGradient id="bwChartArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="d" tickFormatter={(v) => { try { return format(parseISO(v), "MMM d"); } catch { return v; } }} tick={{ fontSize: 10 }} minTickGap={24} />
                <YAxis domain={yDomain} tick={{ fontSize: 10 }} width={32} />
                <Tooltip
                  contentStyle={{ fontSize: 12, padding: 6 }}
                  labelFormatter={(v) => { try { return format(parseISO(String(v)), "MMM d, yyyy"); } catch { return String(v); } }}
                  formatter={(v: any) => [`${v} ${unit}`, "Weight"]}
                />
                <Area
                  type="monotone" dataKey="v"
                  stroke="var(--primary)" strokeWidth={2}
                  fill="url(#bwChartArea)" isAnimationActive={false}
                  dot={(props: any) => (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill="var(--primary)"
                      stroke="var(--card)"
                      strokeWidth={2}
                      className="cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); handlePointClick(props.payload); }}
                    />
                  )}
                  activeDot={{ r: 6, onClick: (_event: unknown, payload: any) => handlePointClick(payload?.payload), style: { cursor: "pointer" } }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {selectedPoint ? (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
              <div className="font-semibold">{selectedPoint.value.toFixed(1)} {selectedPoint.unit}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(selectedPoint.date)}{selectedPoint.note ? ` · ${selectedPoint.note}` : ""}</div>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-muted-foreground">Tap a dot to see that weigh-in.</p>
          )}
        </Card>
      )}
      {!combinedRows.length ? (
        <EmptyState icon={Scale} title="No entries yet" body="Track your bodyweight to see trends over time." actionLabel="Log Weight" onAction={onLog} />
      ) : (
        <Card className="divide-y">
          {combinedRows.slice(0, 50).map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3">
              <div>
                <p className="font-medium">{r.value} {r.unit}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(r.date)} {r.note ? `· ${r.note}` : ""}</p>
              </div>
              {(ctx.viewerRole === "owner" || ctx.viewerRole === "admin") && r.source === "progress_bodyweight" ? (
                <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function BodyweightDialog({ ctx, open, onOpenChange }: { ctx: ProgressContext; open: boolean; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const [val, setVal] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">(ctx.preferredWeightUnit ?? "lb");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!val) return;
    setSaving(true);
    try {
      await logBodyweight({
        user_id: ctx.userId, weight_value: Number(val), weight_unit: unit, logged_date: date, note: note || null,
      });
      if (ctx.clientId) {
        const { data: existing, error: findError } = await supabase
          .from("progress_metrics")
          .select("id")
          .eq("client_id", ctx.clientId)
          .eq("entry_date", date)
          .maybeSingle();
        if (findError) throw findError;
        if (existing?.id) {
          const { error } = await supabase.from("progress_metrics").update({
            bodyweight: Number(val),
            bodyweight_unit: unit,
            source: "manual",
            notes: note || null,
          } as never).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("progress_metrics").insert({
            client_id: ctx.clientId,
            entry_date: date,
            bodyweight: Number(val),
            bodyweight_unit: unit,
            source: "manual",
            notes: note || null,
          } as never);
          if (error) throw error;
        }
      }
      qc.invalidateQueries({ queryKey: ["progress-bw", ctx.userId] });
      qc.invalidateQueries({ queryKey: ["progress-metrics", ctx.clientId] });
      toast.success("Logged");
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Log Weight</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input type="number" inputMode="decimal" autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Weight" />
            <Select value={unit} onValueChange={(v: any) => setUnit(v)}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="kg">kg</SelectItem><SelectItem value="lb">lb</SelectItem></SelectContent>
            </Select>
          </div>
          <DateField value={date} onChange={setDate} />
          <Textarea placeholder="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!val || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Measurements ==============

function MeasurementsTab({ ctx, onAdd }: { ctx: ProgressContext; onAdd: () => void }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["progress-meas", ctx.userId],
    queryFn: () => listMeasurements(ctx.userId),
  });
  async function remove(id: string) {
    if (!confirm("Delete this measurement?")) return;
    await deleteMeasurement(id);
    qc.invalidateQueries({ queryKey: ["progress-meas", ctx.userId] });
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Measurements</h2>
        <Button size="sm" onClick={onAdd}><Plus className="h-4 w-4 mr-1" />Add</Button>
      </div>
      {!rows.length ? (
        <EmptyState icon={Ruler} title="No measurements yet" body="Track waist, hips, arms, and more." actionLabel="Add Measurements" onAction={onAdd} />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{fmtDate(r.measured_date)} <span className="text-xs text-muted-foreground">({r.unit})</span></p>
                <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 text-sm">
                {Object.entries(r.fields).filter(([, v]) => v != null && v !== "").map(([k, v]) => {
                  const label = MEASUREMENT_FIELDS.find((f) => f.key === k)?.label ?? k;
                  return <div key={k}><span className="text-muted-foreground">{label}:</span> <strong>{String(v)}</strong></div>;
                })}
              </div>
              {r.note && <p className="mt-2 text-xs text-muted-foreground">{r.note}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function MeasurementDialog({ ctx, open, onOpenChange }: { ctx: ProgressContext; open: boolean; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [unit, setUnit] = useState<"cm" | "in">("cm");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const cleaned: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v && v.trim()) cleaned[k] = Number(v);
      }
      await logMeasurement({ user_id: ctx.userId, unit, fields: cleaned, measured_date: date, note: note || null });
      qc.invalidateQueries({ queryKey: ["progress-meas", ctx.userId] });
      toast.success("Saved");
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Measurements</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_120px] gap-2 items-end">
            <DateField value={date} onChange={setDate} />
            <div>
              <Label className="text-xs">Unit</Label>
              <Select value={unit} onValueChange={(v: any) => setUnit(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cm">cm</SelectItem><SelectItem value="in">inches</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {MEASUREMENT_FIELDS.map((f) => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type="number" inputMode="decimal"
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <Textarea placeholder="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Comparison ==============

function ComparisonDialog({ ctx, open, onOpenChange }: { ctx: ProgressContext; open: boolean; onOpenChange: (b: boolean) => void }) {
  const { data: subs = [] } = useQuery({
    queryKey: ["progress-subs-photo", ctx.userId],
    queryFn: () => listSubmissions({ userId: ctx.userId, type: "photo" }),
  });
  const [aId, setA] = useState<string | null>(null);
  const [bId, setB] = useState<string | null>(null);
  const [angle, setAngle] = useState<ProgressAngle>("front");

  useEffect(() => {
    if (!aId && subs.length >= 2) { setA(subs[subs.length - 1].id); setB(subs[0].id); }
    else if (!aId && subs.length === 1) { setA(subs[0].id); setB(subs[0].id); }
  }, [subs, aId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Compare Progress</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <SubmissionPicker label="Starting date" value={aId} onChange={setA} subs={subs} />
          <SubmissionPicker label="Comparison date" value={bId} onChange={setB} subs={subs} />
        </div>
        <div className="grid grid-cols-4 gap-1 mb-3">
          {PHOTO_ANGLES.map((a) => (
            <Button key={a} size="sm" variant={angle === a ? "default" : "outline"} onClick={() => setAngle(a)}>
              {ANGLE_LABEL[a]}
            </Button>
          ))}
        </div>
        {aId && bId && (
          <div className="grid grid-cols-2 gap-3">
            <ComparePane subId={aId} angle={angle} />
            <ComparePane subId={bId} angle={angle} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionPicker({ label, value, onChange, subs }: {
  label: string; value: string | null; onChange: (id: string) => void; subs: ProgressSubmission[];
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Pick a check-in" /></SelectTrigger>
        <SelectContent>
          {subs.map((s) => <SelectItem key={s.id} value={s.id}>{fmtDate(s.submission_date)} — {s.check_in_label || "Photos"}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ComparePane({ subId, angle }: { subId: string; angle: ProgressAngle }) {
  const { data: sub } = useQuery({ queryKey: ["progress-sub", subId], queryFn: () => getSubmission(subId) });
  const { data: media = [] } = useQuery({ queryKey: ["progress-media", subId], queryFn: () => listMediaForSubmission(subId) });
  const m = media.find((mm) => mm.angle === angle);
  const { data: url } = useQuery({
    queryKey: ["sig", m?.storage_path],
    enabled: !!m?.storage_path,
    queryFn: () => getSignedMediaUrl(m!.storage_path!),
  });
  return (
    <div>
      <div className="aspect-square bg-muted rounded overflow-hidden">
        {url ? <img loading="lazy" src={url} alt={angle} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No {ANGLE_LABEL[angle]} photo</div>}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {sub ? fmtDate(sub.submission_date) : ""} {sub?.bodyweight ? `· ${sub.bodyweight} ${sub.weight_unit}` : ""}
      </p>
    </div>
  );
}

// ============== Submission detail (gallery + review) ==============

function SubmissionDetailDialog({ ctx, submissionId, onClose }: { ctx: ProgressContext; submissionId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: sub } = useQuery({ queryKey: ["progress-sub", submissionId], queryFn: () => getSubmission(submissionId) });
  const { data: media = [] } = useQuery({ queryKey: ["progress-media", submissionId], queryFn: () => listMediaForSubmission(submissionId) });
  const { data: reviews = [] } = useQuery({ queryKey: ["progress-reviews", submissionId], queryFn: () => listReviewResponses(submissionId) });
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);

  const canReply = ctx.viewerRole === "admin" || ctx.viewerRole === "coach";

  async function submitReply() {
    if (!body.trim()) return;
    await addReviewResponse({
      submission_id: submissionId, reviewer_id: ctx.userId,
      body, kind: internal ? "internal" : "overall",
    });
    setBody(""); setInternal(false);
    qc.invalidateQueries({ queryKey: ["progress-reviews", submissionId] });
    qc.invalidateQueries({ queryKey: ["progress-sub", submissionId] });
    qc.invalidateQueries({ queryKey: ["progress-subs", ctx.userId] });
    toast.success("Sent");
  }

  async function removeSub() {
    if (!confirm("Delete this whole check-in (photos/videos and feedback)?")) return;
    await deleteSubmission(submissionId);
    qc.invalidateQueries({ queryKey: ["progress-subs", ctx.userId] });
    qc.invalidateQueries({ queryKey: ["progress-subs-photo", ctx.userId] });
    qc.invalidateQueries({ queryKey: ["progress-subs-video", ctx.userId] });
    onClose();
  }

  if (!sub) return null;
  const angles: ProgressAngle[] = sub.submission_type === "video" && sub.video_format === "continuous"
    ? ["all"] : PHOTO_ANGLES;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sub.check_in_label || (sub.submission_type === "photo" ? "Progress Photos" : "Progress Video")}</DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground mb-2">
          {fmtDate(sub.submission_date)} · {prettyStatus(sub.review_status)}
          {sub.bodyweight ? ` · ${sub.bodyweight} ${sub.weight_unit}` : ""}
        </div>
        {sub.notes && <p className="text-sm mb-3">{sub.notes}</p>}

        <div className={`grid gap-2 ${angles.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {angles.map((a) => {
            const m = media.find((mm) => mm.angle === a);
            return <DetailMediaPane key={a} angle={a} media={m} />;
          })}
        </div>

        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-2 flex items-center gap-1"><MessageSquare className="h-4 w-4" />Coach feedback</p>
          {!reviews.length ? (
            <p className="text-xs text-muted-foreground">No feedback yet.</p>
          ) : (
            <div className="space-y-2">
              {reviews.map((r) => (
                <div key={r.id} className="rounded border p-2 text-sm">
                  {r.kind === "internal" && <Badge variant="outline" className="mb-1">Internal note</Badge>}
                  <p>{r.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{fmtDate(r.created_at)}</p>
                </div>
              ))}
            </div>
          )}
          {canReply && (
            <div className="mt-3 space-y-2">
              <Textarea placeholder="Write feedback…" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Internal note (hidden from client)
                </label>
                <Button size="sm" onClick={submitReply} disabled={!body.trim()}>Send</Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {ctx.viewerRole !== "coach" && (
            <Button variant="outline" onClick={removeSub} className="text-destructive"><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailMediaPane({ angle, media }: { angle: ProgressAngle; media?: ProgressMedia }) {
  const { data: url } = useQuery({
    queryKey: ["sig", media?.storage_path],
    enabled: !!media?.storage_path,
    queryFn: () => getSignedMediaUrl(media!.storage_path!),
  });
  return (
    <div>
      <p className="text-xs font-medium mb-1">{ANGLE_LABEL[angle]}</p>
      <div className="aspect-square bg-muted rounded overflow-hidden">
        {!media ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Not uploaded</div>
        ) : url ? (
          media.media_type === "video"
            ? <video controls src={url} className="h-full w-full object-contain bg-black" />
            : <img loading="lazy" src={url} alt={angle} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" /></div>
        )}
      </div>
      {media && (
        <p className="text-[10px] text-muted-foreground mt-1">
          {prettyUploadStatus(media.upload_status)} · Drive: {media.drive_sync_status ?? "pending"}
        </p>
      )}
    </div>
  );
}

// ============== Timeline ==============

function TimelineTab({ ctx, onOpen }: { ctx: ProgressContext; onOpen: (id: string) => void }) {
  const { data: subs = [] } = useQuery({ queryKey: ["progress-subs", ctx.userId], queryFn: () => listSubmissions({ userId: ctx.userId }) });
  const { data: bw = [] } = useQuery({ queryKey: ["progress-bw", ctx.userId], queryFn: () => listBodyweight(ctx.userId) });
  const { data: meas = [] } = useQuery({ queryKey: ["progress-meas", ctx.userId], queryFn: () => listMeasurements(ctx.userId) });
  const [filter, setFilter] = useState<"all" | "photos" | "videos" | "weight" | "measure">("all");

  type Item = { at: string; kind: string; title: string; subtitle?: string; id?: string; onClick?: () => void };
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (filter === "all" || filter === "photos") subs.filter((s) => s.submission_type === "photo").forEach((s) => out.push({
      at: s.submission_date, kind: "Photos", title: s.check_in_label || "Progress Photos",
      subtitle: prettyStatus(s.review_status), id: s.id,
    }));
    if (filter === "all" || filter === "videos") subs.filter((s) => s.submission_type === "video").forEach((s) => out.push({
      at: s.submission_date, kind: "Video", title: s.check_in_label || "Progress Video",
      subtitle: prettyStatus(s.review_status), id: s.id,
    }));
    if (filter === "all" || filter === "weight") bw.forEach((r) => out.push({
      at: r.logged_date, kind: "Weight", title: `${r.weight_value} ${r.weight_unit}`, subtitle: r.note ?? undefined,
    }));
    if (filter === "all" || filter === "measure") meas.forEach((r) => out.push({
      at: r.measured_date, kind: "Measure", title: `${Object.keys(r.fields).length} fields`, subtitle: r.unit,
    }));
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }, [subs, bw, meas, filter]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto">
        {(["all", "photos", "videos", "weight", "measure"] as const).map((k) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{k}</Button>
        ))}
      </div>
      {!items.length ? (
        <p className="text-sm text-muted-foreground p-4 text-center">Nothing yet.</p>
      ) : (
        <div className="space-y-4">
          {Array.from(
            items.reduce<Map<string, Item[]>>((m, it) => {
              const arr = m.get(it.at) ?? [];
              arr.push(it);
              m.set(it.at, arr);
              return m;
            }, new Map()).entries(),
          ).map(([date, group]) => (
            <div key={date} className="space-y-2">
              <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {fmtDate(date)}
                </p>
              </div>
              {group.map((it, i) => (
                <Card key={i} className={`p-3 ${it.id ? "cursor-pointer hover:bg-accent/50" : ""}`} onClick={() => it.id && onOpen(it.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">{it.kind}</p>
                      <p className="font-medium">{it.title}</p>
                      {it.subtitle && <p className="text-xs text-muted-foreground">{it.subtitle}</p>}
                    </div>
                    {it.id && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============== Empty / utils ==============

function EmptyState({ icon: Icon, title, body, actionLabel, onAction }: { icon: any; title: string; body: string; actionLabel: string; onAction: () => void }) {
  return (
    <Card className="p-8 text-center">
      <Icon className="mx-auto h-10 w-10 text-primary" />
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Button className="mt-4" onClick={onAction}>{actionLabel}</Button>
    </Card>
  );
}

function fmtDate(d: string) { try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; } }
function prettyStatus(s: string) {
  switch (s) {
    case "draft": return "Draft";
    case "submitted": case "awaiting_review": return "Awaiting Review";
    case "reviewed": return "Reviewed";
    case "needs_update": return "Needs Update";
    case "self_tracking": return "Saved";
    default: return s;
  }
}
function prettyUploadStatus(s: string) {
  switch (s) {
    case "draft": return "Draft";
    case "uploading": return "Uploading";
    case "ready": return "Ready";
    case "syncing_drive": return "Syncing to Drive";
    case "saved_to_drive": return "Saved to Drive";
    case "upload_failed": return "Upload failed";
    case "sync_failed": return "Sync failed";
    default: return s;
  }
}
