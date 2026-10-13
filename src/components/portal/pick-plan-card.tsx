import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** A member with no program yet: one tap to the Plan Library. Hides once a plan is running. */
export function PickPlanCard({ clientId }: { clientId: string }) {
  const { data: programs, isLoading } = useQuery({
    queryKey: ["my-program-count", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("pl_blocks")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("archived", false)
        .eq("client_visible", true);
      return count ?? 0;
    },
  });
  if (isLoading || (programs ?? 0) > 0) return null;
  return (
    <Card className="rounded-xl border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-wider text-primary">Start here</div>
          <h3 className="mt-0.5 text-sm font-bold leading-tight">Pick your plan</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Coach-written plans for every goal. Pick one, choose your days, and Week 1 lands on your calendar.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link to="/portal/plans">
              Browse plans <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
