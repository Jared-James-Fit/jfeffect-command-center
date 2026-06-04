import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/purchases")({ component: MyPurchases });

function MyPurchases() {
  const { user } = useAuth();
  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => (await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle()).data,
  });
  const { data: records = [] } = useQuery({
    queryKey: ["my-purchases", client?.id],
    enabled: !!client?.id,
    queryFn: async () => (await supabase.from("purchase_records").select("*").eq("client_id", client!.id).order("purchased_at", { ascending: false })).data ?? [],
  });

  return (
    <>
      <PageHeader title="My Purchases" subtitle="Your coaching purchases and pending confirmations." />
      <div className="p-6 md:p-8">
        {records.length === 0 ? (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">No purchases yet.</Card>
        ) : (
          <div className="space-y-3">
            {records.map((r: any) => (
              <Link key={r.id} to="/portal/purchases/$id" params={{ id: r.id }}>
                <Card className="border-border bg-card p-4 hover:bg-secondary/30 transition flex items-center justify-between">
                  <div>
                    <div className="font-bold">{r.offer_name}</div>
                    <div className="text-xs text-muted-foreground">{r.offer_type} · {new Date(r.purchased_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!r.terms_accepted && <Badge className="bg-gradient-primary">Action needed</Badge>}
                    <Badge variant="outline">{r.payment_status}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}