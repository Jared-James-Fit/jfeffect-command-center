import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HardDrive, Activity, Check, ChevronRight, Dumbbell, Trophy } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { ClientNameLink } from "@/components/clients/client-name-link";
import {
  buildSnapshot, waitingOnMe, groupWins, winLine, TIER_LABEL,
  type InboxRow, type SnapshotTile, type Overview, type OverviewSession, type OverviewWin,
} from "@/lib/dashboard-feed";
import { DashboardScheduleCard } from "@/components/admin-calendar/dashboard-schedule-card";
import { ChangeRequestsCard } from "@/components/schedule/change-requests-card";
import { UserAvatar } from "@/components/user-avatar";
import { getCoachIntel } from "@/lib/coach-intel";
import { DashboardOfflineEmpty, useIsOfflineWithoutCache } from "@/components/portal/dashboard-offline-empty";
import { NotificationSetupPrompt } from "@/components/notification-setup-prompt";
import { cn } from "@/lib/utils";
import { onDashboardClickCapture } from "@/components/return-to-dashboard";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function SectionHeader({ title, icon: Icon, viewAll }: { title: string; icon?: any; viewAll?: { to: string; label?: string; search?: any; params?: any } }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-bold tracking-tight">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}{title}
      </h2>
      {viewAll && (
        <Link to={viewAll.to as any} search={viewAll.search} params={viewAll.params} className="shrink-0 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
          {viewAll.label ?? "View all"} →
        </Link>
      )}
    </div>
  );
}

function DriveSetupBanner() {
  const { data } = useQuery({
    queryKey: ["media-drive-settings-banner"],
    queryFn: async () => {
      const { data } = await supabase
        .from("media_drive_settings" as any)
        .select("root_folder_id,status").limit(1).maybeSingle();
      return data as { root_folder_id?: string | null; status?: string | null } | null;
    },
  });
  const ready = !!data?.root_folder_id && data?.status === "Ready";
  if (ready) return null;
  return (
    <Card className="border-warning/40 bg-warning/5 p-3">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 truncate text-xs font-semibold">
          {data?.root_folder_id ? `Google Drive: ${data?.status ?? "Unknown"}` : "Google Drive not configured"}
        </div>
        <Button asChild size="sm" variant="outline" className="h-9 text-xs"><Link to="/admin/settings">Fix</Link></Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Snapshot: the six numbers worth seeing every morning               */
/* ------------------------------------------------------------------ */

// Colour only where it means something: red = failing, amber = needs you.
const TILE_TONE: Record<SnapshotTile["tone"], string> = {
  danger: "text-destructive",
  warn: "text-amber-600 dark:text-amber-500",
  info: "text-foreground",
};

/**
 * Only the numbers that have something in them: a zero is nothing to do, so it
 * isn't a tile. With every number at zero the grid is one calm line.
 */
function SnapshotGrid({ tiles, loading }: { tiles: SnapshotTile[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2" aria-busy="true">
        {tiles.map((t) => <div key={t.key} className="h-[76px] animate-pulse rounded-xl border border-border bg-card" />)}
      </div>
    );
  }
  const open = tiles.filter((t) => t.value > 0);
  if (open.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground" data-dashboard-caught-up>
        <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
        <span><span className="font-semibold text-foreground">All caught up.</span> No replies, check-ins, payments, agreements or programs waiting on you.</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
      {open.map((t) => {
        const inner = (
          <div
            title={t.hint}
            className="flex h-full min-h-[76px] flex-col justify-between rounded-xl border border-border bg-card px-3 py-2.5 transition hover:border-foreground/30 active:scale-[0.97]"
          >
            <div className={cn("text-[24px] font-bold leading-none tabular-nums", TILE_TONE[t.tone])}>{t.value}</div>
            <div className="mt-1.5 text-[12px] font-semibold leading-tight text-foreground">{t.label}</div>
            <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{t.hint}</div>
          </div>
        );
        return t.flag ? (
          <Link key={t.key} to="/admin/clients" search={{ flags: t.flag } as any} className="block">{inner}</Link>
        ) : (
          <Link key={t.key} to="/admin/messages" className="block">{inner}</Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: what the Clients and Messages pages don't show            */
/* ------------------------------------------------------------------ */

function timeOf(iso: string | null) {
  if (!iso) return null;
  try { return format(parseISO(iso), "h:mm a"); } catch { return null; }
}

const STATUS_CHIP: Record<OverviewSession["status"], { label: string; cls: string }> = {
  done: { label: "Done", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  training: { label: "Training now", cls: "bg-foreground/10 text-foreground" },
  pending: { label: "Not yet", cls: "bg-muted text-muted-foreground" },
};

function TrainingTodayCard({ overview, loading }: { overview: Overview | undefined; loading: boolean }) {
  const scheduled = overview?.training.scheduled ?? [];
  const extra = overview?.training.unscheduled ?? [];
  const done = scheduled.filter((s) => s.status === "done").length;
  const pct = scheduled.length ? Math.round((done / scheduled.length) * 100) : 0;
  return (
    <Card className="border-border bg-card p-4">
      <SectionHeader title="Training today" icon={Dumbbell} viewAll={{ to: "/admin/training-intelligence", label: "Training intel" }} />
      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : scheduled.length === 0 && extra.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">No workouts scheduled today.</p>
      ) : (
        <>
          {scheduled.length > 0 && (
            <div className="mb-1">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="font-semibold"><span className="text-base font-bold tabular-nums">{done}</span> of {scheduled.length} done</span>
                <span className="text-muted-foreground">{scheduled.length - done} to go</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <ul className="divide-y divide-border">
            {scheduled.map((s) => {
              const chip = STATUS_CHIP[s.status];
              const name = s.name?.trim() || "Client";
              const at = s.status === "done" ? timeOf(s.completed_at) : null;
              return (
                <li key={`${s.client_id}-${s.title}`}>
                  <ClientNameLink clientId={s.client_id} tab="training" className="flex items-center gap-2.5 py-2" ariaLabel={`Open ${name}'s training`}>
                    <UserAvatar src={s.avatar ?? undefined} name={name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">{name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{s.title ?? "Workout"}{at ? ` · ${at}` : ""}</div>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", chip.cls)}>{chip.label}</span>
                  </ClientNameLink>
                </li>
              );
            })}
          </ul>
          {extra.length > 0 && (
            <div className="mt-2 border-t border-border pt-2">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Also trained today</div>
              <ul className="divide-y divide-border">
                {extra.map((s) => {
                  const name = s.name?.trim() || "Client";
                  const at = timeOf(s.completed_at);
                  return (
                    <li key={`${s.client_id}-${s.title}`}>
                      <ClientNameLink clientId={s.client_id} tab="training" className="flex items-center gap-2.5 py-2" ariaLabel={`Open ${name}'s training`}>
                        <UserAvatar src={s.avatar ?? undefined} name={name} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold">{name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{s.title ?? "Workout"}{at ? ` · ${at}` : ""}</div>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_CHIP.done.cls)}>Done</span>
                      </ClientNameLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// The label says which record it is; the chip stays neutral.
const TIER_CHIP: Record<OverviewWin["tier"], string> = {
  atpr: "bg-foreground/10 text-foreground",
  program: "bg-muted text-foreground",
  block: "bg-muted text-muted-foreground",
};

function WinsCard({ wins }: { wins: OverviewWin[] }) {
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => groupWins(wins), [wins]);
  if (groups.length === 0) return null;
  const visible = showAll ? groups : groups.slice(0, 4);
  return (
    <Card className="border-border bg-card p-4">
      <SectionHeader title="Wins this week" icon={Trophy} />
      <ul className="divide-y divide-border">
        {visible.map((g) => {
          const first = g.name.split(" ")[0];
          return (
            <li key={g.client_id} className="flex items-center gap-2.5 py-2">
              <ClientNameLink clientId={g.client_id} tab="training" className="flex min-w-0 flex-1 items-center gap-2.5" ariaLabel={`Open ${g.name}'s training`}>
                <UserAvatar src={g.avatar ?? undefined} name={g.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-bold">{g.name}</span>
                    <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold", TIER_CHIP[g.best])}>{TIER_LABEL[g.best]}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {winLine(g.lifts[0])}
                    {g.lifts.length > 1 && <span className="text-muted-foreground/70"> · +{g.lifts.length - 1} more</span>}
                  </div>
                </div>
              </ClientNameLink>
              <Link
                to="/admin/messages"
                search={{ client: g.client_id } as any}
                className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border px-3 text-[12px] font-semibold text-foreground transition hover:bg-muted active:scale-95"
                aria-label={`Message ${first}`}
              >
                Send props
              </Link>
            </li>
          );
        })}
      </ul>
      {groups.length > 4 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 min-h-10 w-full rounded-lg border border-border py-2 text-[12px] font-semibold text-foreground hover:bg-muted"
        >
          {showAll ? "Show less" : `Show ${groups.length - 4} more`}
        </button>
      )}
    </Card>
  );
}

function AdminDashboard() {
  const offlineNoCache = useIsOfflineWithoutCache();
  const listDirectory = useServerFn(listClientsDirectoryFn);
  const liveQueueQuery = {
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  } as const;

  // The Clients page source: per-client flags + the roster-wide counts.
  const { data: directory, isLoading: directoryLoading } = useQuery({
    queryKey: ["clients-directory", "dashboard"],
    queryFn: () => listDirectory({ data: { size: 100, sort: "attention", flags: [], page: 1 } as any }),
    ...liveQueueQuery,
  });
  const rows = directory?.rows ?? [];

  // The Messages badge source: who is genuinely waiting on staff.
  const { data: inbox = [] } = useQuery({
    queryKey: ["staff-inbox-state", "dashboard"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("staff_inbox_state");
      if (error) throw error;
      return (data ?? []) as InboxRow[];
    },
    ...liveQueueQuery,
  });
  const waiting = useMemo(() => waitingOnMe(inbox), [inbox]);

  // Today's training, this week's records, money + leads: the things no other page summarises.
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["admin-dashboard-overview"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_dashboard_overview");
      if (error) throw error;
      return data as Overview;
    },
    ...liveQueueQuery,
  });

  const { data: intel = [] } = useQuery({
    queryKey: ["coach-intel"],
    queryFn: () => getCoachIntel(),
    ...liveQueueQuery,
  });

  const snapshot = useMemo(
    () => buildSnapshot({ waitingReplies: waiting.length, counts: directory?.counts ?? {} }),
    [waiting.length, directory?.counts],
  );

  /* ---------- Client pulse (training) ---------- */
  const rosterIds = useMemo(() => new Set(rows.map((r: any) => r.id)), [rows]);
  const activeIntel = (intel as any[]).filter((x: any) => rosterIds.has(x.client_id));
  const pulseAtRisk = activeIntel.filter((x: any) =>
    (x.pain_flags ?? []).some((p: any) => p.status === "new" || p.status === "followup") ||
    (x.compliance_pct != null && x.assigned > 0 && x.compliance_pct < 60) ||
    (x.labels ?? []).includes("inactive")
  );
  const pulseWatch = activeIntel.filter((x: any) =>
    !pulseAtRisk.includes(x) && x.compliance_pct != null && x.assigned > 0 && x.compliance_pct < 80
  );
  const pulseRows = [...pulseAtRisk, ...pulseWatch];

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  const todayLabel = format(new Date(), "EEEE d MMM");
  const openCount = snapshot.reduce((n, t) => n + t.value, 0);

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={directoryLoading || openCount === 0 ? todayLabel : `${todayLabel} · tap a number to work through it`}
      />

      <div
        onClickCapture={onDashboardClickCapture}
        className="w-full max-w-full space-y-4 overflow-x-hidden p-4 md:p-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}
      >
        {/* ---------------- SCHEDULE first on every Home: change requests (hidden when none), then the next 7 days ---------------- */}
        <SectionErrorBoundary label="Schedule">
          <ChangeRequestsCard />
          <DashboardScheduleCard />
        </SectionErrorBoundary>

        <DriveSetupBanner />
        <NotificationSetupPrompt problemsOnly />

        {/* ---------------- SNAPSHOT: tap any number to open that list in Clients / Messages ---------------- */}
        <SnapshotGrid tiles={snapshot} loading={directoryLoading} />

        {/* ---------------- TODAY: who trains today and who already has ---------------- */}
        <TrainingTodayCard overview={overview} loading={overviewLoading} />

        {/* ---------------- WINS: records this week, one tap to send props ---------------- */}
        <WinsCard wins={overview?.wins ?? []} />

        {/* ---------------- TRAINING TO CHECK: only who needs a look (pain, low adherence, gone quiet) ---------------- */}
        {pulseRows.length > 0 && (
          <Card className="border-border bg-card p-4">
            <SectionHeader title="Training to check · last 14 days" icon={Activity} />
            <ul className="divide-y divide-border">
              {pulseRows.slice(0, 4).map((x: any) => {
                const pain = (x.pain_flags ?? []).some((p: any) => p.status === "new" || p.status === "followup");
                const reason = pain ? "Pain/discomfort reported" :
                  (x.labels ?? []).includes("inactive") ? "Inactive" :
                  x.compliance_pct != null ? `${x.compliance_pct}% of workouts done (${x.completed}/${x.assigned})` : "Needs review";
                return (
                  <li key={x.client_id}>
                    <ClientNameLink clientId={x.client_id} tab="training" className="flex min-h-11 items-center gap-2.5 py-2">
                      <UserAvatar src={x.profile_picture_url ?? undefined} name={x.full_name ?? "Client"} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold">{x.full_name}</div>
                        <div className={cn("truncate text-[11px]", pain ? "text-destructive" : "text-muted-foreground")}>{reason}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </ClientNameLink>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
