import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { useState, useMemo, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Users, AlertTriangle, Calendar, DollarSign, Plus, Video, ShoppingCart,
  HardDrive, ChefHat, FileText, Megaphone, Zap, ClipboardList, ClipboardCheck,
  MessageCircle, MoreHorizontal, CheckCircle2, Trophy, HeartPulse, Sparkles,
} from "lucide-react";
import type { ConversationState, Message } from "@/lib/messages";
import { listLiftVideos } from "@/lib/lift-videos";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { UpcomingBirthdaysWidget } from "@/components/upcoming-birthdays-widget";
import { UpcomingAppointmentsCard } from "@/components/appointments/upcoming-appointments-card";
const PriceCardPickerDialog = lazy(() =>
  import("@/components/price-card-picker-dialog").then((m) => ({ default: m.PriceCardPickerDialog })),
);
import { UserAvatar } from "@/components/user-avatar";
import { getCoachIntel, filterIntel, LABEL_META } from "@/lib/coach-intel";
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

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <span className="truncate">{children}</span>
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
/* TODAY feed                                                          */
/* ------------------------------------------------------------------ */

type Bucket = "urgent" | "reviews" | "messages" | "payments" | "onboarding";

type Priority = {
  id: string;
  bucket: Bucket;
  clientId?: string;
  name: string;
  reason: string;
  time?: string;
  urgent?: boolean;
  href: string;
  search?: any;
  params?: any;
  action: string;
  avatarUrl?: string | null;
};

const BUCKET_RANK: Record<Bucket, number> = { urgent: 0, payments: 1, messages: 2, reviews: 3, onboarding: 4 };

const FILTERS: { key: Bucket | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "urgent", label: "Urgent" },
  { key: "messages", label: "Messages" },
  { key: "reviews", label: "Reviews" },
  { key: "payments", label: "Payments" },
  { key: "onboarding", label: "Onboarding" },
];

function PriorityRow({ p }: { p: Priority }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <UserAvatar src={p.avatarUrl ?? undefined} name={p.name} size={36} />
      <div className="min-w-0 flex-1">
        {p.clientId ? (
          <ClientNameLink clientId={p.clientId} className="block truncate text-sm font-semibold hover:underline">{p.name}</ClientNameLink>
        ) : <div className="truncate text-sm font-semibold">{p.name}</div>}
        <div className="mt-0.5 flex items-center gap-2">
          {p.urgent && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />}
          <span className="truncate text-[11px] text-muted-foreground">
            {p.reason}{p.time ? ` · ${p.time}` : ""}
          </span>
        </div>
      </div>
      <Link to={p.href as any} params={p.params as any} search={p.search} className="shrink-0">
        <Button size="sm" className="h-10 min-w-[84px] px-3 text-xs font-bold">{p.action}</Button>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function AdminDashboard() {
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const offlineNoCache = useIsOfflineWithoutCache();

  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, full_name, email, status, payment_status, profile_picture_url, invite_expires_at, invite_sent_at, account_created_at, needs_admin_help, archived"
        )
        .eq("archived", false);
      if (error) throw error;
      return data;
    },
  });

  const { data: convStates = [] } = useQuery({
    queryKey: ["conversation-states"],
    queryFn: async () => {
      const { data } = await (supabase.from("conversation_state") as any).select("*");
      return (data ?? []) as ConversationState[];
    },
  });

  const { data: recentMsgs = [] } = useQuery({
    queryKey: ["recent-client-messages-dash"],
    queryFn: async () => {
      const { data } = await (supabase.from("messages") as any)
        .select("client_id, body, created_at, sender_role, is_internal_note")
        .eq("is_internal_note", false).eq("sender_role", "client")
        .order("created_at", { ascending: false }).limit(60);
      return (data ?? []) as Message[];
    },
  });

  const { data: liftVideos = [] } = useQuery({
    queryKey: ["lift-videos-admin"],
    queryFn: () => listLiftVideos(),
  });

  const { data: paymentsAttention = [] } = useQuery({
    queryKey: ["payments-needing-attention"],
    queryFn: async () => (await supabase
      .from("purchase_records")
      .select("id, offer_name, payment_status, full_payable_amount, currency, purchased_at, client_id, clients(id, full_name)")
      .in("payment_status", ["Pending", "Pending Payment", "Overdue", "Failed", "Manual Payment Needed", "Partially Paid"])
      .order("purchased_at", { ascending: false }).limit(20)).data ?? [],
  });

  const { data: actionRequests = [] } = useQuery({
    queryKey: ["dashboard-action-requests"],
    queryFn: async () => (await supabase
      .from("client_action_requests")
      .select("id, client_id, completed_at, clients(id, full_name)")
      .is("completed_at", null).limit(50)).data ?? [],
  });

  const { data: checkInSubmissions = [] } = useQuery({
    queryKey: ["dashboard-checkin-submissions"],
    queryFn: async () => (await (supabase.from("nf_submissions") as any)
      .select("id, client_id, submitted_at, reviewed_at")
      .not("submitted_at", "is", null).is("reviewed_at", null).limit(50)).data ?? [],
  });

  const { data: intel = [] } = useQuery({
    queryKey: ["coach-intel"],
    queryFn: () => getCoachIntel(),
  });

  const liftNeedReview = liftVideos.filter((v) => !v.reviewed_at && v.status !== "Archived");

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.full_name])), [clients]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const stateMap = useMemo(() => new Map(convStates.map((s) => [s.client_id, s])), [convStates]);

  const seenC = new Set<string>();
  const messagesNeedingResponse = recentMsgs.filter((m) => {
    if (seenC.has(m.client_id)) return false;
    const st = stateMap.get(m.client_id);
    const lr = st?.admin_last_read_at ? new Date(st.admin_last_read_at).getTime() : 0;
    const unread = new Date(m.created_at).getTime() > lr;
    const needs = st?.status === "needs_response";
    const highPriority = st?.priority === "High Priority" || st?.priority === "Important";
    if (unread || needs || highPriority) { seenC.add(m.client_id); return true; }
    return false;
  });

  const now = Date.now();
  const setupAlerts = clients
    .map((c) => {
      const expired = c.invite_expires_at && new Date(c.invite_expires_at).getTime() < now && !c.account_created_at;
      const notCreated = !c.account_created_at;
      const needsHelp = c.needs_admin_help;
      let label = ""; let urgent = false;
      if (needsHelp) { label = "Needs admin help"; urgent = true; }
      else if (expired) { label = "Invite expired"; urgent = true; }
      else if (notCreated && c.invite_sent_at) { label = "Setup pending"; }
      else if (notCreated && c.email) { label = "No invite sent"; }
      return label ? { ...c, _label: label, _urgent: urgent } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  /* ---------- Overview numbers ---------- */
  const active = clients.length;
  const overdue = clients.filter((c) => c.status === "Payment Overdue" || c.payment_status === "Overdue").length;
  const needsAttention = clients.filter((c) => c.status === "Needs Attention" || c.status === "Check-In Overdue").length;
  const reviewsWaiting = (checkInSubmissions as any[]).length + liftNeedReview.length;

  /* ---------- Unified priority feed ---------- */
  const priorities: Priority[] = [];

  // Pain flags first — highest severity signal we have.
  for (const c of (intel as any[])) {
    const open = (c.pain_flags ?? []).filter((f: any) => f.status === "new" || f.status === "followup");
    if (open.length === 0) continue;
    priorities.push({
      id: `pain-${c.client_id}`,
      bucket: "urgent",
      clientId: c.client_id,
      name: c.full_name ?? "Client",
      reason: `Pain flag${open.length > 1 ? ` ×${open.length}` : ""}${open[0]?.matched_keywords?.[0] ? ` · ${open[0].matched_keywords[0]}` : ""}`,
      urgent: true,
      href: "/admin/training-intelligence",
      action: "Review",
      avatarUrl: c.profile_picture_url ?? null,
    });
  }
  for (const p of (paymentsAttention as any[])) {
    const c: any = clientById.get(p.client_id);
    priorities.push({
      id: `pay-${p.id}`,
      bucket: "payments",
      clientId: p.client_id,
      name: p.clients?.full_name ?? "Client",
      reason: `${p.payment_status} · ${p.offer_name ?? ""}`.trim(),
      urgent: true,
      href: "/admin/purchases/$id",
      params: { id: p.id },
      action: "Open",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const m of messagesNeedingResponse) {
    const st = stateMap.get(m.client_id);
    const c: any = clientById.get(m.client_id);
    priorities.push({
      id: `msg-${m.client_id}`,
      bucket: "messages",
      clientId: m.client_id,
      name: clientNameById.get(m.client_id) ?? "Client",
      reason: "Unread message",
      time: formatDistanceToNow(parseISO(m.created_at), { addSuffix: true }),
      urgent: st?.priority === "High Priority",
      href: "/admin/messages",
      search: { client: m.client_id },
      action: "Reply",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const s of checkInSubmissions as any[]) {
    const c: any = clientById.get(s.client_id);
    priorities.push({
      id: `ci-${s.id}`,
      bucket: "reviews",
      clientId: s.client_id,
      name: clientNameById.get(s.client_id) ?? "Client",
      reason: "Check-in awaiting review",
      time: s.submitted_at ? formatDistanceToNow(parseISO(s.submitted_at), { addSuffix: true }) : undefined,
      href: "/admin/check-in-reviews",
      action: "Review",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const v of liftNeedReview) {
    const c: any = clientById.get(v.client_id);
    priorities.push({
      id: `lift-${v.id}`,
      bucket: "reviews",
      clientId: v.client_id,
      name: clientNameById.get(v.client_id) ?? "Client",
      reason: `Coach feedback${v.exercise ? ` · ${v.exercise}` : ""}`,
      time: formatDistanceToNow(parseISO(v.created_at), { addSuffix: true }),
      urgent: !!v.is_urgent,
      href: "/admin/lift-videos",
      search: { open: v.id },
      action: "Review",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const a of (actionRequests as any[])) {
    const c: any = clientById.get(a.client_id);
    priorities.push({
      id: `ar-${a.id}`,
      bucket: "reviews",
      clientId: a.client_id,
      name: a.clients?.full_name ?? "Client",
      reason: "Action request pending",
      href: "/admin/client-action-requests",
      action: "Open",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const c of setupAlerts) {
    priorities.push({
      id: `setup-${c.id}`,
      bucket: "onboarding",
      clientId: c.id,
      name: c.full_name,
      reason: c._label,
      urgent: c._urgent,
      href: "/admin/clients/$id",
      params: { id: c.id },
      action: "Fix setup",
      avatarUrl: (c as any).profile_picture_url ?? null,
    });
  }

  priorities.sort((a, b) => {
    const ua = a.urgent ? 0 : 1, ub = b.urgent ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
  });

  const counts = priorities.reduce<Record<string, number>>((acc, p) => {
    acc[p.bucket] = (acc[p.bucket] ?? 0) + 1;
    return acc;
  }, {});
  const filtered = filter === "all" ? priorities : priorities.filter((p) => p.bucket === filter);
  const visible = showAll ? filtered : filtered.slice(0, 5);

  /* ---------- Client alerts (severity ordered) ---------- */
  const alerts = filterIntel(intel as any[], "attention")
    .map((c: any) => {
      const painOpen = (c.pain_flags ?? []).filter((f: any) => f.status === "new" || f.status === "followup").length;
      const severity = painOpen > 0 ? 0
        : c.labels?.includes("inactive") ? 1
        : c.labels?.includes("low_compliance") ? 2
        : 3;
      return { ...c, severity };
    })
    .sort((a: any, b: any) => a.severity - b.severity)
    .slice(0, 6);

  const wins = (intel as any[])
    .filter((c) => (c.recent_prs?.length ?? 0) > 0)
    .sort((a, b) => (b.recent_prs?.length ?? 0) - (a.recent_prs?.length ?? 0))
    .slice(0, 3);

  /* ---------- Quick actions ---------- */
  const primaryActions = [
    { label: "Add Client",  to: "/admin/clients",          icon: Plus },
    { label: "Message",     to: "/admin/messages",         icon: MessageCircle },
    { label: "Check-Ins",   to: "/admin/check-in-reviews", icon: ClipboardList },
    { label: "Program",     to: "/admin/program-library",  icon: FileText },
  ];
  const moreActions = [
    { label: "Coach Feedback", to: "/admin/lift-videos",   icon: Video },
    { label: "Tasks",          to: "/admin/content",       icon: ClipboardList, search: { tab: "tasks" } as any },
    { label: "Payment Link",   to: "/admin/payment-links", icon: DollarSign },
    { label: "Appointment",    to: "/admin/calendar",      icon: Calendar },
    { label: "Broadcast",      to: "/admin/broadcasts",    icon: Megaphone },
    { label: "Recipe",         to: "/admin/recipes",       icon: ChefHat },
    { label: "Upload Media",   to: "/admin/media",         icon: HardDrive },
    { label: "Add Product",    to: "/admin/payment-links", icon: ShoppingCart },
    { label: "Apps & Tools",   to: "/admin/apps",          icon: Sparkles },
  ];

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  const todayLabel = format(new Date(), "EEEE d MMM");
  const openCount = priorities.length;

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={openCount === 0 ? `${todayLabel} · you're all caught up` : `${todayLabel} · ${openCount} ${openCount === 1 ? "thing needs" : "things need"} you`}
      />

      <div
        className="w-full max-w-full space-y-4 overflow-x-hidden p-4 md:p-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}
      >
        <DriveSetupBanner />
        <NotificationSetupPrompt problemsOnly />

        {/* ---------------- TODAY ---------------- */}
        <Card className="border-border bg-card p-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-bold tracking-tight">
              <Zap className="h-4 w-4 text-muted-foreground" /> Needs you
            </h2>
            <DashboardRefreshIndicator />
          </div>

          {openCount > 0 && (
            <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FILTERS.map((f) => {
                const n = f.key === "all" ? priorities.length : counts[f.key] ?? 0;
                if (f.key !== "all" && n === 0) return null;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { setFilter(f.key); setShowAll(false); }}
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                      filter === f.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label} {n}
                  </button>
                );
              })}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-500/5 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="font-semibold">Nothing waiting here.</span>
              </div>
              <Link to="/admin/calendar" className="text-[11px] font-semibold text-primary hover:underline">View schedule →</Link>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {visible.map((p) => <PriorityRow key={p.id} p={p} />)}
              </ul>
              {filtered.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-2 w-full rounded-md border border-border py-2 text-[11px] font-semibold text-primary hover:bg-secondary/50"
                >
                  Show all {filtered.length}
                </button>
              )}
              {showAll && filtered.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className="mt-2 w-full rounded-md border border-border py-2 text-[11px] font-semibold text-muted-foreground hover:bg-secondary/50"
                >
                  Show less
                </button>
              )}
            </>
          )}
        </Card>

        {/* ---------------- QUICK ACTIONS ---------------- */}
        <div className="grid grid-cols-5 gap-2">
          {primaryActions.map((a) => (
            <Link key={a.label} to={a.to as any} className="block">
              <div className="flex h-full min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-center transition hover:border-primary/50 active:scale-[0.96]">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
                  <a.icon className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-bold leading-tight">{a.label}</div>
              </div>
            </Link>
          ))}
          <ActionsSheet
            actions={moreActions}
            trigger={
              <button type="button" className="flex h-full min-h-[72px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-center transition hover:border-primary/50 active:scale-[0.96]">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-bold leading-tight">More</div>
              </button>
            }
          />
        </div>

        {/* ---------------- OVERVIEW (compact) ---------------- */}
        <Card className="border-border bg-card p-3">
          <div className="grid grid-cols-4 divide-x divide-border">
            <OverviewStat label="Clients" value={active} to="/admin/clients" icon={Users} />
            <OverviewStat label="Attention" value={needsAttention} to="/admin/clients" icon={AlertTriangle} tone={needsAttention > 0 ? "warn" : undefined} />
            <OverviewStat label="Reviews" value={reviewsWaiting} to="/admin/check-in-reviews" icon={ClipboardCheck} tone={reviewsWaiting > 0 ? "primary" : undefined} />
            <OverviewStat label="Overdue" value={overdue} to="/admin/payments" icon={DollarSign} tone={overdue > 0 ? "warn" : undefined} />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {/* ---------------- CLIENT ALERTS ---------------- */}
            <Card className="border-border bg-card p-4">
              <SectionHeader title="Client alerts" icon={HeartPulse} viewAll={{ to: "/admin/training-intelligence" }} />
              {alerts.length === 0 ? (
                <EmptyRow>No training flags right now.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {alerts.map((c: any) => (
                    <li key={c.client_id} className="flex items-start gap-3 py-2.5">
                      <UserAvatar src={c.profile_picture_url ?? undefined} name={c.full_name ?? "Client"} size={32} />
                      <div className="min-w-0 flex-1">
                        <ClientNameLink clientId={c.client_id} className="block truncate text-sm font-semibold hover:underline">
                          {c.full_name}
                        </ClientNameLink>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(c.labels ?? []).slice(0, 3).map((l: string) => {
                            const meta = (LABEL_META as any)[l];
                            if (!meta) return null;
                            return <Badge key={l} variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>;
                          })}
                        </div>
                      </div>
                      <Link to="/admin/training-intelligence" className="shrink-0 text-[11px] font-semibold text-primary hover:underline">Open</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* ---------------- WINS ---------------- */}
            {wins.length > 0 && (
              <Card className="border-border bg-card p-4">
                <SectionHeader title="Wins to celebrate" icon={Trophy} />
                <ul className="divide-y divide-border">
                  {wins.map((c: any) => (
                    <li key={`win-${c.client_id}`} className="flex items-center gap-3 py-2.5">
                      <UserAvatar src={c.profile_picture_url ?? undefined} name={c.full_name ?? "Client"} size={32} />
                      <div className="min-w-0 flex-1">
                        <ClientNameLink clientId={c.client_id} className="block truncate text-sm font-semibold hover:underline">
                          {c.full_name}
                        </ClientNameLink>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {c.recent_prs.length} recent PR{c.recent_prs.length === 1 ? "" : "s"}
                          {c.recent_prs[0]?.exercise ? ` · ${c.recent_prs[0].exercise}` : ""}
                        </div>
                      </div>
                      <Link to="/admin/messages" search={{ client: c.client_id } as any} className="shrink-0">
                        <Button size="sm" variant="outline" className="h-9 text-xs font-bold">Send praise</Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* ---------------- UPCOMING ---------------- */}
          <div className="min-w-0 space-y-4">
            <UpcomingAppointmentsCard mode="admin" />
            <UpcomingBirthdaysWidget windowDays={7} />
          </div>
        </div>
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

function OverviewStat({ label, value, to, icon: Icon, tone }: { label: string; value: number; to: string; icon: any; tone?: "warn" | "primary" }) {
  return (
    <Link to={to as any} className="flex flex-col items-center gap-0.5 px-1 py-1 text-center transition active:scale-[0.97]">
      <Icon className={cn(
        "h-3.5 w-3.5",
        tone === "warn" ? "text-warning" : tone === "primary" ? "text-primary" : "text-muted-foreground",
      )} />
      <div className="text-xl font-black leading-none tracking-tight">{value}</div>
      <div className="text-[10px] font-semibold text-muted-foreground">{label}</div>
    </Link>
  );
}
