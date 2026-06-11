import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/archives")({
  component: ArchivesPage,
});

function ArchivesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-archives-mm"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_archives")
        .select("id, file_name, drive_url, created_at, marketing_visibility")
        .in("marketing_visibility", ["marketing", "public"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Media Archives</h1>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && (data ?? []).length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">No archived marketing media yet.</Card>
      )}
      <ul className="space-y-2">
        {(data ?? []).map((m: any) => (
          <li key={m.id}>
            <Card className="p-3 flex items-center justify-between">
              <span className="truncate">{m.file_name || "Untitled"}</span>
              {m.drive_url && <a href={m.drive_url} target="_blank" rel="noreferrer" className="text-xs underline">Open</a>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}