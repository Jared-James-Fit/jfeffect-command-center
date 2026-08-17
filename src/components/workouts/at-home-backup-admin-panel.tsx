import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Home } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listAtHomeBackupDefinitions,
  listAtHomeBackupSessions,
} from "@/lib/at-home-backup.functions";

/** Coach-side summary: available backup templates + recent sessions. */
export function AtHomeBackupAdminPanel({ clientId }: { clientId: string }) {
  const fetchDefinitions = useServerFn(listAtHomeBackupDefinitions);
  const fetchSessions = useServerFn(listAtHomeBackupSessions);

  const { data: defData } = useQuery({
    queryKey: ["at-home-backup-definitions", clientId],
    staleTime: 5 * 60_000,
    queryFn: () => fetchDefinitions({ data: { clientId } }),
  });
  const { data: sessData } = useQuery({
    queryKey: ["at-home-backup-sessions", clientId],
    queryFn: () => fetchSessions({ data: { clientId, limit: 10 } }),
  });

  const definitions = defData?.definitions ?? [];
  const sessions = sessData?.sessions ?? [];
  if (!definitions.length && !sessions.length) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        <Home className="h-3.5 w-3.5" /> At-Home Backup
      </h2>
      <Card className="space-y-4 p-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Templates (private)
          </div>
          <div className="mt-2 space-y-1.5">
            {definitions.map((d: any) => (
              <div
                key={d.dayId}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{d.summary}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      to="/portal/workouts/$dayId"
                      params={{ dayId: d.dayId }}
                      search={{ readonly: 1 } as any}
                    >
                      Preview
                    </Link>
                  </Button>
                  {d.blockId && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/blocks/$blockId" params={{ blockId: d.blockId }}>
                        Edit
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!definitions.length && (
              <span className="text-xs text-muted-foreground">None configured.</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Recent sessions
          </div>
          <div className="mt-2 space-y-1.5">
            {sessions.length === 0 ? (
              <span className="text-xs text-muted-foreground">No backup sessions started yet.</span>
            ) : (
              sessions.map((s: any) => (
                <Link
                  key={s.dayId}
                  to="/portal/workouts/$dayId"
                  params={{ dayId: s.dayId }}
                  search={{ readonly: 1 } as any}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-secondary/40"
                >
                  <span className="truncate">{s.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {s.date ?? "—"}
                    <Badge
                      variant={s.lifecycle === "completed" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {s.lifecycle === "cancelled" ? "Cancelled" : s.completedAt ? "Completed" : "Open"}
                    </Badge>
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}