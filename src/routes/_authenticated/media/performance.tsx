import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/performance")({
  component: PerformancePage,
});

function PerformancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-performance-summary"],
    queryFn: async () => {
      const [{ count: published }, { count: scheduled }, { count: archived }] = await Promise.all([
        (supabase.from("media_content_records") as any)
          .select("id", { count: "exact", head: true })
          .eq("production_status", "published")
          .eq("archived", false),
        (supabase.from("media_content_records") as any)
          .select("id", { count: "exact", head: true })
          .eq("production_status", "scheduled")
          .eq("archived", false),
        (supabase.from("media_content_records") as any)
          .select("id", { count: "exact", head: true })
          .eq("archived", true),
      ]);
      return {
        published: published ?? 0,
        scheduled: scheduled ?? 0,
        archived: archived ?? 0,
      };
    },
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <MediaHeader
        title="Performance"
        description="High-level publishing volume. Per-platform analytics arrive in the next phase."
      />
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Published", value: data?.published },
          { label: "Scheduled", value: data?.scheduled },
          { label: "Archived", value: data?.archived },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-20" />
            ) : (
              <div className="mt-1 text-3xl font-semibold">{stat.value ?? 0}</div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}