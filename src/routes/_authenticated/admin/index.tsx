import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { CommunityCoachCard } from "@/components/community/community-entry";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  HardDrive, ChefHat, FileText, Megaphone, Zap, ClipboardList,
  MessageCircle, MoreHorizontal, CheckCircle2, Activity, Sparkles, Check, Loader2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listLiftVideos } from "@/lib/lift-videos";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { markCheckinReviewed, refreshReviewQueries } from "@/lib/checkin-review";
import {
  buildNeedsYou, buildSnapshot, waitingOnMe, FEED_GROUPS,
  type FeedItem, type FeedAction, type InboxRow, type SnapshotTile,
} from "@/lib/dashboard-feed";
import { UpcomingBirthdaysWidget } from "@/components/upcoming-birthdays-widget";
import { UpcomingAppointmentsCard } from "@/components/appointments/upcoming-appointments-card";
const PriceCardPickerDialog = lazyWithRetry(() =>
  import("@/components/price-card-picker-dialog").then((m) => ({ default: m.PriceCardPickerDialog })),
);
import { UserAvatar } from "@/components/user-avatar";
import { getCoachIntel, setPainFlagStatus } from "@/lib/coach-intel";
import { DashboardRefreshIndicator } from "@/components/portal/dashboard-refresh-indicator";
import { DashboardOfflineEmpty, useIsOfflineWithoutCache } from "@/components/portal/dashboard-offline-empty";
import { NotificationSetupPrompt } from "@/components/notification-setup-prompt";
import { cn } from "@/lib/utils";

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
      <SheetContent side="bottom" className="rounded-t-2xl">
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
/* Needs you                                                           */
/* ------------------------------------------------------------------ */

function ActionLink({ action, className, children, ariaLabel }: { action: FeedAction; className?: string; children: React.ReactNode; ariaLabel?: string }) {
  switch (action.kind) {
    case "messages":
      return <Link to="/admin/messages" search={{ client: action.clientId } as any} className={className} aria-label={ariaLabel}>{children}</Link>;
    case "billing":
      return <ClientNameLink clientId={action.clientId} tab="billing" className={className} ariaLabel={ariaLabel}>{children}</ClientNameLink>;
    case "profile":
      return <ClientNameLink clientId={action.clientId} className={className} ariaLabel={ariaLabel}>{children}</ClientNameLink>;
    case "program":
      return <Link to="/admin/program-assign/$clientId" params={{ clientId: action.clientId } as any} className={className} aria-label={ariaLabel}>{children}</Link>;
    case "lift":
      return <Link to="/admin/lift-videos" search={{ open: action.videoId } as any} className={className} aria-label={ariaLabel}>{children}</Link>;
    case "intel":
    default:
      return <Link to="/admin/training-intelligence" className={className} aria-label={ariaLabel}>{children}</Link>;
  }
}

function ago(iso: string | null) {
  if (!iso) return null;
  try { return formatDistanceToNowStrict(parseISO(iso), { addSuffix: false }).replace(/ (seconds?|minutes?)/, "m").replace(/ hours?/, "h").replace(/ days?/, "d").replace(/ months?/, "mo"); }
  catch { return null; }
}

function FeedRow({ item, onDone }: { item: FeedItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const closeCheckin = async () => {
    if (!item.checkinId || busy) return;
    setBusy(true);
    try {
      await markCheckinReviewed(item.checkinId, "manual");
      toast.success(`Marked ${item.name.split(" ")[0]}'s check-in reviewed`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark it reviewed");
    } finally {
      setBusy(false);
    }
  };
  const closePain = async () => {
    if (!item.painFlagId || busy) return;
    setBusy(true);
    try {
      await setPainFlagStatus(item.painFlagId, "reviewed");
      toast.success("Pain flag marked reviewed");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update it");
    } finally {
      setBusy(false);
    }
  };
  const when = ago(item.at);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <ClientNameLink clientId={item.clientId} className="shrink-0" ariaLabel={`Open ${item.name}`}>
        <UserAvatar src={item.avatarUrl ?? undefined} name={item.name} size={40} />
      </ClientNameLink>
      <ActionLink action={item.action} className="min-w-0 flex-1" ariaLabel={`${item.actionLabel}: ${item.name}`}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold">{item.name}</span>
          {item.urgent && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-label="Urgent" />}
        </div>
        <div className={cn("mt-0.5 line-clamp-1 text-[12px]", item.urgent ? "text-destructive" : "text-muted-foreground")}>
          {when && <span className="font-semibold text-foreground/70">{when} · </span>}
          {item.reason}
          {item.more > 0 && <span className="text-muted-foreground/70"> · +{item.more} more</span>}
        </div>
      </ActionLink>
      {(item.checkinId || item.painFlagId) && (
        <button
          type="button"
          onClick={item.checkinId ? closeCheckin : closePain}
          disabled={busy}
          title={item.checkinId ? "Mark check-in reviewed" : "Mark pain flag reviewed"}
          aria-label={item.checkinId ? "Mark check-in reviewed" : "Mark pain flag reviewed"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition hover:border-emerald-500/50 hover:text-emerald-500 active:scale-95 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      )}
      <ActionLink
        action={item.action}
        className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary/15 px-3.5 text-[12px] font-semibold text-primary transition hover:bg-primary/25 active:scale-95"
      >
        {item.actionLabel}
      </ActionLink>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function AdminDashboard() {
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);
  const [group, setGroup] = useState<(typeof FEED_GROUPS)[number]["key"]>("all");
  const [showAll, setShowAll] = useState(false);
  const offlineNoCache = useIsOfflineWithoutCache();
  const queryClient = useQueryClient();
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
  const waitingIds = useMemo(() => waiting.map((w) => w.client_id).sort(), [waiting]);

  // The words they actually sent, only for the conversations that are waiting.
  const { data: lastClientMessage = new Map<string, string>() } = useQuery({
    queryKey: ["dashboard-last-client-message", waitingIds],
    enabled: waitingIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase.from("messages") as any)
        .select("client_id, body, created_at")
        .in("client_id", waitingIds)
        .eq("sender_role", "client").eq("is_internal_note", false).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(200);
      const m = new Map<string, string>();
      for (const r of (data ?? []) as any[]) if (!m.has(r.client_id) && r.body) m.set(r.client_id, r.body);
      return m;
    },
    staleTime: 15_000,
  });

  const { data: openReviews = { checkins: [], forms: [] } } = useQuery({
    queryKey: ["message-form-checkin-inbox", "dashboard"],
    queryFn: async () => {
      const [checkins, forms] = await Promise.all([
        (supabase.from("messenger_checkins") as any)
          .select("id, client_id, task_type, submitted_at")
          .eq("status", "completed").is("reviewed_at", null).is("superseded_at", null)
          .limit(200),
        (supabase.from("nf_submissions") as any)
          .select("id, client_id, submitted_at")
          .not("submitted_at", "is", null).is("reviewed_at", null).in("status", ["submitted", "pending_review"])
          .limit(200),
      ]);
      return { checkins: (checkins.data ?? []) as any[], forms: (forms.data ?? []) as any[] };
    },
    ...liveQueueQuery,
  });

  const { data: liftVideos = [] } = useQuery({
    queryKey: ["lift-videos-admin"],
    queryFn: () => listLiftVideos(),
    ...liveQueueQuery,
  });

  const { data: intel = [] } = useQuery({
    queryKey: ["coach-intel"],
    queryFn: () => getCoachIntel(),
    ...liveQueueQuery,
  });

  const refreshNeedsYou = () => {
    refreshReviewQueries(queryClient);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["coach-intel"] }),
      queryClient.invalidateQueries({ queryKey: ["lift-videos-admin"] }),
    ]);
  };

  const feed = useMemo(() => buildNeedsYou({
    clients: rows as any,
    inbox,
    lastClientMessage,
    openCheckins: openReviews.checkins,
    openForms: openReviews.forms,
    liftVideos: (liftVideos as any[]).filter((v) => !v.reviewed_at && v.status !== "Archived" && v.status !== "Reviewed"),
    painFlags: (intel as any[]).flatMap((c: any) =>
      (c.pain_flags ?? [])
        .filter((f: any) => f.status === "new" || f.status === "followup")
        .slice(0, 1)
        .map((f: any) => ({ id: f.id, client_id: c.client_id, keyword: f.matched_keywords?.[0] ?? null, created_at: f.created_at ?? null }))),
  }), [rows, inbox, lastClientMessage, openReviews, liftVideos, intel]);

  const snapshot = useMemo(
    () => buildSnapshot({ waitingReplies: waiting.length, counts: directory?.counts ?? {} }),
    [waiting.length, directory?.counts],
  );

  const groupCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of FEED_GROUPS) out[g.key] = feed.filter((f) => g.kinds.includes(f.kind)).length;
    return out;
  }, [feed]);
  const activeGroup = FEED_GROUPS.find((g) => g.key === group) ?? FEED_GROUPS[0];
  const filtered = feed.filter((f) => activeGroup.kinds.includes(f.kind));
  const visible = showAll ? filtered : filtered.slice(0, 6);

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
  ];

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  const todayLabel = format(new Date(), "EEEE d MMM");
  const openCount = feed.length;

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={openCount === 0 ? `${todayLabel} · you're all caught up` : `${todayLabel} · ${openCount} ${openCount === 1 ? "client needs" : "clients need"} you`}
      />

      <div
        className="w-full max-w-full space-y-4 overflow-x-hidden p-4 md:p-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}
      >
        <DriveSetupBanner />
        <NotificationSetupPrompt problemsOnly />

        {/* ---------------- SNAPSHOT: tap any number to see who ---------------- */}
        <SnapshotGrid tiles={snapshot} loading={directoryLoading} />

        {/* ---------------- NEEDS YOU: one row per client, act in one tap ---------------- */}
        <Card className="border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-bold tracking-tight">
              <Zap className="h-4 w-4 text-muted-foreground" /> Needs you
            </h2>
            <DashboardRefreshIndicator />
          </div>

          {openCount > 0 && (
            <div className="-mx-1 mb-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FEED_GROUPS.map((g) => {
                const n = groupCounts[g.key] ?? 0;
                if (g.key !== "all" && n === 0) return null;
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => { setGroup(g.key); setShowAll(false); }}
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                      group === g.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {g.label} {n}
                  </button>
                );
              })}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 px-3 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="font-semibold">{openCount === 0 ? "You're caught up." : "Nothing here."}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{openCount === 0 ? "New things show up here by themselves." : "Try All."}</span>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {visible.map((item) => <FeedRow key={item.id} item={item} onDone={refreshNeedsYou} />)}
              </ul>
              {filtered.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 w-full rounded-lg border border-border py-2 text-[12px] font-semibold text-primary hover:bg-secondary/50"
                >
                  {showAll ? "Show less" : `Show ${filtered.length - visible.length} more`}
                </button>
              )}
            </>
          )}
        </Card>

        {/* ---------------- QUICK ACTIONS ---------------- */}
        <div className="grid grid-cols-5 gap-2">
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

        {/* ---------------- COMMUNITY: one-tap coach props (hidden when nothing was shared this week) */}
        <SectionErrorBoundary label="Community">
          <CommunityCoachCard />
        </SectionErrorBoundary>

        {/* Empty schedule sections collapse instead of consuming dashboard space. */}
        <UpcomingAppointmentsCard mode="admin" limit={3} hideWhenEmpty />
        <UpcomingBirthdaysWidget windowDays={7} />
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
