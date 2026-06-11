import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/action-items")({
  component: ActionItems,
});

function ActionItems() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["media-tasks", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("*").eq("assigned_to", user!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Action Items</h1>
      {(data ?? []).length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No action items assigned to you.</Card>
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((t: any) => (
            <li key={t.id}><Card className="p-3"><div className="font-medium">{t.title}</div><div className="text-xs text-muted-foreground">{t.status}</div></Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}