import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { ChevronRight, Camera, Video, Loader2, CheckCircle2 } from "lucide-react";

type Row = {
  id: string;
  client_id: string | null;
  submission_type: "photo" | "video";
  check_in_label: string | null;
  submission_date: string;
  submitted_at: string | null;
  review_status: string;
  reviewed_at: string | null;
  clients: { full_name: string | null } | null;
};

type StatusFilter = "awaiting_review" | "reviewed";

export function ProgressReviewQueue() {
  const [status, setStatus] = useState<StatusFilter>("awaiting_review");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["coach-progress-review-queue", status],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("progress_submissions")
        .select(
          "id, client_id, submission_type, check_in_label, submission_date, submitted_at, review_status, reviewed_at, clients:client_id (full_name)",
        )
        .eq("owner_type", "client")
        .eq("review_status", status)
        .order(status === "awaiting_review" ? "submitted_at" : "reviewed_at", {
          ascending: false,
          nullsFirst: false,
        })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 30_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Client Progress Queue</h2>
          <p className="text-sm text-muted-foreground">
            Photos and videos coaching clients have submitted for review.
          </p>
        </div>
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="awaiting_review">Awaiting Review</TabsTrigger>
            <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Loading…
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {status === "awaiting_review" ? (
            <>
              <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
              All caught up — no submissions waiting for review.
            </>
          ) : (
            <>No reviewed submissions yet.</>
          )}
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3 p-3 md:p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                  {r.submission_type === "video" ? (
                    <Video className="h-4 w-4" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">
                      {r.clients?.full_name ?? "Client"}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {r.check_in_label ?? "Progress"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {r.submission_type}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Submitted {formatWhen(r.submitted_at ?? r.submission_date)}
                    {status === "reviewed" && r.reviewed_at
                      ? ` · Reviewed ${formatWhen(r.reviewed_at)}`
                      : ""}
                  </div>
                </div>
              </div>
              {r.client_id ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    to="/admin/clients/$id/progress"
                    params={{ id: r.client_id }}
                  >
                    Open
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}