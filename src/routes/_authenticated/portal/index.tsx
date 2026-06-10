import React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, CheckCircle2, ShieldAlert, MessageCircle, Mail, CheckCheck, CreditCard, AlertTriangle, Receipt, Dumbbell, Settings, ChevronRight } from "lucide-react";
import { createCustomerPortalSession } from "@/lib/stripe-checkout.functions";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { derivePhase, displayTitle, toneClasses as phaseToneClasses, type TrainingPhase } from "@/lib/training-phases";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { PowerlifterBadge } from "@/components/powerlifter-badge";
import { ExternalLink } from "lucide-react";
import { SocialIcons } from "@/components/social-icons";
import { LogBodyweightCard } from "@/components/log-bodyweight-card";
import type { WeightUnit } from "@/lib/progress-metrics";
import { HomeScreenSetupCard } from "@/components/home-screen-setup-card";
import { listFormsForClient } from "@/lib/native-forms";
import { ManualCheckInReviewModal } from "@/components/manual-check-in-review-modal";
import { ClientActionRequestModal } from "@/components/client-action-request-modal";

export const Route = createFileRoute("/_authenticated/portal/")({ component: PortalHome });

function PortalHome() {
  const { user } = useAuth();
  const portalUserId = usePortalUserId();

  const { data: client } = useQuery({
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

  const markAgreementComplete = async (id: string) => {
    const { error } = await supabase
      .from("agreements")
      .update({ client_marked_complete_at: new Date().toISOString(), client_marked_complete_by: user?.id ?? null } as any)
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Thanks — Coach Jared will verify it.");
    qc.invalidateQueries({ queryKey: ["portal-outstanding-agreements", client?.id] });
  };

  const firstName = (client?.full_name ?? user?.email?.split("@")[0] ?? "").split(" ")[0];

  // Primary billing record — most recent non-cancelled
  const primaryPurchase = (purchases as any[]).find(
    (p) => !["Cancelled", "Expired", "Refunded"].includes(p.payment_status),
  ) ?? (purchases as any[])[0];

  const billingNeedsAction = !!primaryPurchase && ["Pending Payment", "Pending", "Overdue", "Failed", "Manual Payment Needed"].includes(primaryPurchase.payment_status);
  const billingCancelled = !!primaryPurchase && ["Cancelled", "Expired"].includes(primaryPurchase.payment_status);

  type UpdateCard = {
    key: string;
    icon: any;
    tone: "warning" | "primary" | "success";
    title: string;
    message: string;
    primary?: { label: string; onClick?: () => void; to?: string };
    secondary?: { label: string; to: string };
    status?: string;
  };
  const toneClasses: Record<UpdateCard["tone"], string> = {
    warning: "border-warning/40 bg-warning/5",
    primary: "border-primary/30 bg-primary/5",
    success: "border-emerald-500/30 bg-emerald-500/5",
  };
  const iconToneClasses: Record<UpdateCard["tone"], string> = {
    warning: "text-warning",
    primary: "text-primary",
    success: "text-emerald-500",
  };

  const updates: UpdateCard[] = [];
  if (billingNeedsAction) {
    updates.push({
      key: `billing-${primaryPurchase.id}`,
      icon: AlertTriangle,
      tone: "warning",
      title: "Payment needed",
      message: "Payment needed to keep your coaching active.",
      primary: primaryPurchase.stripe_payment_link
        ? { label: "Complete Payment", onClick: () => window.open(primaryPurchase.stripe_payment_link, "_blank", "noopener,noreferrer") }
        : { label: "Message Coach", to: "/portal/messages" },
      secondary: primaryPurchase.stripe_payment_link ? { label: "Message Coach", to: "/portal/messages" } : undefined,
    });
  }
  if (client?.info_update_requested) {
    updates.push({
      key: "info-update",
      icon: ShieldAlert,
      tone: "warning",
      title: "Update Account Info",
      message: "Confirm your contact details are current.",
      primary: { label: "Update", to: "/portal/account" },
    });
  }
  for (const a of outstandingAgreements as any[]) {
    if (a.client_marked_complete_at) {
      updates.push({
        key: `agreement-${a.id}`,
        icon: CheckCheck,
        tone: "success",
        title: "Agreement marked complete",
        message: "Coach Jared will verify it.",
        secondary: { label: "View", to: "/portal/agreements" },
        status: "Awaiting verification",
      });
    } else {
      const hasLink = !!a.signnow_signing_link;
      updates.push({
        key: `agreement-${a.id}`,
        icon: Mail,
        tone: "warning",
        title: "Agreement needs signature",
        message: hasLink
          ? "Check your Gmail for a SignNow document from Coach Jared / JF Effect."
          : "Please check your Gmail for the SignNow agreement or message Coach Jared if you cannot find it.",
        primary: hasLink
          ? { label: "Open Agreement", onClick: () => window.open(a.signnow_signing_link, "_blank", "noopener,noreferrer") }
          : { label: "I completed it", onClick: () => markAgreementComplete(a.id) },
        secondary: { label: "Open Agreements", to: "/portal/agreements" },
      });
    }
  }

  return (
    <>
      <PageHeader
        title={
          <>
            <span>{`Welcome${firstName ? `, ${firstName}` : ""}`}</span>
            {client?.is_powerlifter && client?.powerlifting_visible_to_client && (
              <PowerlifterBadge label={client.powerlifter_badge_label} size="sm" />
            )}
            <SocialIcons client={client} size="sm" />
          </>
        }
        subtitle="Your private coaching dashboard."
      />
      <div className="space-y-6 p-6 md:p-8">
        {client?.id && <ManualCheckInReviewModal clientId={client.id} />}
        {client?.id && <ClientActionRequestModal clientId={client.id} />}
        {client?.id && (
          <HomeScreenSetupCard
            clientId={client.id}
            status={(client as any).home_screen_setup_status}
            remindAfter={(client as any).home_screen_setup_remind_after}
          />
        )}
        {/* Today / This Week — alerts and action items */}
        <section aria-label="Today / This Week">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Today / This Week</h3>
            <span className="text-[10px] text-muted-foreground">{updates.length}</span>
          </div>
          {updates.length > 0 ? (
            <div className="-mx-6 md:-mx-8 px-6 md:px-8 overflow-x-auto snap-x snap-mandatory scrollbar-none">
              <div className="flex gap-3 pb-2">
                {updates.map((u) => (
                  <Card
                    key={u.key}
                    className={`w-[260px] shrink-0 snap-start p-4 ${toneClasses[u.tone]}`}
                  >
                    <div className="flex items-start gap-2">
                      <u.icon className={`h-5 w-5 mt-0.5 ${iconToneClasses[u.tone]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold truncate">{u.title}</div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{u.message}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {u.primary && (
                        u.primary.to ? (
                          <Link to={u.primary.to} className="flex-1">
                            <Button size="sm" className="w-full bg-gradient-primary uppercase font-bold text-xs">{u.primary.label}</Button>
                          </Link>
                        ) : (
                          <Button size="sm" onClick={u.primary.onClick} className="flex-1 bg-gradient-primary uppercase font-bold text-xs">{u.primary.label}</Button>
                        )
                      )}
                      {u.secondary && (
                        <Link to={u.secondary.to} className={u.primary ? "" : "flex-1"}>
                          <Button size="sm" variant="outline" className={`text-xs ${u.primary ? "" : "w-full"}`}>{u.secondary.label}</Button>
                        </Link>
                      )}
                    </div>
                    {u.status && (
                      <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{u.status}</div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <Card className="border-border/60 bg-card/60 p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-semibold text-foreground">No updates right now</div>
                  <p className="text-xs text-muted-foreground mt-0.5">You're all caught up.</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1.5">New check-ins, agreements, coach feedback, billing reminders, and updates will show here.</p>
                </div>
              </div>
            </Card>
          )}
        </section>

        {activePhase && (() => {
          const d = derivePhase(activePhase);
          return (
            <Card className="border-border bg-card p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <Dumbbell className="h-4 w-4" /> Current Training Phase
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{displayTitle(activePhase)}</span>
                <Badge variant="outline" className={phaseToneClasses(d.tone)}>{d.label}</Badge>
                <Badge variant="outline" className="text-[10px]">{activePhase.phase_type}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {format(parseISO(activePhase.start_date), "MMM d, yyyy")} → {format(parseISO(activePhase.end_date), "MMM d, yyyy")}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                <PhaseItem label="Week" value={`${d.currentWeek} / ${d.totalWeeks}`} />
                <PhaseItem label="Days remaining" value={d.daysRemaining < 0 ? `${Math.abs(d.daysRemaining)}d over` : `${d.daysRemaining}d`} />
                <PhaseItem label="Weeks left" value={String(d.weeksRemaining)} />
                <PhaseItem label="Progress" value={`${d.percentComplete}%`} />
              </div>
              <Progress value={d.percentComplete} className="mt-3 h-2" />
              {activePhase.training_goal && (
                <p className="mt-4 text-sm"><span className="text-muted-foreground">Goal: </span>{activePhase.training_goal}</p>
              )}
              {activePhase.notes && (
                <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">{activePhase.notes}</div>
              )}
            </Card>
          );
        })()}

        {client?.powerlifting_visible_to_client && (client.is_powerlifter || client.openpowerlifting_url) && (
          <Card className="border-border bg-card p-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Powerlifting Athlete</h3>
              {client.is_powerlifter && <PowerlifterBadge label={client.powerlifter_badge_label} size="xs" />}
            </div>
            {client.openpowerlifting_url ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(client.openpowerlifting_url ?? "", "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open my OpenPowerlifting profile
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">No OpenPowerlifting link yet. Message Coach Jared to add one.</p>
            )}
          </Card>
        )}

        {!client && (
          <Card className="border-primary/30 bg-primary/5 p-6">
            <p className="text-sm">Your coach hasn't set up your client profile yet. Once they do, you'll see your program, check-in form and resources here.</p>
          </Card>
        )}

        {client && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-primary/30 bg-primary/5 p-6 space-y-4 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Check-Ins & Forms</h2>
                </div>
                <Link to="/portal/check-ins">
                  <Button size="sm" variant="outline">View All</Button>
                </Link>
              </div>
              {assignedForms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No check-ins assigned yet.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {assignedForms.slice(0, 4).map((form) => (
                    <Link key={form.id} to="/portal/check-ins/$formId" params={{ formId: form.id }}>
                      <div className="flex min-h-[54px] items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition hover:border-primary">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{form.title}</div>
                          <div className="text-[11px] text-muted-foreground">{form.kind === "external" ? "External form" : "Native form"}</div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Bodyweight quick entry */}
            <LogBodyweightCard clientId={client.id} defaultUnit={(client.preferred_weight_unit as WeightUnit) ?? "lb"} />

            {/* Your Coaching */}
            <Card className="border-border bg-card p-6 space-y-2">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Your Coaching</h3>
              <CoachingRow label="Type" value={client.coaching_type} />
              <CoachingRow label="Package" value={client.coaching_package} />
              <CoachingRow label="Phase" value={client.program_phase} />
              <CoachingRow label="Renewal" value={client.renewal_date} />
              {!client.program_sheet_link && (
                <div className="text-[11px] text-muted-foreground/80 pt-1">Program not added yet.</div>
              )}
              {assignedForms.length === 0 && (
                <div className="text-[11px] text-muted-foreground/80">No check-ins assigned yet.</div>
              )}
            </Card>

            {/* Billing & Subscription */}
            <BillingCard purchase={primaryPurchase} cancelled={billingCancelled} needsAction={billingNeedsAction} />
          </div>
        )}
      </div>
    </>
  );
}

function CoachingRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="text-sm flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value ?? "—"}</span>
    </div>
  );
}

function PhaseItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}


function BillingCard({ purchase, cancelled, needsAction }: { purchase: any; cancelled: boolean; needsAction: boolean }) {
  const portalFn = useServerFn(createCustomerPortalSession);
  const [portalLoading, setPortalLoading] = React.useState(false);
  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { url } = await portalFn({ data: { origin: window.location.origin } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };
  if (!purchase) {
    return (
      <Card className="border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Billing & Subscription</h3>
        </div>
        <p className="text-sm text-muted-foreground">Billing details have not been added yet.</p>
        <p className="text-xs text-muted-foreground/80">Need to adjust your billing or package? Message Coach Jared.</p>
        <Link to="/portal/messages">
          <Button size="sm" variant="outline" className="w-full"><MessageCircle className="h-4 w-4" /> Message Coach</Button>
        </Link>
      </Card>
    );
  }

  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString() : "—";
  const amount = purchase.installment_amount ?? purchase.full_payable_amount ?? purchase.amount_due_today;
  const cur = purchase.currency ?? "USD";
  const tone = needsAction ? "border-warning/40 bg-warning/5" : cancelled ? "border-destructive/40 bg-destructive/5" : "border-border bg-card";

  return (
    <Card className={`${tone} p-6 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Billing & Subscription</h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider rounded-full border border-border px-2 py-0.5">
          {purchase.payment_status}
        </span>
      </div>
      <div className="text-sm font-bold">{purchase.offer_name}</div>
      <div className="space-y-1 text-sm">
        {purchase.payment_structure && <CoachingRow label="Billing" value={purchase.payment_frequency ?? purchase.payment_structure} />}
        {amount != null && <CoachingRow label="Amount" value={`${amount} ${cur}`} />}
        {purchase.is_recurring && <CoachingRow label="Next billing" value={fmtDate(purchase.term_end_date)} />}
        <CoachingRow label="Service start" value={fmtDate(purchase.term_start_date)} />
        {purchase.term_end_date && <CoachingRow label="Service end" value={fmtDate(purchase.term_end_date)} />}
      </div>

      {needsAction && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {purchase.payment_status === "Failed" || purchase.payment_status === "Overdue"
            ? "Payment issue. Message Coach Jared or update payment if a link is available."
            : "Payment needed to keep your coaching active."}
        </div>
      )}
      {cancelled && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          Your service is {purchase.payment_status.toLowerCase()}. Message Coach Jared to reactivate.
        </div>
      )}

      <p className="text-xs text-muted-foreground/80">Need to adjust your billing or package? Use Manage Billing or message Coach Jared.</p>
      <div className="flex flex-wrap gap-2">
        {needsAction && purchase.stripe_payment_link && (
          <Button size="sm" className="bg-gradient-primary uppercase font-bold text-xs" onClick={() => window.open(purchase.stripe_payment_link, "_blank", "noopener,noreferrer")}>
            Complete Payment
          </Button>
        )}
        {purchase.stripe_customer_id && (
          <Button size="sm" variant="outline" className="text-xs" onClick={openPortal} disabled={portalLoading}>
            <Settings className="h-3.5 w-3.5 mr-1" />{portalLoading ? "Opening..." : "Manage Billing"}
          </Button>
        )}
        <Link to="/portal/messages" className="flex-1 min-w-[140px]">
          <Button size="sm" variant="outline" className="w-full text-xs"><MessageCircle className="h-4 w-4" /> Message Coach</Button>
        </Link>
        <Link to="/portal/purchases" className="flex-1 min-w-[140px]">
          <Button size="sm" variant="outline" className="w-full text-xs"><Receipt className="h-4 w-4" /> Purchase History</Button>
        </Link>
      </div>
    </Card>
  );
}