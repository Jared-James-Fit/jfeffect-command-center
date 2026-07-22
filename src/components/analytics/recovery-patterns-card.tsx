import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";
import { format } from "date-fns";
import { detectRecoveryPatterns, type WorkoutSessionMeta } from "@/lib/analytics/recovery-patterns";

interface Props {
  clientId: string;
  rangeStart: Date;
  rangeEnd: Date;
}

/**
 * Detected recovery patterns — rendered only when we have enough history
 * AND at least one pattern crosses its effect-size threshold.
 */
export function RecoveryPatternsCard({ clientId, rangeStart, rangeEnd }: Props) {
  const start = format(rangeStart, "yyyy-MM-dd") + "T00:00:00Z";
  const end = format(rangeEnd, "yyyy-MM-dd") + "T23:59:59Z";

  const { data: patterns } = useQuery({
    queryKey: ["recovery-patterns", clientId, start, end],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("member_workout_reviews")
        .select("overall_rating, session_rpe, strength_feel, fatigue_feel, pain, review_submitted_at, member_plan_enrollments!inner(client_id)")
        .eq("member_plan_enrollments.client_id", clientId)
        .gte("review_submitted_at", start)
        .lte("review_submitted_at", end)
        .order("review_submitted_at", { ascending: true });
      const sessions: WorkoutSessionMeta[] = (data ?? []).map((r: any) => ({
        date: r.review_submitted_at,
        overallRating: r.overall_rating,
        sessionRpe: r.session_rpe,
        strengthFeel: r.strength_feel,
        fatigueFeel: r.fatigue_feel,
        pain: r.pain,
      }));
      return detectRecoveryPatterns(sessions);
    },
  });

  if (!patterns || patterns.length === 0) return null;

  return (
    <section aria-label="Recovery patterns">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
          <Lightbulb className="h-5 w-5 text-primary" />
          Detected Patterns
        </h2>
      </div>
      <Card className="border-border/80 bg-card p-4">
        <ul className="space-y-2">
          {patterns.map((p) => (
            <li key={p.id} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Lightbulb className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{p.text}</p>
                <p className="text-[11px] text-muted-foreground">Based on {p.support} sessions</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}