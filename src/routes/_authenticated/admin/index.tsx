import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Users, UserPlus, AlertTriangle, Calendar, DollarSign, Plus, ExternalLink,
  Activity, Eye, ClipboardCheck, MessageCircle, Video, Timer, ShoppingCart,
  HardDrive, Mail, Apple, ChefHat, FileText, Megaphone, Zap, ClipboardList,
  ArrowRight, ChevronUp, ChevronDown, LayoutGrid,
} from "lucide-react";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import type { ConversationState, Message } from "@/lib/messages";
import { listLiftVideos } from "@/lib/lift-videos";
import { formatDistanceToNow, parseISO, format, startOfWeek, endOfWeek, isToday } from "date-fns";
import { UpcomingBirthdaysWidget } from "@/components/upcoming-birthdays-widget";
import { UpcomingEventsPanel } from "@/components/events/upcoming-events-panel";
import { UpcomingAppointmentsCard } from "@/components/appointments/upcoming-appointments-card";
import { PriceCardPickerDialog } from "@/components/price-card-picker-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { getCoachIntel, filterIntel, LABEL_META } from "@/lib/coach-intel";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function StatCard({ label, value, icon: Icon, tone = "default" }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "default" | "warn" | "primary" }) {
  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-1 text-xl font-black tracking-tight sm:text-2xl md:text-3xl">{value}</div>
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${
          tone === "primary" ? "bg-gradient-primary text-primary-foreground" :
          tone === "warn" ? "bg-warning/15 text-warning" : "bg-secondary text-foreground"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
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
    <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
      <h2 className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}{title}
      </h2>
      {viewAll && (
        <Link to={viewAll.to as any} search={viewAll.search} params={viewAll.params} className="shrink-0 text-[11px] font-semibold text-primary hover:underline">
          {viewAll.label ?? "View all"} →
        </Link>
      )}
    </div>
  );
}

function EmptyMini({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
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
        <EmptyMini>No training flags right now.</EmptyMini>
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

function AdminDashboard() {
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);

  const [commandCollapsed, setCommandCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("admin-command-collapsed-v2");
    if (saved !== null) return saved === "true";
    return window.innerWidth < 768; // mobile only: collapsed by default
  });

  useEffect(() => {
    localStorage.setItem("admin-command-collapsed-v2", String(commandCollapsed));
  }, [commandCollapsed]);

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
  void startOfWeek;
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

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const liftNeedReview = liftVideos.filter((v) => !v.reviewed_at && v.status !== "Archived");

  // Latest comment per lift video shown in Needs Attention (for preview line).
  const liftIdsForPreview = liftNeedReview.slice(0, 10).map((v) => v.id);
  const { data: liftLatestComments = [] } = useQuery({
    queryKey: ["lift-latest-comments-dash", liftIdsForPreview.sort().join(",")],
    enabled: liftIdsForPreview.length > 0,
    queryFn: async () => {
      const { data } = await (supabase.from("lift_video_comments") as any)
        .select("video_id, body, author_role, created_at, is_internal_note")
        .in("video_id", liftIdsForPreview)
        .eq("is_internal_note", false)
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as Array<{ video_id: string; body: string | null; author_role: string; created_at: string; is_internal_note: boolean }>;
    },
  });
  const liftPreviewByVideoId = useMemo(() => {
    const m = new Map<string, { body: string; from: "admin" | "client" }>();
    for (const c of liftLatestComments) {
      if (m.has(c.video_id)) continue;
      const body = (c.body ?? "").trim();
      if (!body) continue;
      m.set(c.video_id, { body, from: c.author_role === "admin" ? "admin" : "client" });
    }
    return m;
  }, [liftLatestComments]);

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

  const active = clients.length;
  const newClients = clients.filter((c) => c.status === "New Client").length;
  const overdue = clients.filter((c) => c.status === "Payment Overdue" || c.payment_status === "Overdue").length;
  const needsAttention = clients.filter((c) => c.status === "Needs Attention" || c.status === "Check-In Overdue").length;

  const clientsWithActivePurchase = new Set((activePurchases as any[]).map((p) => p.client_id));
  const EXCLUDED_FOR_SELL = new Set(["Deactivated", "Archived", "Paused", "Cancelling"]);
  const clientsWithoutProduct = clients
    .filter((c) => !EXCLUDED_FOR_SELL.has(c.status ?? "") && !clientsWithActivePurchase.has(c.id))
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));

  // Birthdays today
  const birthdaysToday = clients.filter((c) => {
    const dob = (c as any).date_of_birth;
    if (!dob) return false;
    const b = new Date(dob);
    return b.getMonth() === today.getMonth() && b.getDate() === today.getDate();
  });

  // Build Needs Attention unified feed
  type NeedItem = { id: string; clientId?: string; name: string; reason: string; time?: string; tone: string; priority: number; href: string; search?: any; params?: any; action: string; avatarUrl?: string | null; thumbnailUrl?: string | null; preview?: string | null; previewFromClient?: boolean };
  const need: NeedItem[] = [];
  for (const v of liftNeedReview.slice(0, 10)) {
    const c: any = clientById.get(v.client_id);
    const latest = liftPreviewByVideoId.get(v.id);
    const note = (v as any).client_notes?.trim?.() || (v as any).question_for_coach?.trim?.() || null;
    const preview = latest?.body ?? note ?? null;
    const previewFromClient = latest ? latest.from === "client" : true;
    need.push({
      id: `lift-${v.id}`,
      clientId: v.client_id,
      name: clientNameById.get(v.client_id) ?? "Client",
      reason: `Lift video${v.exercise ? ` · ${v.exercise}` : ""}`,
      time: formatDistanceToNow(parseISO(v.created_at), { addSuffix: true }),
      tone: v.is_urgent ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-primary",
      priority: v.is_urgent ? 1 : 4,
      href: "/admin/lift-videos",
      search: { open: v.id },
      action: "Open Review",
      avatarUrl: c?.profile_picture_url ?? null,
      thumbnailUrl: v.thumbnail_url ?? null,
      preview,
      previewFromClient,
    });
  }
  for (const s of checkInSubmissions.slice(0, 10)) {
    const c: any = clientById.get((s as any).client_id);
    need.push({
      id: `ci-${(s as any).id}`,
      clientId: (s as any).client_id,
      name: clientNameById.get((s as any).client_id) ?? "Client",
      reason: "Check-in awaiting review",
      time: (s as any).submitted_at ? formatDistanceToNow(parseISO((s as any).submitted_at), { addSuffix: true }) : undefined,
      tone: "border-primary/40 bg-primary/10 text-primary",
      priority: 3,
      href: "/admin/check-in-reviews",
      action: "Review",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const m of messagesNeedingResponse.slice(0, 10)) {
    const st = stateMap.get(m.client_id);
    const c: any = clientById.get(m.client_id);
    need.push({
      id: `msg-${m.client_id}`,
      clientId: m.client_id,
      name: clientNameById.get(m.client_id) ?? "Client",
      reason: "Unread message",
      time: formatDistanceToNow(parseISO(m.created_at), { addSuffix: true }),
      tone: st?.priority === "High Priority" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-primary",
      priority: st?.priority === "High Priority" ? 1 : 2,
      href: "/admin/messages",
      search: { client: m.client_id },
      action: "Reply",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const p of (paymentsAttention as any[]).slice(0, 5)) {
    const c: any = clientById.get(p.client_id);
    need.push({
      id: `pay-${p.id}`,
      clientId: p.client_id,
      name: p.clients?.full_name ?? "Client",
      reason: `${p.payment_status} · ${p.offer_name ?? ""}`,
      tone: "border-destructive/40 bg-destructive/10 text-destructive",
      priority: 1,
      href: "/admin/purchases/$id",
      params: { id: p.id },
      action: "Open",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  for (const c of setupAlerts.slice(0, 5)) {
    need.push({
      id: `setup-${c.id}`,
      clientId: c.id,
      name: c.full_name,
      reason: c._label,
      tone: c._urgent ? "border-warning/40 bg-warning/10 text-warning" : "border-muted/40 bg-muted/10 text-muted-foreground",
      priority: c._urgent ? 2 : 5,
      href: "/admin/clients/$id",
      params: { id: c.id },
      action: "Fix Setup",
      avatarUrl: (c as any).profile_picture_url ?? null,
    });
  }
  for (const a of (actionRequests as any[]).slice(0, 5)) {
    const c: any = clientById.get(a.client_id);
    need.push({
      id: `ar-${a.id}`,
      clientId: a.client_id,
      name: a.clients?.full_name ?? "Client",
      reason: "Action request pending",
      tone: "border-primary/40 bg-primary/10 text-primary",
      priority: 4,
      href: "/admin/client-action-requests",
      action: "Open",
      avatarUrl: c?.profile_picture_url ?? null,
    });
  }
  need.sort((a, b) => a.priority - b.priority);
  const needsTop = need.slice(0, 5);

  // Command Center counts
  const cc = {
    unread: messagesNeedingResponse.length,
    checkIns: (checkInSubmissions as any[]).length,
    lifts: liftNeedReview.length,
    actions: (actionRequests as any[]).length,
    payments: (paymentsAttention as any[]).length,
    setup: setupAlerts.length,
    birthdays: birthdaysToday.length,
  };
  void isToday; void format; void todayStr;

  const quickActions = [
    { label: "Add Client", to: "/admin/clients", icon: Plus },
    { label: "Message Client", to: "/admin/messages", icon: MessageCircle },
    { label: "Review Check-Ins", to: "/admin/check-in-reviews", icon: ClipboardList },
    { label: "Review Lift Videos", to: "/admin/lift-videos", icon: Video },
    { label: "Create Program", to: "/admin/program-library", icon: FileText },
    { label: "Send Payment Link", to: "/admin/payment-links", icon: DollarSign },
    { label: "New Broadcast", to: "/admin/broadcasts", icon: Megaphone },
    { label: "New Recipe", to: "/admin/recipes", icon: ChefHat },
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
      <PageHeader title="Command Center" subtitle="What needs your attention today." />

      <div className="w-full max-w-full space-y-4 overflow-x-hidden p-4 pb-32 md:p-6 md:pb-8">
        {/* POV + Drive */}
        <div className="grid gap-3 md:grid-cols-2">
          <Link to="/admin/client-pov" className="block">
            <Card className="border-warning/40 bg-gradient-to-r from-warning/20 to-warning/5 p-3 hover:shadow-md transition-shadow cursor-pointer h-full">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/20 text-warning"><Eye className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">Enter Client POV</div>
                  <div className="text-xs text-muted-foreground truncate">View the portal as any client</div>
                </div>
              </div>
            </Card>
          </Link>
          <DriveSetupBanner />
        </div>

        {/* FLOATING BAR CUSTOMIZE */}
        <div className="grid gap-3">
          <Link to="/admin/floating-bar" className="block">
            <div className="flex h-full items-center gap-3 rounded-lg border border-border bg-card p-3 transition hover:bg-accent">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-foreground">
                <LayoutGrid className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">Customize Floating Bar</div>
                <div className="truncate text-xs text-muted-foreground">Add toggles (including a Search shortcut), reorder, stack hold-to-open options.</div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
        </div>

        {/* TODAY'S COMMAND CENTER */}
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-widest">
              <Zap className="h-4 w-4 text-primary" /> Today's Command Center
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{format(today, "EEE MMM d")}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCommandCollapsed((v) => !v)}
                className="h-7 px-2 text-[11px] font-semibold"
                aria-label={commandCollapsed ? "Expand" : "Collapse"}
              >
                {commandCollapsed ? <><ChevronDown className="mr-1 h-3.5 w-3.5" />Expand</> : <><ChevronUp className="mr-1 h-3.5 w-3.5" />Collapse</>}
              </Button>
            </div>
          </div>

          {commandCollapsed ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {cc.checkIns > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.checkIns}</span> check-ins pending</span>}
              {cc.lifts > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.lifts}</span> lift videos pending</span>}
              {cc.unread > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.unread}</span> unread messages</span>}
              {cc.actions > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.actions}</span> action requests</span>}
              {cc.payments > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.payments}</span> payments need attention</span>}
              {cc.setup > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.setup}</span> clients need setup</span>}
              {cc.birthdays > 0 && <span className="whitespace-nowrap"><span className="font-bold text-foreground">{cc.birthdays}</span> birthdays today</span>}
              {cc.checkIns + cc.lifts + cc.unread + cc.actions + cc.payments + cc.setup + cc.birthdays === 0 && (
                <span>Inbox zero. You're all caught up.</span>
              )}
              <button onClick={() => setCommandCollapsed(false)} className="ml-auto text-[11px] font-semibold text-primary hover:underline whitespace-nowrap">
                Open →
              </button>
            </div>
          ) : (
            <>
              <ul className="space-y-1.5 text-sm">
                {cc.checkIns > 0 && <CcLine label="check-ins to review" count={cc.checkIns} to="/admin/check-in-reviews" />}
                {cc.lifts > 0 && <CcLine label="lift videos pending" count={cc.lifts} to="/admin/lift-videos" />}
                {cc.unread > 0 && <CcLine label={cc.unread === 1 ? "unread client message" : "unread client messages"} count={cc.unread} to="/admin/messages" />}
                {cc.actions > 0 && <CcLine label={cc.actions === 1 ? "action request" : "action requests"} count={cc.actions} to="/admin/client-action-requests" />}
                {cc.payments > 0 && <CcLine label="payments need attention" count={cc.payments} to="/admin/payments" />}
                {cc.setup > 0 && <CcLine label={cc.setup === 1 ? "client needs setup" : "clients need setup"} count={cc.setup} to="/admin/clients" />}
                {cc.birthdays > 0 && <CcLine label={cc.birthdays === 1 ? "birthday today" : "birthdays today"} count={cc.birthdays} to="/admin/clients" />}
                {cc.checkIns + cc.lifts + cc.unread + cc.actions + cc.payments + cc.setup + cc.birthdays === 0 && (
                  <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Inbox zero. You're all caught up.</li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/admin/check-in-reviews"><Button size="sm" variant="outline" className="h-8 text-xs">Review Check-Ins</Button></Link>
                <Link to="/admin/lift-videos"><Button size="sm" variant="outline" className="h-8 text-xs">Review Lift Videos</Button></Link>
                <Link to="/admin/messages"><Button size="sm" variant="outline" className="h-8 text-xs">Open Messages</Button></Link>
                {cc.setup > 0 && <Link to="/admin/clients"><Button size="sm" variant="outline" className="h-8 text-xs">Fix Setup</Button></Link>}
              </div>
            </>
          )}
        </Card>

        {/* QUICK STATS */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active Clients" value={active} icon={Users} tone="primary" />
          <StatCard label="New This Period" value={newClients} icon={UserPlus} />
          <StatCard label="Needs Attention" value={needsAttention} icon={AlertTriangle} tone="warn" />
          <StatCard label="Payment Overdue" value={overdue} icon={DollarSign} tone="warn" />
        </div>

        {/* QUICK ACTIONS */}
        <Card className="border-border bg-card p-4">
          <SectionHeader title="Quick Actions" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickActions.map((a) => (
              <Link key={a.label} to={a.to}>
                <Button variant="outline" size="sm" className="w-full justify-start font-semibold h-9 text-xs">
                  <a.icon className="mr-1.5 h-3.5 w-3.5" />
                  <span className="truncate">{a.label}</span>
                </Button>
              </Link>
            ))}
          </div>
        </Card>

        {/* UPCOMING APPOINTMENTS */}
        <UpcomingAppointmentsCard mode="admin" />

        {/* DESKTOP 2-COL GRID below */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* LEFT (col-span-2) */}
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {/* NEEDS ATTENTION */}
            <Card className="border-border bg-card p-4 md:p-5">
              <SectionHeader title="Needs Attention" icon={AlertTriangle} />
              {needsTop.length === 0 ? (
                <EmptyMini>Nothing urgent right now.</EmptyMini>
              ) : (
                <ul className="divide-y divide-border">
                  {needsTop.map((n) => (
                    <li key={n.id} className="flex items-center gap-3 py-2.5">
                      <UserAvatar src={n.avatarUrl ?? undefined} name={n.name} size={36} />
                      {n.thumbnailUrl && (
                        <div
                          className="relative hidden h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-secondary/60 sm:block"
                          style={{ backgroundImage: `url(${n.thumbnailUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                          aria-hidden
                        >
                          <div className="absolute inset-0 grid place-items-center">
                            <Video className="h-4 w-4 text-white/90 drop-shadow" />
                          </div>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {n.clientId ? (
                            <Link to="/admin/clients/$id" params={{ id: n.clientId }} className="text-sm font-semibold hover:underline truncate min-w-0 max-w-full">{n.name}</Link>
                          ) : (
                            <span className="text-sm font-semibold truncate min-w-0 max-w-full">{n.name}</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] max-w-full truncate ${n.tone}`}>{n.reason}</Badge>
                          {n.time && <span className="text-[10px] text-muted-foreground">{n.time}</span>}
                        </div>
                        {n.preview && (
                          <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground/80">
                              {n.previewFromClient ? `${n.name.split(" ")[0]}:` : "You:"}
                            </span>{" "}
                            {n.preview}
                          </div>
                        )}
                      </div>
                      <Link to={n.href as any} params={n.params as any} search={n.search} className="shrink-0">
                        <Button variant="outline" size="sm" className="h-8 text-[11px] shrink-0">{n.action}</Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* REVIEWS */}
            <Card className="border-border bg-card p-4 md:p-5">
              <SectionHeader title="Reviews" icon={ClipboardCheck} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Link to="/admin/check-in-reviews">
                  <Card className="border-border bg-secondary/30 p-3 hover:bg-secondary transition cursor-pointer h-full">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Check-Ins</div>
                        <div className="text-2xl font-black">{cc.checkIns}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Open Check-In Reviews</div>
                  </Card>
                </Link>
                <Link to="/admin/lift-videos">
                  <Card className="border-border bg-secondary/30 p-3 hover:bg-secondary transition cursor-pointer h-full">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Lift Videos</div>
                        <div className="text-2xl font-black">{cc.lifts}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Open Lift Reviews</div>
                  </Card>
                </Link>
              </div>
            </Card>

            {/* TRAINING INTELLIGENCE */}
            <TrainingIntelDashboardCard />

            {/* TRAINING DEADLINES */}
            <Card className="border-border bg-card p-4 md:p-5">
              <SectionHeader title="Training Deadlines" icon={Timer} viewAll={{ to: "/admin/training-phases" }} />
              {deadlines.length === 0 ? (
                <EmptyMini>No phases due this week. You're ahead.</EmptyMini>
              ) : (
                <ul className="divide-y divide-border">
                  {deadlines.slice(0, 5).map((p) => (
                    <li key={p.id} className="py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          {p.clients ? (
                            <Link to="/admin/clients/$id" params={{ id: p.clients.id }} search={{ tab: "training" }} className="text-sm font-semibold hover:underline truncate block">
                              {p.clients.full_name}
                            </Link>
                          ) : <span className="text-sm text-muted-foreground">—</span>}
                          <div className="text-[11px] text-muted-foreground truncate">{displayTitle(p)} · {p.phase_type}</div>
                        </div>
                        <Badge variant="outline" className={`shrink-0 ${toneClasses(p.derived.tone)}`}>
                          {p.derived.daysRemaining < 0 ? `${Math.abs(p.derived.daysRemaining)}d past` : p.derived.daysRemaining === 0 ? "Due today" : `${p.derived.daysRemaining}d left`}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Progress value={p.derived.percentComplete} className="h-1 min-w-[120px] flex-1" />
                        <span className="text-[10px] text-muted-foreground shrink-0">{p.derived.percentComplete}%</span>
                        <Link to="/admin/clients/$id" params={{ id: p.client_id }} search={{ tab: "training" }} className="shrink-0 text-[11px] font-semibold text-primary hover:underline">Update</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* RIGHT */}
          <div className="min-w-0 space-y-4">
            {/* BIRTHDAYS */}
            <UpcomingBirthdaysWidget />

            {/* EVENTS */}
            <UpcomingEventsPanel audience="admin" />

            {/* PAYMENTS / PRODUCTS */}
            <Card className="border-border bg-card p-4 md:p-5">
              <SectionHeader title="Payments & Products" icon={ShoppingCart} viewAll={{ to: "/admin/payment-links", label: "Sell product" }} />
              {clientsWithoutProduct.length === 0 ? (
                <EmptyMini>Every active client has a product. Nice.</EmptyMini>
              ) : (
                <>
                  <div className="mb-2 text-xs text-muted-foreground">
                    Clients without active product: <span className="font-bold text-foreground">{clientsWithoutProduct.length}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {clientsWithoutProduct.slice(0, 3).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 py-2 min-w-0">
                        <Link to="/admin/clients/$id" params={{ id: c.id }} className="text-sm font-semibold hover:underline truncate min-w-0 flex-1">{c.full_name}</Link>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] shrink-0" onClick={() => setSellTo({ id: c.id, name: c.full_name })}>
                          Sell
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {clientsWithoutProduct.length > 3 && (
                    <Link to="/admin/clients" className="mt-2 block text-center text-[11px] font-semibold text-primary hover:underline">
                      View all ({clientsWithoutProduct.length})
                    </Link>
                  )}
                </>
              )}
            </Card>

            {/* RECENT CLIENTS */}
            <Card className="border-border bg-card p-4 md:p-5">
              <SectionHeader title="Recent Clients" icon={Users} viewAll={{ to: "/admin/clients" }} />
              {clients.length === 0 ? (
                <EmptyMini>No clients yet.</EmptyMini>
              ) : (
                <ul className="divide-y divide-border">
                  {clients.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2 min-w-0">
                      <Link to="/admin/clients/$id" params={{ id: c.id }} className="flex items-center gap-2 hover:opacity-80 min-w-0 flex-1">
                        <UserAvatar src={c.profile_picture_url} name={c.full_name} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{c.full_name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{c.coaching_type ?? "—"}</div>
                        </div>
                      </Link>
                      <Badge variant="outline" className="text-[10px] shrink-0 max-w-[40%] truncate">{c.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* QUICK TOOLS */}
            <Card className="border-border bg-card p-4 md:p-5">
              <SectionHeader title="Quick Tools" icon={Activity} />
              <div className="grid grid-cols-2 gap-2">
                {shortcuts.map((s) => (
                  <a key={s.name} href={s.url} target="_blank" rel="noreferrer"
                    className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary">
                    <span className="truncate">{s.name}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                  </a>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>

      <PriceCardPickerDialog
        open={!!sellTo}
        fixedClientId={sellTo?.id}
        onClose={() => setSellTo(null)}
      />
    </>
  );
}

function CcLine({ label, count, to }: { label: string; count: number; to: string }) {
  return (
    <li>
      <Link to={to as any} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-secondary/50 transition">
        <span className="text-sm"><span className="font-black text-base text-primary">{count}</span> {label}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </Link>
    </li>
  );
}

// keep silence for unused imports that may become used later
void Calendar; void Mail; void Apple;