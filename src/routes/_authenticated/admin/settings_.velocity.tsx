/**
 * Bar speed from set videos: what the automatic reader is doing, so nothing
 * waits or fails unseen (admins; the view-only admin login reads it).
 *
 * Every set video of a barbell lift gets a job (set_velocity_jobs). The
 * server's reader (.github/workflows/velocity-worker.yml →
 * scripts/velocity-worker) reads it with no phone open; this page lists the
 * jobs newest first with where each stands, what it found and whether its
 * speed is on the set, from `velocity_admin_overview`, and reads one again
 * with `velocity_admin_requeue` (never over a person's own read or a speed
 * already on the set).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QueryState, EmptyState } from "@/components/loading/query-state";
import { ListSkeleton } from "@/components/loading/skeletons";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/settings_/velocity")({
  component: VelocityDiagnostics,
});

type Job = {
  set_video_id: string;
  client_id: string | null;
  athlete: string;
  exercise: string;
  set_index: number;
  origin: string | null;
  created_at: string;
  status: string;
  enabled: boolean;
  worker: string | null;
  stage: string | null;
  outcome: string | null;
  error: string | null;
  attempts: number;
  server_attempts: number;
  available_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  compute_ms: number | null;
  analysis: {
    status: string;
    engine: string | null;
    source: string | null;
    units: string | null;
    reps: number | null;
    accepted: boolean | null;
    set_mcv: number | null;
    excluded: boolean | null;
    why: string | null;
    reasons: string[] | null;
    view: string | null;
  } | null;
  set: {
    reps: number | null;
    load_kg: number | null;
    velocity: number | null;
    source: string | null;
    quality: string | null;
    from_this_video: boolean | null;
  } | null;
  /** The athlete's body read (pl_set_video_poses), null before the bar's read is saved. */
  pose: {
    status: string;
    attempts: number;
    available_at: string | null;
    found: number | null;
    frames: number | null;
    view: string | null;
    error: string | null;
    why: string | null;
    compute_ms: number | null;
    observations: number;
  } | null;
};

type Overview = {
  worker: { last_seen?: string; worker?: string; updated_at?: string } | null;
  counts: Record<string, number>;
  pose_counts: Record<string, number>;
  oldest_queued: string | null;
  jobs: Job[];
};

/** Where a job stands, in one word, for the filter (pure). */
export function jobBucket(
  j: Pick<Job, "status" | "enabled" | "available_at" | "set" | "analysis">,
): string {
  if (!j.enabled) return "off";
  if (j.set?.from_this_video && j.set.velocity != null) return "logged";
  if (j.status === "running") return "reading";
  if (j.status === "queued")
    return j.available_at && Date.parse(j.available_at) > Date.now() ? "retrying" : "waiting";
  if (j.status === "failed") return "failed";
  if (j.status === "cancelled") return "removed";
  return "no_speed";
}

/** Where the body read stands, in words (pure). */
export function poseWords(p: Job["pose"]): { text: string; tone: string } | null {
  if (!p) return null;
  if (p.status === "done") {
    const seen = p.frames ? `${p.found ?? 0} of ${p.frames} frames` : "read";
    const view = p.view && p.view !== "unknown" ? `, ${p.view} view` : "";
    const obs = p.observations
      ? `, ${p.observations} observation${p.observations === 1 ? "" : "s"}`
      : "";
    return { text: `Body read: ${seen}${view}${obs}`, tone: "text-muted-foreground" };
  }
  if (p.status === "no_body")
    return { text: "Body read: no one found in the frame", tone: "text-warning" };
  if (p.status === "running")
    return { text: "Body read: reading on the server", tone: "text-muted-foreground" };
  if (p.status === "queued")
    return p.available_at && Date.parse(p.available_at) > Date.now()
      ? { text: `Body read: trying again${p.error ? ` (${p.error})` : ""}`, tone: "text-warning" }
      : { text: "Body read: waiting", tone: "text-muted-foreground" };
  if (p.status === "failed")
    return { text: `Body read failed${p.error ? `: ${p.error}` : ""}`, tone: "text-destructive" };
  return null;
}

const BUCKETS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "reading", label: "Reading" },
  { key: "retrying", label: "Retrying" },
  { key: "logged", label: "On the set" },
  { key: "no_speed", label: "No speed" },
  { key: "failed", label: "Failed" },
  { key: "off", label: "Off" },
];

const BUCKET_WORD: Record<string, string> = {
  logged: "On the set",
  reading: "Reading",
  waiting: "Waiting",
  retrying: "Trying again",
  failed: "Failed",
  no_speed: "No speed logged",
  removed: "Video removed",
  off: "Automatic reading off",
};

const BUCKET_TONE: Record<string, string> = {
  logged: "text-success",
  failed: "text-destructive",
  no_speed: "text-warning",
  retrying: "text-warning",
};

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function VelocityDiagnostics() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const [bucket, setBucket] = useState("all");

  const overview = useQuery({
    queryKey: ["velocity-admin-overview"],
    queryFn: async (): Promise<Overview> => {
      const { data, error } = await (supabase.rpc as any)("velocity_admin_overview", {
        _limit: 300,
      });
      if (error) throw error;
      const o = (data ?? {}) as Overview;
      return {
        worker: o.worker ?? null,
        counts: o.counts ?? {},
        pose_counts: o.pose_counts ?? {},
        oldest_queued: o.oldest_queued ?? null,
        jobs: o.jobs ?? [],
      };
    },
    refetchInterval: 30_000,
  });

  const requeue = useMutation({
    mutationFn: async (video: string) => {
      const { data, error } = await (supabase.rpc as any)("velocity_admin_requeue", {
        _video: video,
      });
      if (error) throw error;
      return String(data ?? "");
    },
    onSuccess: (r) => {
      toast.success(
        r === "queued"
          ? "Queued to read again"
          : r === "running"
            ? "It's being read now"
            : "Kept: a person's read or a speed on the set",
      );
      void qc.invalidateQueries({ queryKey: ["velocity-admin-overview"] });
    },
    onError: () => toast.error("Couldn't queue it"),
  });

  const requeuePose = useMutation({
    mutationFn: async (video: string) => {
      const { data, error } = await (supabase.rpc as any)("pose_admin_requeue", { _video: video });
      if (error) throw error;
      return String(data ?? "");
    },
    onSuccess: (r) => {
      toast.success(
        r === "running"
          ? "It's being read now"
          : r === "removed"
            ? "The video was removed"
            : "Body queued to read again",
      );
      void qc.invalidateQueries({ queryKey: ["velocity-admin-overview"] });
    },
    onError: () => toast.error("Couldn't queue it"),
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <PageHeader
        title="Bar speed from videos"
        subtitle="Every barbell set video is read automatically on the server. This is what it's doing."
        backTo="/admin/settings"
      />
      <QueryState query={overview} what="the readings" skeleton={<ListSkeleton rows={6} />}>
        {(o) => (
          <Body
            o={o}
            bucket={bucket}
            setBucket={setBucket}
            canRequeue={isAdmin}
            onRequeue={(id) => requeue.mutate(id)}
            busyId={requeue.isPending ? requeue.variables : null}
            onRequeuePose={(id) => requeuePose.mutate(id)}
            poseBusyId={requeuePose.isPending ? requeuePose.variables : null}
          />
        )}
      </QueryState>
    </div>
  );
}

function Body({
  o,
  bucket,
  setBucket,
  canRequeue,
  onRequeue,
  busyId,
  onRequeuePose,
  poseBusyId,
}: {
  o: Overview;
  bucket: string;
  setBucket: (b: string) => void;
  canRequeue: boolean;
  onRequeue: (id: string) => void;
  busyId: string | null | undefined;
  onRequeuePose: (id: string) => void;
  poseBusyId: string | null | undefined;
}) {
  const withBucket = useMemo(() => o.jobs.map((j) => ({ j, b: jobBucket(j) })), [o.jobs]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: withBucket.length };
    for (const { b } of withBucket) c[b] = (c[b] ?? 0) + 1;
    return c;
  }, [withBucket]);
  const shown = bucket === "all" ? withBucket : withBucket.filter((x) => x.b === bucket);
  const waiting = (o.counts.queued ?? 0) + (o.counts.running ?? 0);
  const bodiesWaiting = (o.pose_counts.queued ?? 0) + (o.pose_counts.running ?? 0);
  const lastSeen = o.worker?.last_seen ?? null;
  const stale = waiting > 0 && (!lastSeen || Date.now() - Date.parse(lastSeen) > 45 * 60_000);

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold">Server reader</p>
          <p className={cn("text-sm", stale ? "text-destructive" : "text-muted-foreground")}>
            Last seen {ago(lastSeen)}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {waiting === 0
            ? "Nothing waiting."
            : `${waiting} waiting${o.oldest_queued ? `, the oldest since ${ago(o.oldest_queued)}` : ""}. It runs every 30 minutes and keeps reading while videos arrive.`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Body reads (joints for Technique): {o.pose_counts.done ?? 0} done
          {bodiesWaiting ? ` · ${bodiesWaiting} waiting` : ""}
          {o.pose_counts.no_body ? ` · ${o.pose_counts.no_body} with no one in frame` : ""}
          {o.pose_counts.failed ? ` · ${o.pose_counts.failed} failed` : ""}. Read after each video's
          bar speed.
        </p>
        {stale && (
          <p className="mt-2 text-sm text-destructive">
            Videos are waiting and the reader hasn't checked in. Check the "Velocity worker"
            workflow on GitHub (Actions).
          </p>
        )}
      </Card>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter">
        {BUCKETS.filter((b) => b.key === "all" || (counts[b.key] ?? 0) > 0 || bucket === b.key).map(
          (b) => (
            <button
              key={b.key}
              type="button"
              role="tab"
              aria-selected={bucket === b.key}
              onClick={() => setBucket(b.key)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm",
                bucket === b.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground",
              )}
            >
              {b.label} <span className="tabular-nums opacity-70">{counts[b.key] ?? 0}</span>
            </button>
          ),
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing here" detail="No set videos in this filter." />
      ) : (
        <Card className="divide-y divide-border p-0">
          {shown.map(({ j, b }) => (
            <JobRow
              key={j.set_video_id}
              j={j}
              b={b}
              canRequeue={canRequeue}
              onRequeue={onRequeue}
              busy={busyId === j.set_video_id}
              onRequeuePose={onRequeuePose}
              poseBusy={poseBusyId === j.set_video_id}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function JobRow({
  j,
  b,
  canRequeue,
  onRequeue,
  busy,
  onRequeuePose,
  poseBusy,
}: {
  j: Job;
  b: string;
  canRequeue: boolean;
  onRequeue: (id: string) => void;
  busy: boolean;
  onRequeuePose: (id: string) => void;
  poseBusy: boolean;
}) {
  const a = j.analysis;
  const detail =
    b === "reading"
      ? `${j.worker === "server" ? "On the server" : "On a phone"}${j.stage ? ` · ${j.stage}` : ""}${j.heartbeat_at ? ` · ${ago(j.heartbeat_at)}` : ""}`
      : (j.error ?? (a?.why && b !== "logged" ? a.why.replace(/_/g, " ") : null));
  const speed =
    j.set?.from_this_video && j.set.velocity != null
      ? j.set.velocity
      : a?.accepted
        ? a.set_mcv
        : null;
  const requeueable =
    canRequeue && b !== "reading" && b !== "logged" && b !== "removed" && a?.source !== "tap";
  const body = poseWords(j.pose);
  const poseRequeueable =
    canRequeue && !!j.pose && (j.pose.status === "failed" || j.pose.status === "no_body");
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          {j.client_id ? (
            <ClientNameLink clientId={j.client_id} className="font-medium hover:underline">
              {j.athlete || "Client"}
            </ClientNameLink>
          ) : (
            <span className="font-medium">{j.athlete || "Client"}</span>
          )}
          <span className="text-muted-foreground">
            {" "}
            · {j.exercise}
            {j.set_index > 0 ? ` · Set ${j.set_index}` : ""}
          </span>
        </p>
        <p className="mt-0.5 text-sm">
          <span className={cn("font-medium", BUCKET_TONE[b])}>{BUCKET_WORD[b] ?? b}</span>
          {speed != null && <span className="tabular-nums"> · {speed.toFixed(2)} m/s</span>}
          {a?.reps != null && <span className="text-muted-foreground"> · {a.reps} reps seen</span>}
          {j.set?.reps != null && (
            <span className="text-muted-foreground"> · {j.set.reps} logged</span>
          )}
        </p>
        {detail && <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>}
        {body && <p className={cn("mt-0.5 text-sm", body.tone)}>{body.text}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sent {ago(j.created_at)}
          {j.server_attempts > 0 ? ` · server tries ${j.server_attempts}` : ""}
          {j.compute_ms ? ` · read in ${Math.round(j.compute_ms / 1000)} s` : ""}
          {a?.engine ? ` · ${a.engine}` : ""}
          {j.outcome ? ` · ${j.outcome.replace(/_/g, " ")}` : ""}
        </p>
      </div>
      {(requeueable || poseRequeueable) && (
        <div className="flex shrink-0 flex-col items-end gap-2">
          {requeueable && (
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() => onRequeue(j.set_video_id)}
              aria-label="Read again"
            >
              <RotateCcw className="h-4 w-4" />
              Read again
            </Button>
          )}
          {poseRequeueable && (
            <Button
              variant="ghost"
              size="sm"
              loading={poseBusy}
              onClick={() => onRequeuePose(j.set_video_id)}
            >
              Read body again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
