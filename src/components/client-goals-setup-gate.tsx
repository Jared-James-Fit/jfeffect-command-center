import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { Target } from "lucide-react";
import { GoalsSetupFlow } from "@/components/client-goals/GoalsSetupFlow";
import { isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";

/**
 * Blocks the client portal until the Goals & Setup section has the
 * minimum required answers filled in. Admin impersonating a client bypasses.
 */
export function ClientGoalsSetupGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ["my-client-goals-gate", user?.id],
    enabled: !!user && !isImpersonating,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: setup, isLoading: setupLoading } = useQuery({
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

  if (isImpersonating) return <>{children}</>;
  if (!user || clientLoading || !client) return <>{children}</>;
  if (setupLoading) return <>{children}</>;
  if (isGoalsSetupComplete(setup ?? null)) return <>{children}</>;

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4 md:p-6">
      <Card className="w-full max-w-3xl border-border bg-card p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <Target className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight">Goals & Setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A few quick answers so Coach Jared can build the right program for you. This is required before you can use the rest of the portal — you can update it anytime.
            </p>
          </div>
        </div>
        <GoalsSetupFlow clientId={client.id} />
      </Card>
    </div>
  );
}