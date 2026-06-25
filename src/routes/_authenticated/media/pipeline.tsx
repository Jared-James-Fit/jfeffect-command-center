import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/pipeline")({
  component: PipelinePage,
});

const STAGES = ["idea", "drafting", "in_review", "approved", "scheduled", "published"] as const;

function PipelinePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-content-records", "pipeline"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("media_content_records") as any)
        .select("id, title, production_status, approval_status, due_date, publish_date, platform, thumbnail_url, assignee_id")
        .eq("archived", false)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Array<{ id: string; title: string; production_status: string; approval_status: string; due_date: string | null; publish_date: string | null; platform: string | null; thumbnail_url: string | null; assignee_id: string | null }>;
    },
    staleTime: 30_000,
  });

  const byStage = new Map<string, typeof data extends (infer T)[] | undefined ? T[] : never>();
  for (const stage of STAGES) byStage.set(stage, [] as any);
  for (const r of data ?? []) (byStage.get(r.production_status) ?? byStage.get("idea")!).push(r as any);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Content Pipeline"
        description="Every piece of content from idea to published — grouped by production stage."
      />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s) => <Skeleton key={s} className="h-40 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage) => {
            const items = (byStage.get(stage) ?? []) as any[];
            return (
              <Card key={stage} className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold capitalize">{stage.replace("_", " ")}</h2>
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing here yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {items.slice(0, 25).map((r) => (
                      <li key={r.id} className="rounded border bg-card/50 p-2 text-xs">
                        <div className="font-medium">{r.title}</div>
                        {r.platform && <div className="text-muted-foreground">{r.platform}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}