import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ClipboardCheck, Dumbbell, Calendar, ExternalLink, CheckCircle2, Circle, ShieldAlert, MessageCircle, Video, Mail, Target, Image, CheckCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portal/")({ component: PortalHome });

function PortalHome() {
  const { user } = useAuth();
  const userId = user?.id ?? "anon";
  const checklistKey = `jf-checklist-${userId}`;
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(checklistKey);
      if (raw) setChecks(JSON.parse(raw));
    } catch {}
  }, [checklistKey]);
  const toggle = (k: string) => {
    const next = { ...checks, [k]: !checks[k] };
    setChecks(next);
    try { localStorage.setItem(checklistKey, JSON.stringify(next)); } catch {}
  };

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

  const checklist = [
    { key: "program", label: "Access your program" },
    { key: "checkin", label: "Submit your intake / check-in form" },
    { key: "resources", label: "Review your resources" },
    { key: "save", label: "Save your dashboard login" },
    { key: "book", label: "Book a call if needed" },
  ];
  const completed = checklist.filter((c) => checks[c.key]).length;
  const showChecklist = completed < checklist.length;

  const actions = [
    { to: "/portal/messages", label: "Message Coach", icon: MessageCircle },
    { to: "/portal/program", label: "Workout Program", icon: FileText },
    { to: "/portal/lift-videos", label: "Send Lift Videos", icon: Video },
    { to: "/portal/check-in", label: "Weekly Check-In", icon: ClipboardCheck },
    { to: "/portal/exercises", label: "Exercise Library", icon: Dumbbell },
    { to: "/portal/nutrition-targets", label: "Nutrition Targets", icon: Target },
    { to: "/portal/media", label: "Media + Feedback", icon: Image },
  ];

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
      updates.push({
        key: `agreement-${a.id}`,
        icon: Mail,
        tone: "warning",
        title: "Agreement Sent",
        message: "Check your email to complete it.",
        primary: { label: "I completed it", onClick: () => markAgreementComplete(a.id) },
        secondary: { label: "Open Agreements", to: "/portal/agreements" },
      });
    }
  }

  return (
    <>
      <PageHeader
        title={`Welcome${firstName ? `, ${firstName}` : ""}`}
        subtitle="Your private coaching dashboard."
      />
      <div className="space-y-6 p-6 md:p-8">
        <section aria-label="Important Updates">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Important Updates</h3>
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
                  <p className="text-[11px] text-muted-foreground/70 mt-1.5">New check-ins, agreements, coach feedback, and reminders will show here.</p>
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

        {showChecklist && (
          <Card className="border-primary/30 bg-primary/5 p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-widest text-primary">Get Started</h3>
              <span className="text-xs text-muted-foreground">{completed} / {checklist.length}</span>
            </div>
            <ul className="space-y-1.5">
              {checklist.map((item) => {
                const done = !!checks[item.key];
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => toggle(item.key)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-secondary/40"
                    >
                      {done
                        ? <CheckCircle2 className="h-4 w-4 text-primary" />
                        : <Circle className="h-4 w-4 text-muted-foreground" />}
                      <span className={done ? "line-through text-muted-foreground" : ""}>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((a) => (
            <Link key={a.to} to={a.to}>
              <Card className="group h-full border-border bg-card p-5 transition hover:border-primary hover:shadow-glow">
                <a.icon className="h-6 w-6 text-primary" />
                <div className="mt-3 font-bold">{a.label}</div>
              </Card>
            </Link>
          ))}
        </div>

        {client && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-border bg-card p-6">
              <h3 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Quick Links</h3>
              <div className="space-y-2">
                {[
                  ["My Program", client.program_sheet_link],
                  ["Book a Call", client.calendar_link],
                  ["Submit Check-In", client.checkin_form_link],
                  ["Pay / Manage", client.stripe_link],
                ].filter(([, v]) => v).map(([n, v]) => (
                  <a key={n} href={v as string} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm font-semibold hover:border-primary">
                    <span>{n}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </Card>

            <Card className="border-border bg-card p-6 space-y-3">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Your Coaching</h3>
              <div className="text-sm"><span className="text-muted-foreground">Package:</span> {client.coaching_package ?? "—"}</div>
              <div className="text-sm"><span className="text-muted-foreground">Type:</span> {client.coaching_type ?? "—"}</div>
              <div className="text-sm"><span className="text-muted-foreground">Phase:</span> {client.program_phase ?? "—"}</div>
              <div className="text-sm"><span className="text-muted-foreground">Renewal:</span> {client.renewal_date ?? "—"}</div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
void Calendar; void Button;