import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, ClipboardCheck, Dumbbell, Calendar, ExternalLink, CheckCircle2, Circle, ShieldAlert, MessageCircle, Video, FileSignature, Target, Image } from "lucide-react";
import { useEffect, useState } from "react";

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
      const { data } = await supabase
        .from("agreements")
        .select("id, template_name, status, signnow_signing_link, sent_at")
        .eq("client_id", client!.id)
        .in("status", ["Sent", "Opened", "Waiting on Client", "Needs Resend", "Manual Action Needed"])
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

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

  return (
    <>
      <PageHeader
        title={`Welcome${firstName ? `, ${firstName}` : ""}`}
        subtitle="Your private coaching dashboard."
      />
      <div className="space-y-6 p-6 md:p-8">
        {client?.info_update_requested && (
          <Card className="border-warning/40 bg-warning/10 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-warning" />
                <div>
                  <div className="font-bold">Please review and update your account information.</div>
                  <div className="text-xs text-muted-foreground">Your coach asked you to confirm your contact details are current.</div>
                </div>
              </div>
              <Link to="/portal/account"><Button size="sm" className="bg-gradient-primary uppercase font-bold">Update Account Information</Button></Link>
            </div>
          </Card>
        )}
        {outstandingAgreements.length > 0 && (
          <Card className="border-warning/40 bg-warning/10 p-5">
            <div className="flex items-start gap-3">
              <FileSignature className="h-5 w-5 text-warning mt-0.5" />
              <div className="flex-1">
                <div className="font-bold">You have {outstandingAgreements.length === 1 ? "an agreement" : `${outstandingAgreements.length} agreements`} waiting for signature.</div>
                <p className="text-xs text-muted-foreground">Sign now so your coach can finalize your program and purchases.</p>
                <div className="mt-3 space-y-2">
                  {outstandingAgreements.map((a: any) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-background/40 px-3 py-2">
                      <span className="text-sm font-semibold">{a.template_name}</span>
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">{a.status}</Badge>
                      {a.signnow_signing_link
                        ? <a href={a.signnow_signing_link} target="_blank" rel="noreferrer" className="ml-auto"><Button size="sm" className="bg-gradient-primary uppercase font-bold">Sign now</Button></a>
                        : <Link to="/portal/agreements" className="ml-auto"><Button size="sm" variant="outline">View agreements</Button></Link>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}
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