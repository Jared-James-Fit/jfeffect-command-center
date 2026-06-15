import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Users, UserPlus, AlertTriangle, Calendar, DollarSign, Plus, ExternalLink,
  Activity, Eye, ClipboardCheck, MessageCircle, Video, Timer, ShoppingCart,
  HardDrive, Mail, Apple, ChefHat, FileText, Megaphone, Zap, ClipboardList,
  ArrowRight, ChevronDown, LayoutGrid, MoreHorizontal, CheckCircle2, Cake, Settings as SettingsIcon,
} from "lucide-react";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import type { ConversationState, Message } from "@/lib/messages";
import { listLiftVideos } from "@/lib/lift-videos";
import { formatDistanceToNow, parseISO, endOfWeek } from "date-fns";
import { UpcomingBirthdaysWidget } from "@/components/upcoming-birthdays-widget";
import { UpcomingEventsPanel } from "@/components/events/upcoming-events-panel";
import { UpcomingAppointmentsCard } from "@/components/appointments/upcoming-appointments-card";
const PriceCardPickerDialog = lazy(() =>
  import("@/components/price-card-picker-dialog").then((m) => ({ default: m.PriceCardPickerDialog })),
);
import { UserAvatar } from "@/components/user-avatar";
import { getCoachIntel, filterIntel, LABEL_META } from "@/lib/coach-intel";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function StatTile({ label, value, icon: Icon, tone = "default", to, search }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "default" | "warn" | "primary"; to: string; search?: any }) {
  const isZero = Number(value) === 0;
  return (
    <Link to={to as any} search={search} className="block">
      <Card className="border-border bg-card p-3 transition active:scale-[0.98] hover:border-primary/50">
        <div className="flex items-center justify-between gap-2">
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
            isZero ? "bg-secondary text-muted-foreground" :
            tone === "primary" ? "bg-primary/15 text-primary" :
            tone === "warn" ? "bg-warning/15 text-warning" :
            "bg-secondary text-foreground"
          }`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="text-2xl font-black tracking-tight">{value}</div>
        </div>
        <div className="mt-1.5 text-[11px] font-semibold text-muted-foreground">{label}</div>
      </Card>
    </Link>
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
        <HardDrive className="h-4 w-4 text-warning shrink-0" />
        <div className="text-xs font-semibold min-w-0 flex-1 truncate">
          {data?.root_folder_id ? `Google Drive: ${data?.status ?? "Unknown"}` : "Google Drive not configured"}
        </div>
        <Link to="/admin/settings"><Button size="sm" variant="outline" className="h-7 text-xs">Fix</Button></Link>
      </div>
    </Card>
  );
}

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
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

function TrainingIntelDashboardCard() {
  const { data: intel = [] } = useQuery({
    queryKey: ["coach-intel"],
    queryFn: () => getCoachIntel(),
  });
  const attention = filterIntel(intel, "attention").slice(0, 5);
  return (
    <Card className="border-border bg-card p-4 md:p-5">
      <SectionHeader title="Training Intelligence" icon={Activity} viewAll={{ to: "/admin/training-intelligence" }} />
      {attention.length === 0 ? (
        <EmptyRow>No training flags right now.</EmptyRow>
      ) : (
        <ul className="divide-y divide-border">
          {attention.map((c: any) => (
            <li key={c.client_id} className="flex items-start gap-3 py-2.5">
              <UserAvatar src={c.profile_picture_url ?? undefined} name={c.full_name ?? "Client"} size={32} />
              <div className="min-w-0 flex-1">
                <Link to="/admin/clients/$id" params={{ id: c.client_id }} className="text-sm font-semibold hover:underline truncate block">
                  {c.full_name}
                </Link>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(c.labels ?? []).slice(0, 4).map((l: string) => {
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
  );
}


// -------------------- TODAY priority feed --------------------
type Priority = {
  id: string;
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

function ActionsSheet({ actions, trigger }: { actions: { label: string; to: string; icon: any }[]; trigger: React.ReactNode }) {
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
            <Link key={a.label} to={a.to as any} onClick={() => setOpen(false)} className="block">
              <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/40 p-2 text-center transition active:scale-[0.97] hover:border-primary/50">
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

function AdminDashboard() {
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);

  // ---------- Data (unchanged sources) ----------
  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("archived", false);
      if (error) throw error;
      return data;
    },
  });

  const { data: phaseRows = [] } = useQuery({
    queryKey: ["training-phases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_phases")
        .select("*, clients(id, full_name)")
        .order("end_date", { ascending: true });
      if (error) throw error;
      return data as Array<TrainingPhase & { clients: { id: string; full_name: string } | null }>;
    },
  });

  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const deadlines = phaseRows
    .map((r) => ({ ...r, derived: derivePhase(r) }))
    .filter((r) => {
      if (["completed", "archived", "upcoming"].includes(r.derived.state)) return false;
      return parseISO(r.end_date) <= weekEnd;
    })
    .sort((a, b) => a.end_date.localeCompare(b.end_date));

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
        .order("created_at", { ascending: false }).limit(200);
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
      .order("purchased_at", { ascending: false }).limit(8)).data ?? [],
  });

  const { data: activePurchases = [] } = useQuery({
    queryKey: ["active-purchases-by-client"],
    queryFn: async () => (await supabase.from("purchase_records").select("client_id, status").eq("status", "Active")).data ?? [],
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

  // ---------- Numbers ----------
  const active = clients.length;
  const overdue = clients.filter((c) => c.status === "Payment Overdue" || c.payment_status === "Overdue").length;
  const needsAttention = clients.filter((c) => c.status === "Needs Attention" || c.status === "Check-In Overdue").length;
  const reviewsWaiting = (checkInSubmissions as any[]).length + liftNeedReview.length;

  // ---------- Payments / products ----------
  const clientsWithActivePurchase = new Set((activePurchases as any[]).map((p) => p.client_id));
  const EXCLUDED_FOR_SELL = new Set(["Deactivated", "Archived", "Paused", "Cancelling"]);
  const clientsWithoutProduct = clients
    .filter((c) => !EXCLUDED_FOR_SELL.has(c.status ?? "") && !clientsWithActivePurchase.has(c.id))
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));

  // ---------- Unified priority feed ----------
  const priorities: Priority[] = [];
  for (const v of liftNeedReview.slice(0, 10)) {
    const c: any = clientById.get(v.client_id);
    priorities.push({
      id: `lift-${v.id}`,
      clientId: v.client_id,
      name: clientNameById.get(v.client_id) ?? "Client",
      reason: `Lift video${v.exercise ? ` · ${v.exercise}` : ""}`,
      time: formatDistanceToNow(parseISO(v.created_at), { addSuffix: true }),
      urgent: !!v.is_urgent,
      href: "/admin/lift-videos",
      search: { open: v.id },
      action: "Review",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const s of checkInSubmissions.slice(0, 10) as any[]) {
    const c: any = clientById.get(s.client_id);
    priorities.push({
      id: `ci-${s.id}`,
      clientId: s.client_id,
      name: clientNameById.get(s.client_id) ?? "Client",
      reason: "Check-in awaiting review",
      time: s.submitted_at ? formatDistanceToNow(parseISO(s.submitted_at), { addSuffix: true }) : undefined,
      href: "/admin/check-in-reviews",
      action: "Review",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const m of messagesNeedingResponse.slice(0, 10)) {
    const st = stateMap.get(m.client_id);
    const c: any = clientById.get(m.client_id);
    priorities.push({
      id: `msg-${m.client_id}`,
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
  for (const p of (paymentsAttention as any[]).slice(0, 5)) {
    const c: any = clientById.get(p.client_id);
    priorities.push({
      id: `pay-${p.id}`,
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
  for (const c of setupAlerts.slice(0, 5)) {
    priorities.push({
      id: `setup-${c.id}`,
      clientId: c.id,
      name: c.full_name,
      reason: c._label,
      urgent: c._urgent,
      href: "/admin/clients/$id",
      params: { id: c.id },
      action: "Fix Setup",
      avatarUrl: (c as any).profile_picture_url ?? null,
    });
  }
  for (const a of (actionRequests as any[]).slice(0, 5)) {
    const c: any = clientById.get(a.client_id);
    priorities.push({
      id: `ar-${a.id}`,
      clientId: a.client_id,
      name: a.clients?.full_name ?? "Client",
      reason: "Action request pending",
      href: "/admin/client-action-requests",
      action: "Open",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  // urgent first, then by insertion
  priorities.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  const priorityTop = priorities.slice(0, 3);
  const priorityRest = priorities.length - priorityTop.length;

  // ---------- Quick Actions ----------
  const primaryActions = [
    { label: "Add Client",     to: "/admin/clients",          icon: Plus },
    { label: "Message",        to: "/admin/messages",         icon: MessageCircle },
    { label: "Check-Ins",      to: "/admin/check-in-reviews", icon: ClipboardList },
    { label: "Program",        to: "/admin/program-library",  icon: FileText },
  ];
  const moreActions = [
    { label: "Lift Reviews",   to: "/admin/lift-videos",      icon: Video },
    { label: "Payment Link",   to: "/admin/payment-links",    icon: DollarSign },
    { label: "Appointment",    to: "/admin/calendar",         icon: Calendar },
    { label: "Broadcast",      to: "/admin/broadcasts",       icon: Megaphone },
    { label: "Recipe",         to: "/admin/recipes",          icon: ChefHat },
    { label: "Upload Media",   to: "/admin/media",            icon: HardDrive },
    { label: "Add Product",    to: "/admin/payment-links",    icon: ShoppingCart },
    { label: "Assign Program", to: "/admin/program-library",  icon: FileText },
  ];

  const shortcuts = [
    { name: "Stripe", url: "https://dashboard.stripe.com" },
    { name: "Google Drive", url: "https://drive.google.com" },
    { name: "Google Sheets", url: "https://sheets.google.com" },
    { name: "Google Calendar", url: "https://calendar.google.com" },
    { name: "Fillout", url: "https://fillout.com" },
    { name: "SignNow", url: "https://signnow.com" },
  ];

  return (
    <>
      <PageHeader title="Today" subtitle="What needs your attention." />

      <div
        className="w-full max-w-full space-y-4 overflow-x-hidden p-4 md:p-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}
      >
        <DriveSetupBanner />

        {/* TODAY PRIORITY */}
        <Card className="border-border bg-card p-4">
          <SectionHeader
            title="Today"
            icon={Zap}
            viewAll={priorityRest > 0 ? { to: "/admin/clients", label: `View all (${priorities.length})` } : undefined}
          />
          {priorityTop.length === 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-500/5 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="font-semibold">You're caught up.</span>
              </div>
              <Link to="/admin/calendar" className="text-[11px] font-semibold text-primary hover:underline">View schedule →</Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {priorityTop.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <UserAvatar src={p.avatarUrl ?? undefined} name={p.name} size={36} />
                  <div className="min-w-0 flex-1">
                    {p.clientId ? (
                      <Link to="/admin/clients/$id" params={{ id: p.clientId }} className="block truncate text-sm font-semibold hover:underline">{p.name}</Link>
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
              ))}
            </ul>
          )}
        </Card>

        {/* QUICK ACTIONS */}
        <div className="grid grid-cols-5 gap-2">
          {primaryActions.map((a) => (
            <Link key={a.label} to={a.to as any} className="block">
              <div className="flex h-full min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-center transition active:scale-[0.96] hover:border-primary/50">
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
              <button type="button" className="flex h-full min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-center transition active:scale-[0.96] hover:border-primary/50">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-bold leading-tight">More</div>
              </button>
            }
          />
        </div>

        {/* NUMBERS */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Active clients" value={active} icon={Users} tone="primary" to="/admin/clients" />
          <StatTile label="Needs attention" value={needsAttention} icon={AlertTriangle} tone="warn" to="/admin/clients" />
          <StatTile label="Reviews waiting" value={reviewsWaiting} icon={ClipboardCheck} to="/admin/check-in-reviews" />
          <StatTile label="Payments overdue" value={overdue} icon={DollarSign} tone="warn" to="/admin/payments" />
        </div>

        {/* WORK QUEUES (desktop side-by-side with appointments) */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <Card className="border-border bg-card p-4">
              <Tabs defaultValue="reviews">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-[13px] font-bold tracking-tight">Work queues</h2>
                  <TabsList className="h-8 bg-secondary/60">
                    <TabsTrigger value="reviews" className="h-7 text-[11px]">Reviews</TabsTrigger>
                    <TabsTrigger value="training" className="h-7 text-[11px]">Training</TabsTrigger>
                    <TabsTrigger value="payments" className="h-7 text-[11px]">Payments</TabsTrigger>
                    <TabsTrigger value="onboarding" className="h-7 text-[11px]">Onboarding</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="reviews" className="mt-0 space-y-2">
                  {(checkInSubmissions as any[]).length === 0 && liftNeedReview.length === 0 ? (
                    <EmptyRow>No reviews waiting.</EmptyRow>
                  ) : (
                    <>
                      {liftNeedReview.slice(0, 2).map((v) => (
                        <QueueRow
                          key={`r-lift-${v.id}`}
                          name={clientNameById.get(v.client_id) ?? "Client"}
                          reason={`Lift video${v.exercise ? ` · ${v.exercise}` : ""}`}
                          to="/admin/lift-videos"
                          search={{ open: v.id }}
                          action="Review"
                          avatarUrl={(clientById.get(v.client_id) as any)?.profile_picture_url ?? null}
                        />
                      ))}
                      {(checkInSubmissions as any[]).slice(0, 1).map((s: any) => (
                        <QueueRow
                          key={`r-ci-${s.id}`}
                          name={clientNameById.get(s.client_id) ?? "Client"}
                          reason="Check-in awaiting review"
                          to="/admin/check-in-reviews"
                          action="Review"
                          avatarUrl={(clientById.get(s.client_id) as any)?.profile_picture_url ?? null}
                        />
                      ))}
                      <ViewAllLink to="/admin/check-in-reviews" count={(checkInSubmissions as any[]).length + liftNeedReview.length} />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="training" className="mt-0 space-y-2">
                  {deadlines.length === 0 ? (
                    <EmptyRow>No training deadlines this week.</EmptyRow>
                  ) : (
                    <>
                      {deadlines.slice(0, 3).map((p) => (
                        <div key={p.id} className="rounded-lg border border-border bg-secondary/30 p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="min-w-0 flex-1">
                              {p.clients ? (
                                <Link to="/admin/clients/$id" params={{ id: p.clients.id }} search={{ tab: "training" }} className="block truncate text-sm font-semibold hover:underline">
                                  {p.clients.full_name}
                                </Link>
                              ) : <span className="text-sm text-muted-foreground">—</span>}
                              <div className="truncate text-[11px] text-muted-foreground">{displayTitle(p)} · {p.phase_type}</div>
                            </div>
                            <Badge variant="outline" className={`shrink-0 ${toneClasses(p.derived.tone)}`}>
                              {p.derived.daysRemaining < 0 ? `${Math.abs(p.derived.daysRemaining)}d past` : p.derived.daysRemaining === 0 ? "Due today" : `${p.derived.daysRemaining}d left`}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress value={p.derived.percentComplete} className="h-1 flex-1" />
                            <Link to="/admin/clients/$id" params={{ id: p.client_id }} search={{ tab: "training" }} className="shrink-0 text-[11px] font-semibold text-primary hover:underline">Update</Link>
                          </div>
                        </div>
                      ))}
                      <ViewAllLink to="/admin/training-intelligence" count={deadlines.length} />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="payments" className="mt-0 space-y-2">
                  {(paymentsAttention as any[]).length === 0 && clientsWithoutProduct.length === 0 ? (
                    <EmptyRow>Payments look healthy.</EmptyRow>
                  ) : (
                    <>
                      {(paymentsAttention as any[]).slice(0, 2).map((p: any) => (
                        <QueueRow
                          key={`pay-${p.id}`}
                          name={p.clients?.full_name ?? "Client"}
                          reason={`${p.payment_status} · ${p.offer_name ?? ""}`.trim()}
                          to="/admin/purchases/$id"
                          params={{ id: p.id }}
                          action="Open"
                          urgent
                          avatarUrl={(clientById.get(p.client_id) as any)?.profile_picture_url ?? null}
                        />
                      ))}
                      {clientsWithoutProduct.length > 0 && (
                        <Link to="/admin/clients" className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/30 p-2.5 hover:border-primary/50 transition">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{clientsWithoutProduct.length} clients without an active product</div>
                            <div className="text-[11px] text-muted-foreground">Review who needs to be sold</div>
                          </div>
                          <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs">Review</Button>
                        </Link>
                      )}
                      {(paymentsAttention as any[]).length > 2 && (
                        <ViewAllLink to="/admin/payments" count={(paymentsAttention as any[]).length} />
                      )}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="onboarding" className="mt-0 space-y-2">
                  {setupAlerts.length === 0 ? (
                    <EmptyRow>No onboarding issues.</EmptyRow>
                  ) : (
                    <>
                      {setupAlerts.slice(0, 3).map((c) => (
                        <QueueRow
                          key={`setup-${c.id}`}
                          name={c.full_name}
                          reason={c._label}
                          to="/admin/clients/$id"
                          params={{ id: c.id }}
                          action="Fix"
                          urgent={c._urgent}
                          avatarUrl={(c as any).profile_picture_url ?? null}
                        />
                      ))}
                      <ViewAllLink to="/admin/clients" count={setupAlerts.length} />
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </Card>

            {/* TRAINING INTELLIGENCE (separate insight feed, kept distinct from deadlines) */}
            <TrainingIntelDashboardCard />
          </div>

          {/* RIGHT COLUMN */}
          <div className="min-w-0 space-y-4">
            <UpcomingAppointmentsCard mode="admin" />

            {/* MORE — collapsed by default */}
            <MoreSection
              clients={clients}
              shortcuts={shortcuts}
            />
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

function QueueRow({ name, reason, to, search, params, action, avatarUrl, urgent }: { name: string; reason: string; to: string; search?: any; params?: any; action: string; avatarUrl?: string | null; urgent?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-2.5">
      <UserAvatar src={avatarUrl ?? undefined} name={name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="mt-0.5 flex items-center gap-2">
          {urgent && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />}
          <span className="truncate text-[11px] text-muted-foreground">{reason}</span>
        </div>
      </div>
      <Link to={to as any} params={params} search={search} className="shrink-0">
        <Button size="sm" variant="outline" className="h-9 text-xs font-bold">{action}</Button>
      </Link>
    </div>
  );
}

function ViewAllLink({ to, count }: { to: string; count: number }) {
  return (
    <Link to={to as any} className="block text-center text-[11px] font-semibold text-primary hover:underline">
      View all ({count}) →
    </Link>
  );
}

function MoreSection({ clients, shortcuts }: { clients: any[]; shortcuts: { name: string; url: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-border bg-card p-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13px] font-bold tracking-tight">
              <LayoutGrid className="h-4 w-4 text-muted-foreground" /> More
            </h2>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          {/* Recent Clients */}
          <div>
            <SectionHeader title="Recent clients" icon={Users} viewAll={{ to: "/admin/clients" }} />
            <ul className="divide-y divide-border">
              {clients.slice(0, 3).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2 min-w-0">
                  <Link to="/admin/clients/$id" params={{ id: c.id }} className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80">
                    <UserAvatar src={c.profile_picture_url} name={c.full_name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{c.full_name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{c.coaching_type ?? "—"}</div>
                    </div>
                  </Link>
                  <Badge variant="outline" className="shrink-0 max-w-[40%] truncate text-[10px]">{c.status}</Badge>
                </li>
              ))}
            </ul>
          </div>

          {/* Birthdays (compact widget, max 2 handled by widget) */}
          <div>
            <SectionHeader title="Upcoming birthdays" icon={Cake} />
            <UpcomingBirthdaysWidget />
          </div>

          {/* Events */}
          <UpcomingEventsPanel audience="admin" />

          {/* External tools */}
          <div>
            <SectionHeader title="External tools" icon={ExternalLink} />
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((s) => (
                <a key={s.name} href={s.url} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary">
                  <span className="truncate">{s.name}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>

          {/* Customize Navigation + Client POV */}
          <div className="grid grid-cols-2 gap-2">
            <Link to="/admin/floating-bar" className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary">
              <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Customize navigation</span>
            </Link>
            <Link to="/admin/client-pov" className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary">
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">View as client</span>
            </Link>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// keep silence for unused imports
void Mail; void Apple; void Timer; void Activity; void UserPlus;
