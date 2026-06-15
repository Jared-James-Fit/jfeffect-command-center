import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app-shell";
import { GoalsSetupFlow } from "@/components/client-goals/GoalsSetupFlow";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Target, BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { clearGoalsUpdateRequestFn } from "@/lib/client-goals/goals.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portal/goals-setup")({
  component: PortalGoalsSetupPage,
  head: () => ({
    meta: [
      { title: "Goals & Setup — Client Portal" },
      { name: "description", content: "Tell your coach the goals and preferences they need to build your program." },
    ],
  }),
});

function PortalGoalsSetupPage() {
  const userId = usePortalUserId();
  const qc = useQueryClient();

  const { data: client, isLoading } = useQuery({
    queryKey: ["portal-self-client", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clients")
        .select("id, full_name")
        .eq("user_id", userId)
        .maybeSingle();
      return data as { id: string; full_name: string } | null;
    },
  });

  const { data: setup } = useQuery({
    queryKey: ["client-goals-setup", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("client_goals_setup")
        .select("update_requested_at, update_request_message, completed_at")
        .eq("client_id", client!.id)
        .maybeSingle();
      return data;
    },
  });

  const clearReq = useServerFn(clearGoalsUpdateRequestFn);
  const clearReqMut = useMutation({
    mutationFn: () => clearReq({ data: { clientId: client!.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-goals-setup", client?.id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!client) {
    return (
      <Card className="m-4 p-6 text-center text-sm text-muted-foreground">
        We couldn't find your client profile. Please contact your coach.
      </Card>
    );
  }

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <PageHeader
        title="Goals & Setup"
        subtitle="Quick answers so your coach can build the right program for you."
        icon={Target}
      />

      {setup?.update_requested_at && (
        <Card className="border-primary/40 bg-primary/5 p-4">
          <div className="flex items-start gap-2">
            <BellRing className="mt-0.5 h-4 w-4 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Your coach asked you to update your answers</div>
              {setup.update_request_message && (
                <p className="mt-1 text-sm text-muted-foreground">{setup.update_request_message}</p>
              )}
            </div>
            <Button
              size="sm" variant="ghost"
              onClick={() => clearReqMut.mutate()}
              disabled={clearReqMut.isPending}
            >
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      {setup?.completed_at && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          Saved {new Date(setup.completed_at).toLocaleDateString()} — you can update any answer below.
          <Badge variant="secondary" className="ml-auto text-[10px]">Saves automatically</Badge>
        </div>
      )}

      <GoalsSetupFlow
        clientId={client.id}
        onComplete={() => toast.success("Thanks — your coach will see your updates.")}
      />

      <div className="pt-2 text-center">
        <Link to="/portal" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}