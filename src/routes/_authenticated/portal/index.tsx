import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ClipboardCheck, Dumbbell, CreditCard, Calendar, ExternalLink } from "lucide-react";

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

  const firstName = (client?.full_name ?? user?.email?.split("@")[0] ?? "").split(" ")[0];

  const actions = [
    { to: "/portal/program", label: "My Program", icon: FileText },
    { to: "/portal/check-in", label: "Submit Check-In", icon: ClipboardCheck },
    { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
    { to: "/portal/payments", label: "Payments", icon: CreditCard },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome${firstName ? `, ${firstName}` : ""}`}
        subtitle="Your private coaching dashboard."
      />
      <div className="space-y-6 p-6 md:p-8">
        {!client && (
          <Card className="border-primary/30 bg-primary/5 p-6">
            <p className="text-sm">Your coach hasn't set up your client profile yet. Once they do, you'll see your program, check-in form and resources here.</p>
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