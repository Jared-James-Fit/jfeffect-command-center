import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users, UserPlus, AlertTriangle, Calendar, DollarSign,
  Plus, Zap, ExternalLink, Activity, Dumbbell, Package, Timer, UserCheck, Apple,
  ClipboardCheck, Heart, FileText, Target, MessageCircle, Video, FileSignature,
} from "lucide-react";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import { deriveImportantDate, dateTypeLabel, importantToneClasses, type ImportantDate } from "@/lib/important-dates";
import { deriveTarget } from "@/lib/nutrition-cardio";
import { statusTone, fmtTimeRange } from "@/lib/pt-sessions";
import type { ConversationState, Message } from "@/lib/messages";
import { listLiftVideos, statusTone as liftStatusTone } from "@/lib/lift-videos";
import { formatDistanceToNow, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function StatCard({ label, value, icon: Icon, tone = "default" }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "default" | "warn" | "primary" }) {
  return (
    <Card className="border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-md ${
          tone === "primary" ? "bg-gradient-primary text-primary-foreground" :
          tone === "warn" ? "bg-warning/15 text-warning" : "bg-secondary text-foreground"
        }`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function AdminDashboard() {
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

  const deadlines = phaseRows
    .map((r) => ({ ...r, derived: derivePhase(r) }))
    .filter((r) => ["ending-soon", "due-today", "past-due"].includes(r.derived.state))
    .slice(0, 8);

  const { data: ptSessions = [] } = useQuery({
    queryKey: ["pt-sessions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("*, clients(id, full_name)")
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true });
      return data ?? [];
    },
  });

  const { data: nutritionTargets = [] } = useQuery({
    queryKey: ["nutrition-targets"],
    queryFn: async () => {
      const { data } = await supabase
        .from("nutrition_targets")
        .select("id, client_id, start_date, end_date, status, ending_soon_days, phase, custom_phase, clients(id, full_name)")
        .neq("status", "Archived")
        .order("end_date", { ascending: true });
      return data ?? [];
    },
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const inSevenDays = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const sessionsToday = ptSessions.filter((s: any) => s.session_date === todayStr && s.status === "Scheduled");
  const sessionsThisWeek = ptSessions.filter((s: any) => s.session_date >= todayStr && s.session_date <= inSevenDays && s.status === "Scheduled");
  const sessionsNeedMarking = ptSessions.filter((s: any) => s.session_date < todayStr && s.status === "Scheduled");
  const sessionsMissedOrCancelled = ptSessions.filter((s: any) => s.status === "Missed" || s.status === "Cancelled").slice(0, 5);
  const nextSession = sessionsThisWeek[0];

  const nutritionAlerts = nutritionTargets
    .map((t: any) => ({ ...t, derived: deriveTarget(t) }))
    .filter((t: any) => ["ending-soon", "due-today", "past-due"].includes(t.derived.state))
    .slice(0, 8);

  const { data: importantDates = [] } = useQuery({
    queryKey: ["important-dates"],
    queryFn: async () => {
      const { data } = await (supabase.from("important_dates") as any)
        .select("*, clients(id, full_name)")
        .neq("status", "Archived")
        .order("target_date", { ascending: true });
      return (data ?? []) as Array<ImportantDate & { clients: { id: string; full_name: string } | null }>;
    },
  });

  const { data: agreementsNeedingAttention = [] } = useQuery({
    queryKey: ["dashboard-agreements"],
    queryFn: async () => {
      const { data } = await supabase.from("agreements")
        .select("id, template_name, status, sent_at, client_id, clients(id, full_name)")
        .in("status", ["Sent", "Opened", "In Progress", "Waiting On Client", "Waiting On Coach", "Expired", "Needs Update"])
        .order("sent_at", { ascending: false })
        .limit(8);
      return (data ?? []) as any[];
    },
  });

  const importantAlerts = importantDates
    .map((d) => ({ ...d, derived: deriveImportantDate(d) }))
    .filter((d) => {
      const s = d.derived.state;
      if (["past-due", "due-today", "approaching"].includes(s)) return true;
      if (s === "active" && d.derived.daysRemaining <= 30) return true;
      return false;
    })
    .slice(0, 8);

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
        .eq("is_internal_note", false)
        .eq("sender_role", "client")
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as Message[];
    },
  });

  const { data: liftVideos = [] } = useQuery({
    queryKey: ["lift-videos-admin"],
    queryFn: () => listLiftVideos(),
  });
  const liftNeedReview = liftVideos
    .filter((v) => !v.reviewed_at && v.status !== "Archived")
    .sort((a, b) => (Number(b.is_urgent) - Number(a.is_urgent)) || (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
    .slice(0, 8);

  const clientNameById = new Map(clients.map((c) => [c.id, c.full_name]));
  const stateMap = new Map(convStates.map((s) => [s.client_id, s]));
  const seenC = new Set<string>();
  const messagesNeedingResponse = recentMsgs
    .filter((m) => {
      if (seenC.has(m.client_id)) return false;
      const st = stateMap.get(m.client_id);
      const lr = st?.admin_last_read_at ? new Date(st.admin_last_read_at).getTime() : 0;
      const unread = new Date(m.created_at).getTime() > lr;
      const needs = st?.status === "needs_response";
      const highPriority = st?.priority === "High Priority" || st?.priority === "Important";
      if (unread || needs || highPriority) {
        seenC.add(m.client_id);
        return true;
      }
      return false;
    })
    .slice(0, 8);

  // Account setup alerts
  const now = Date.now();
  const setupAlerts = clients
    .map((c) => {
      const expired = c.invite_expires_at && new Date(c.invite_expires_at).getTime() < now && !c.account_created_at;
      const notCreated = !c.account_created_at;
      const needsHelp = c.needs_admin_help;
      const recentReset = c.password_reset_sent_at && (now - new Date(c.password_reset_sent_at).getTime()) < 7 * 24 * 60 * 60 * 1000;
      let tone: "warn" | "primary" | "default" | null = null;
      let label = "";
      if (needsHelp) { tone = "warn"; label = "Needs admin help"; }
      else if (expired) { tone = "warn"; label = "Invite expired"; }
      else if (notCreated && c.invite_sent_at) { tone = "primary"; label = "Setup pending"; }
      else if (notCreated && c.email) { tone = "default"; label = "No invite sent"; }
      else if (recentReset) { tone = "primary"; label = "Reset email sent"; }
      return tone ? { ...c, _tone: tone, _label: label } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 8);

  const active = clients.length;
  const newClients = clients.filter((c) => c.status === "New Client").length;
  const overdue = clients.filter((c) => c.status === "Payment Overdue" || c.payment_status === "Overdue").length;
  const needsAttention = clients.filter((c) => c.status === "Needs Attention" || c.status === "Check-In Overdue").length;

  const quickActions = [
    { label: "Add Client", to: "/admin/clients", icon: Plus },
    { label: "Quick Sell", to: "/admin/offers", icon: Zap },
    { label: "Book PT Session", to: "/admin/calendar", icon: Calendar },
    { label: "Update Phase", to: "/admin/training-phases", icon: Timer },
    { label: "Nutrition Targets", to: "/admin/nutrition-targets", icon: Apple },
    { label: "Cardio Targets", to: "/admin/cardio-targets", icon: Heart },
    { label: "Review Check-Ins", to: "/admin/check-ins", icon: ClipboardCheck },
    { label: "Programs", to: "/admin/programs", icon: FileText },
    { label: "Add Exercise", to: "/admin/exercises", icon: Dumbbell },
    { label: "Create Offer", to: "/admin/offers", icon: Package },
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
      <PageHeader
        title="Command Center"
        subtitle="Your coaching business at a glance."
        actions={quickActions.map((a) => (
          <Link key={a.label} to={a.to}>
            <Button variant="outline" size="sm" className="font-semibold">
              <a.icon className="mr-2 h-4 w-4" />{a.label}
            </Button>
          </Link>
        ))}
      />
      <div className="space-y-6 p-6 md:p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active Clients" value={active} icon={Users} tone="primary" />
          <StatCard label="New This Period" value={newClients} icon={UserPlus} />
          <StatCard label="Needs Attention" value={needsAttention} icon={AlertTriangle} tone="warn" />
          <StatCard label="Payment Overdue" value={overdue} icon={DollarSign} tone="warn" />
        </div>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <MessageCircle className="h-4 w-4" /> Messages Needing Response
            </h2>
            <Link to="/admin/messages" className="text-xs font-semibold text-primary hover:underline">Open inbox →</Link>
          </div>
          {messagesNeedingResponse.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No client messages need a response.</div>
          ) : (
            <ul className="divide-y divide-border">
              {messagesNeedingResponse.map((m) => {
                const st = stateMap.get(m.client_id);
                return (
                  <li key={m.client_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      {st?.priority === "High Priority" && <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">High</Badge>}
                      {st?.priority === "Important" && <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">Important</Badge>}
                      <Link to="/admin/messages" search={{ client: m.client_id }} className="text-sm font-semibold hover:underline">
                        {clientNameById.get(m.client_id) ?? "Client"}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground max-w-md">{m.body || "(attachment)"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(parseISO(m.created_at), { addSuffix: true })}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Video className="h-4 w-4" /> Lift Videos Needing Review
            </h2>
            <Link to="/admin/lift-videos" className="text-xs font-semibold text-primary hover:underline">Open reviews →</Link>
          </div>
          {liftNeedReview.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">All caught up — no videos awaiting review.</div>
          ) : (
            <ul className="divide-y divide-border">
              {liftNeedReview.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    {v.is_urgent && <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3 w-3" />Urgent</Badge>}
                    <Link to="/admin/clients/$id" params={{ id: v.client_id }} search={{ tab: "lift-videos" as any }} className="text-sm font-semibold hover:underline">
                      {clientNameById.get(v.client_id) ?? "Client"}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground max-w-md">{v.exercise} · {v.training_day ?? "—"}</span>
                    <Badge variant="outline" className={liftStatusTone(v.status)}>{v.status}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Calendar className="h-4 w-4" /> Upcoming Personal Training Sessions
            </h2>
            <Link to="/admin/calendar" className="text-xs font-semibold text-primary hover:underline">View calendar →</Link>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-4 text-xs">
            <MiniStat label="Today" value={sessionsToday.length} />
            <MiniStat label="This week" value={sessionsThisWeek.length} />
            <MiniStat label="Needs marking" value={sessionsNeedMarking.length} tone={sessionsNeedMarking.length > 0 ? "warn" : undefined} />
            <MiniStat label="Missed / cancelled" value={sessionsMissedOrCancelled.length} />
          </div>
          {nextSession && (
            <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <span className="text-[10px] uppercase tracking-widest text-primary">Next up</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Link to="/admin/clients/$id" params={{ id: nextSession.clients?.id }} className="font-semibold hover:underline">{nextSession.clients?.full_name}</Link>
                <span className="text-xs text-muted-foreground">{nextSession.title} · {new Date(nextSession.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {fmtTimeRange(nextSession.start_time, nextSession.end_time)} · {nextSession.location}</span>
              </div>
            </div>
          )}
          {sessionsThisWeek.length === 0 && sessionsNeedMarking.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No upcoming sessions in the next 7 days.</div>
          ) : (
            <ul className="divide-y divide-border">
              {[...sessionsNeedMarking, ...sessionsThisWeek].slice(0, 8).map((s: any) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={statusTone(s.status)}>{s.status}</Badge>
                    {s.clients && <Link to="/admin/clients/$id" params={{ id: s.clients.id }} className="text-sm font-semibold hover:underline">{s.clients.full_name}</Link>}
                    <span className="text-xs text-muted-foreground">{s.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {fmtTimeRange(s.start_time, s.end_time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Apple className="h-4 w-4" /> Nutrition Targets Needing Updates
            </h2>
            <Link to="/admin/nutrition-targets" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
          </div>
          {nutritionAlerts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">All clients' nutrition targets are current.</div>
          ) : (
            <ul className="divide-y divide-border">
              {nutritionAlerts.map((t: any) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={t.derived.tone}>{t.derived.label}</Badge>
                    {t.clients && <Link to="/admin/clients/$id" params={{ id: t.clients.id }} className="text-sm font-semibold hover:underline">{t.clients.full_name}</Link>}
                    <span className="text-xs text-muted-foreground">{t.phase === "Custom" ? t.custom_phase : t.phase}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{t.derived.daysRemaining < 0 ? `${Math.abs(t.derived.daysRemaining)}d past due` : `${t.derived.daysRemaining}d left`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <UserCheck className="h-4 w-4" /> Account Setup Alerts
            </h2>
            <Link to="/admin/clients" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
          </div>
          {setupAlerts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Every client has set up their account. Nice.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {setupAlerts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={
                        c._tone === "warn"
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : c._tone === "primary"
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }
                    >
                      {c._label}
                    </Badge>
                    <Link to="/admin/clients/$id" params={{ id: c.id }} className="text-sm font-semibold hover:underline">
                      {c.full_name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{c.email ?? "no email"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{c.account_status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Timer className="h-4 w-4" /> Training Phase Deadlines
            </h2>
            <Link to="/admin/training-phases" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
          </div>
          {deadlines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No phases ending soon. You're ahead.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {deadlines.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={toneClasses(p.derived.tone)}>{p.derived.label}</Badge>
                    {p.clients && (
                      <Link to="/admin/clients/$id" params={{ id: p.clients.id }} className="text-sm font-semibold hover:underline">
                        {p.clients.full_name}
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">{displayTitle(p)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {p.derived.daysRemaining < 0 ? `${Math.abs(p.derived.daysRemaining)}d past due` : `${p.derived.daysRemaining}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Target className="h-4 w-4" /> Important Training Dates
            </h2>
          </div>
          {importantAlerts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No important dates in the next 30 days.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {importantAlerts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={importantToneClasses(d.derived.tone)}>{d.derived.label}</Badge>
                    {d.clients && (
                      <Link to="/admin/clients/$id" params={{ id: d.clients.id }} search={{ tab: "training" }} className="text-sm font-semibold hover:underline">
                        {d.clients.full_name}
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">{d.title} · {dateTypeLabel(d)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {d.derived.daysRemaining < 0 ? `${Math.abs(d.derived.daysRemaining)}d past` : `${d.derived.daysRemaining}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="border-border bg-card p-6 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Recent Clients</h2>

              <Link to="/admin/clients" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
            </div>
            {clients.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No clients yet. <Link to="/admin/clients" className="text-primary underline">Add your first client</Link>.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {clients.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <Link to="/admin/clients/$id" params={{ id: c.id }} className="flex items-center gap-3 hover:opacity-80">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-primary text-xs font-black text-primary-foreground">
                        {c.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{c.full_name}</div>
                        <div className="text-xs text-muted-foreground">{c.coaching_type ?? "—"}</div>
                      </div>
                    </Link>
                    <Badge variant="outline" className="text-xs">{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <FileSignature className="h-4 w-4" /> Agreements Needing Attention
              </h2>
              <Link to="/admin/agreements" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
            </div>
            {agreementsNeedingAttention.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                All agreements are signed or up-to-date.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {agreementsNeedingAttention.map((a: any) => (
                  <li key={a.id} className="py-2 flex items-center justify-between gap-2">
                    <Link to="/admin/agreements/instance/$id" params={{ id: a.id }} className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{a.clients?.full_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">{a.template_name}</p>
                    </Link>
                    <Badge variant="outline" className="text-[10px] shrink-0">{a.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">Quick Tools</h2>
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs font-semibold transition hover:border-primary hover:bg-secondary"
                >
                  <span>{s.name}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ))}
            </div>
            <Link to="/admin/apps">
              <Button variant="ghost" size="sm" className="mt-4 w-full justify-center">
                <Activity className="mr-2 h-4 w-4" /> View all tools
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}

void Calendar;

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "warn" ? "border-warning/40 bg-warning/10" : "border-border bg-secondary/40"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}