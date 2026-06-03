import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/payments")({ component: Payments });

function Payments() {
  const { user } = useAuth();
  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle()).data,
  });

  return (
    <>
      <PageHeader title="Payments" subtitle="Manage your coaching subscription." />
      <div className="p-6 md:p-8">
        <Card className="border-border bg-card p-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Payment status</div>
              <Badge variant="outline" className="mt-2">{client?.payment_status ?? "—"}</Badge>
            </div>
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          {client?.stripe_link ? (
            <a href={client.stripe_link} target="_blank" rel="noreferrer">
              <Button size="lg" className="w-full bg-gradient-primary font-bold uppercase">
                Pay / Manage Payment <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">No payment link assigned. Contact your coach if this looks wrong.</p>
          )}
        </Card>
      </div>
    </>
  );
}