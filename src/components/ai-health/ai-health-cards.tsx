/**
 * Settings → AI & Cleo (Nov 23 2026): whether AI is answering and what it costs.
 *
 * AiHealthCard: OpenAI's status (answering, or paused since when and why, with what to do), what's
 * waiting on it, the last recovery, the open AI alerts and Check now.
 * AiUsageCard: estimated spend and calls per feature (7 or 30 days), the monthly trend (one series,
 * one axis, a value on hover and a table view), recent failures and the month's budget.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  aiHealthCheckNowFn,
  getAiHealthFn,
  getAiUsageFn,
  setAiBudgetFn,
  type AiHealthView,
  type AiUsageView,
} from "@/lib/ai/ai-usage.functions";

const TZ = "America/Winnipeg";
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso))
    : "";
const money = (n: number) =>
  n >= 100 ? `$${Math.round(n)}` : n >= 0.1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(3)}` : "$0";

const DOWN_WORDS: Record<string, { title: string; how: string }> = {
  credits: {
    title: "OpenAI credits ran out",
    how: "Add credits at platform.openai.com → Settings → Billing. Turning on auto-recharge there stops this happening again.",
  },
  auth: {
    title: "The OpenAI key was refused",
    how: "Check the OPENAI_API_KEY secret in the project's settings.",
  },
  outage: {
    title: "OpenAI isn't answering",
    how: "It usually comes back by itself. Nothing to do yet.",
  },
};

export function AiHealthCard() {
  const getFn = useServerFn(getAiHealthFn);
  const checkFn = useServerFn(aiHealthCheckNowFn);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-health"], queryFn: () => getFn(), refetchInterval: 60_000 });
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const view = await checkFn();
      qc.setQueryData(["ai-health"], view);
      toast.success(
        view.openai.status === "ok" ? "OpenAI is answering" : "Still paused: OpenAI didn't answer",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't check");
    } finally {
      setChecking(false);
    }
  };
  const d = q.data as AiHealthView | undefined;
  const down = d && d.openai.status !== "ok";
  const words = down ? DOWN_WORDS[d!.openai.status] : null;
  const waiting = d
    ? [
        [d.waiting.coachingReplies, "coaching reply", "coaching replies"],
        [d.waiting.checkinRecaps, "check-in recap", "check-in recaps"],
        [d.waiting.athleteInsights, "Athlete Insight", "Athlete Insights"],
      ]
        .filter(([n]) => (n as number) > 0)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
        .join(", ")
    : "";
  const recentRecovery =
    d?.openai.recoveryDoneAt &&
    Date.now() - new Date(d.openai.recoveryDoneAt).getTime() < 7 * 86_400_000
      ? d.openai.recoverySummary
      : null;
  const otherAlerts = (d?.alerts ?? []).filter((a) => a.type !== "ai_unavailable");
  return (
    <Card className="space-y-3 p-4" data-ai-health>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">AI status</h2>
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          onClick={check}
          disabled={checking || !d}
        >
          {checking ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}{" "}
          Check now
        </Button>
      </div>
      {q.isLoading || !d ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : down ? (
        <div className="rounded-xl border border-warning/50 bg-warning/5 p-3" data-ai-down>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 space-y-1 text-[13px]">
              <div className="font-semibold">
                {words?.title} · paused since {when(d.openai.since)}
              </div>
              <p className="text-muted-foreground">{words?.how}</p>
              <p className="text-muted-foreground">
                {waiting ? `Waiting: ${waiting}. ` : ""}Everything waiting is redone by itself once
                OpenAI answers (checked every 10 minutes, or tap Check now). Replies still wait for
                your OK, and nothing is sent in the meantime.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-[13px]" data-ai-ok>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div>
            <div className="font-semibold">OpenAI is answering</div>
            {!d.keySet && (
              <p className="text-destructive">No OpenAI key is set up on the server.</p>
            )}
            {d.openai.lastOkAt && (
              <p className="text-muted-foreground">Last answer {when(d.openai.lastOkAt)}.</p>
            )}
          </div>
        </div>
      )}
      {recentRecovery && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-[12px]" data-ai-recovery>
          <span className="font-semibold">Back since {when(d!.openai.recoveredAt)}.</span>{" "}
          {recentRecovery}
        </p>
      )}
      {otherAlerts.length > 0 && (
        <ul className="space-y-1.5" data-ai-alerts>
          {otherAlerts.map((a) => (
            <li
              key={a.type}
              className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-[12px]"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${m}-15T12:00:00Z`),
  );

/** The monthly trend: one series (estimated spend), one axis, a value on hover or focus, a table view. */
function MonthlyTrend({ months }: { months: AiUsageView["months"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!months.length)
    return <p className="text-[13px] text-muted-foreground">No calls on record yet.</p>;
  const max = Math.max(...months.map((m) => m.cost), 0.01);
  const shown = hover ?? months.length - 1;
  const m = months[shown];
  return (
    <div className="space-y-2" data-ai-monthly>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px]">
          <span className="font-semibold">{monthLabel(m.month)}</span>
          <span className="text-muted-foreground">
            {" "}
            · {money(m.cost)} est. · {m.calls.toLocaleString()} calls
            {m.failed ? ` · ${m.failed} failed` : ""}
            {m.gatewayCost > 0 ? ` · ${money(m.gatewayCost)} of it on Lovable credits` : ""}
          </span>
        </div>
        <button
          type="button"
          className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setTable((t) => !t)}
        >
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-[12px]">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-normal">Month</th>
              <th className="pr-2 text-right font-normal">Est. spend</th>
              <th className="pr-2 text-right font-normal">Calls</th>
              <th className="text-right font-normal">Failed</th>
            </tr>
          </thead>
          <tbody>
            {months.map((x) => (
              <tr key={x.month} className="border-t border-border/50">
                <td className="py-1 pr-2">{monthLabel(x.month)}</td>
                <td className="pr-2 text-right tabular-nums">{money(x.cost)}</td>
                <td className="pr-2 text-right tabular-nums">{x.calls.toLocaleString()}</td>
                <td className="text-right tabular-nums">{x.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          <div
            className="flex h-28 items-end gap-[2px] border-b border-border/70"
            role="list"
            aria-label="Estimated AI spend by month"
          >
            {months.map((x, i) => (
              <button
                key={x.month}
                type="button"
                role="listitem"
                aria-label={`${monthLabel(x.month)}: ${money(x.cost)} estimated, ${x.calls} calls`}
                className="group flex h-full min-w-0 flex-1 items-end focus:outline-none"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span
                  className={cn(
                    "block w-full rounded-t-[4px] transition-opacity",
                    hover != null && hover !== i ? "opacity-50" : "opacity-100",
                    "group-focus-visible:ring-2 group-focus-visible:ring-ring",
                  )}
                  style={{
                    height: `${Math.max(2, (x.cost / max) * 100)}%`,
                    background: "var(--money-out)",
                  }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] text-[10px] text-muted-foreground">
            {months.map((x, i) => (
              <span key={x.month} className="min-w-0 flex-1 truncate text-center">
                {i === 0 || i === months.length - 1 || months.length <= 6
                  ? monthLabel(x.month)
                  : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AiUsageCard() {
  const getFn = useServerFn(getAiUsageFn);
  const budgetFn = useServerFn(setAiBudgetFn);
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["ai-usage", days], queryFn: () => getFn({ data: { days } }) });
  const d = q.data as AiUsageView | undefined;
  const [budget, setBudget] = useState<string | null>(null);
  const saveBudget = async () => {
    const n = Number(budget ?? "");
    if (budget !== "" && (!Number.isFinite(n) || n < 0))
      return toast.error("Enter a dollar amount, or leave it empty for no budget");
    try {
      await budgetFn({ data: { monthlyUsd: budget === "" ? null : n } });
      toast.success(
        budget === "" || n === 0 ? "Budget alerts off" : `Alerts at 80% and 100% of $${n}`,
      );
      setBudget(null);
      await q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the budget");
    }
  };
  return (
    <Card className="space-y-4 p-4" data-ai-usage>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">AI use and cost</h2>
        <div className="flex rounded-lg bg-secondary p-0.5 text-[12px]" role="tablist">
          {[7, 30].map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={days === n}
              className={cn(
                "rounded-md px-2.5 py-1",
                days === n ? "bg-background font-semibold shadow-none" : "text-muted-foreground",
              )}
              onClick={() => setDays(n)}
            >
              {n} days
            </button>
          ))}
        </div>
      </div>
      {q.isLoading || !d ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/50 px-2 py-2">
              <div className="text-[17px] font-semibold tabular-nums">{money(d.totals.cost)}</div>
              <div className="text-[11px] text-muted-foreground">est. spend</div>
            </div>
            <div className="rounded-lg bg-muted/50 px-2 py-2">
              <div className="text-[17px] font-semibold tabular-nums">
                {d.totals.calls.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">calls</div>
            </div>
            <div className="rounded-lg bg-muted/50 px-2 py-2">
              <div className="text-[17px] font-semibold tabular-nums">{d.totals.failed}</div>
              <div className="text-[11px] text-muted-foreground">
                failed{d.totals.paused ? ` · ${d.totals.paused} paused` : ""}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-[13px] font-semibold">By feature, most expensive first</h3>
            {d.features.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No calls in the last {d.days} days.
              </p>
            ) : (
              <ul className="divide-y divide-border/60" data-ai-features>
                {d.features.map((f) => (
                  <li key={f.key} className="py-2">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 font-medium">{f.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {f.unpriced >= f.calls && f.cost === 0 ? "—" : money(f.cost)}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.calls.toLocaleString()} calls
                      {f.perCall != null ? ` · ${money(f.perCall)} each` : ""}
                      {f.avgSeconds != null ? ` · ${f.avgSeconds}s` : ""}
                      {f.failed ? ` · ${f.failed} failed` : ""}
                      {f.unpriced > 0 ? ` · ${f.unpriced} with no price on file` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1">
            <h3 className="text-[13px] font-semibold">Estimated spend by month</h3>
            <MonthlyTrend months={d.months} />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-[13px] font-semibold">Monthly budget</h3>
            <p className="text-[12px] text-muted-foreground">
              You get an alert at 80% and 100% of it (an estimate from published prices; OpenAI's
              own bill is the final word). Leave empty for no budget.
            </p>
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                placeholder="e.g. 50"
                className="h-10 max-w-[140px]"
                value={budget ?? (d.budget ? String(d.budget) : "")}
                onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                aria-label="Monthly AI budget in US dollars"
              />
              <Button
                size="sm"
                className="h-10"
                variant="outline"
                onClick={saveBudget}
                disabled={budget == null}
              >
                Save
              </Button>
            </div>
          </div>
          {d.errors.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer font-semibold">
                Recent failures ({d.errors.length})
              </summary>
              <ul className="mt-1 space-y-1">
                {d.errors.map((e, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">
                      {when(e.at)} · {e.task} · {e.model}:
                    </span>{" "}
                    {String(e.error ?? e.failure ?? "").slice(0, 200)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[11px] text-muted-foreground">
            Estimated from published prices (GPT-5.5 $5 / $30, GPT-5 mini $0.25 / $2 per million
            tokens in / out, cached input at its lower rate). Calls through Lovable's gateway bill
            Lovable credits. A call with no price on file shows its count, never a guess.
          </p>
        </>
      )}
    </Card>
  );
}
