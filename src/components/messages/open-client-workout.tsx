import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useClientImpersonation } from "@/lib/client-impersonation";

const sb = supabase as any;

/** The coach opens that workout as the client sees it, on the exercise (the way workout history does). */
export function OpenWorkout({ clientId, dayId, rowId, className }: { clientId: string; dayId: string | null; rowId: string | null; className?: string }) {
  const navigate = useNavigate();
  const impersonation = useClientImpersonation();
  const { data: client } = useQuery({
    queryKey: ["workout-note-client", clientId],
    enabled: !!dayId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await sb.from("clients").select("id, user_id, full_name").eq("id", clientId).maybeSingle();
      return (data ?? null) as { id: string; user_id: string | null; full_name: string | null } | null;
    },
  });
  if (!dayId) return null;
  return (
    <button
      type="button"
      disabled={!client?.user_id}
      onClick={() => {
        if (!client?.user_id) return;
        impersonation.start({ id: client.id, user_id: client.user_id, full_name: client.full_name }, window.location.pathname + window.location.search);
        navigate({ to: "/portal/workouts/$dayId", params: { dayId }, search: rowId ? { focus: rowId } : {} } as any);
      }}
      className={cn("inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold text-primary active:bg-muted disabled:opacity-50", className)}
      data-workout-note-open
    >
      Open workout <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}

