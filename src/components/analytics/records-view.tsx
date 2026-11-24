/**
 * Records: what the athlete has built (records.ts). Lifetime numbers first,
 * then the latest records worth celebrating, competitions as a timeline, and
 * every exercise's records, searchable. A first time is a baseline, never a
 * record; one record per exercise a day; tiny gains don't count.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Search, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { Input } from "@/components/ui/input";
import {
  isHeadlineRecord,
  nextLiftedMilestone,
  type ExerciseRecords,
  type Lifetime,
  type PersonalRecord,
} from "@/lib/analytics/records";
import { COMP_LIFTS, COMP_LIFT_LABEL, type MeetResult } from "@/lib/analytics/competition-strength";
import { SectionTitle, LB_PER_KG, LIFT_SERIES } from "@/components/analytics/viz";

const fmt = (d: string, f?: string) => {
  const x = parseLocalDate(d);
  return x
    ? format(x, f ?? (x.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy"))
    : d;
};

function compact(v: number): string {
  if (v >= 1_000_000) return `${(Math.round(v / 10_000) / 100).toLocaleString()}M`;
  if (v >= 10_000) return `${Math.round(v / 1000).toLocaleString()}k`;
  return Math.round(v).toLocaleString();
}

export function RecordsView({
  lifetime,
  records,
  byExercise,
  meets,
  unit,
}: {
  lifetime: Lifetime;
  records: PersonalRecord[];
  byExercise: ExerciseRecords[];
  meets: MeetResult[];
  unit: "lb" | "kg";
}) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));
  const lifted = unit === "kg" ? lifetime.liftedKg : lifetime.liftedLb;
  const next = nextLiftedMilestone(lifetime.liftedLb, unit);
  const recent = useMemo(() => {
    const cut = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    return records
      .filter((r) => r.day >= cut)
      .sort(
        (a, b) =>
          Number(isHeadlineRecord(b)) - Number(isHeadlineRecord(a)) || b.day.localeCompare(a.day),
      )
      .slice(0, 4);
  }, [records]);

  return (
    <div className="space-y-8" data-records-view>
      {/* lifetime: big numbers, nothing else */}
      <section aria-label="Lifetime">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4" data-lifetime>
          <div className="col-span-2 sm:col-span-2">
            <div className="text-[12px] text-muted-foreground">
              Total weight lifted, all time
            </div>
            <div className="text-[38px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
              {compact(lifted)}
              <span className="ml-1 text-[15px] font-medium text-muted-foreground">{unit}</span>
            </div>
            <div className="mt-1 text-[12px] tabular-nums text-muted-foreground">
              {unit === "kg"
                ? `${compact(lifetime.liftedLb)} lb`
                : `${compact(lifetime.liftedKg)} kg`}
              {lifetime.firstDay ? ` · since ${fmt(lifetime.firstDay, "MMM yyyy")}` : ""} · every
              set's weight × reps, added up
            </div>
            <div
              className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={next}
              aria-valuenow={lifted}
              aria-label="Toward the next milestone"
            >
              <div
                className="h-full rounded-full bg-foreground/80"
                style={{ width: `${Math.min(100, (lifted / next) * 100)}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Next milestone: {compact(next)} {unit}
            </div>
          </div>
          <Counter
            label="Workouts"
            value={lifetime.workouts.toLocaleString()}
            sub={`${lifetime.sets.toLocaleString()} sets`}
          />
          <Counter
            label="Records"
            value={lifetime.records.toLocaleString()}
            sub={
              lifetime.bestStreakWeeks >= 2
                ? `longest streak ${lifetime.bestStreakWeeks} weeks`
                : `across ${lifetime.exercises} exercises`
            }
          />
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-label="Latest records">
          <SectionTitle
            title="Latest records"
            sub="Your new bests from the last two months"
            info={
              <p>
                A record is beating your own best on an exercise: the heaviest weight you've lifted,
                or your best estimated max (the most you could likely lift once, worked out from a
                set). The first time you do an exercise sets the starting point.
              </p>
            }
          />
          <div className="grid gap-2 sm:grid-cols-2" data-recent-records>
            {recent.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-2xl border border-border p-3"
                data-record-card
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/12 text-warning">
                  <Trophy className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-foreground">
                    {r.exercise}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {fmt(r.day)} ·{" "}
                    {r.kinds.includes("weight") ? "heaviest ever" : "best estimated max yet"}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-[15px] font-semibold text-foreground">
                    {w(r.load)} {unit} × {r.reps}
                  </div>
                  <div className="text-[12px] text-success">up {r.gainPct}%</div>
                </div>
              </div>
            ))}
          </div>
          {lifetime.bestWeek && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Your best week for records: the week of {fmt(lifetime.bestWeek.monday)}, with{" "}
              {lifetime.bestWeek.records}.
            </p>
          )}
        </section>
      )}

      {meets.length > 0 && <MeetTimeline meets={meets} unit={unit} />}

      <ExerciseRecordList rows={byExercise} unit={unit} />
    </div>
  );
}

function Counter({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[28px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MeetTimeline({ meets, unit }: { meets: MeetResult[]; unit: "lb" | "kg" }) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));
  const [all, setAll] = useState(false);
  const shown = all ? meets : meets.slice(0, 5);
  return (
    <section aria-label="Competitions">
      <SectionTitle
        title="Competitions"
        sub={`${meets.length} meet${meets.length === 1 ? "" : "s"} on file`}
      />
      <ol className="relative ml-1.5 border-l border-border pl-5" data-meet-timeline>
        {shown.map((m, i) => {
          const prev = meets[i + 1];
          const diff = prev ? conv(m.total) - conv(prev.total) : null;
          return (
            <li key={`${m.date}-${m.name}`} className="relative pb-5 last:pb-0">
              <span
                className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-foreground bg-card"
                aria-hidden
              />
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-semibold text-foreground">
                  {m.name ?? "Competition"}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {fmt(m.date, "MMM d, yyyy")}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2 tabular-nums">
                <span className="text-[20px] font-semibold text-foreground">
                  {w(m.total).toLocaleString()}{" "}
                  <span className="text-[12px] font-medium text-muted-foreground">
                    {unit} total
                  </span>
                </span>
                {diff != null && Math.abs(diff) >= 0.5 && (
                  <span
                    className={cn(
                      "text-[12px]",
                      diff > 0 ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {diff > 0 ? "up" : "down"} {Math.abs(Math.round(diff))} {unit} from the meet
                    before
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] tabular-nums text-muted-foreground">
                {COMP_LIFTS.map((l) => (
                  <span key={l} className="inline-flex items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: LIFT_SERIES[l] }}
                      aria-hidden
                    />
                    {COMP_LIFT_LABEL[l]} {w(m.lifts[l])}
                  </span>
                ))}
                {m.bodyweightLb ? <span>Bodyweight {w(m.bodyweightLb)}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {meets.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-2 min-h-10 text-[13px] font-medium text-foreground"
        >
          Show all {meets.length} meets
        </button>
      )}
    </section>
  );
}

function ExerciseRecordList({ rows, unit }: { rows: ExerciseRecords[]; unit: "lb" | "kg" }) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(12);
  const filtered = q.trim()
    ? rows.filter((r) => r.exercise.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;
  if (!rows.length)
    return (
      <section aria-label="Records by exercise">
        <SectionTitle title="Records by exercise" />
        <p className="text-[13px] text-muted-foreground">
          No records yet. The first time you log an exercise sets its baseline; beating it is a
          record.
        </p>
      </section>
    );
  return (
    <section aria-label="Records by exercise">
      <SectionTitle
        title="Records by exercise"
        sub={`${rows.length} exercise${rows.length === 1 ? "" : "s"}, most recent first. Tap one to see each record.`}
      />
      {rows.length > 8 && (
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an exercise"
            className="h-10 pl-9"
            aria-label="Find an exercise"
          />
        </div>
      )}
      <ul className="divide-y divide-border/60" data-records-by-exercise>
        {filtered.slice(0, limit).map((r) => {
          const isOpen = open === r.key;
          const best = r.bestE1rm;
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.key)}
                aria-expanded={isOpen}
                className="flex min-h-12 w-full items-center gap-3 py-2.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-foreground">
                    {r.exercise}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {r.records.length} record{r.records.length === 1 ? "" : "s"} · last{" "}
                    {fmt(r.lastDay)}
                  </div>
                </div>
                {best && (
                  <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-foreground">
                    {w(best.load)} {unit} × {best.reps}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <ol
                  className="mb-3 space-y-1 border-l border-border pl-3 text-[12px] tabular-nums"
                  data-exercise-records={r.key}
                >
                  {[...r.records].reverse().map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{fmt(p.day)}</span>
                      <span className="text-foreground">
                        {w(p.load)} {unit} × {p.reps}
                        {p.rpe ? <span className="text-muted-foreground"> at RPE {p.rpe}</span> : null}
                        <span className="ml-2 text-success">up {p.gainPct}%</span>
                      </span>
                    </li>
                  ))}
                  {r.heaviest && (
                    <li className="pt-1 text-muted-foreground">
                      Heaviest ever: {w(r.heaviest.load)} {unit} × {r.heaviest.reps} (
                      {fmt(r.heaviest.day)})
                    </li>
                  )}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 24)}
          className="mt-1 min-h-10 text-[13px] font-medium text-foreground"
        >
          Show more
        </button>
      )}
    </section>
  );
}
