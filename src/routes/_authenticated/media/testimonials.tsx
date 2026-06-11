import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/testimonials")({
  component: TestimonialsPage,
});

function TestimonialsPage() {
  const { data } = useQuery({
    queryKey: ["media-testimonials"],
    queryFn: async () => {
      const { data } = await supabase
        .from("media_items")
        .select("id, file_name, thumbnail_url, drive_url, created_at")
        .in("marketing_visibility", ["marketing", "public"])
        .ilike("media_type", "%testimonial%");
      return data ?? [];
    },
  });
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Testimonials & Proof</h1>
      {(data ?? []).length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No testimonials tagged yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {(data ?? []).map((m: any) => (
            <Card key={m.id} className="p-3">
              <div className="truncate font-medium text-sm">{m.file_name}</div>
              {m.drive_url && <a href={m.drive_url} target="_blank" rel="noreferrer" className="text-xs underline">Open</a>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}