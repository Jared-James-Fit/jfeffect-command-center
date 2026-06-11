import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-inbox-mm"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_items")
        .select("id, file_name, media_type, created_at, thumbnail_url, drive_url, marketing_visibility")
        .in("marketing_visibility", ["marketing", "public"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Media Inbox</h1>
      <p className="text-sm text-muted-foreground">Files tagged marketing or public.</p>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && (data ?? []).length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">
          No marketing media yet. Admin can tag media items with "marketing" or "public" visibility from the admin Media Inbox.
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {(data ?? []).map((m: any) => (
          <Card key={m.id} className="p-3">
            {m.thumbnail_url && <img src={m.thumbnail_url} alt="" className="mb-2 h-32 w-full rounded object-cover" />}
            <div className="truncate font-medium text-sm">{m.file_name || m.media_type}</div>
            <div className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}