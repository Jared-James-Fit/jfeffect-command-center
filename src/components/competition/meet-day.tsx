/**
 * The meet-day command centre (Nov 24 2026): a handler's screen, full screen,
 * one-handed. Our athlete's attempts logged in two taps (weight, good or no
 * lift, optional RPE and bar speed), the next attempt the confirmed plan's
 * conditions point to, the warm-ups for the lift that's on, the live standings
 * from what's logged, and the exact deadlift for a placing, a qualifying total
 * or a record, worked out by code (scenarios.ts), never by a model. Nothing is
 * ever submitted to the meet: the official attempt is the coach's to hand in.
 *
 * Venues have bad signal: every entry shows at once and is kept on the phone
 * until the server has it (a queue retried when the connection's back; the
 * server keeps one row per lifter, lift and attempt, so a re-send never
 * duplicates). The last read of the plan stays on the phone for offline use.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, CloudOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/loading";
import { getMeetDayFn, logAttemptFn } from "@/lib/competition/competition.functions";
import {
  deadliftForPlace,
  deadliftForTotal,
  deadliftToBeat,
  standings,
  bestMade,
  type Entrant,
  type LiveAttempt,
} from "@/lib/competition/scenarios";
import { LIFT_LABEL, type Lift } from "@/lib/competition/types";
import { readRules, toLb } from "@/lib/competition/rules";
import { ordinal } from "@/lib/competition/landscape";
import { cn } from "@/lib/utils";

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
type Entry = {
  entrant: string;
  lift: Lift;
  attempt: number;
  kg: number | null;
  result: "good" | "no_lift" | "pending";
  rpe?: number | null;
  velocity?: number | null;
  note?: string | null;
  clientKey: string;
  pending?: boolean;
};
const keyOf = (e: Pick<Entry, "entrant" | "lift" | "attempt">) =>
  `${e.entrant}|${e.lift}|${e.attempt}`;

function useQueue(competitionId: string) {
  const storeKey = `jf-meetday-queue:${competitionId}`;
  const read = (): Entry[] => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? "[]");
    } catch {
      return [];
    }
  };
  const write = (xs: Entry[]) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(xs));
    } catch {
      // storage full or blocked: the entry stays on screen and is retried while the page is open
    }
  };
  return { read, write };
}

/** The next attempt the confirmed plan's conditions point to, from how the last one went. */
export function nextFromPlan(
  plan: any,
  lift: Lift,
  attempts: LiveAttempt[],
  rpes: Array<number | null>,
  increment: number,
): { kg: number | null; why: string } {
  const a = plan?.attempts?.lifts?.[lift];
  if (!a) return { kg: null, why: "No plan for this lift" };
  const taken = attempts.filter((x) => x.result === "good" || x.result === "no_lift");
  if (!taken.length) return { kg: a.opener, why: "The planned opener" };
  const i = taken.length; // next attempt index (1 = second)
  if (i >= 3) return { kg: null, why: "All three taken" };
  const last = taken[taken.length - 1];
  const rpe = rpes[taken.length - 1];
  if (last.result === "no_lift")
    return { kg: last.kg, why: "Missed: repeat the same weight (it can't go lower)" };
  const path =
    rpe == null
      ? a.pathways.balanced
      : rpe <= 7
        ? a.pathways.aggressive
        : rpe <= 8.5
          ? a.pathways.balanced
          : a.pathways.conservative;
  const pick = Math.max(path[i], (last.kg ?? 0) + increment);
  const why =
    rpe == null
      ? "Balanced pathway (no RPE logged)"
      : rpe <= 7
        ? `RPE ${rpe}: aggressive pathway`
        : rpe <= 8.5
          ? `RPE ${rpe}: balanced pathway`
          : `RPE ${rpe}: conservative pathway`;
  return { kg: pick, why };
}

export function MeetDayCommandCentre({ competitionId }: { competitionId: string }) {
  const read = useServerFn(getMeetDayFn);
  const log = useServerFn(logAttemptFn);
  const qc = useQueryClient();
  const queue = useQueue(competitionId);
  const q = useQuery({
    queryKey: ["competition-meetday", competitionId],
    queryFn: () => read({ data: { competitionId } }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const [local, setLocal] = useState<Record<string, Entry>>({});
  const [lift, setLift] = useState<Lift>("squat");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [assume, setAssume] = useState<"current" | "ceiling">("ceiling");
  const [goal, setGoal] = useState<string>("place:1");
  const [customTotal, setCustomTotal] = useState("");

  // entries waiting on the server come back after a reload
  useEffect(() => {
    const waiting = queue.read();
    if (waiting.length)
      setLocal((m) => ({
        ...Object.fromEntries(waiting.map((e) => [keyOf(e), { ...e, pending: true }])),
        ...m,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId]);

  const flush = useCallback(async () => {
    const waiting = queue.read();
    if (!waiting.length) return;
    const left: Entry[] = [];
    for (const e of waiting) {
      try {
        await log({
          data: {
            competitionId,
            entrant: e.entrant,
            lift: e.lift,
            attempt: e.attempt,
            kg: e.kg,
            result: e.result,
            rpe: e.rpe ?? null,
            velocity: e.velocity ?? null,
            note: e.note ?? null,
            clientKey: e.clientKey,
          },
        });
        setLocal((m) =>
          m[keyOf(e)]?.clientKey === e.clientKey
            ? { ...m, [keyOf(e)]: { ...m[keyOf(e)], pending: false } }
            : m,
        );
      } catch {
        left.push(e);
      }
    }
    queue.write(left);
    if (left.length < waiting.length)
      void qc.invalidateQueries({ queryKey: ["competition-meetday", competitionId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, log, qc]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void flush();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t = window.setInterval(() => void flush(), 15_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.clearInterval(t);
    };
  }, [flush]);

  const record = (e: Omit<Entry, "clientKey">) => {
    const entry: Entry = { ...e, clientKey: `${keyOf(e)}:${Date.now()}`, pending: true };
    setLocal((m) => ({ ...m, [keyOf(e)]: entry }));
    queue.write([...queue.read().filter((x) => keyOf(x) !== keyOf(e)), entry]);
    void flush();
  };

  const data = q.data as any;
  const rules = data ? readRules(data.competition?.rules, data.competition?.federation) : null;

  // server rows overlaid by what's on this phone and not yet confirmed
  const merged = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const r of (data?.log ?? []) as any[])
      m.set(keyOf(r), {
        entrant: r.entrant,
        lift: r.lift,
        attempt: r.attempt,
        kg: r.kg != null ? Number(r.kg) : null,
        result: r.result,
        rpe: r.rpe,
        velocity: r.velocity,
        note: r.note,
        clientKey: r.client_key ?? r.id,
      });
    for (const [k, e] of Object.entries(local)) if (e.pending || !m.has(k)) m.set(k, e);
    return m;
  }, [data, local]);

  const attemptsOf = (entrant: string, l: Lift): LiveAttempt[] =>
    [1, 2, 3].map((n) => {
      const e = merged.get(`${entrant}|${l}|${n}`);
      return { kg: e?.kg ?? null, result: e?.result ?? null };
    });
  const rpesOf = (entrant: string, l: Lift) =>
    [1, 2, 3].map((n) => merged.get(`${entrant}|${l}|${n}`)?.rpe ?? null);

  const entrants: Entrant[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        id: "us",
        name: data.athlete,
        us: true,
        bodyweight:
          data.competition?.weigh_in_kg != null ? Number(data.competition.weigh_in_kg) : null,
        attempts: {
          squat: attemptsOf("us", "squat"),
          bench: attemptsOf("us", "bench"),
          deadlift: attemptsOf("us", "deadlift"),
        },
      },
      ...((data.field ?? []) as any[]).map((f) => ({
        id: f.id,
        name: f.name,
        bodyweight: f.bodyweight != null ? Number(f.bodyweight) : null,
        attempts: {
          squat: attemptsOf(f.id, "squat"),
          bench: attemptsOf(f.id, "bench"),
          deadlift: attemptsOf(f.id, "deadlift"),
        },
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, merged]);

  if (q.isLoading) {
    return (
      <div className="fixed inset-0 z-50 space-y-3 bg-background p-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.error || !data || !rules)
    return (
      <div className="fixed inset-0 z-50 bg-background p-4">
        <ErrorState error={q.error} what="the meet day" onRetry={() => void q.refetch()} />
      </div>
    );

  const comp = data.competition;
  const plan = data.plan;
  const table = standings(entrants);
  const us = table.find((s) => s.id === "us");
  const highDl = plan?.forecast?.lifts?.deadlift?.range?.high ?? null;
  const need = (() => {
    if (goal.startsWith("place:"))
      return deadliftForPlace({
        entrants,
        usId: "us",
        place: Number(goal.slice(6)),
        rules,
        assume,
        ourHighDeadlift: highDl,
      });
    if (goal.startsWith("beat:"))
      return deadliftToBeat({
        entrants,
        usId: "us",
        rivalId: goal.slice(5),
        rules,
        assume,
        ourHighDeadlift: highDl,
      });
    if (goal === "qualify" && comp.qualification_total_kg)
      return deadliftForTotal({
        entrant: entrants[0],
        target: Number(comp.qualification_total_kg),
        rules,
        goal: "Qualify",
        ourHighDeadlift: highDl,
      });
    if (goal === "target" && comp.target_total_kg)
      return deadliftForTotal({
        entrant: entrants[0],
        target: Number(comp.target_total_kg),
        rules,
        goal: "Target total",
        ourHighDeadlift: highDl,
      });
    if (goal === "custom" && Number(customTotal) > 0)
      return deadliftForTotal({
        entrant: entrants[0],
        target: Number(customTotal),
        rules,
        goal: `${customTotal} kg total`,
        ourHighDeadlift: highDl,
      });
    return null;
  })();
  const next = nextFromPlan(
    plan,
    lift,
    attemptsOf("us", lift),
    rpesOf("us", lift),
    rules.incrementKg,
  );
  const warm = plan?.warmups?.[lift];
  const pendingCount = Object.values(local).filter((e) => e.pending).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-meet-day>
      <header className="flex items-center gap-2 border-b border-border px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Link
          to="/admin/clients/$id"
          params={{ id: comp.client_id }}
          search={{ tab: "competition" } as any}
          className="grid h-10 w-10 place-items-center rounded-lg hover:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">
            {data.athlete} · {comp.name}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {plan
              ? plan.confirmed
                ? `Confirmed game plan v${plan.version}`
                : `Game plan v${plan.version}, not approved yet`
              : "No game plan"}{" "}
            · {rules.confirmed ? "rules confirmed" : "rules not confirmed"}
          </p>
        </div>
        {!online || pendingCount ? (
          <span
            className="flex items-center gap-1 rounded-full border border-warning/50 px-2 py-1 text-[11px] text-warning"
            data-meet-day-offline
          >
            <CloudOff className="h-3.5 w-3.5" />{" "}
            {pendingCount ? `${pendingCount} to send` : "Offline"}
          </span>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1" role="tablist">
            {LIFTS.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={lift === l}
                onClick={() => setLift(l)}
                className={cn(
                  "h-11 rounded-lg text-[15px]",
                  lift === l ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
                )}
              >
                {LIFT_LABEL[l]}
              </button>
            ))}
          </div>

          <section className="rounded-2xl border border-border bg-card p-3" data-meet-day-us>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[16px] font-semibold">{LIFT_LABEL[lift]}</h2>
              <p className="text-[13px] text-muted-foreground">
                Total so far{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {us?.subtotal ?? 0} kg
                </span>
                {us?.place ? ` · ${ordinal(us.place)}` : ""}
              </p>
            </div>
            <div className="mt-3 rounded-xl bg-muted/60 p-3">
              <p className="text-[12px] text-muted-foreground">Next attempt</p>
              <p className="text-[26px] font-semibold tabular-nums leading-tight">
                {next.kg != null ? `${next.kg} kg` : "—"}
                <span className="ml-2 text-[14px] font-normal text-muted-foreground">
                  {next.kg != null ? `${toLb(next.kg)} lb` : ""}
                </span>
              </p>
              <p className="text-[12px] text-muted-foreground">
                {next.why}
                {rules.declareSeconds
                  ? ` · declare within ${rules.declareSeconds >= 60 ? `${rules.declareSeconds / 60} minute` : `${rules.declareSeconds} s`}`
                  : ""}
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {[1, 2, 3].map((n) => (
                <AttemptRow
                  key={n}
                  n={n}
                  entry={merged.get(`us|${lift}|${n}`) ?? null}
                  suggested={
                    n ===
                    attemptsOf("us", lift).filter(
                      (x) => x.result === "good" || x.result === "no_lift",
                    ).length +
                      1
                      ? next.kg
                      : null
                  }
                  onSave={(e) => record({ entrant: "us", lift, attempt: n, ...e })}
                />
              ))}
            </div>
          </section>

          {warm ? (
            <section className="rounded-2xl border border-border bg-card p-3">
              <h3 className="text-[15px] font-semibold">Warm-ups</h3>
              <ol className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-3">
                {warm.sets.map((s: any, i: number) => (
                  <li key={i} className="tabular-nums">
                    <span className="font-medium">{s.kg}</span> × {s.reps}
                    <span className="ml-1 text-[12px] text-muted-foreground">
                      {s.minutesBefore} min
                    </span>
                  </li>
                ))}
              </ol>
              {warm.timing?.[1] ? (
                <p className="mt-2 text-[12px] text-muted-foreground">{warm.timing[1]}</p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-border bg-card p-3" data-meet-day-standings>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">Standings</h3>
              <div className="inline-flex rounded-lg bg-secondary p-0.5 text-[12px]">
                {(["current", "ceiling"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAssume(a)}
                    className={cn(
                      "rounded-md px-2 py-1",
                      assume === a
                        ? "bg-background font-medium shadow-sm"
                        : "text-muted-foreground",
                    )}
                  >
                    {a === "current" ? "As it stands" : "If declared attempts go"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Logged by hand here. Live results platforms aren't connected; projections are shown
              only before someone lifts.
            </p>
            <ul className="mt-2 divide-y divide-border">
              {table.map((s) => {
                const f = (data.field as any[]).find((x) => x.id === s.id);
                return (
                  <li key={s.id} className={cn("py-2", s.us && "font-medium")}>
                    <div className="flex items-center justify-between gap-2 text-[14px]">
                      <span className="min-w-0 truncate">
                        {s.place ? `${s.place}. ` : ""}
                        {s.name}
                        {s.us ? " (ours)" : ""}
                        {s.bodyweight ? (
                          <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                            {s.bodyweight} kg BW
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {s.bombed ? (
                          "No total"
                        ) : s.total != null ? (
                          `${s.total} kg`
                        ) : s.subtotal ? (
                          `${s.subtotal} so far`
                        ) : f?.projection ? (
                          <span className="text-muted-foreground">
                            proj. {f.projection.expected}
                          </span>
                        ) : (
                          "—"
                        )}
                        {assume === "ceiling" && s.ceiling && s.ceiling !== s.total ? (
                          <span className="ml-1 text-[12px] text-muted-foreground">
                            → {s.ceiling}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {!s.us ? (
                      <RivalRow
                        entry={(n) => merged.get(`${s.id}|${lift}|${n}`) ?? null}
                        onSave={(n, e) => record({ entrant: s.id, lift, attempt: n, ...e })}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3" data-meet-day-scenarios>
            <h3 className="text-[15px] font-semibold">What do we need?</h3>
            <select
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px]"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            >
              {[1, 2, 3].map((p) => (
                <option key={p} value={`place:${p}`}>
                  {ordinal(p)} place
                </option>
              ))}
              {(data.field as any[]).map((f) => (
                <option key={f.id} value={`beat:${f.id}`}>
                  Beat {f.name}
                </option>
              ))}
              {comp.qualification_total_kg ? (
                <option value="qualify">Qualifying total ({comp.qualification_total_kg} kg)</option>
              ) : null}
              {comp.target_total_kg ? (
                <option value="target">Target total ({comp.target_total_kg} kg)</option>
              ) : null}
              <option value="custom">A total…</option>
            </select>
            {goal === "custom" ? (
              <input
                className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px]"
                inputMode="decimal"
                placeholder="Total in kg"
                value={customTotal}
                onChange={(e) => setCustomTotal(e.target.value)}
              />
            ) : null}
            {need ? (
              <div
                className={cn(
                  "mt-3 rounded-xl p-3",
                  need.possible ? "bg-muted/60" : "bg-warning/10",
                )}
              >
                <p className="text-[12px] text-muted-foreground">Deadlift needed</p>
                <p className="text-[26px] font-semibold tabular-nums leading-tight">
                  {need.deadlift != null ? `${need.deadlift} kg` : "—"}
                </p>
                <p className="text-[13px]">{need.why}</p>
                {need.total ? (
                  <p className="text-[12px] text-muted-foreground">Total {need.total} kg</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-muted-foreground">Pick a goal.</p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Worked out from the attempts logged here and the rules on file
              {rules.confirmed ? "" : " (not confirmed for this meet)"}. Never submitted for you.
            </p>
          </section>

          {bestMade(attemptsOf("us", "deadlift")) != null && us?.total ? (
            <p className="text-center text-[13px] text-muted-foreground">
              Final total {us.total} kg. Save the results from the Competition tab's History to
              write the debrief.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AttemptRow({
  n,
  entry,
  suggested,
  onSave,
}: {
  n: number;
  entry: Entry | null;
  suggested: number | null;
  onSave: (e: {
    kg: number | null;
    result: Entry["result"];
    rpe?: number | null;
    velocity?: number | null;
  }) => void;
}) {
  const [kg, setKg] = useState<string>(entry?.kg != null ? String(entry.kg) : "");
  const [rpe, setRpe] = useState<string>(entry?.rpe != null ? String(entry.rpe) : "");
  useEffect(() => {
    if (entry?.kg != null) setKg(String(entry.kg));
    if (entry?.rpe != null) setRpe(String(entry.rpe));
  }, [entry?.kg, entry?.rpe]);
  const val = Number(kg) || (suggested ?? null);
  const save = (result: Entry["result"]) => onSave({ kg: val, result, rpe: Number(rpe) || null });
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border p-2",
        entry?.result === "good"
          ? "border-success/50"
          : entry?.result === "no_lift"
            ? "border-destructive/40"
            : "border-border",
      )}
      data-attempt-row={n}
    >
      <span className="w-7 text-center text-[13px] text-muted-foreground">{n}</span>
      <input
        className="h-11 w-24 rounded-lg border border-input bg-background px-2 text-[17px] font-semibold tabular-nums"
        inputMode="decimal"
        placeholder={suggested != null ? String(suggested) : "kg"}
        value={kg}
        onChange={(e) => setKg(e.target.value)}
        aria-label={`Attempt ${n} kg`}
      />
      <input
        className="h-11 w-14 rounded-lg border border-input bg-background px-2 text-[15px] tabular-nums"
        inputMode="decimal"
        placeholder="RPE"
        value={rpe}
        onChange={(e) => setRpe(e.target.value)}
        aria-label={`Attempt ${n} RPE`}
      />
      <div className="ml-auto flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={entry?.result === "good" ? "default" : "outline"}
          className="h-11 w-12"
          disabled={val == null}
          onClick={() => save("good")}
          aria-label="Good lift"
        >
          <Check className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "h-11 w-12",
            entry?.result === "no_lift" && "border-destructive text-destructive",
          )}
          disabled={val == null}
          onClick={() => save("no_lift")}
          aria-label="No lift"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      {entry?.pending ? <span className="text-[10px] text-muted-foreground">saving</span> : null}
    </div>
  );
}

function RivalRow({
  entry,
  onSave,
}: {
  entry: (n: number) => Entry | null;
  onSave: (n: number, e: { kg: number | null; result: Entry["result"] }) => void;
}) {
  return (
    <div className="mt-1 flex gap-1">
      {[1, 2, 3].map((n) => {
        const e = entry(n);
        return <RivalCell key={n} e={e} onSave={(x) => onSave(n, x)} />;
      })}
    </div>
  );
}

function RivalCell({
  e,
  onSave,
}: {
  e: Entry | null;
  onSave: (x: { kg: number | null; result: Entry["result"] }) => void;
}) {
  const [kg, setKg] = useState(e?.kg != null ? String(e.kg) : "");
  useEffect(() => {
    if (e?.kg != null) setKg(String(e.kg));
  }, [e?.kg]);
  const next = (r: Entry["result"] | null): Entry["result"] =>
    r === "pending" || r == null ? "good" : r === "good" ? "no_lift" : "pending";
  return (
    <div
      className={cn(
        "flex flex-1 items-center gap-1 rounded-lg border px-1",
        e?.result === "good"
          ? "border-success/50"
          : e?.result === "no_lift"
            ? "border-destructive/40"
            : "border-border",
      )}
    >
      <input
        className="h-9 w-full min-w-0 bg-transparent px-1 text-[13px] tabular-nums outline-none"
        inputMode="decimal"
        placeholder="kg"
        value={kg}
        onChange={(x) => setKg(x.target.value)}
        onBlur={() =>
          Number(kg) > 0 &&
          Number(kg) !== e?.kg &&
          onSave({ kg: Number(kg), result: e?.result ?? "pending" })
        }
      />
      <button
        type="button"
        className="h-9 shrink-0 px-1 text-[11px] text-muted-foreground"
        disabled={!(Number(kg) > 0)}
        onClick={() => onSave({ kg: Number(kg), result: next(e?.result ?? null) })}
        aria-label="Change result"
      >
        {e?.result === "good" ? "✓" : e?.result === "no_lift" ? "✗" : "…"}
      </button>
    </div>
  );
}
