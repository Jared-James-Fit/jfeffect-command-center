/**
 * The client's cardio plan (Nov 23 2026): opened from the "Your cardio plan has
 * been updated" card in their coach chat and its push. Simpler than the
 * coach's view on purpose: what to do, when, how long and how hard, the week
 * at a glance, and what changes on a later date. Logging stays where it is
 * (the Workouts day card and the workout's last exercise).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { portalWorkoutsClientQuery } from "@/lib/portal-page-queries";
import { CardioWeek } from "@/components/cardio/cardio-week";
import { normalizeCardioWeekdays } from "@/lib/cardio-prescription";
import { daysWords, effortWords, sessionTitle, settingsWords, TIMING_SHORT, type CardioPlan, type PlanContext } from "@/lib/cardio/plan";
import { planOn, pendingStart } from "@/lib/cardio/publish";
import { rpeWords } from "@/lib/cardio/modalities";
import { todayLocalISO } from "@/lib/today";
import type { SpeedUnit } from "@/lib/weight-management/units";

export const Route = createFileRoute("/_authenticated/portal/cardio")({ component: CardioPage });

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

function Sessions({ plan, ctx, unit }: { plan: CardioPlan; ctx: PlanContext; unit: SpeedUnit }) {
  const list = plan.sessions.filter((s) => s.enabled);
  if (!list.length) return <p className="rounded-2xl border border-border bg-card p-4 text-[15px] text-muted-foreground">No cardio in your plan right now.</p>;
  return (
    <ul className="space-y-3">
      {list.map((s) => {
        const effort = effortWords(s);
        const feel = rpeWords(s.rpeMin, s.rpeMax);
        return (
          <li key={s.key} className="rounded-2xl border border-border bg-card p-4" data-client-cardio-session>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[16px] font-semibold">{sessionTitle(s)}</p>
              <p className="shrink-0 text-[20px] font-semibold tabular-nums">{s.minutes} min</p>
            </div>
            <p className="mt-1 text-[14px]">{daysWords(s, ctx)}{s.timing !== "any" ? ` · ${TIMING_SHORT[s.timing]}` : ""}</p>
            {settingsWords(s, unit) && <p className="mt-1 text-[14px] text-muted-foreground">{settingsWords(s, unit)}</p>}
            {(effort || feel) && <p className="mt-1 text-[14px] text-muted-foreground">{[effort, feel].filter(Boolean).join(" · ")}</p>}
            {s.instructions && <p className="mt-2 text-[14px]">{s.instructions}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function CardioPage() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({ ...portalWorkoutsClientQuery(portalUserId ?? ""), enabled: !!portalUserId });
  const q = useQuery({
    queryKey: ["portal-cardio-plan", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const [rows, prefs] = await Promise.all([
        supabase.from("cardio_targets").select("*").eq("client_id", client!.id),
        supabase.from("clients").select("committed_training_days, preferred_training_days, preferred_high_days, preferred_weight_unit").eq("id", client!.id).maybeSingle(),
      ]);
      if (rows.error) throw rows.error;
      return { rows: (rows.data ?? []).filter((r: any) => r.visible_to_client !== false), prefs: prefs.data as any };
    },
  });
  if (!q.data) {
    return (
      <>
        <PageHeader title="Your cardio" />
        <Skeleton className="h-40 rounded-2xl" />
      </>
    );
  }
  const today = todayLocalISO();
  const p = q.data.prefs ?? {};
  const ctx: PlanContext = {
    trainingDays: normalizeCardioWeekdays((p.committed_training_days?.length ? p.committed_training_days : p.preferred_training_days) ?? []),
    highDays: normalizeCardioWeekdays(p.preferred_high_days ?? []),
  };
  const live = planOn(q.data.rows as any, today);
  const next = pendingStart(q.data.rows as any, today);
  const later = next ? planOn(q.data.rows as any, next) : null;
  const unit: SpeedUnit = ((q.data.rows as any[]).find((r) => r.speed_unit)?.speed_unit as SpeedUnit) ?? (p.preferred_weight_unit === "kg" ? "kmh" : "mph");
  return (
    <div className="space-y-5" data-client-cardio-page>
      <PageHeader title="Your cardio" />
      <section className="space-y-2">
        <h2 className="text-base font-semibold">This week</h2>
        <CardioWeek plan={{ sessions: live.sessions.filter((s) => s.enabled) }} ctx={ctx} />
      </section>
      <Sessions plan={live} ctx={ctx} unit={unit} />
      {later && next && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">From {fmtDay(next)}</h2>
          <Sessions plan={later} ctx={ctx} unit={unit} />
        </section>
      )}
      <p className="text-[13px] text-muted-foreground">
        Log it from your day on{" "}
        <Link to="/portal/workouts" className="font-medium text-foreground underline-offset-2 hover:underline">
          Workouts
        </Link>
        {ctx.trainingDays.length ? "; on lifting days it's the last exercise of your workout." : "."}
      </p>
    </div>
  );
}
