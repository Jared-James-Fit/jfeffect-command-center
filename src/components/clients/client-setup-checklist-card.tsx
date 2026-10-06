import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import type { ClientGoalsSetupRow } from "@/lib/client-goals/schema";
import { setupChecklistSteps, type SetupChecklistKey } from "@/lib/client-setup-checklist";
import { isActiveClient } from "@/lib/coaching-agreement/rules";
import { adminClientAgreementDetail } from "@/lib/coaching-agreement.functions";
import { ADMIN_AGREEMENT_QUERY_ROOT } from "@/components/coaching-agreement/admin-agreement-parts";
import type { TabValue } from "@/components/clients/client-tab-values";

/** Where each step's data lives on the profile, so the coach can jump straight to it. */
const STEP_INFO: Record<SetupChecklistKey, { label: string; tab: TabValue }> = {
  agreement: { label: "Coaching Agreement", tab: "documents" },
  profile_picture: { label: "Profile photo", tab: "info" },
  basic_info: { label: "Basic info", tab: "info" },
  training_schedule: { label: "Training schedule", tab: "training" },
  goals_setup: { label: "Goals & Setup", tab: "goals-setup" },
};

/** The client's "Complete your setup" checklist, read from the same data the client's Home screen uses. */
export function useClientSetupChecklist(clientId: string, client: Record<string, any> | null | undefined) {
  const detailFn = useServerFn(adminClientAgreementDetail);
  const goals = useQuery({
    // A child of the shared goals key, so every goals update refreshes it. Its own entry,
    // because other screens cache a different shape under the parent key.
    queryKey: ["client-goals-setup", clientId, "checklist"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("client_goals_setup").select("*").eq("client_id", clientId).maybeSingle();
      return (data ?? null) as ClientGoalsSetupRow | null;
    },
    enabled: !!clientId,
    staleTime: 60_000,
  });
  const agreement = useQuery({
    queryKey: [ADMIN_AGREEMENT_QUERY_ROOT, "detail", clientId],
    queryFn: () => detailFn({ data: { clientId } }),
    enabled: !!clientId,
    staleTime: 15_000,
  });
  const steps = setupChecklistSteps({
    client,
    goals: goals.data,
    agreement: isActiveClient(client) ? (agreement.data?.state ?? null) : null,
  });
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    loading: goals.isPending || agreement.isPending,
  };
}

export function ClientSetupChecklistCard({
  clientId,
  client,
  onGoToTab,
}: {
  clientId: string;
  client: Record<string, any> | null | undefined;
  onGoToTab: (t: TabValue) => void;
}) {
  const { steps, done, loading } = useClientSetupChecklist(clientId, client);
  const complete = !loading && done === steps.length;
  return (
    <Card className={["border-border bg-card p-6 space-y-3", !loading && !complete ? "border-primary/30" : ""].join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Setup Checklist</h3>
        <Badge variant="outline" className={complete ? "border-success/40 text-success text-[11px]" : "text-[11px]"}>
          {loading ? "…" : complete ? "Complete" : `${done}/${steps.length}`}
        </Badge>
      </div>
      {complete ? (
        <p className="text-xs text-success">All {steps.length} “Complete your setup” steps are done.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {client?.user_id
              ? "The same “Complete your setup” steps the client sees on their Home screen."
              : "They'll see these steps on their Home screen once their account is set up."}
          </p>
          {!loading && (
            <ul className="space-y-1">
              {steps.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => onGoToTab(STEP_INFO[s.key].tab)}
                    className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-secondary/40"
                  >
                    {s.done
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
                    <span className={s.done ? "font-medium" : "text-muted-foreground"}>{STEP_INFO[s.key].label}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{s.done ? "Done" : "Not yet"}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
