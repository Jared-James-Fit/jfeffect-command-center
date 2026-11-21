import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ProgramStartOptions } from "@/components/program-import/program-start-options";

/** A member with no program yet: follow one, build one or import one, a tap each. Hides once one is running. */
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
            Follow one of ours, build your own or bring one you already have. Its workouts land on your training days.
          </p>
        </div>
      </div>
      <ProgramStartOptions className="mt-3" />
    </Card>
  );
}
