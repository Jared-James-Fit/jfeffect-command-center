import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bell, ClipboardCheck, ShieldAlert, MessageCircle, Mail, CheckCheck, AlertTriangle, Dumbbell, Settings, Receipt, FileSignature, Calendar as CalendarIcon, Target } from "lucide-react";
import { isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";
import type { TrainingPhase } from "@/lib/training-phases";
import { derivePhase } from "@/lib/training-phases";
import { toast } from "sonner";
import type { WeightUnit } from "@/lib/progress-metrics";
import { HomeScreenSetupCard } from "@/components/home-screen-setup-card";
import { listFormsForClient, pickWeeklyCheckInForm } from "@/lib/native-forms";
import { ManualCheckInReviewModal } from "@/components/manual-check-in-review-modal";
import { ClientActionRequestModal } from "@/components/client-action-request-modal";
import { UpcomingEventsPanel } from "@/components/events/upcoming-events-panel";
import { SmartTodayCard } from "@/components/smart-today-card";
import { getClientWorkouts } from "@/lib/pl-programs";
import { QuickActionsGrid } from "@/components/portal/quick-actions-grid";
import { ActionCentre, type ActionItem } from "@/components/portal/action-centre";
import { TrainingBlockCard } from "@/components/portal/training-block-card";
import { BodyweightSummaryCard } from "@/components/portal/bodyweight-summary-card";
import { useEffect, useRef, useState } from "react";
import { listMyPortalAppointments } from "@/lib/appointments.functions";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO, isToday, isTomorrow } from "date-fns";
import { forwardRef, useImperativeHandle } from "react";

export const Route = createFileRoute("/_authenticated/portal/")({ component: PortalHome });

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function PortalHome() {
  const { user } = useAuth();
  const portalUserId = usePortalUserId();

  const { data: client, isPending: clientPending, isSuccess: clientSettled } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  const { data: assignedForms = [] } = useQuery({
    queryKey: ["nf-forms-for-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listFormsForClient(client!.id),
  });

  const { data: outstandingAgreements = [] } = useQuery({
    queryKey: ["portal-outstanding-agreements", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await (supabase
        .from("agreements") as any)
        .select("id, template_name, status, signnow_signing_link, sent_at, client_marked_complete_at")
        .eq("client_id", client!.id)
        .in("status", ["Sent", "Opened", "Waiting on Client", "Needs Resend", "Manual Action Needed"])
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["portal-purchases", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("*")
        .eq("client_id", client!.id)
        .order("purchased_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

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

  // Coach response surfaces — power "Today / This Week" cards so clients see
  // when their coach has replied to anything (messages, lift reviews, check-ins).
  const { data: coachUpdates } = useQuery({
    queryKey: ["portal-coach-updates", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const [{ data: msgs }, { data: state }, { data: vids }, { data: vcomments }, { data: reviews }] = await Promise.all([
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
          .order("updated_at", { ascending: false })
          .limit(20),
        (supabase.from("lift_video_comments") as any)
          .select("video_id, body, created_at, author_role, is_internal_note")
          .eq("client_id", client!.id)
          .eq("author_role", "admin")
          .eq("is_internal_note", false)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase.from("manual_check_in_reviews") as any)
          .select("id, title, message, created_at, read_at, dismissed_at, notify_client")
          .eq("client_id", client!.id)
          .eq("notify_client", true)
          .is("read_at", null)
          .is("dismissed_at", null)
          .order("created_at", { ascending: false })
          .limit(10),
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
        checkInReviews: (reviews ?? []) as any[],
      };
    },
  });

  const activePhase = phases.find((p) => {
    const s = derivePhase(p).state;
    return s === "active" || s === "ending-soon" || s === "due-today";
  }) ?? phases.find((p) => derivePhase(p).state === "upcoming") ?? null;

  const qc = useQueryClient();

  // Workout items power the "Today's primary action" card via SmartTodayCard.
  const { data: workoutItems = [] } = useQuery({
    queryKey: ["my-workouts", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const items = await getClientWorkouts(client!.id);
      return (items as any[]).filter((it) => it.day?.id);
    },
  });

  // Compact upcoming appointment (single, only if within ~14 days).
  const fetchPortalAppointments = useServerFn(listMyPortalAppointments);
  const { data: appts = [] } = useQuery({
    queryKey: ["portal-next-appointment"],
    queryFn: async () => {
      const res: any = await fetchPortalAppointments();
      return (res?.upcoming ?? []) as any[];
    },
  });
  const nextAppointment: any = (appts as any[])[0] ?? null;

  const markAgreementComplete = async (id: string) => {
    const { error } = await supabase
      .from("agreements")
      .update({ client_marked_complete_at: new Date().toISOString(), client_marked_complete_by: user?.id ?? null } as any)
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Thanks — Coach Jared will verify it.");
    qc.invalidateQueries({ queryKey: ["portal-outstanding-agreements", client?.id] });
  };

  // Only derive the name from the loaded client record. Falling back to the
  // email username mid-load caused a visible "jaredm…" → "Jared" flash.
  const firstName = (client?.full_name ?? "").split(" ")[0];
  void user;

  const primaryPurchase = (purchases as any[]).find(
    (p) => !["Cancelled", "Expired", "Refunded"].includes(p.payment_status),
  ) ?? (purchases as any[])[0];

  const billingNeedsAction = !!primaryPurchase && ["Pending Payment", "Pending", "Overdue", "Failed", "Manual Payment Needed"].includes(primaryPurchase.payment_status);

  // Build Action Centre items from existing data only.
  const actions: ActionItem[] = [];
  if (goalsSetup?.update_requested_at) {
    actions.push({
      key: "goals-update-requested",
      icon: Target,
      tone: "primary",
      title: "Update your Goals & Setup",
      message: goalsSetup.update_request_message || "Your coach asked you to review your answers.",
      to: "/portal/goals-setup",
      chip: "Action",
    });
  } else if (!isGoalsSetupComplete(goalsSetup ?? null)) {
    actions.push({
      key: "goals-incomplete",
      icon: Target,
      tone: "warning",
      title: "Goals & Setup incomplete",
      message: "Spend ~2 minutes so your coach can build the right plan for you.",
      to: "/portal/goals-setup",
      chip: "Setup",
    });
  }
  if (billingNeedsAction) {
    actions.push({
      key: `billing-${primaryPurchase.id}`,
      icon: AlertTriangle,
      tone: "warning",
      title: "Payment needed",
      message: "Keep your coaching active.",
      chip: "Action",
      ...(primaryPurchase.stripe_payment_link
        ? { href: primaryPurchase.stripe_payment_link }
        : { to: "/portal/messages" }),
    });
  }
  if (client?.info_update_requested) {
    actions.push({
      key: "info-update",
      icon: ShieldAlert,
      tone: "warning",
      title: "Update your account info",
      message: "Confirm your contact details are current.",
      to: "/portal/account",
      chip: "Action",
    });
  }
  for (const a of outstandingAgreements as any[]) {
    if (a.client_marked_complete_at) {
      actions.push({
        key: `agreement-${a.id}`,
        icon: CheckCheck,
        tone: "success",
        title: "Agreement marked complete",
        message: "Coach Jared will verify it.",
        to: "/portal/agreements",
        chip: "Pending",
      });
    } else {
      actions.push({
        key: `agreement-${a.id}`,
        icon: Mail,
        tone: "warning",
        title: a.template_name ? `Sign: ${a.template_name}` : "Agreement needs signature",
        message: a.signnow_signing_link
          ? "Check your Gmail for the SignNow document."
          : "Open Agreements to view or mark complete.",
        chip: "Sign",
        ...(a.signnow_signing_link ? { href: a.signnow_signing_link } : { to: "/portal/agreements" }),
      });
    }
  }
  const unreadMsgs = coachUpdates?.unreadMessages ?? [];
  if (unreadMsgs.length > 0) {
    actions.push({
      key: "coach-messages",
      icon: MessageCircle,
      tone: "primary",
      title: unreadMsgs.length > 1 ? `${unreadMsgs.length} new from Coach Jared` : "New message from Coach Jared",
      message: (unreadMsgs[0]?.body || "Open your messages").toString().slice(0, 120),
      to: "/portal/messages",
      chip: "New",
    });
  }
  for (const p of (coachUpdates?.liftPings ?? []).slice(0, 5)) {
    actions.push({
      key: `lift-${p.videoId}`,
      icon: Dumbbell,
      tone: "primary",
      title: `Coach feedback on ${p.exercise}`,
      message: p.preview,
      to: "/portal/lift-videos",
      chip: "New",
    });
  }
  for (const r of coachUpdates?.checkInReviews ?? []) {
    actions.push({
      key: `review-${r.id}`,
      icon: ClipboardCheck,
      tone: "primary",
      title: r.title || "New Check-In review",
      message: r.message || "Open to read your coach's review.",
      chip: "New",
      onClick: async () => {
        await (supabase.from("manual_check_in_reviews") as any)
          .update({ read_at: new Date().toISOString() })
          .eq("id", r.id);
        qc.invalidateQueries({ queryKey: ["portal-coach-updates", client?.id] });
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      },
    });
  }
  // Surface the nearest due check-in form into Action Centre.
  const dueForm = (assignedForms ?? [])[0];
  if (dueForm) {
    actions.push({
      key: `form-${dueForm.id}`,
      icon: ClipboardCheck,
      tone: "primary",
      title: dueForm.title,
      message: dueForm.kind === "external" ? "External check-in form" : "Tap to fill in",
      to: "/portal/check-ins/$formId",
      chip: "Due",
    } as any);
  }

  // Bottom-sheet trigger for Log Bodyweight from the quick-actions grid.
  const bodyweightRef = useRef<{ open: () => void }>(null);

  // While the core client record is loading, render a steady skeleton in the
  // same layout shape as the real portal so the dashboard fades in once
  // instead of popping in piece-by-piece.
  const initialLoading = clientPending || (!!portalUserId && !clientSettled && !client);

  return (
    <>
      {/* Background gates / popups — keep wired exactly as before. */}
      {client?.id && <ManualCheckInReviewModal clientId={client.id} />}
      {client?.id && <ClientActionRequestModal clientId={client.id} />}
      {client?.id && (
        <HomeScreenSetupCard
          clientId={client.id}
          status={(client as any).home_screen_setup_status}
          remindAfter={(client as any).home_screen_setup_remind_after}
        />
      )}

      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-24 pt-4 md:max-w-5xl md:px-8 md:pt-6 animate-fade-in">
        {initialLoading ? (
          <PortalHomeSkeleton />
        ) : (
          <>
        {/* 1 — Compact greeting header */}
        <GreetingHeader
          firstName={firstName}
          avatarUrl={(client as any)?.profile_picture_url ?? null}
          unreadCount={unreadMsgs.length}
        />

        {/* 2 — Today's primary action */}
        {client && workoutItems.length > 0 ? (
          <div className="animate-fade-in">
            <SmartTodayCard items={workoutItems as any[]} clientId={client.id} />
          </div>
        ) : clientSettled && !client ? (
          <NoProfileCard />
        ) : null}

        {/* 3 — Quick Actions */}
        {client && (
          <QuickActionsGrid
            messageBadge={unreadMsgs.length}
            checkInBadge={(assignedForms as any[])?.length || undefined}
            onLogWeight={() => bodyweightRef.current?.open()}
          />
        )}

        {/* 4 — Action Centre */}
        <ActionCentre items={actions} />

        {/* 5 — Current Training Block */}
        {activePhase && <TrainingBlockCard phase={activePhase} />}

        {/* 6 — Bodyweight summary */}
        {client && (
          <BodyweightSummaryCardWithRef
            ref={bodyweightRef}
            clientId={client.id}
            defaultUnit={(client.preferred_weight_unit as WeightUnit) ?? "lb"}
          />
        )}

        {/* 7 — Upcoming appointment (compact, only if exists) */}
        {nextAppointment && <UpcomingAppointmentRow appt={nextAppointment} />}

        {/* 8 — Events panel (only renders when there's something) */}
        <UpcomingEventsPanel audience="client" />

        {/* 9 — Secondary links */}
        {client && (
          <SecondaryLinks
            handleAgreementComplete={markAgreementComplete}
          />
        )}
          </>
        )}
      </div>
    </>
  );
}

function PortalHomeSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Greeting */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <div className="h-11 w-11 shrink-0 rounded-full border border-border bg-secondary/40 animate-pulse" />
        <div className="min-w-0 space-y-2">
          <div className="h-5 w-48 rounded bg-secondary/50 animate-pulse" />
          <div className="h-3 w-32 rounded bg-secondary/30 animate-pulse" />
        </div>
        <div className="h-11 w-11 rounded-full border border-border bg-card" />
      </div>
      {/* Today's primary action */}
      <div className="h-44 rounded-2xl border border-border bg-card animate-pulse" />
      {/* Quick actions grid */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-card animate-pulse" />
        ))}
      </div>
      {/* Action Centre */}
      <div className="space-y-3">
        <div className="h-5 w-32 rounded bg-secondary/40 animate-pulse" />
        <div className="h-16 rounded-2xl border border-border bg-card animate-pulse" />
      </div>
      {/* Bodyweight */}
      <div className="h-52 rounded-2xl border border-border bg-card animate-pulse" />
    </div>
  );
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
    <Link to="/portal/appointments" className="block">
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

function SecondaryLinks({ handleAgreementComplete: _ }: { handleAgreementComplete: (id: string) => void }) {
  const items = [
    { to: "/portal/purchases", label: "Purchases", icon: Receipt },
    { to: "/portal/agreements", label: "Agreements", icon: FileSignature },
    { to: "/portal/account", label: "Account & Coaching", icon: Settings },
  ];
  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-card">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <li key={it.to} className={i > 0 ? "border-t border-border/70" : ""}>
            <Link to={it.to} className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition active:bg-secondary/30">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1 text-sm font-semibold">{it.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Imperative-handle wrapper for the bodyweight bottom sheet (so the quick
// action tile can open it).
const BodyweightSummaryCardWithRef = forwardRef<
  { open: () => void },
  { clientId: string; defaultUnit?: WeightUnit }
>(function BodyweightSummaryCardWithRef({ clientId, defaultUnit }, ref) {
  // Trigger the visible "Log Weight" button programmatically by clicking it.
  const containerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    open: () => {
      const btn = containerRef.current?.querySelector<HTMLButtonElement>(
        "button[data-log-bw-trigger]",
      ) ?? containerRef.current?.querySelector<HTMLButtonElement>("button");
      btn?.click();
    },
  }));
  return (
    <div ref={containerRef}>
      <BodyweightSummaryCard clientId={clientId} defaultUnit={defaultUnit} />
    </div>
  );
});