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
      const [reviewsRes, setsRes] = await Promise.all([
        (supabase as any)
          .from("member_workout_reviews")
          .select("overall_rating, session_rpe, strength_feel, fatigue_feel, pain, review_submitted_at, member_plan_enrollments!inner(client_id)")
          .eq("member_plan_enrollments.client_id", clientId)
          .gte("review_submitted_at", start)
          .lte("review_submitted_at", end)
          .order("review_submitted_at", { ascending: true }),
        (supabase as any)
          .from("pl_row_results")
          .select("actual_rpe, actual_rir, completed_at, client_id")
          .eq("client_id", clientId)
          .gte("completed_at", start)
          .lte("completed_at", end),
      ]);

      // Aggregate per-day avg RIR / RPE from set logs to fill in gaps
      // when the client submits a workout without a review.
      const byDay = new Map<string, { rpes: number[]; rirs: number[] }>();
      for (const r of (setsRes.data ?? []) as any[]) {
        if (!r.completed_at) continue;
        const day = String(r.completed_at).slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, { rpes: [], rirs: [] });
        const b = byDay.get(day)!;
        const rpe = r.actual_rpe != null ? Number(r.actual_rpe) : NaN;
        const rir = r.actual_rir != null ? Number(r.actual_rir) : NaN;
        if (Number.isFinite(rpe)) b.rpes.push(rpe);
        if (Number.isFinite(rir)) b.rirs.push(rir);
      }

      const sessions: WorkoutSessionMeta[] = (reviewsRes.data ?? []).map((r: any) => {
        const day = String(r.review_submitted_at).slice(0, 10);
        const agg = byDay.get(day);
        const avgRpe = agg && agg.rpes.length
          ? agg.rpes.reduce((s, n) => s + n, 0) / agg.rpes.length
          : null;
        const avgRir = agg && agg.rirs.length
          ? agg.rirs.reduce((s, n) => s + n, 0) / agg.rirs.length
          : null;
        return {
          date: r.review_submitted_at,
          overallRating: r.overall_rating,
          sessionRpe: r.session_rpe,
          avgRpe,
          avgRir,
          strengthFeel: r.strength_feel,
          fatigueFeel: r.fatigue_feel,
          pain: r.pain,
        };
      });

      // Include set-log-only days (no review) so we still detect patterns
      // for clients who don't submit reviews.
      const reviewDays = new Set(sessions.map((s) => String(s.date).slice(0, 10)));
      for (const [day, agg] of byDay) {
        if (reviewDays.has(day)) continue;
        const avgRpe = agg.rpes.length ? agg.rpes.reduce((s, n) => s + n, 0) / agg.rpes.length : null;
        const avgRir = agg.rirs.length ? agg.rirs.reduce((s, n) => s + n, 0) / agg.rirs.length : null;
        sessions.push({ date: `${day}T00:00:00Z`, avgRpe, avgRir });
      }
      sessions.sort((a, b) => a.date.localeCompare(b.date));
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