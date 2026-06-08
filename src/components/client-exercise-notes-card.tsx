import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, parseISO } from "date-fns";
import { StickyNote } from "lucide-react";

const sb = supabase as any;

export function ClientExerciseNotesCard({ clientId }: { clientId: string }) {
  const { data: notes = [] } = useQuery({
    queryKey: ["client-exercise-notes", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await sb
        .from("pl_exercise_notes")
        .select("id, exercise_name, content, status, created_at, updated_at, day_id, pl_days(title, day_index)")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  return (
    <Card className="p-4 md:col-span-3">
      <div className="mb-3 flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">Exercise Notes from Client</h3>
        <Badge variant="outline" className="ml-auto">{(notes as any[]).length}</Badge>
      </div>
      {(notes as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground">No exercise notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {(notes as any[]).map((n) => (
            <li key={n.id} className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold">{n.exercise_name}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{n.pl_days?.title || `Day ${n.pl_days?.day_index ?? "?"}`}</span>
                {n.status === "edited" && <Badge variant="outline" className="text-[10px]">Edited</Badge>}
                <span className="ml-auto text-[10px] text-muted-foreground">{formatDistanceToNow(parseISO(n.updated_at), { addSuffix: true })}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{n.content}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}