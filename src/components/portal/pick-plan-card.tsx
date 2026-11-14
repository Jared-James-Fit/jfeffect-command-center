import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** A member with no program yet: one tap to finding one (Programs → My programs lists every way). Hides once one is running. */
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
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-tight">Pick your program</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Start a JF Effect plan, copy one from the crew or build your own. Its workouts land on your training days.
          </p>
          {/* a member with no program: this is Home's one red action, the same two as Workouts' empty state */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild className="h-10">
              <Link to="/portal/programs" search={{ tab: "mine" }}>
                Find a program <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="h-10">
              <Link to="/portal/programs/new">Build your own</Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
