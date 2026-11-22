import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

/**
 * Everything that changed a coach's access, newest first: joining, losing or
 * getting back coach access, and every client given to or taken from them
 * (organization_audit_log, written only by the database: triggers on staff
 * roles, the coach record and client assignments). The owner and admins read
 * it; nobody can edit or delete a line.
 */
export type AccessRecordLine = {
  id: string;
  action: string;
  summary: string;
  created_at: string;
  actor_user_id: string | null;
};

/** The PostgREST filter for one coach's lines: about their record, their login, or a client moved to or from them. */
export function coachRecordFilter(coachId: string, userId: string | null): string {
  const parts = [
    `target_id.eq.${coachId}`,
    `detail->>to_coach_id.eq.${coachId}`,
    `detail->>from_coach_id.eq.${coachId}`,
  ];
  if (userId) parts.push(`target_id.eq.${userId}`);
  return parts.join(",");
}

export function CoachAccessRecord({ coachId, userId }: { coachId: string; userId: string | null }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["coach-access-record", coachId, userId],
    queryFn: async (): Promise<AccessRecordLine[]> => {
      const { data, error } = await (supabase as any)
        .from("organization_audit_log")
        .select("id, action, summary, created_at, actor_user_id")
        .or(coachRecordFilter(coachId, userId))
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as AccessRecordLine[];
    },
  });

  return (
    <Card className="p-5" data-coach-access-record>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden />
        Access record
      </h3>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Every change to what this coach can reach. Kept by the database, never edited.
      </p>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-muted-foreground">The record couldn't be read.</p>
      ) : !data?.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing recorded yet. Changes from now on show here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {data.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-sm">{l.summary}</span>
              <time className="shrink-0 text-[12px] text-muted-foreground" dateTime={l.created_at}>
                {new Date(l.created_at).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
