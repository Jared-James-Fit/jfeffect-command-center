import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { BirthdayPostsCard } from "@/components/community/birthday-posts";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Users, Calendar, DollarSign, Plus, Video, ShoppingCart,
  HardDrive, ChefHat, FileText, Megaphone, ClipboardList, Mic, Zap,
  MessageCircle, MoreHorizontal, Activity, Sparkles, Check, Dumbbell, Trophy, TrendingUp,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { ClientNameLink } from "@/components/clients/client-name-link";
import {
  buildSnapshot, waitingOnMe, groupWins, winLine, revenueDelta, formatMoney, TIER_LABEL,
  type InboxRow, type SnapshotTile, type Overview, type OverviewSession, type OverviewWin,
} from "@/lib/dashboard-feed";
import { DashboardScheduleCard } from "@/components/admin-calendar/dashboard-schedule-card";
import { ChangeRequestsCard } from "@/components/schedule/change-requests-card";
const PriceCardPickerDialog = lazyWithRetry(() =>
  import("@/components/price-card-picker-dialog").then((m) => ({ default: m.PriceCardPickerDialog })),
);
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
        <Link to={viewAll.to as any} search={viewAll.search} params={viewAll.params} className="shrink-0 text-[11px] font-semibold text-primary hover:underline">
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
        <Link to="/admin/settings"><Button size="sm" variant="outline" className="h-7 text-xs">Fix</Button></Link>
      </div>
    </Card>
  );
}

function ActionsSheet({ actions, trigger }: { actions: { label: string; to: string; icon: any; search?: any }[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl" data-no-return>
        <SheetHeader>
          <SheetTitle>More actions</SheetTitle>
        </SheetHeader>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {actions.map((a) => (
            <Link key={a.label} to={a.to as any} search={a.search} onClick={() => setOpen(false)} className="block">
              <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/40 p-2 text-center transition hover:border-primary/50 active:scale-[0.97]">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
                  <a.icon className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-bold leading-tight">{a.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Snapshot: the six numbers worth seeing every morning               */
/* ------------------------------------------------------------------ */

const TILE_TONE: Record<SnapshotTile["tone"], string> = {
  danger: "text-destructive",
  warn: "text-amber-500",
  info: "text-sky-500",
};

function SnapshotGrid({ tiles, loading }: { tiles: SnapshotTile[]; loading: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
      {tiles.map((t) => {
        const clear = !loading && t.value === 0;
        const inner = (
          <div
            title={t.hint}
            className="flex h-full flex-col justify-between rounded-xl border border-border bg-card px-3 py-2.5 transition hover:border-primary/40 active:scale-[0.97]"
          >
            <div className={cn("flex items-center gap-1 text-[24px] font-black leading-none tabular-nums", clear ? "text-emerald-500" : TILE_TONE[t.tone])}>
              {loading ? <span className="text-muted-foreground/50">–</span> : clear ? <Check className="h-6 w-6" aria-label="None" /> : t.value}
            </div>
            <div className="mt-1.5 text-[11px] font-semibold leading-tight text-muted-foreground">{t.label}</div>
            <div className="mt-0.5 hidden line-clamp-1 text-[10px] text-muted-foreground/80 md:block">{clear ? "All clear" : t.hint}</div>
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
  training: { label: "Training now", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  pending: { label: "Not yet", cls: "bg-secondary text-muted-foreground" },
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
        <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />
      ) : scheduled.length === 0 && extra.length === 0 ? (
        <p className="rounded-lg bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">No sessions scheduled today.</p>
      ) : (
        <>
          {scheduled.length > 0 && (
            <div className="mb-1">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="font-semibold"><span className="text-base font-black tabular-nums">{done}</span> of {scheduled.length} done</span>
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

const TIER_CHIP: Record<OverviewWin["tier"], string> = {
  atpr: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  program: "bg-primary/15 text-primary",
  block: "bg-secondary text-muted-foreground",
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
                className="inline-flex h-8 shrink-0 items-center rounded-full bg-primary/15 px-3 text-[11px] font-semibold text-primary transition hover:bg-primary/25 active:scale-95"
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
          className="mt-2 w-full rounded-lg border border-border py-2 text-[12px] font-semibold text-primary hover:bg-secondary/50"
        >
          {showAll ? "Show less" : `Show ${groups.length - 4} more`}
        </button>
      )}
    </Card>
  );
}

function BusinessCard({ overview }: { overview: Overview }) {
  const money = overview.money ?? [];
  const primary = money.find((m) => m.currency === "CAD") ?? money[0];
  const others = money.filter((m) => m !== primary && m.this_month > 0);
  const delta = primary ? revenueDelta(primary) : null;
  const leads = overview.leads;
  return (
    <Card className="border-border bg-card p-4">
      <SectionHeader title={`Business · ${format(new Date(), "MMMM")}`} icon={TrendingUp} viewAll={{ to: "/admin/transactions", label: "Transactions" }} />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-[28px] font-black leading-none tabular-nums">{formatMoney(primary?.this_month ?? 0, primary?.currency ?? "CAD")}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Collected this month{primary ? ` · ${primary.payments} ${primary.payments === 1 ? "payment" : "payments"}` : ""}
            {others.map((o) => ` · ${formatMoney(o.this_month, o.currency)}`).join("")}
          </div>
        </div>
        {delta && primary && (
          <div className="text-right">
            <div className={cn("text-sm font-bold tabular-nums", delta.up ? "text-emerald-500" : "text-amber-500")}>
              {delta.up ? "▲" : "▼"} {delta.pct}%
            </div>
            <div className="text-[10px] text-muted-foreground">vs {formatMoney(primary.last_month_to_date, primary.currency)} by this day last month</div>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-lg bg-secondary/20 py-2.5">
        <Link to="/admin/clients" className="text-center">
          <div className="text-xl font-black tabular-nums">{overview.roster.active}</div>
          <div className="text-[10px] font-semibold text-muted-foreground">Active clients</div>
        </Link>
        <Link to="/admin/clients" className="text-center">
          <div className={cn("text-xl font-black tabular-nums", overview.roster.new_this_month > 0 && "text-emerald-500")}>
            {overview.roster.new_this_month > 0 ? `+${overview.roster.new_this_month}` : 0}
          </div>
          <div className="text-[10px] font-semibold text-muted-foreground">New this month</div>
        </Link>
        <Link to="/admin/sales/coaching-applications" className="text-center">
          <div className={cn("text-xl font-black tabular-nums", (leads?.new_7d ?? 0) > 0 && "text-primary")}>{leads?.new_7d ?? 0}</div>
          <div className="text-[10px] font-semibold text-muted-foreground">New leads · 7d</div>
        </Link>
      </div>
      {leads && leads.latest.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {leads.latest.slice(0, 3).map((l) => (
            <li key={l.id}>
              <Link to="/admin/sales/coaching-applications" className="flex items-center gap-2 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-bold">{l.name?.trim() || "New applicant"}</span>
                {l.temperature && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold capitalize text-muted-foreground">{l.temperature}</span>}
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDistanceToNowStrict(parseISO(l.submitted_at), { addSuffix: true })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function AdminDashboard() {
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);
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
  const active = directory?.counts?.all ?? rows.length;
  const pulseOnTrack = Math.max(0, active - pulseAtRisk.length - pulseWatch.length);

  /* ---------- Quick actions ---------- */
  const primaryActions = [
    { label: "Add Client",  to: "/admin/clients",          icon: Plus },
    { label: "Message",     to: "/admin/messages",         icon: MessageCircle },
    { label: "Clients",     to: "/admin/clients",          icon: Users },
    { label: "Program",     to: "/admin/program-library",  icon: FileText },
  ];
  const moreActions = [
    { label: "Coach Feedback", to: "/admin/lift-videos",   icon: Video },
    { label: "Forms",          to: "/admin/forms",         icon: ClipboardList },
    { label: "Tasks",          to: "/admin/content",       icon: ClipboardList, search: { tab: "tasks" } as any },
    { label: "Payment Link",   to: "/admin/payment-links", icon: DollarSign },
    { label: "Appointment",    to: "/admin/calendar",      icon: Calendar },
    { label: "Broadcast",      to: "/admin/broadcasts",    icon: Megaphone },
    { label: "Recipe",         to: "/admin/recipes",       icon: ChefHat },
    { label: "Add Product",    to: "/admin/payment-links", icon: ShoppingCart },
    { label: "Apps & Tools",   to: "/admin/apps",          icon: Sparkles },
    { label: "My Voice",       to: "/admin/voice",         icon: Mic },
    { label: "Automations",    to: "/admin/automations",   icon: Zap },
  ];

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  const todayLabel = format(new Date(), "EEEE d MMM");
  const openCount = snapshot.reduce((n, t) => n + t.value, 0);

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={directoryLoading ? todayLabel : openCount === 0 ? `${todayLabel} · you're all caught up` : `${todayLabel} · tap a number to work through it`}
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

        {/* ---------------- BIRTHDAY POSTS: only a draft that needs you (the rest is in Community > Birthdays) ---------------- */}
        <SectionErrorBoundary label="Birthday posts">
          <BirthdayPostsCard actionableOnly />
        </SectionErrorBoundary>

        {/* ---------------- SNAPSHOT: tap any number to open that list in Clients / Messages ---------------- */}
        <SnapshotGrid tiles={snapshot} loading={directoryLoading} />

        {/* ---------------- TODAY: who trains today and who already has ---------------- */}
        <TrainingTodayCard overview={overview} loading={overviewLoading} />

        {/* ---------------- WINS: records this week, one tap to send props ---------------- */}
        <WinsCard wins={overview?.wins ?? []} />

        {/* ---------------- QUICK ACTIONS (deliberate moves: no "‹ Today" pill) ---------------- */}
        <div className="grid grid-cols-5 gap-2" data-no-return>
          {primaryActions.map((a) => (
            <Link key={a.label} to={a.to as any} className="block">
              <div className="flex h-full min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-center transition hover:border-primary/50 active:scale-[0.96]">
                <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
                  <a.icon className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-bold leading-tight">{a.label}</div>
              </div>
            </Link>
          ))}
          <ActionsSheet
            actions={moreActions}
            trigger={
              <button type="button" className="flex h-full min-h-[68px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-center transition hover:border-primary/50 active:scale-[0.96]">
                <div className="grid h-8 w-8 place-items-center rounded-md bg-secondary text-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-bold leading-tight">More</div>
              </button>
            }
          />
        </div>

        {/* ---------------- CLIENT PULSE ---------------- */}
        <Card className="border-border bg-card p-4">
          <SectionHeader title="Client pulse · last 14 days" icon={Activity} viewAll={{ to: "/admin/training-intelligence", label: "Training intel" }} />
          <div className="grid grid-cols-3 divide-x divide-border rounded-lg bg-secondary/20 py-2.5">
            <div className="text-center">
              <div className="text-xl font-black text-emerald-500">{pulseOnTrack}</div>
              <div className="text-[10px] font-semibold text-muted-foreground">On track</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-amber-500">{pulseWatch.length}</div>
              <div className="text-[10px] font-semibold text-muted-foreground">Watch</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-destructive">{pulseAtRisk.length}</div>
              <div className="text-[10px] font-semibold text-muted-foreground">Needs attention</div>
            </div>
          </div>
          {(pulseAtRisk.length > 0 || pulseWatch.length > 0) && (
            <ul className="mt-2 divide-y divide-border">
              {[...pulseAtRisk, ...pulseWatch].slice(0, 4).map((x: any) => {
                const pain = (x.pain_flags ?? []).some((p: any) => p.status === "new" || p.status === "followup");
                const reason = pain ? "Pain/discomfort reported" :
                  (x.labels ?? []).includes("inactive") ? "Inactive" :
                  x.compliance_pct != null ? `${x.compliance_pct}% of workouts done (${x.completed}/${x.assigned})` : "Needs review";
                return (
                  <li key={x.client_id}>
                    <ClientNameLink clientId={x.client_id} tab="training" className="flex items-center gap-2.5 py-2">
                      <UserAvatar src={x.profile_picture_url ?? undefined} name={x.full_name ?? "Client"} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold">{x.full_name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{reason}</div>
                      </div>
                      <span className="text-[11px] font-semibold text-primary">Open</span>
                    </ClientNameLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---------------- BUSINESS (admins only: the RPC returns no money for coaches) ---------------- */}
        {overview?.money && <BusinessCard overview={overview} />}

      </div>

      {sellTo ? (
        <Suspense fallback={null}>
          <PriceCardPickerDialog
            open={!!sellTo}
            fixedClientId={sellTo?.id}
            onClose={() => setSellTo(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
