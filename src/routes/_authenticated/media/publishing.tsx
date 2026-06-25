import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/publishing")({
  component: PublishingPage,
});

function PublishingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-content-records", "publishing"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("media_content_records") as any)
        .select("id, title, platform, publish_date, publish_time, production_status, approval_status")
        .eq("archived", false)
        .in("production_status", ["approved", "scheduled"])
        .order("publish_date", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data as Array<{ id: string; title: string; platform: string | null; publish_date: string | null; publish_time: string | null; production_status: string; approval_status: string }>;
    },
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <MediaHeader
        title="Publishing Queue"
        description="Approved and scheduled content waiting to go live."
      />
      <Card className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in the publishing queue yet. Approve content in the pipeline to schedule it here.
          </p>
        ) : (
          <ul className="divide-y">
            {data.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.platform ?? "—"}
                    {r.publish_date && <> · {r.publish_date}{r.publish_time ? ` ${r.publish_time}` : ""}</>}
                  </div>
                </div>
                <Badge variant={r.production_status === "scheduled" ? "default" : "secondary"}>
                  {r.production_status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}