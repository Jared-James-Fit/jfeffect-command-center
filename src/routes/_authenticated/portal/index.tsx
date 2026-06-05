import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, CheckCircle2, ShieldAlert, MessageCircle, Video, Mail, CheckCheck, CreditCard, AlertTriangle, Receipt, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { PowerlifterBadge } from "@/components/powerlifter-badge";
import { ExternalLink } from "lucide-react";
import { SocialIcons } from "@/components/social-icons";

export const Route = createFileRoute("/_authenticated/portal/")({ component: PortalHome });

function PortalHome() {
  const { user } = useAuth();

  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
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

  const quickActions = [
    { to: "/portal/check-in", label: "Submit Check-In", icon: ClipboardCheck },
    { to: "/portal/lift-videos", label: "Send Lift Video", icon: Video },
    { to: "/portal/exercises", label: "Exercise Library", icon: Dumbbell },
    { to: "/portal/messages", label: "Message Coach", icon: MessageCircle },
  ];

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

        {!client && (
          <Card className="border-primary/30 bg-primary/5 p-6">
            <p className="text-sm">Your coach hasn't set up your client profile yet. Once they do, you'll see your program, check-in form and resources here.</p>
          </Card>
        )}

        {/* Quick Actions — compact row */}
        <section aria-label="Quick Actions">
          <h3 className="mb-2 px-1 text-xs uppercase tracking-widest text-muted-foreground">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickActions.map((a) => (
              <Link key={a.to} to={a.to}>
                <Card className="flex h-full flex-col items-center justify-center gap-1.5 border-border bg-card p-3 text-center transition hover:border-primary">
                  <a.icon className="h-4 w-4 text-primary" />
                  <div className="text-[11px] font-semibold leading-tight">{a.label}</div>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {client && (
          <div className="grid gap-4 md:grid-cols-2">
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
              {!client.checkin_form_link && (
                <div className="text-[11px] text-muted-foreground/80">Check-in link missing.</div>
              )}
            </Card>

            {/* Billing & Subscription */}
            <BillingCard purchase={primaryPurchase} cancelled={billingCancelled} needsAction={billingNeedsAction} />

            {client.powerlifting_visible_to_client && (client.is_powerlifter || client.openpowerlifting_url) && (
              <Card className="border-border bg-card p-6 space-y-3 md:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs uppercase tracking-widest text-muted-foreground">OpenPowerlifting</h3>
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

function BillingCard({ purchase, cancelled, needsAction }: { purchase: any; cancelled: boolean; needsAction: boolean }) {
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

      <p className="text-xs text-muted-foreground/80">Need to adjust your billing or package? Message Coach Jared.</p>
      <div className="flex flex-wrap gap-2">
        {needsAction && purchase.stripe_payment_link && (
          <Button size="sm" className="bg-gradient-primary uppercase font-bold text-xs" onClick={() => window.open(purchase.stripe_payment_link, "_blank", "noopener,noreferrer")}>
            Complete Payment
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