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
  listSubmissionsPaged, listPrimaryThumbsForSubmissions, getSignedMediaUrlsBatch,
  type ProgressSubmissionCard,
} from "@/lib/progress";
import { format, parseISO } from "date-fns";
import { WaterTrackerCard } from "./water-tracker-card";
import { convertWeight, type ProgressMetric } from "@/lib/progress-metrics";
import { compressImage } from "@/lib/image-compress";

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
  const { data: bwRows = [] } = useQuery({
    queryKey: ["progress-bw", ctx.userId],
    queryFn: () => listBodyweight(ctx.userId),
    staleTime: 60_000,
  });
  const { data: photoSubs = [] } = useQuery({
    queryKey: ["progress-subs-photo", ctx.userId],
    queryFn: () => listSubmissionsPaged({ userId: ctx.userId, type: "photo", limit: 6 }),
    staleTime: 60_000,
  });
  const { data: videoSubs = [] } = useQuery({
    queryKey: ["progress-subs-video", ctx.userId],
    queryFn: () => listSubmissionsPaged({ userId: ctx.userId, type: "video", limit: 6 }),
    staleTime: 60_000,
  });
  const { data: measRows = [] } = useQuery({
    queryKey: ["progress-meas", ctx.userId],
    queryFn: () => listMeasurements(ctx.userId),
    staleTime: 60_000,
  });

  const stats = useMemo(() => bodyweightStats(bwRows), [bwRows]);

  const weightChart = useMemo(() => {
    if (!bwRows.length) return [];
    const unit = stats?.unit ?? bwRows[0].weight_unit;
    const convert = (r: ProgressBodyweight) =>
      r.weight_unit === unit
        ? r.weight_value
        : r.weight_unit === "kg"
        ? +(r.weight_value * 2.20462).toFixed(2)
        : +(r.weight_value / 2.20462).toFixed(2);
    return [...bwRows]
      .sort((a, b) => a.logged_date.localeCompare(b.logged_date))
      .slice(-14)
      .map((r) => ({ d: r.logged_date, v: convert(r) }));
  }, [bwRows, stats]);

  const activities = useMemo(() => {
    const items: {
      type: "weight" | "photo" | "video" | "measurement";
      id: string;
      date: string;
      label: string;
      detail?: string;
    }[] = [];
    bwRows.forEach((r) =>
      items.push({
        type: "weight",
        id: r.id,
        date: r.logged_date,
        label: `${r.weight_value.toFixed(1)} ${r.weight_unit}`,
      })
    );
    photoSubs.forEach((s) =>
      items.push({
        type: "photo",
        id: s.id,
        date: s.submission_date,
        label: s.check_in_label || "Progress Photos",
        detail: s.bodyweight ? `${s.bodyweight} ${s.weight_unit}` : undefined,
      })
    );
    videoSubs.forEach((s) =>
      items.push({
        type: "video",
        id: s.id,
        date: s.submission_date,
        label: s.check_in_label || "Progress Video",
        detail: s.bodyweight ? `${s.bodyweight} ${s.weight_unit}` : undefined,
      })
    );
    measRows.forEach((r) =>
      items.push({
        type: "measurement",
        id: r.id,
        date: r.measured_date,
        label: "Measurements",
      })
    );
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  }, [bwRows, photoSubs, videoSubs, measRows]);

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

      {/* Weight — full-width hero card with bigger graph and change from start */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Weight</h3>
          {stats && <button onClick={() => onViewTab("bodyweight")} className="text-xs text-primary font-medium hover:underline">View all</button>}
        </div>
        {stats ? (
          <div>
            <div className="flex items-end gap-3">
              <div>
                <p className="text-3xl font-black tabular-nums leading-none">{stats.latest}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{stats.unit}{stats.avg7 != null ? ` · 7-day avg ${stats.avg7}` : ""}</p>
              </div>
              {stats.count > 1 && (
                <div className={`ml-auto text-right pb-0.5 ${stats.change < 0 ? "text-emerald-400" : stats.change > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                  <p className="text-xl font-bold tabular-nums leading-none">{stats.change > 0 ? "+" : ""}{stats.change} {stats.unit}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">from start ({stats.startWeight} {stats.unit})</p>
                </div>
              )}
            </div>
            {weightChart.length >= 2 && (
              <div className="mt-3 h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weightChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="overviewBwArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="d" hide />
                    <YAxis hide domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, padding: 6 }}
                      labelFormatter={(d: string) => d}
                      formatter={(v: any) => [`${v} ${stats.unit}`, "Weight"]}
                    />
                    <Area type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} fill="url(#overviewBwArea)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : (
          <MiniEmpty body="No weight logged." actionLabel="Log weight" onAction={onLogWeight} />
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Photos */}
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Photos</h3>
            {photoSubs.length > 0 && <button onClick={() => onViewTab("photos")} className="text-xs text-primary font-medium hover:underline">View all</button>}
          </div>
          {photoSubs.length > 0 ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {photoSubs.slice(0, 2).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => onViewTab("photos")}
                  className="relative aspect-square overflow-hidden rounded bg-muted text-left"
                >
                  <LazyMount className="h-full w-full">
                    <SubmissionThumb sub={sub} />
                  </LazyMount>
                </button>
              ))}
            </div>
          ) : (
            <MiniEmpty body="No photos yet." actionLabel="Add photos" onAction={onAddPhotos} />
          )}
        </Card>

        {/* Videos */}
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Videos</h3>
            {videoSubs.length > 0 && <button onClick={() => onViewTab("videos")} className="text-xs text-primary font-medium hover:underline">View all</button>}
          </div>
          {videoSubs.length > 0 ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold">{videoSubs.length}</span>{" "}
              <span className="text-muted-foreground">total · last {fmtDate(videoSubs[0].submission_date)}</span>
            </p>
          ) : (
            <MiniEmpty body="No videos yet." actionLabel="Add video" onAction={onAddVideo} />
          )}
        </Card>

        {/* Body Composition — show actual latest measurement values */}
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Body Composition</h3>
            {measRows.length > 0 && <button onClick={() => onViewTab("measurements")} className="text-xs text-primary font-medium hover:underline">View all</button>}
          </div>
          {measRows.length > 0 ? (() => {
            const latest = measRows[0];
            const unit = latest.unit;
            const keyFields = ["waist", "hips", "chest", "arm_l", "thigh_l"] as const;
            const shown = keyFields.filter((k) => latest.fields[k] != null && Number(latest.fields[k]) > 0);
            const LABELS: Record<string, string> = { waist: "Waist", hips: "Hips", chest: "Chest", arm_l: "Arm", thigh_l: "Thigh" };
            if (!shown.length) return <MiniEmpty body="No measurements yet." actionLabel="Add measurements" onAction={onAddMeasurements} />;
            return (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground mb-2">Last logged {fmtDate(latest.measured_date)}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {shown.map((k) => (
                    <div key={k} className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">{LABELS[k]}</span>
                      <span className="text-sm font-bold tabular-nums">{Number(latest.fields[k]).toFixed(1)} <span className="text-[10px] font-normal text-muted-foreground">{unit}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })() : (
            <MiniEmpty body="No measurements yet." actionLabel="Add measurements" onAction={onAddMeasurements} />
          )}
        </Card>
      </div>

      {/* Recent activity list */}
      <Card className="p-3">
        <h3 className="text-sm font-semibold">Recent Activity</h3>
        {activities.length > 0 ? (
          <ul className="mt-2 divide-y divide-border/60">
            {activities.map((a) => {
              const Icon =
                a.type === "weight" ? Scale :
                a.type === "photo" ? Camera :
                a.type === "video" ? VideoIcon :
                Ruler;
              return (
                <li key={`${a.type}-${a.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">{a.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {fmtDate(a.date)}{a.detail ? ` · ${a.detail}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
        )}
      </Card>
    </div>
  );
}

function SubmissionThumb({ sub }: { sub: Pick<ProgressSubmission, "id" | "submission_type"> }) {
  const { data: media = [] } = useQuery({
    queryKey: ["progress-media", sub.id],
    queryFn: () => listMediaForSubmission(sub.id),
    staleTime: 60 * 60 * 1000,
  });
  const firstReady = media.find((m) => m.upload_status !== "draft");
  if (!firstReady) {
    return <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No preview</div>;
  }
  return <MediaThumb m={firstReady} />;
}

function MiniEmpty({ body, actionLabel, onAction }: { body: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{body}</p>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onAction}>
        <Plus className="h-3 w-3 mr-1" />{actionLabel}
      </Button>
    </div>
  );
}

/** Defer mounting children until the placeholder scrolls near the viewport. */
function LazyMount({ children, className, rootMargin = "200px" }: { children: React.ReactNode; className?: string; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !ref.current) return;
    const el = ref.current;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);
  return <div ref={ref} className={className}>{visible ? children : null}</div>;
}

// ============== Photos tab ==============

function PhotosTab({
  ctx, onNew, onOpen, onCompare,
}: { ctx: ProgressContext; onNew: () => void; onOpen: (id: string) => void; onCompare: () => void }) {
  return (
    <PaginatedSubmissionList
      ctx={ctx}
      kind="photo"
      title="Progress Photos"
      emptyIcon={Camera}
      emptyTitle="No photos"
      emptyBody="Upload progress photos."
      onNew={onNew}
      onOpen={onOpen}
      headerExtras={
        <Button variant="outline" size="sm" onClick={onCompare}>
          <Eye className="h-4 w-4 mr-1" />Compare
        </Button>
      }
    />
  );
}

function VideosTab({
  ctx, onNew, onOpen,
}: { ctx: ProgressContext; onNew: () => void; onOpen: (id: string) => void }) {
  return (
    <PaginatedSubmissionList
      ctx={ctx}
      kind="video"
      title="Progress Videos"
      emptyIcon={VideoIcon}
      emptyTitle="No videos"
      emptyBody="Record or upload a video."
      onNew={onNew}
      onOpen={onOpen}
    />
  );
}

type StatusFilter = "all" | "awaiting" | "reviewed";
const PAGE_SIZE = 6;

/**
 * Lightweight, paginated, filterable submission list.
 *
 * - One narrow paginated query for submission cards (no notes / no review meta).
 * - One batched query for primary media per visible page.
 * - One batched signed-URL fetch.
 * - NO Google Drive iframes / players in the list (open detail to view).
 */
function PaginatedSubmissionList({
  ctx, kind, title, emptyIcon, emptyTitle, emptyBody, onNew, onOpen, headerExtras,
}: {
  ctx: ProgressContext;
  kind: "photo" | "video";
  title: string;
  emptyIcon: any;
  emptyTitle: string;
  emptyBody: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  headerExtras?: React.ReactNode;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pages, setPages] = useState(1);
  // Reset pagination on filter change so we always re-request from offset 0.
  useEffect(() => { setPages(1); }, [status, kind, ctx.userId]);

  const limit = pages * PAGE_SIZE;
  const { data: subs = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["progress-subs-paged", ctx.userId, kind, status, limit],
    queryFn: () => listSubmissionsPaged({
      userId: ctx.userId,
      type: kind,
      reviewStatus: status === "all" ? undefined : status,
      limit,
      offset: 0,
    }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const ids = useMemo(() => subs.map((s) => s.id), [subs]);
  const { data: thumbs } = useQuery({
    queryKey: ["progress-primary-thumbs", ctx.userId, ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const map = await listPrimaryThumbsForSubmissions(ids);
      const paths = Array.from(map.values()).map((m) => m.thumbPath).filter((p): p is string => !!p);
      const signed = await getSignedMediaUrlsBatch(paths);
      const out = new Map<string, { url: string | null; mediaType: "photo" | "video" }>();
      for (const id of ids) {
        const m = map.get(id);
        out.set(id, {
          url: m?.thumbPath ? signed.get(m.thumbPath) ?? null : null,
          mediaType: (m?.mediaType ?? kind) as "photo" | "video",
        });
      }
      return out;
    },
  });

  const hasMore = subs.length === limit; // approximate — last page may be exactly full

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-2">
          {headerExtras}
          <Button size="sm" onClick={onNew}><Plus className="h-4 w-4 mr-1" />New</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {([
          ["all", "All"], ["awaiting", "Awaiting Review"], ["reviewed", "Reviewed"],
        ] as const).map(([k, label]) => (
          <Button
            key={k}
            size="sm"
            variant={status === k ? "default" : "outline"}
            onClick={() => setStatus(k)}
            className="h-7 px-3 text-xs"
          >
            {label}
          </Button>
        ))}
      </div>

      {isError ? (
        <Card className="p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">Progress submissions could not be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>Try Again</Button>
        </Card>
      ) : isLoading && !subs.length ? (
        <SubmissionGridSkeleton />
      ) : !subs.length ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} body={emptyBody} actionLabel="Add" onAction={onNew} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {subs.map((s) => {
              const t = thumbs?.get(s.id);
              return (
                <LightSubmissionCard
                  key={s.id}
                  sub={s}
                  thumbUrl={t?.url ?? null}
                  mediaType={t?.mediaType ?? kind}
                  onOpen={() => onOpen(s.id)}
                />
              );
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPages((p) => p + 1)}
                disabled={isFetching}
              >
                {isFetching ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Loading…</> : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SubmissionGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <div className="aspect-square w-full animate-pulse bg-muted" />
          <div className="p-3 space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function LightSubmissionCard({
  sub, thumbUrl, mediaType, onOpen,
}: {
  sub: ProgressSubmissionCard;
  thumbUrl: string | null;
  mediaType: "photo" | "video";
  onOpen: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const isVideo = mediaType === "video" || sub.submission_type === "video";
  return (
    <Card className="overflow-hidden flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-square w-full bg-muted text-left"
      >
        {thumbUrl && !imgFailed && !isVideo ? (
          <img
            src={thumbUrl}
            alt={sub.check_in_label || "Progress submission"}
            loading="lazy"
            width={400}
            height={400}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : isVideo ? (
          <div className="flex h-full w-full flex-col items-center justify-center bg-black/70 text-white">
            <VideoIcon className="h-8 w-8" />
            <span className="mt-1 text-[10px] uppercase tracking-widest opacity-80">Video</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No preview
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
          {prettyStatus(sub.review_status)}
        </span>
      </button>
      <div className="p-3 flex flex-col gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">
            {sub.check_in_label || (sub.submission_type === "photo" ? "Progress Photos" : "Progress Video")}
          </p>
          <p className="text-xs text-muted-foreground">
            {fmtDate(sub.submission_date)}{sub.bodyweight ? ` · ${sub.bodyweight} ${sub.weight_unit}` : ""}
          </p>
        </div>
        <Button size="sm" className="w-full" onClick={onOpen}>
          View Submission
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
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
          <DialogTitle>Add Progress Photos</DialogTitle>
          <p className="text-sm text-muted-foreground">Upload one photo per angle. Use consistent lighting and distance for accurate comparisons.</p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {PHOTO_ANGLES.map((a) => (
              <AngleUploadCard
                key={a} angle={a} mediaType="photo" ctx={ctx}
                getSubId={ensureSub} subId={subId}
              />
            ))}
          </div>

          <details className="rounded-md border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Details (optional)</summary>
            <div className="mt-3 space-y-3">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Bodyweight</Label>
                  <div className="flex gap-2">
                    <Input type="number" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} placeholder="—" />
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
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Use similar lighting and camera distance</li>
                <li>Same four angles, stand in a consistent position</li>
                <li>Take photos at a similar time of day</li>
              </ul>
            </div>
          </details>
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
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const localPreviewRef = useRef<string | null>(null);
  useEffect(() => { localPreviewRef.current = localPreview; }, [localPreview]);
  // Revoke only on unmount; the setter already revokes the previous URL.
  useEffect(() => () => {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
  }, []);
  const { data: media = [] } = useQuery({
    queryKey: ["progress-media", subId],
    enabled: !!subId,
    queryFn: () => listMediaForSubmission(subId!),
    staleTime: 60_000,
  });
  const existing = media.find((m) => m.angle === angle);

  async function onFile(f: File) {
    setErr(null);
    try {
      // Instant local preview — don't make the user wait for upload to "see" the file.
      const previewUrl = URL.createObjectURL(f);
      setLocalPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return previewUrl; });
      setProgress(1);

      // Compress images aggressively before upload (massive speed-up on phone photos / HEIC).
      let fileToUpload: File = f;
      if (mediaType === "photo" && f.type.startsWith("image/") && f.type !== "image/gif") {
        try {
          const compressed = await compressImage(f, { maxDimension: 2000, quality: 0.82 });
          fileToUpload = compressed instanceof File
            ? compressed
            : new File([compressed], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        } catch { /* fall back to original */ }
      }

      const sid = await getSubId();
      // Pre-create media row in "uploading" state
      const m = await createMedia({
        submission_id: sid, user_id: ctx.userId, media_type: mediaType, angle,
        original_filename: f.name, file_size_bytes: fileToUpload.size, mime_type: fileToUpload.type || f.type,
        upload_status: "uploading",
      });
      qc.invalidateQueries({ queryKey: ["progress-media", sid] });
      const res = await uploadProgressFile({
        file: fileToUpload, userId: ctx.userId, onProgress: (p) => setProgress(p),
      });
      await updateMedia(m.id, {
        storage_path: res.path, thumbnail_path: res.path,
        mime_type: res.mimeType, file_size_bytes: res.sizeBytes,
        upload_status: "ready", drive_sync_status: "pending",
      } as any);
      setProgress(100);
      qc.invalidateQueries({ queryKey: ["progress-media", sid] });
      setTimeout(() => {
        setProgress(null);
        setLocalPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      }, 800);
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
      setProgress(null);
      setLocalPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
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
      <div className="min-h-32 sm:min-h-40 aspect-square rounded bg-muted relative overflow-hidden">
        {localPreview ? (
          mediaType === "video" ? (
            <video src={localPreview} className="h-full w-full object-cover" muted playsInline />
          ) : (
            <img src={localPreview} alt={angle} className="h-full w-full object-cover" />
          )
        ) : existing ? (
          <MediaThumb m={existing} />
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground hover:bg-accent active:bg-accent"
          >
            {mediaType === "video" ? <VideoIcon className="h-8 w-8" /> : <Camera className="h-8 w-8" />}
            <span className="font-medium">{mediaType === "video" ? "Tap to record or upload" : "Tap to take or upload photo"}</span>
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
        // No `capture` attribute — lets the user pick from their photo library or take a new photo.
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
  // Default to single video upload. Four-angle is an advanced option.
  const [format, setFormat] = useState<ProgressVideoFormat>("continuous");
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
        <DialogHeader>
          <DialogTitle>Add Progress Video</DialogTitle>
          <p className="text-sm text-muted-foreground">Record or upload one video. Optional: switch to 4-angle format for a full physique breakdown.</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className={`grid gap-3 ${angles.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {angles.map((a) => (
              <AngleUploadCard key={a} angle={a} mediaType="video" ctx={ctx} getSubId={ensureSub} subId={subId} />
            ))}
          </div>

          <details className="rounded-md border border-border p-3 text-sm" open>
            <summary className="cursor-pointer font-medium">Details (optional)</summary>
            <div className="mt-3 space-y-3">
              <div>
                <Label className="text-xs">Format</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <Button size="sm" variant={format === "continuous" ? "default" : "outline"} onClick={() => setFormat("continuous")}>
                    Single Video
                  </Button>
                  <Button size="sm" variant={format === "four_angle" ? "default" : "outline"} onClick={() => setFormat("four_angle")}>
                    4-Angle Physique
                  </Button>
                </div>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Bodyweight</Label>
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
          </details>
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
    staleTime: 60_000,
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
    staleTime: 60_000,
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

  const stats = useMemo(
    () =>
      bodyweightStats(
        combinedRows.map((r) => ({
          id: r.id,
          user_id: ctx.userId,
          logged_date: r.date,
          weight_value: r.value,
          weight_unit: r.unit,
          note: r.note ?? null,
          created_at: "",
        })),
      ),
    [combinedRows, ctx.userId],
  );

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
  const yDomain = useMemo<[number | string, number | string]>(
    () => (chart.length === 1 ? [chart[0].v - 1, chart[0].v + 1] : ["auto", "auto"]),
    [chart],
  );

  // Stable custom dot renderer so recharts doesn't rebuild every render.
  const renderDot = useMemo(
    () => (props: any) => (
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
    ),
    [],
  );

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
                  dot={renderDot}
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
        <EmptyState icon={Scale} title="No weight logged" body="Log weight to see trends." actionLabel="Log Weight" onAction={onLog} />
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
    staleTime: 60_000,
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
        <EmptyState icon={Ruler} title="No measurements" body="Track waist, hips, arms, etc." actionLabel="Add" onAction={onAdd} />
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
    staleTime: 60_000,
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
  const { data: sub } = useQuery({ queryKey: ["progress-sub", subId], queryFn: () => getSubmission(subId), staleTime: 60_000 });
  const { data: media = [] } = useQuery({ queryKey: ["progress-media", subId], queryFn: () => listMediaForSubmission(subId), staleTime: 60 * 60 * 1000 });
  const m = media.find((mm) => mm.angle === angle);
  const { data: url } = useQuery({
    queryKey: ["sig", m?.storage_path],
    enabled: !!m?.storage_path,
    queryFn: () => getSignedMediaUrl(m!.storage_path!),
    staleTime: 60 * 60 * 1000,
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
  const { data: sub } = useQuery({ queryKey: ["progress-sub", submissionId], queryFn: () => getSubmission(submissionId), staleTime: 60_000 });
  const { data: media = [] } = useQuery({ queryKey: ["progress-media", submissionId], queryFn: () => listMediaForSubmission(submissionId), staleTime: 60 * 60 * 1000 });
  const { data: reviews = [] } = useQuery({ queryKey: ["progress-reviews", submissionId], queryFn: () => listReviewResponses(submissionId), staleTime: 60_000 });
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
    staleTime: 60 * 60 * 1000,
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
  const { data: subs = [] } = useQuery({ queryKey: ["progress-subs", ctx.userId], queryFn: () => listSubmissions({ userId: ctx.userId }), staleTime: 60_000 });
  const { data: bw = [] } = useQuery({ queryKey: ["progress-bw", ctx.userId], queryFn: () => listBodyweight(ctx.userId), staleTime: 60_000 });
  const { data: meas = [] } = useQuery({ queryKey: ["progress-meas", ctx.userId], queryFn: () => listMeasurements(ctx.userId), staleTime: 60_000 });
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

function EmptyState({ icon: Icon, title, body, actionLabel, onAction }: { icon: any; title: string; body?: string; actionLabel: string; onAction: () => void }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{title}</p>
          {body && <p className="text-xs text-muted-foreground leading-tight">{body}</p>}
        </div>
        <Button size="sm" onClick={onAction}>{actionLabel}</Button>
      </div>
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
