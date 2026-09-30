import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  MessageCircle, MoreHorizontal, CheckCircle2, Activity, Sparkles,
  ChevronDown, ChevronUp,
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

function PriorityRow({ p, intel, messagePreview, onResolved }: { p: Priority; intel?: any; messagePreview?: string | null; onResolved?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const pain = intel?.pain_flags?.find((f: any) => f.status === "new" || f.status === "followup");
  const missed = intel?.missed_days ?? [];
  const isTrainingIssue = p.bucket === "urgent" || p.reason.toLowerCase().includes("workout") || p.reason.toLowerCase().includes("compliance");

  return (
    <li className="py-2.5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <UserAvatar src={p.avatarUrl ?? undefined} name={p.name} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{p.name}</span>
            {p.urgent && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />}
          </div>
          <div className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
            {p.reason}{p.time ? ` · ${p.time}` : ""}
          </div>
          {isTrainingIssue && intel?.last_completed_at && (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              Last trained {formatDistanceToNow(parseISO(intel.last_completed_at), { addSuffix: true })}
            </div>
          )}
        </div>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-secondary/20">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="ml-[50px] mt-2 rounded-xl border border-border bg-secondary/15 p-3">
          {pain?.note_text && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-[11px]">
              <div className="font-bold text-destructive">Pain / discomfort</div>
              <div className="mt-0.5 text-foreground">{pain.note_text}</div>
            </div>
          )}
          {p.bucket === "messages" && messagePreview && (
            <div className="rounded-lg border border-border bg-card p-2 text-[11px]">
              <div className="font-bold">Latest message</div>
              <div className="mt-0.5 line-clamp-3 text-muted-foreground">{messagePreview}</div>
            </div>
          )}
          {isTrainingIssue && !pain && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div><span className="text-muted-foreground">14-day compliance</span><div className="font-bold">{intel?.compliance_pct != null ? `${intel.compliance_pct}% (${intel.completed}/${intel.assigned})` : "—"}</div></div>
              <div><span className="text-muted-foreground">Missed</span><div className="font-bold">{missed.length || 0}</div></div>
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {p.bucket === "messages" && <Link to="/admin/messages" search={{ client: p.clientId } as any}><Button size="sm" className="h-8 text-[11px]"><MessageCircle className="mr-1 h-3.5 w-3.5" />Reply</Button></Link>}
            {pain && <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={async () => { await setPainFlagStatus(pain.id, "reviewed"); onResolved?.(); }}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Reviewed</Button>}
            {p.clientId && p.bucket !== "messages" && <Link to="/admin/messages" search={{ client: p.clientId } as any}><Button size="sm" variant="outline" className="h-8 text-[11px]"><MessageCircle className="mr-1 h-3.5 w-3.5" />Message</Button></Link>}
            {p.clientId && <Link to="/admin/clients/$id" params={{ id: p.clientId } as any}><Button size="sm" variant="ghost" className="h-8 text-[11px]">Full profile</Button></Link>}
          </div>
        </div>
      )}
    </li>
  );
}
/* ------------------------------------------------------------------ */

function AdminDashboard() {
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const offlineNoCache = useIsOfflineWithoutCache();
  const queryClient = useQueryClient();
  const liveQueueQuery = {
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  } as const;
  const refreshNeedsYou = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["coach-intel"] }),
      queryClient.invalidateQueries({ queryKey: ["conversation-states"] }),
      queryClient.invalidateQueries({ queryKey: ["recent-client-messages-dash"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-checkin-submissions"] }),
      queryClient.invalidateQueries({ queryKey: ["lift-videos-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-action-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["payments-needing-attention"] }),
    ]);
  };

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
    ...liveQueueQuery,
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
    ...liveQueueQuery,
  });

  const { data: liftVideos = [] } = useQuery({
    queryKey: ["lift-videos-admin"],
    queryFn: () => listLiftVideos(),
    ...liveQueueQuery,
  });

  const { data: paymentsAttention = [] } = useQuery({
    queryKey: ["payments-needing-attention"],
    queryFn: async () => (await supabase
      .from("purchase_records")
      .select("id, offer_name, payment_status, full_payable_amount, currency, purchased_at, client_id, clients(id, full_name)")
      .in("payment_status", ["Pending", "Pending Payment", "Overdue", "Failed", "Manual Payment Needed", "Partially Paid"])
      .order("purchased_at", { ascending: false }).limit(20)).data ?? [],
    ...liveQueueQuery,
  });

  const { data: actionRequests = [] } = useQuery({
    queryKey: ["dashboard-action-requests"],
    queryFn: async () => (await supabase
      .from("client_action_requests")
      .select("id, client_id, completed_at, clients(id, full_name)")
      .is("completed_at", null).limit(50)).data ?? [],
    ...liveQueueQuery,
  });

  const { data: checkInSubmissions = [] } = useQuery({
    queryKey: ["dashboard-checkin-submissions"],
    queryFn: async () => (await (supabase.from("nf_submissions") as any)
      .select("id, client_id, submitted_at, reviewed_at")
      .not("submitted_at", "is", null).is("reviewed_at", null).limit(50)).data ?? [],
    ...liveQueueQuery,
  });

  const { data: intel = [] } = useQuery({
    queryKey: ["coach-intel"],
    queryFn: () => getCoachIntel(),
    ...liveQueueQuery,
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

  // Command center = one row per client. The first item is the highest-ranked
  // actionable issue; lower-priority duplicate signals stay in deeper intel.
  const dedupedPriorities = priorities.filter((p, index, all) =>
    !p.clientId || all.findIndex((x) => x.clientId === p.clientId) === index
  );

  const counts = dedupedPriorities.reduce<Record<string, number>>((acc, p) => {
    acc[p.bucket] = (acc[p.bucket] ?? 0) + 1;
    return acc;
  }, {});
  const filtered = filter === "all" ? dedupedPriorities : dedupedPriorities.filter((p) => p.bucket === filter);
  const intelById = useMemo(() => new Map((intel as any[]).map((x: any) => [x.client_id, x])), [intel]);
  const messageByClient = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of recentMsgs as any[]) if (!m.has(msg.client_id)) m.set(msg.client_id, msg.body ?? "");
    return m;
  }, [recentMsgs]);
  const visible = showAll ? filtered : filtered.slice(0, 3);

  const activeIntel = (intel as any[]).filter((x: any) => clientById.has(x.client_id));
  const pulseAtRisk = activeIntel.filter((x: any) =>
    (x.pain_flags ?? []).some((p: any) => p.status === "new" || p.status === "followup") ||
    (x.compliance_pct != null && x.assigned > 0 && x.compliance_pct < 60) ||
    (x.labels ?? []).includes("inactive")
  );
  const pulseWatch = activeIntel.filter((x: any) =>
    !pulseAtRisk.includes(x) && x.compliance_pct != null && x.assigned > 0 && x.compliance_pct < 80
  );
  const pulseOnTrack = Math.max(0, active - pulseAtRisk.length - pulseWatch.length);

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
  const openCount = dedupedPriorities.length;

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
                const n = f.key === "all" ? dedupedPriorities.length : counts[f.key] ?? 0;
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
                <span className="font-semibold">{openCount === 0 ? "You’re caught up." : "Nothing in this filter."}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">{openCount === 0 ? "New items appear here automatically." : "Try All."}</span>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {visible.map((p) => <PriorityRow key={p.id} p={p} intel={p.clientId ? intelById.get(p.clientId) : undefined} messagePreview={p.clientId ? messageByClient.get(p.clientId) : null} onResolved={refreshNeedsYou} />)}
              </ul>
              {filtered.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-2 w-full rounded-md border border-border py-2 text-[11px] font-semibold text-primary hover:bg-secondary/50"
                >
                  Show remaining {filtered.length - visible.length}
                </button>
              )}
              {showAll && filtered.length > 3 && (
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

        {/* ---------------- CLIENT PULSE ---------------- */}
        <Card className="border-border bg-card p-4">
          <SectionHeader title="Client pulse" icon={Activity} viewAll={{ to: "/admin/training-intelligence", label: "Training intel" }} />
          <div className="grid grid-cols-3 divide-x divide-border rounded-lg bg-secondary/20 py-2.5">
            <div className="text-center">
              <div className="text-xl font-black text-emerald-600">{pulseOnTrack}</div>
              <div className="text-[10px] font-semibold text-muted-foreground">On track</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-amber-600">{pulseWatch.length}</div>
              <div className="text-[10px] font-semibold text-muted-foreground">Watch</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-destructive">{pulseAtRisk.length}</div>
              <div className="text-[10px] font-semibold text-muted-foreground">Needs attention</div>
            </div>
          </div>
          {(pulseAtRisk.length > 0 || pulseWatch.length > 0) && (
            <ul className="mt-2 divide-y divide-border">
              {[...pulseAtRisk, ...pulseWatch].slice(0, 3).map((x: any) => {
                const pain = (x.pain_flags ?? []).some((p: any) => p.status === "new" || p.status === "followup");
                const reason = pain ? "Pain/discomfort reported" :
                  (x.labels ?? []).includes("inactive") ? "Inactive" :
                  x.compliance_pct != null ? `${x.compliance_pct}% 14-day compliance` : "Needs review";
                return (
                  <li key={x.client_id} className="flex items-center gap-2.5 py-2">
                    <UserAvatar src={x.profile_picture_url ?? undefined} name={x.full_name ?? "Client"} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">{x.full_name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{reason}</div>
                    </div>
                    <Link to="/admin/training-intelligence" className="text-[10px] font-semibold text-primary">Review</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

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

