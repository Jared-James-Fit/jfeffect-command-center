/**
 * What was logged at check-out (sleep, how recovered they felt, pain) in a
 * period, on the athlete's own days. One query for the analytics Overview's
 * recovery line and the Recovery tab, so they never disagree.
 */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { SleepBucket } from "@/lib/analytics/recovery-score";
import type { CheckoutRow } from "@/lib/analytics/recovery-trends";

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useCheckouts(clientId: string, start: Date, end: Date, enabled = true) {
  const startISO = format(start, "yyyy-MM-dd");
  const endISO = format(end, "yyyy-MM-dd");
  return useQuery({
    queryKey: ["recovery-trends", clientId, startISO, endISO],
    enabled: !!clientId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("pl_workout_feedback")
        .select(
          "created_at, sleep_bucket, recovery_today, pain, pl_day_completions!inner(completed_at, logging_percentage, session_rating, client_id)",
        )
        .eq("client_id", clientId)
        .gte("pl_day_completions.completed_at", `${startISO}T00:00:00`)
        .lte("pl_day_completions.completed_at", `${endISO}T23:59:59`);
      if (error) throw error;
      const out: CheckoutRow[] = ((rows ?? []) as any[])
        .filter((r) => r.pl_day_completions?.completed_at)
        // the period, on the athlete's own days (never trusting the embed filter alone)
        .filter((r) => {
          const d = localDay(r.pl_day_completions.completed_at);
          return d >= startISO && d <= endISO;
        })
        .map((r) => ({
          day: localDay(r.pl_day_completions.completed_at),
          sleepBucket: (r.sleep_bucket ?? null) as SleepBucket | null,
          recovery: r.recovery_today != null ? Number(r.recovery_today) : null,
          pain: r.pain ?? null,
          rating:
            r.pl_day_completions.session_rating != null ? Number(r.pl_day_completions.session_rating) : null,
          logging:
            r.pl_day_completions.logging_percentage != null
              ? Number(r.pl_day_completions.logging_percentage)
              : null,
        }));
      return out;
    },
  });
}
