/**
 * What the progress report reads beyond the analytics page's own training
 * load: the athlete's name, their weigh-ins, the nutrition plan they're on and
 * the weekly check-ins' nutrition ratings. Read with the viewer's own login
 * (RLS decides: the athlete, their coach, an admin); a source that can't be
 * read comes back null and its section says so, never a made-up number.
 */
import { supabase } from "@/integrations/supabase/client";
import { inUnit, loadClientBodyweight } from "@/lib/client-bodyweight";
import { nutritionConsistency } from "@/lib/nutrition-targets/nutrition-progress";
import type { ProgressReportInput } from "@/lib/analytics/progress-report-pdf";

const db = supabase as any;

export async function loadProgressReportExtras(
  clientId: string,
  unit: "kg" | "lb",
  from: string,
  to: string,
): Promise<{
  athlete: string | null;
  bodyweight: ProgressReportInput["bodyweight"];
  nutrition: ProgressReportInput["nutrition"];
}> {
  const nameP = db
    .from("clients")
    .select("full_name, first_name, last_name")
    .eq("id", clientId)
    .maybeSingle()
    .then(({ data }: any) =>
      data
        ? data.full_name || [data.first_name, data.last_name].filter(Boolean).join(" ") || null
        : null,
    )
    .catch(() => null);

  const bodyweightP = loadClientBodyweight(clientId)
    .then((bw) =>
      bw.entries.map((e) => ({
        date: e.date,
        value: Math.round(inUnit(e.value, e.unit, unit) * 10) / 10,
      })),
    )
    .catch(() => null);

  const planP = db
    .from("nutrition_targets")
    .select(
      "phase, custom_phase, start_date, end_date, status, nutrition_target_days(day_label, calories, protein, carbs, fats, sort_order)",
    )
    .eq("client_id", clientId)
    .neq("status", "Archived")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data, error }: any) => {
      if (error) throw error;
      if (!data) return null;
      return {
        phase: data.phase === "Custom" ? (data.custom_phase ?? null) : (data.phase ?? null),
        start: data.start_date ?? null,
        end: data.end_date ?? null,
        days: ((data.nutrition_target_days ?? []) as any[])
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((d) => ({
            label: d.day_label ?? "Day",
            calories: d.calories ?? null,
            protein: d.protein ?? null,
            carbs: d.carbs ?? null,
            fats: d.fats ?? null,
          })),
      };
    });

  const ratingsP = db
    .from("messenger_checkins")
    .select("submitted_at, answers")
    .eq("client_id", clientId)
    .eq("task_type", "weekly_checkin")
    .eq("status", "completed")
    .gte("submitted_at", `${from}T00:00:00Z`)
    .order("submitted_at", { ascending: true })
    .limit(200)
    .then(({ data, error }: any) => {
      if (error) throw error;
      return nutritionConsistency(data ?? [], from, to).points;
    });

  const [athlete, bodyweight, plan, ratings] = await Promise.all([
    nameP,
    bodyweightP,
    planP.catch(() => undefined),
    ratingsP.catch(() => undefined),
  ]);
  const nutrition =
    plan === undefined && ratings === undefined
      ? null
      : { plan: plan ?? null, ratings: ratings ?? [] };
  return { athlete, bodyweight, nutrition };
}
