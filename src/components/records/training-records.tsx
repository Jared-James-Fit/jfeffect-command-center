import { Trophy, Medal, Award, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  alsoLabel, formatLoad, formatTonnage, repRecordLabel, tonnageRecordLabel, topScope,
  type RecordScope, type RepRecord, type TonnageRecord, type WorkoutRecords, type RecentRecords, type ExerciseRecords,
} from "@/lib/training-records";
import { format, parseISO } from "date-fns";

/** ATPR = gold & loud; PROGRAM PR = violet; BLOCK PR = subtle blue. */
const TIER: Record<RecordScope, { pill: string; icon: typeof Trophy }> = {
  atpr: { pill: "border-amber-500/60 bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-sm shadow-amber-500/30", icon: Trophy },
  program_pr: { pill: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300", icon: Medal },
  block_pr: { pill: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300", icon: Award },
};

export function RecordPill({ scope, label, className, size = "sm" }: { scope: RecordScope; label: string; className?: string; size?: "sm" | "md" }) {
  const t = TIER[scope];
  const Icon = t.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-black uppercase tracking-wide",
      size === "md" ? "h-6 px-2.5 text-[11px]" : "h-5 px-2 text-[10px]", t.pill, className)}>
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      {label}
    </span>
  );
}

/** Inline badge under a logged set: "NEW 5-REP ATPR". Never spams: one pill, top scope only. */
export function SetRecordBadge({ record }: { record: Pick<RepRecord, "reps" | "atpr" | "program_pr" | "block_pr"> }) {
  const scope = topScope(record);
  const label = repRecordLabel(record);
  if (!scope || !label) return null;
  return <RecordPill scope={scope} label={`New ${label}`} />;
}

/** Recap: the exciting part — records first, ATPRs on top. */
export function NewRecordsSection({ records, unit }: { records: WorkoutRecords; unit: "kg" | "lb" }) {
  const reps = records.records ?? [];
  const tonLabel = tonnageRecordLabel(records.tonnage);
  if (reps.length === 0 && !tonLabel) return null;
  const hasAtpr = reps.some((r) => r.atpr) || records.tonnage?.atpr;
  return (
    <section className={cn("relative overflow-hidden rounded-2xl border-2 p-3.5 shadow-sm animate-in zoom-in-95 fade-in duration-700",
      hasAtpr ? "border-amber-500/50 bg-gradient-to-br from-amber-500/[0.16] via-amber-500/[0.05] to-background" : "border-violet-500/30 bg-gradient-to-br from-violet-500/[0.08] to-background")}>
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">New records</div>
      <ul className="space-y-2">
        {reps.slice(0, 6).map((r) => {
          const scope = topScope(r)!;
          const also = alsoLabel(r);
          return (
            <li key={r.set_id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-black leading-tight">{r.exercise_name}</div>
                <div className="text-[12px] font-semibold tabular-nums text-muted-foreground">{formatLoad(r.load_kg, unit)} × {r.reps}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <RecordPill scope={scope} label={repRecordLabel(r)!} />
                {also && <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">also {also}</span>}
              </div>
            </li>
          );
        })}
        {reps.length > 6 && <li className="text-[11px] font-semibold text-muted-foreground">+{reps.length - 6} more records</li>}
        {tonLabel && (
          <li className="flex items-start gap-2 border-t border-border/60 pt-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-black leading-tight">Workout Tonnage</div>
              <div className="text-[12px] font-semibold tabular-nums text-muted-foreground">{formatTonnage(records.tonnage_kg, unit)}</div>
            </div>
            <RecordPill scope={topScope(records.tonnage)!} label={tonLabel} />
          </li>
        )}
      </ul>
    </section>
  );
}

/** Headline that never says a bare "PR". */
export function recordsHeadline(records: WorkoutRecords | null | undefined): string | null {
  if (!records) return null;
  const reps = records.records ?? [];
  const atprs = reps.filter((r) => r.atpr).length + (records.tonnage?.atpr ? 1 : 0);
  if (atprs > 1) return `${atprs} NEW ATPRs!`;
  if (atprs === 1) return "NEW ATPR!";
  if (reps.some((r) => r.program_pr) || records.tonnage?.program_pr) return "NEW PROGRAM PR!";
  if (reps.some((r) => r.block_pr) || records.tonnage?.block_pr) return "NEW BLOCK PR!";
  return null;
}

export function TonnageStat({ records, unit }: { records: WorkoutRecords; unit: "kg" | "lb" }) {
  const label = tonnageRecordLabel(records.tonnage);
  return (
    <div className="flex items-center gap-3 border-t border-border/70 px-3.5 py-3">
      <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-black uppercase tracking-[0.12em] text-muted-foreground">Total tonnage</div>
        <div className="mt-0.5 truncate text-xl font-black leading-tight tabular-nums text-foreground">{formatTonnage(records.tonnage_kg, unit)}</div>
      </div>
      {label && <RecordPill scope={topScope(records.tonnage as TonnageRecord)!} label={label} />}
    </div>
  );
}

/** Coach: recent ATPRs first, then program/block PRs and tonnage records. */
export function RecentRecordsList({ data, unit, limit = 8 }: { data: RecentRecords; unit: "kg" | "lb"; limit?: number }) {
  const items = [
    ...data.records.map((r) => ({ key: `${r.workout_key}:${r.exercise_name}:${r.reps}`, at: r.at, scope: topScope(r)!, title: r.exercise_name, detail: `${formatLoad(r.load_kg, unit)} × ${r.reps}`, label: repRecordLabel(r)! })),
    ...data.tonnage.map((t) => ({ key: `t:${t.workout_key}`, at: t.at, scope: topScope(t)!, title: "Workout Tonnage", detail: formatTonnage(t.tonnage_kg, unit), label: tonnageRecordLabel(t)! })),
  ].sort((a, b) => (a.scope === b.scope ? b.at.localeCompare(a.at) : ["atpr", "program_pr", "block_pr"].indexOf(a.scope) - ["atpr", "program_pr", "block_pr"].indexOf(b.scope)));
  if (items.length === 0) return <div className="text-xs text-muted-foreground">No new records in this period.</div>;
  return (
    <ul className="divide-y divide-border/60">
      {items.slice(0, limit).map((i) => (
        <li key={i.key} className="flex items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{i.title}</div>
            <div className="text-[11px] tabular-nums text-muted-foreground">{i.detail} · {format(parseISO(i.at), "MMM d")}</div>
          </div>
          <RecordPill scope={i.scope} label={i.label} />
        </li>
      ))}
    </ul>
  );
}

/** Exercise history: ALL-TIME BESTS per rep count + current program/block bests. */
export function ExerciseRecordsPanel({ data, unit }: { data: ExerciseRecords; unit: "kg" | "lb" }) {
  if (!data.rep_bests.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Rep records</div>
        <div className="text-[10px] text-muted-foreground">ATPR = all-time · Program / Block = current</div>
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-3 gap-y-1 text-xs">
        <div className="text-[10px] font-bold uppercase text-muted-foreground">Reps</div>
        <div className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">ATPR</div>
        <div className="truncate text-[10px] font-bold uppercase text-violet-600 dark:text-violet-300" title={data.current_program ?? ""}>Program</div>
        <div className="truncate text-[10px] font-bold uppercase text-sky-600 dark:text-sky-300" title={data.current_block ?? ""}>Block</div>
        {data.rep_bests.map((b) => (
          <div key={b.reps} className="contents">
            <div className="font-black tabular-nums">{b.reps}</div>
            <div className="font-bold tabular-nums">{b.atpr ? formatLoad(b.atpr.load_kg, unit) : "—"}</div>
            <div className="tabular-nums">{b.program ? formatLoad(b.program.load_kg, unit) : "—"}</div>
            <div className="tabular-nums">{b.block ? formatLoad(b.block.load_kg, unit) : "—"}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

import { createContext, useContext } from "react";
export type WorkoutRecordsContextValue = { bySetId: Map<string, RepRecord> } | null;
/** Provided by the client workout view; set rows read their record from here. */
export const WorkoutRecordsContext = createContext<WorkoutRecordsContextValue>(null);
export const useSetRecord = (setId: string | null | undefined) => {
  const ctx = useContext(WorkoutRecordsContext);
  return { hasRecords: !!ctx, record: setId ? ctx?.bySetId.get(setId) ?? null : null };
};

// ── Data-bound wrappers (exercise history, coach review) ────────────────────
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchWorkoutRecords, useExerciseRecords, useRecentRecords } from "@/lib/training-records";

export function ExerciseRecordsForClient({ clientId, exerciseId, exerciseName, unit }: {
  clientId: string | null | undefined; exerciseId: string | null | undefined; exerciseName: string; unit: "kg" | "lb";
}) {
  const { data } = useExerciseRecords(clientId, exerciseId, exerciseName);
  if (!data || !data.rep_bests?.length) return null;
  return <ExerciseRecordsPanel data={data} unit={unit} />;
}

/** Coach workout review: the records this workout earned + its tonnage. */
export function WorkoutRecordsStrip({ clientId, dayId, completionId, unit }: {
  clientId: string; dayId: string | null | undefined; completionId?: string | null; unit: "kg" | "lb";
}) {
  const { data } = useQuery({
    queryKey: ["workout-records-review", clientId, dayId ?? null, completionId ?? null],
    enabled: !!clientId && (!!dayId || !!completionId),
    staleTime: 60_000,
    queryFn: async () => {
      let sw: string | null = null;
      if (completionId) {
        const { data: c } = await (supabase.from("pl_day_completions") as any).select("scheduled_workout_id, day_id").eq("id", completionId).maybeSingle();
        sw = c?.scheduled_workout_id ?? null;
      }
      return fetchWorkoutRecords(clientId, sw, dayId ?? null);
    },
  });
  if (!data) return null;
  const reps = data.records ?? [];
  const ton = tonnageRecordLabel(data.tonnage);
  if (reps.length === 0 && !ton && !data.tonnage_kg) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      {data.tonnage_kg > 0 && (
        <span className="mr-1 font-semibold tabular-nums text-muted-foreground">Tonnage {formatTonnage(data.tonnage_kg, unit)}</span>
      )}
      {ton && <RecordPill scope={topScope(data.tonnage)!} label={ton} />}
      {reps.slice(0, 6).map((r) => (
        <span key={r.set_id} className="inline-flex items-center gap-1">
          <RecordPill scope={topScope(r)!} label={repRecordLabel(r)!} />
          <span className="text-[11px] text-muted-foreground">{r.exercise_name} {formatLoad(r.load_kg, unit)} × {r.reps}</span>
        </span>
      ))}
    </div>
  );
}

export function RecentRecordsCard({ clientId, unit, days = 60 }: { clientId: string; unit: "kg" | "lb"; days?: number }) {
  const { data, isPending } = useRecentRecords(clientId, days);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Records · last {days} days</h2>
        <span className="text-[10px] text-muted-foreground">ATPR = all-time · Program / Block = scoped</span>
      </div>
      {isPending ? <div className="text-xs text-muted-foreground">Loading…</div> : data ? <RecentRecordsList data={data} unit={unit} /> : null}
    </section>
  );
}
