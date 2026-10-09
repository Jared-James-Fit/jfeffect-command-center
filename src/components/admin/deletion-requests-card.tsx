import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listDeletionRequests } from "@/lib/my-data.functions";

/** Pending account deletion requests (30-day hold). Deleting is done by review, not automatically. */
export function DeletionRequestsCard() {
  const listFn = useServerFn(listDeletionRequests);
  const { data, isLoading, error } = useQuery({ queryKey: ["deletion-requests"], queryFn: () => listFn() });
  const now = Date.now();
  return (
    <Card className="border-border bg-card p-6 space-y-3 md:col-span-2">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Account deletion requests</h3>
      <p className="text-xs text-muted-foreground">
        People who asked to delete their account. Each request is held 30 days and can be cancelled by them until then.
      </p>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}
      {data && data.length === 0 && <div className="text-sm text-muted-foreground">No pending requests.</div>}
      {data?.map((r: any) => {
        const due = Date.parse(r.delete_after) <= now;
        return (
          <div key={r.id} className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{r.full_name || r.email || r.user_id}</div>
              <div className="truncate text-xs text-muted-foreground">
                {r.email} · requested {new Date(r.requested_at).toLocaleDateString()}
                {r.reason ? ` · “${r.reason}”` : ""}
              </div>
            </div>
            <Badge variant={due ? "destructive" : "outline"}>
              {due ? "Due" : `Due ${new Date(r.delete_after).toLocaleDateString()}`}
            </Badge>
          </div>
        );
      })}
    </Card>
  );
}
