import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bell, Calendar as CalendarIcon } from "lucide-react";
import { isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";
import type { TrainingPhase } from "@/lib/training-phases";
import { derivePhase } from "@/lib/training-phases";
import { toast } from "sonner";
import type { WeightUnit } from "@/lib/progress-metrics";
import { HomeScreenSetupCard } from "@/components/home-screen-setup-card";
import { ClientActionRequestModal } from "@/components/client-action-request-modal";
import { UpcomingEventsPanel } from "@/components/events/upcoming-events-panel";
import { InstallAppCard } from "@/components/portal/install-app-card";
import { UpcomingScheduleCard } from "@/components/home/upcoming-schedule-card";
import { TrainingBlockCard } from "@/components/portal/training-block-card";
import { ProgressSummaryCard } from "@/components/progress/progress-summary-card";
import { HomeWaterCard } from "@/components/home/home-water-card";
import { BodyweightSummaryCard } from "@/components/portal/bodyweight-summary-card";
import { WearablesCard } from "@/components/portal/wearables-card";
import { SessionsCard } from "@/components/portal/sessions-card";
import { SetupChecklistBanner } from "@/components/portal/setup-checklist-banner";
import { AgreementDashboardCard } from "@/components/coaching-agreement/agreement-dashboard-card";
import { LevelCelebrations } from "@/components/portal/athlete-level-card";
import { SwipeCards } from "@/components/portal/swipe-cards";
import { MissingBodyweightPrompt } from "@/components/portal/missing-bodyweight-prompt";
import { SexPromptCard } from "@/components/athlete-sex";
import { CommunityHomeStrip } from "@/components/community/community-entry";
import { useEffect, useState } from "react";
import { listMyPortalAppointments } from "@/lib/appointments.functions";
import { useServerFn } from "@tanstack/react-start";
import { setClientTimeZone, bootstrapClientOccurrences } from "@/lib/action-centre.functions";
import { ensureDueMessengerCheckins } from "@/lib/messenger-checkins.functions";
import { format, isToday, isTomorrow } from "date-fns";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { DashboardRefreshIndicator } from "@/components/portal/dashboard-refresh-indicator";
import { DashboardOfflineEmpty, useIsOfflineWithoutCache } from "@/components/portal/dashboard-offline-empty";
import { DeferRender } from "@/components/defer-render";
import { logPerf } from "@/lib/perf-timing";
import { NotificationSetupPrompt } from "@/components/notification-setup-prompt";
import { CalendarSyncCard } from "@/components/schedule/calendar-sync-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GoalsSetupFlow } from "@/components/client-goals/GoalsSetupFlow";
import { Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/")({ component: PortalHome });

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function PortalHome() {
  const { user, role } = useAuth();
  const portalUserId = usePortalUserId();
  const offlineNoCache = useIsOfflineWithoutCache();
  const qc = useQueryClient();

  // Dev-only first-load timing.
  useEffect(() => { logPerf("dashboard mounted"); }, []);

  // Quietly persist device tz + ensure the client has at least one active
  // occurrence per enabled task definition. Both are idempotent server-side.
  const persistTz = useServerFn(setClientTimeZone);
  const bootstrapOcc = useServerFn(bootstrapClientOccurrences);
  const ensureMessengerCheckins = useServerFn(ensureDueMessengerCheckins);
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void persistTz({ data: { timeZone: tz } }).catch(() => {});
    } catch {}
  }, [persistTz]);

  // Bootstrap query — collapses the dashboard startup waterfall.
  // Previously each dependent query (training_phases, client_goals_setup, etc.)
  // waited on the client row in series. This single query fetches the client,
  // then runs the two heaviest dependents in parallel and primes the React
  // Query cache under their existing keys so the per-section useQuery hooks
  // render from cache immediately on first paint.
  useQuery({
    queryKey: ["portal-bootstrap", portalUserId],
    enabled: !!portalUserId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: clientRow } = await supabase
        .from("clients").select("*").eq("user_id", portalUserId!).maybeSingle();
      qc.setQueryData(["my-client", portalUserId], clientRow ?? null);
      if (!clientRow?.id) return { client: null, phases: [] as TrainingPhase[], goalsSetup: null as ClientGoalsSetupRow | null };
      const [phasesRes, goalsRes] = await Promise.all([
        supabase
          .from("training_phases").select("*").eq("client_id", clientRow.id)
          .order("start_date", { ascending: false }),
        (supabase as any)
          .from("client_goals_setup").select("*").eq("client_id", clientRow.id).maybeSingle(),
      ]);
      const phases = (phasesRes.data ?? []) as TrainingPhase[];
      const goalsSetup = (goalsRes.data ?? null) as ClientGoalsSetupRow | null;
      qc.setQueryData(["my-phases", clientRow.id], phases);
      qc.setQueryData(["client-goals-setup", clientRow.id], goalsSetup);
      return { client: clientRow, phases, goalsSetup };
    },
  });

  const { data: client, isPending: clientPending, isSuccess: clientSettled } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });
  useEffect(() => { if (client) logPerf("card:client loaded"); }, [client]);

  useEffect(() => {
    if (!client?.id) return;
    // Seed the recurring task first, then turn any due Weekly Check-In /
    // Nutrition Review into a Messenger reminder. No Home-page form card.
    void bootstrapOcc({ data: { clientId: client.id } })
      .then(() => ensureMessengerCheckins({ data: { clientId: client.id } }))
      .then((res) => {
        if (res?.created) {
          qc.invalidateQueries({ queryKey: ["portal-coach-updates", client.id] });
          qc.invalidateQueries({ queryKey: ["messages", client.id, "client"] });
        }
      })
      .catch(() => {});
  }, [client?.id, bootstrapOcc, ensureMessengerCheckins, qc]);

  const { data: phases = [] } = useQuery({
    queryKey: ["my-phases", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("training_phases").select("*").eq("client_id", client!.id)
        .order("start_date", { ascending: false });
      return (data ?? []) as TrainingPhase[];
    },
  });

  const { data: goalsSetup } = useQuery({
    queryKey: ["client-goals-setup", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("client_goals_setup")
        .select("*")
        .eq("client_id", client!.id)
        .maybeSingle();
      return data as ClientGoalsSetupRow | null;
    },
  });

  const [goalsSetupPromptOpen, setGoalsSetupPromptOpen] = useState(false);
  const [goalsSetupPromptDismissed, setGoalsSetupPromptDismissed] = useState(false);

  // Prompt incomplete clients once per app load. Closing only dismisses this
  // session; it never marks Goals & Setup complete, so it returns next load/login.
  useEffect(() => {
    if (!client?.id || goalsSetup === undefined || goalsSetupPromptDismissed) return;
    if (!isGoalsSetupComplete(goalsSetup ?? null)) setGoalsSetupPromptOpen(true);
  }, [client?.id, goalsSetup, goalsSetupPromptDismissed]);

  // Coach response surfaces — power "Today / This Week" cards so clients see
  // when their coach has replied to anything (messages, lift reviews, check-ins).
  const { data: coachUpdates } = useQuery({
    queryKey: ["portal-coach-updates", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const [{ data: msgs }, { data: state }, { data: vids }, { data: vcomments }] = await Promise.all([
        (supabase.from("messages") as any)
          .select("body, attachments, created_at, sender_role, is_internal_note")
          .eq("client_id", client!.id)
          .eq("sender_role", "admin")
          .eq("is_internal_note", false)
          .order("created_at", { ascending: false })
          .limit(10),
        (supabase.from("conversation_state") as any)
          .select("client_last_read_at").eq("client_id", client!.id).maybeSingle(),
        (supabase.from("lift_videos") as any)
          .select("id, exercise, watched_at, liked_at, reviewed_at, status, client_last_viewed_at, updated_at")
          .eq("client_id", client!.id)
          .eq("archived", false)
          .order("updated_at", { ascending: false })
          .limit(20),
        (supabase.from("lift_video_comments") as any)
          .select("video_id, body, created_at, author_role, is_internal_note")
          .eq("client_id", client!.id)
          .eq("author_role", "admin")
          .eq("is_internal_note", false)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const lastRead = (state as any)?.client_last_read_at;
      const unreadMsgs = (msgs ?? []).filter((m: any) => !lastRead || new Date(m.created_at).getTime() > new Date(lastRead).getTime());
      const vidMap = new Map<string, any>();
      for (const v of (vids ?? []) as any[]) vidMap.set(v.id, v);
      const liftPings: { videoId: string; exercise: string; preview: string; at: string }[] = [];
      for (const c of (vcomments ?? []) as any[]) {
        const v = vidMap.get(c.video_id);
        const seen = v?.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
        if (new Date(c.created_at).getTime() <= seen) continue;
        liftPings.push({ videoId: c.video_id, exercise: v?.exercise || "Lift video", preview: c.body || "New coach reply", at: c.created_at });
      }
      for (const v of (vids ?? []) as any[]) {
        const seen = v.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
        const ev = v.reviewed_at && new Date(v.reviewed_at).getTime() > seen
          ? { verb: "reviewed", at: v.reviewed_at }
          : v.status === "Needs Follow-Up" && (!v.client_last_viewed_at || new Date(v.updated_at).getTime() > seen)
          ? { verb: "requested a follow-up on", at: v.updated_at }
          : null;
        if (ev) liftPings.push({ videoId: v.id, exercise: v.exercise || "Lift video", preview: `Coach Jared ${ev.verb} your video.`, at: ev.at });
      }
      // newest first, one per video
      liftPings.sort((a, b) => +new Date(b.at) - +new Date(a.at));
      const seenIds = new Set<string>();
      const liftDeduped = liftPings.filter((p) => (seenIds.has(p.videoId) ? false : (seenIds.add(p.videoId), true)));
      return {
        unreadMessages: unreadMsgs as any[],
        liftPings: liftDeduped,
      };
    },
  });
  useEffect(() => { if (coachUpdates) logPerf("card:coach-updates loaded"); }, [coachUpdates]);

  const activePhase = phases.find((p) => {
    const s = derivePhase(p).state;
    return s === "active" || s === "ending-soon" || s === "due-today";
  }) ?? phases.find((p) => derivePhase(p).state === "upcoming") ?? null;

  // Compact upcoming appointment (single, only if within ~14 days).
  const fetchPortalAppointments = usePovFn(useServerFn(listMyPortalAppointments));
  const povKey = usePovArgs().viewAsClientId ?? null;
  const { data: appts = [] } = useQuery({
    queryKey: ["portal-next-appointment", povKey],
    queryFn: async () => {
      const res: any = await fetchPortalAppointments();
      return (res?.upcoming ?? []) as any[];
    },
  });
  useEffect(() => { if (appts) logPerf("card:appointments loaded"); }, [appts]);
  const nextAppointment: any = (appts as any[])[0] ?? null;

  // Only derive the name from the loaded client record. Falling back to the
  // email username mid-load caused a visible "jaredm…" → "Jared" flash.
  const firstName = (client?.full_name ?? "").split(" ")[0];
  void user;

  const unreadMsgs = coachUpdates?.unreadMessages ?? [];

  // We render the shell + per-section skeletons immediately so the dashboard
  // never blocks waiting on one query. Each section is wrapped in a local
  // error boundary so a single failure can't take the whole dashboard down.
  const clientLoading = clientPending || (!!portalUserId && !clientSettled && !client);

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  return (
    <>
      {/* Background gates / popups — keep wired exactly as before. */}
      {client?.id && <ClientActionRequestModal clientId={client.id} />}
      {client?.id && (
        <Dialog
          open={goalsSetupPromptOpen && !isGoalsSetupComplete(goalsSetup ?? null)}
          onOpenChange={(open) => {
            setGoalsSetupPromptOpen(open);
            if (!open && !isGoalsSetupComplete(goalsSetup ?? null)) setGoalsSetupPromptDismissed(true);
          }}
        >
          <DialogContent className="max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-3xl overflow-y-auto rounded-2xl p-4 sm:p-6">
            <DialogHeader className="text-left">
              <div className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
                <Target className="h-5 w-5" />
              </div>
              <DialogTitle>Finish your Goals & Setup</DialogTitle>
              <DialogDescription>
                Complete the remaining coaching details so your program, nutrition and recommendations can be tailored to you. You can close this for now, but it will remind you again next time you load the app until setup is complete.
              </DialogDescription>
            </DialogHeader>
            <GoalsSetupFlow clientId={client.id} />
          </DialogContent>
        </Dialog>
      )}
      {client?.id && portalUserId && <MissingBodyweightPrompt userId={portalUserId} />}
      {client?.id && (
        <HomeScreenSetupCard
          clientId={client.id}
          status={(client as any).home_screen_setup_status}
          remindAfter={(client as any).home_screen_setup_remind_after}
        />
      )}

      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-safe-bottom pt-4 md:max-w-5xl md:px-8 md:pt-6 animate-fade-in">
        {/* 1 — Compact greeting header (renders immediately) */}
        <GreetingHeader
          firstName={firstName}
          avatarUrl={(client as any)?.profile_picture_url ?? null}
          unreadCount={unreadMsgs.length}
        />
      <div className="-mt-2 flex justify-end">
        <DashboardRefreshIndicator />
      </div>

      {/* 2 — Profile-missing fallback (workouts moved off the dashboard
            for perf — clients reach training via Quick Actions / nav). */}
        {clientSettled && !client ? <NoProfileCard /> : null}

        {/* 2a — Mandatory Coaching Agreement. Shown on every visit until signed;
            hides itself once signed (and in coach "View as client"). */}
        <SectionErrorBoundary label="Coaching agreement">
          <AgreementDashboardCard />
        </SectionErrorBoundary>

        {/* 2b — Non-blocking onboarding checklist (replaces the old hard-lock
            gates for profile picture / basic info / training schedule / goals). */}
        {client?.id && portalUserId && (
          <SectionErrorBoundary label="Setup checklist">
            <SetupChecklistBanner clientId={client.id} userId={portalUserId ?? ""} />
          </SectionErrorBoundary>
        )}

        {/* 2c — One-tap profile question for athletes who haven't answered
            (the athlete only, never in coach "View as client"). */}
        {client?.id && (
          <SectionErrorBoundary label="Sex prompt">
            <SexPromptCard enabled={role === "client"} />
          </SectionErrorBoundary>
        )}

        {/* 1b — Compact Today / Upcoming schedule (full calendar one tap away) */}
        {client?.id && (
          <SectionErrorBoundary label="Upcoming schedule">
            <UpcomingScheduleCard clientId={client.id} />
          </SectionErrorBoundary>
        )}

        {/* The crew's week: a shelf of posts, "+ Share" first. */}
        {client?.id && (
          <SectionErrorBoundary label="Community">
            <CommunityHomeStrip />
          </SectionErrorBoundary>
        )}

        {/* Body: the daily weigh-in first (most clients log it), then water and
            progress, one swipe apart. The standings live on the League tab. */}
        {client?.id && portalUserId ? (
          <DeferRender placeholderHeight="h-52">
            <SwipeCards
              storageKey="jf-home-body"
              cards={[
                {
                  key: "bodyweight",
                  label: "Bodyweight",
                  node: (
                    <SectionErrorBoundary label="Bodyweight">
                      <BodyweightSummaryCard
                        clientId={client.id}
                        userId={portalUserId}
                        defaultUnit={((client as any)?.preferred_weight_unit as WeightUnit) ?? "lb"}
                      />
                    </SectionErrorBoundary>
                  ),
                },
                {
                  key: "water",
                  label: "Water",
                  node: (
                    <SectionErrorBoundary label="Water">
                      <HomeWaterCard userId={portalUserId} currentUserId={portalUserId} surface="portal" />
                    </SectionErrorBoundary>
                  ),
                },
                {
                  key: "progress",
                  label: "Progress",
                  node: (
                    <SectionErrorBoundary label="Progress">
                      <ProgressSummaryCard
                        userId={portalUserId}
                        currentUserId={portalUserId}
                        viewerRole="owner"
                        progressHref={{ kind: "portal" }}
                        liftHref="/portal/lift-videos"
                      />
                    </SectionErrorBoundary>
                  ),
                },
              ]}
            />
          </DeferRender>
        ) : clientLoading ? (
          <SectionSkeleton height="h-52" />
        ) : null}

        {/* New-milestone reveals pop here, on the way in */}
        {client?.id && <LevelCelebrations clientId={client.id} />}

        {/* Current Training Block */}
        {activePhase && (
          <SectionErrorBoundary label="Training block">
            <TrainingBlockCard phase={activePhase} />
          </SectionErrorBoundary>
        )}

        {client?.id && (
          <SectionErrorBoundary label="Devices">
            <WearablesCard mode="summary" />
          </SectionErrorBoundary>
        )}

        {/* 7 — Upcoming appointment (compact, only if exists) */}
        {nextAppointment && <UpcomingAppointmentRow appt={nextAppointment} />}

        {/* 7b — Sessions package summary (only if active package) */}
        {client?.id && (
          <SectionErrorBoundary label="Sessions">
            <SessionsCard clientId={client.id} nextAppointmentAt={nextAppointment?.starts_at ?? null} />
          </SectionErrorBoundary>
        )}

        {/* 8 — Events panel (only renders when there's something) */}
        <DeferRender placeholderHeight="h-24">
          <SectionErrorBoundary label="Events">
            <UpcomingEventsPanel audience="client" />
          </SectionErrorBoundary>
        </DeferRender>

        {/* Setup — install app + notifications, grouped together */}
        {client && (
          <SectionGroup title="Setup" subtitle="Get the most out of JF Effect">
            <InstallAppCard />
            <NotificationSetupPrompt />
            <CalendarSyncCard />
          </SectionGroup>
        )}

        {/* Billing, agreements and account live in the top menu (☰) and the avatar menu. */}
      </div>
    </>
  );
}

function SectionSkeleton({ height = "h-32" }: { height?: string }) {
  return <div className={`rounded-2xl border border-border bg-card animate-pulse ${height}`} />;
}

function GreetingHeader({
  firstName, avatarUrl, unreadCount,
}: { firstName: string; avatarUrl: string | null; unreadCount: number }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  void now;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <Avatar className="h-11 w-11 shrink-0 border border-border">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={firstName} />}
        <AvatarFallback className="text-sm font-bold">
          {(firstName?.[0] ?? "?").toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-black tracking-tight md:text-2xl">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="truncate text-xs text-muted-foreground">Here's what to focus on today.</p>
      </div>
      <div className="flex items-center gap-2">
      <Link
        to="/portal/announcements"
        aria-label="Notifications"
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card transition hover:border-primary/40"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>
      </div>
    </div>
  );
}

function NoProfileCard() {
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <p className="text-sm">
        Your coach hasn't set up your client profile yet. Once they do, you'll see your program, check-ins, and resources here.
      </p>
    </div>
  );
}

function UpcomingAppointmentRow({ appt }: { appt: any }) {
  const start: Date | null = appt?.starts_at ? new Date(appt.starts_at) : null;
  if (!start) return null;
  const when = isToday(start) ? `Today · ${format(start, "h:mma")}`
    : isTomorrow(start) ? `Tomorrow · ${format(start, "h:mma")}`
    : format(start, "EEE, MMM d · h:mma");
  return (
    <Link to="/portal/calendar" className="block">
      <div className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition active:bg-secondary/30">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-secondary/40">
          <CalendarIcon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{appt.title || appt.appointment_type || "Upcoming appointment"}</div>
          <div className="truncate text-xs text-muted-foreground">{when}</div>
        </div>
      </div>
    </Link>
  );
}

function SectionGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="px-1">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">{subtitle}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

