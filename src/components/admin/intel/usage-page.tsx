/**
 * Usage & spend (/admin/usage): what AI and texts cost, what they're for, how reliably they work,
 * and the limits that protect the month. One read (getUsageViewFn); every number is from the
 * ledgers (ai_call_log, sms_log), estimates say they're estimates.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getUsageViewFn, type UsageView } from "@/lib/admin-intel/usage.functions";
import { aiHealthCheckNowFn, setAiBudgetFn } from "@/lib/ai/ai-usage.functions";
import { updateSmsSettings } from "@/lib/sms.functions";
import { AREA_LABEL, perOp, usd, type AreaKey } from "@/lib/admin-intel/usage-model";
import {
  AlertList,
  Definitions,
  IntelSection,
  Kpi,
  Meter,
  PeriodSwitch,
  RankRows,
  StackedDays,
} from "./intel-ui";

const DAYS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

export function UsagePage() {
  const [days, setDays] = useState<number>(30);
  const fetchView = useServerFn(getUsageViewFn);
  const q = useQuery({
    queryKey: ["admin-usage", days],
    queryFn: () => fetchView({ data: { days } }) as Promise<UsageView>,
    refetchInterval: 120_000,
    placeholderData: (p) => p,
  });
  const v = q.data;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-28 pt-2 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          What AI and texts cost, what they're used for, and the limits that protect the month. Estimates from published prices; Twilio's own bill when it's read.
        </p>
        <PeriodSwitch value={days} options={DAYS as any} onChange={setDays} label="Period" />
      </div>

      {q.isLoading && !v ? (
        <UsageSkeleton />
      ) : q.error && !v ? (
        <IntelSection title="Couldn't load usage">
          <p className="text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</p>
          <Button className="mt-3" variant="outline" onClick={() => q.refetch()}>Try again</Button>
        </IntelSection>
      ) : v ? (
        <UsageBody v={v} days={days} refreshing={q.isFetching} />
      ) : null}
    </div>
  );
}

function UsageBody({ v, days, refreshing }: { v: UsageView; days: number; refreshing: boolean }) {
  const [area, setArea] = useState<AreaKey | null>(null);
  const aiMonthTone = v.ai.month.level === "over" ? "bad" : v.ai.month.level === "close" ? "warn" : "neutral";
  const smsMonthTone = v.sms.month.level === "over" ? "bad" : v.sms.month.level === "close" ? "warn" : "neutral";
  const waiting = v.ai.waiting.coachingReplies + v.ai.waiting.checkinRecaps + v.ai.waiting.athleteInsights + v.ai.waiting.postDecks;
  const features = area ? v.features.filter((f) => f.area === area) : v.features;
  const purposes = area ? v.sms.purposes.filter((p) => p.area === area) : v.sms.purposes;
  const deliveryRate = v.sms.funnel.sent ? Math.round((v.sms.funnel.delivered / v.sms.funnel.sent) * 100) : null;

  return (
    <div className={cn("space-y-4 transition-opacity", refreshing && "opacity-90")}>
      <AlertList alerts={v.alerts} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="AI this month"
          value={usd(v.ai.month.spent)}
          tone={aiMonthTone}
          meter={v.ai.month.budget ? { pct: v.ai.month.pct, marks: [80] } : null}
          sub={
            v.ai.month.budget
              ? `${v.ai.month.pct}% of $${v.ai.month.budget.toFixed(0)} · on pace for ${usd(v.ai.month.projected)}`
              : `On pace for ${usd(v.ai.month.projected)} · no budget set`
          }
        />
        <Kpi
          label="Texts this month"
          value={`$${v.sms.month.spent.toFixed(2)}`}
          tone={smsMonthTone}
          meter={v.sms.month.budget ? { pct: v.sms.month.pct, marks: [80] } : null}
          sub={
            <>
              CAD · {v.sms.month.budget ? `${v.sms.month.pct}% of $${v.sms.month.budget.toFixed(0)}` : "no budget"}
              {v.sms.month.actualCad != null && <> · Twilio's bill ${v.sms.month.actualCad.toFixed(2)}</>}
            </>
          }
        />
        <Kpi
          label="AI working"
          value={v.ai.status === "ok" ? (v.totals.aiSuccess != null ? `${v.totals.aiSuccess}%` : "—") : "Paused"}
          tone={v.ai.status !== "ok" ? "bad" : v.totals.aiSuccess != null && v.totals.aiSuccess < 90 ? "warn" : "neutral"}
          sub={
            v.ai.status !== "ok"
              ? `${waiting} job${waiting === 1 ? "" : "s"} waiting`
              : `${v.totals.aiCalls.toLocaleString()} calls answered or failed · ${waiting ? `${waiting} waiting` : "nothing waiting"}`
          }
        />
        <Kpi
          label="Texts delivered"
          value={deliveryRate != null ? `${deliveryRate}%` : "—"}
          tone={v.sms.funnel.sent >= 10 && v.sms.funnel.undelivered / Math.max(1, v.sms.funnel.sent) >= 0.05 ? "warn" : "neutral"}
          sub={`${v.sms.funnel.sent} sent · ${v.sms.funnel.unconfirmed} not confirmed yet · ${v.sms.funnel.byPush} skipped (push got there)`}
        />
      </div>

      <IntelSection
        title="Spend by day"
        sub={
          <>
            US$, last {days} days: AI {usd(v.totals.ai)}
            {v.totals.aiChange != null && <> ({signed(v.totals.aiChange)} vs the {days} days before)</>}, texts {usd(v.totals.sms)}
            {v.totals.smsChange != null && <> ({signed(v.totals.smsChange)})</>}.
          </>
        }
      >
        <StackedDays
          rows={v.daily}
          series={[
            { key: "ai", label: "AI (estimated)", color: "var(--viz-1)" },
            { key: "sms", label: "Texts", color: "var(--viz-2)" },
          ]}
          format={(n) => (n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`)}
          ariaLabel={`AI and text spend by day for the last ${days} days`}
        />
        {v.totals.aiUnpriced > 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {v.totals.aiUnpriced} AI call{v.totals.aiUnpriced === 1 ? " has" : "s have"} no published price on file (counted, not costed).
          </p>
        )}
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-5">
        <IntelSection
          id="areas"
          className="lg:col-span-2"
          title="Where it goes"
          sub="Tap an area to see only its features and texts."
        >
          <RankRows
            rows={v.areas.map((a) => ({
              key: a.key,
              label: a.label,
              sub: [a.calls ? `${a.calls} AI` : "", a.texts ? `${a.texts} texts` : ""].filter(Boolean).join(" · "),
              values: [a.ai, a.sms],
            }))}
            parts={[
              { label: "AI", color: "var(--viz-1)" },
              { label: "Texts", color: "var(--viz-2)" },
            ]}
            format={(n) => usd(n)}
            onPick={setArea}
            picked={area}
          />
        </IntelSection>

        <IntelSection
          id="features"
          className="lg:col-span-3"
          title={area ? `AI in ${AREA_LABEL[area]}` : "Most expensive AI features"}
          sub="Cost per call is what one answered call costs on average."
          action={
            area && (
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setArea(null)}>
                Show all
              </Button>
            )
          }
        >
          <FeatureTable rows={features} />
        </IntelSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection id="models" title="Models" sub="What each model costs per call and how reliably it answers.">
          <ModelTable rows={v.models} />
        </IntelSection>
        <IntelSection id="texts" title="Texts" sub={`Last ${days} days. Push and chat come first; a text goes only when they can't.`}>
          <SmsFunnel v={v} />
          <div className="mt-4">
            <RankRows
              rows={purposes.map((p) => ({
                key: p.category,
                label: p.label,
                sub: `${p.sent} sent${p.byPush ? ` · ${p.byPush} by push instead` : ""}${p.undelivered ? ` · ${p.undelivered} not delivered` : ""}`,
                values: [p.cost],
              }))}
              parts={[{ label: "Texts", color: "var(--viz-2)" }]}
              format={(n) => usd(n)}
              empty="No texts in this period."
            />
          </div>
        </IntelSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HealthSection v={v} />
        <ControlsSection v={v} />
      </div>

      {v.credits && (
        <IntelSection
          title="Members' AI credits"
          sub={`Last ${days} days. Members and clients spend credits on the AI features they use; packs are sold on the web only.`}
          action={
            <Button asChild size="sm" variant="outline" className="h-9">
              <Link to="/admin/settings/ai">Allowances</Link>
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Uses" value={v.credits.uses.toLocaleString()} />
            <MiniStat label="People" value={String(v.credits.people)} />
            <MiniStat label="What it cost us" value={usd(v.credits.costUsd)} />
            <MiniStat label="Packs sold" value={`${v.credits.salesCount} · $${(v.credits.salesMinor / 100).toFixed(2)}`} />
          </div>
        </IntelSection>
      )}

      <Definitions
        items={[
          { term: "AI cost", text: "Each call's tokens × the model's published price (src/lib/ai/ai-usage.ts). A model with no price on file is counted, not costed." },
          { term: "Lovable credits", text: "Calls through the Lovable gateway bill in Lovable credits, not OpenAI. Every default route is on the OpenAI key." },
          { term: "Text cost", text: "The larger of Twilio's price for the text and our estimate (segments × the per-segment price); Twilio's own monthly bill shows when it's been read." },
          { term: "Delivered", text: "Twilio confirmed the carrier delivered it. Not confirmed = accepted by Twilio and not read back yet." },
          { term: "Background AI hold", text: "Past the AI budget, the Crew post backlog waits. Coaching, client features, Cleo and anything you start never wait." },
          { term: "Areas", text: "Each AI task and text purpose belongs to one area (usage-model.ts); untagged ones are Other." },
        ]}
      />
    </div>
  );
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}%`;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function FeatureTable({ rows }: { rows: UsageView["features"] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No AI calls in this period.</p>;
  const shown = all ? rows : rows.slice(0, 8);
  const max = Math.max(...rows.map((r) => r.cost), 1e-9);
  return (
    <div>
      {/* phones: one line per feature, the cost on the right (a table would hide it) */}
      <ul className="divide-y sm:hidden">
        {shown.map((f) => (
          <li key={f.key} className="py-2">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-medium">{f.name}</span>
              <span className="shrink-0 font-medium tabular-nums">{f.unpriced === f.calls ? "unpriced" : usd(f.cost)}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {f.calls.toLocaleString()} calls · {perOp(f.perCall)} a call
              {f.failed > 0 && (
                <span className={cn(f.calls >= 10 && f.failed / f.calls >= 0.1 && "font-semibold text-amber-600 dark:text-amber-400")}>
                  {" "}· {Math.round((f.failed / f.calls) * 100)}% failed
                </span>
              )}
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${(f.cost / max) * 100}%`, background: "var(--viz-1)" }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="-mx-2 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead className="text-[12px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Feature</th>
              <th className="px-2 py-1.5 text-right font-medium">Calls</th>
              <th className="px-2 py-1.5 text-right font-medium">Failed</th>
              <th className="px-2 py-1.5 text-right font-medium">Per call</th>
              <th className="px-2 py-1.5 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.key} className="border-t">
                <td className="max-w-[16rem] px-2 py-2">
                  <div className="truncate font-medium" title={f.name}>{f.name}</div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(f.cost / max) * 100}%`, background: "var(--viz-1)" }} />
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{f.calls.toLocaleString()}</td>
                <td className={cn("px-2 py-2 text-right tabular-nums", f.calls >= 10 && f.failed / f.calls >= 0.1 && "font-semibold text-amber-600 dark:text-amber-400")}>
                  {f.failed ? `${Math.round((f.failed / f.calls) * 100)}%` : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{perOp(f.perCall)}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">{f.unpriced === f.calls ? "unpriced" : usd(f.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          {all ? "Show the top 8" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function modelName(m: string): string {
  return m.replace(/^openai:/, "").replace(/^gateway:/, "").replace(/^(openai|anthropic|google)\//, "");
}

function ModelTable({ rows }: { rows: UsageView["models"] }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No AI calls in this period.</p>;
  return (
    <>
    <ul className="divide-y sm:hidden">
      {rows.slice(0, 10).map((m) => (
        <li key={m.model} className="py-2">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-medium">{modelName(m.model)}</span>
            <span className="shrink-0 font-medium tabular-nums">{m.unpriced === m.calls ? "unpriced" : usd(m.cost)}</span>
          </div>
          <div className="text-[12px] text-muted-foreground">
            {m.provider === "gateway" ? "Lovable credits" : "OpenAI key"} · {m.calls.toLocaleString()} calls ·{" "}
            {m.calls ? `${Math.round(((m.calls - m.failed) / m.calls) * 100)}% answered` : "—"} · {perOp(m.perCall)} a call
          </div>
        </li>
      ))}
    </ul>
    <div className="-mx-2 hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[440px] text-[13px]">
        <thead className="text-[12px] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Model</th>
            <th className="px-2 py-1.5 text-right font-medium">Calls</th>
            <th className="px-2 py-1.5 text-right font-medium">Answered</th>
            <th className="px-2 py-1.5 text-right font-medium">Per call</th>
            <th className="px-2 py-1.5 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((m) => (
            <tr key={m.model} className="border-t">
              <td className="px-2 py-2">
                <div className="font-medium">{modelName(m.model)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {m.provider === "gateway" ? "Lovable credits" : "OpenAI key"}
                  {m.avgSeconds != null && ` · ${m.avgSeconds}s avg`}
                </div>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{m.calls.toLocaleString()}</td>
              <td className="px-2 py-2 text-right tabular-nums">{m.calls ? `${Math.round(((m.calls - m.failed) / m.calls) * 100)}%` : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{perOp(m.perCall)}</td>
              <td className="px-2 py-2 text-right font-medium tabular-nums">{m.unpriced === m.calls ? "unpriced" : usd(m.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** Asked → sent → delivered as one segmented bar, with what didn't go and why. */
function SmsFunnel({ v }: { v: UsageView }) {
  const f = v.sms.funnel;
  const parts = [
    { label: "Delivered", n: f.delivered, cls: "bg-[var(--viz-3)]" },
    { label: "Not confirmed yet", n: f.unconfirmed, cls: "bg-muted-foreground/40" },
    { label: "Not delivered", n: f.undelivered + f.failed, cls: "bg-destructive" },
    { label: "Not sent (push, cap, budget)", n: f.blocked, cls: "bg-muted-foreground/15" },
  ];
  const total = Math.max(1, parts.reduce((n, p) => n + p.n, 0));
  if (!f.asked) return <p className="text-[13px] text-muted-foreground">No texts asked for in this period.</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {parts.map((p) =>
          p.n ? <div key={p.label} className={cn("h-full border-r-2 border-card last:border-r-0", p.cls)} style={{ width: `${(p.n / total) * 100}%` }} /> : null,
        )}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", p.cls)} aria-hidden />
            <span className="truncate">{p.label}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">{p.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DOWN: Record<string, string> = {
  credits: "OpenAI credits ran out",
  auth: "the OpenAI key was refused",
  outage: "OpenAI isn't answering",
};

function HealthSection({ v }: { v: UsageView }) {
  const qc = useQueryClient();
  const checkNow = useServerFn(aiHealthCheckNowFn);
  const [checking, setChecking] = useState(false);
  const w = v.ai.waiting;
  const jobs = [
    { label: "Coaching replies", n: w.coachingReplies },
    { label: "Check-in recaps", n: w.checkinRecaps },
    { label: "Athlete Insights", n: w.athleteInsights },
    { label: "Crew post decks", n: w.postDecks },
  ];
  const run = async () => {
    setChecking(true);
    try {
      await checkNow();
      await qc.invalidateQueries({ queryKey: ["admin-usage"] });
      toast.success("Checked");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't check");
    } finally {
      setChecking(false);
    }
  };
  return (
    <IntelSection
      id="health"
      title="Health & waiting work"
      action={
        <Button size="sm" variant="outline" className="h-9" onClick={run} disabled={checking}>
          {checking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Check now
        </Button>
      }
    >
      <div className="flex items-center gap-2 text-[14px]">
        <span className={cn("inline-block h-2.5 w-2.5 rounded-full", v.ai.status === "ok" ? "bg-[var(--viz-3)]" : "bg-destructive")} aria-hidden />
        <span className="font-medium">{v.ai.status === "ok" ? "OpenAI is answering" : `Paused: ${DOWN[v.ai.status]}`}</span>
        {!v.ai.keySet && <span className="text-[12px] text-destructive">· no OpenAI key set</span>}
      </div>
      {v.ai.held && (
        <p className="mt-1.5 text-[13px] text-amber-700 dark:text-amber-300">
          Background AI is on hold: this month's AI is past its budget.
        </p>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {jobs.map((j) => (
          <li key={j.label} className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
            <div className="text-muted-foreground">{j.label}</div>
            <div className="font-semibold tabular-nums">{j.n ? `${j.n} waiting` : "None waiting"}</div>
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-[13px] font-semibold">Recent failures</h3>
      {v.ai.errors.length ? (
        <ul className="mt-1.5 divide-y text-[12px]">
          {v.ai.errors.slice(0, 5).map((e, i) => (
            <li key={i} className="py-1.5">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">{e.feature}</span>
                <span className="shrink-0 text-muted-foreground">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div className="truncate text-muted-foreground" title={e.error ?? ""}>
                {e.failure ? `${e.failure}: ` : ""}
                {e.error ?? ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-muted-foreground">No failed calls in this period.</p>
      )}
    </IntelSection>
  );
}

function ControlsSection({ v }: { v: UsageView }) {
  const qc = useQueryClient();
  const saveAi = useServerFn(setAiBudgetFn);
  const saveSms = useServerFn(updateSmsSettings);
  const [aiBudget, setAiBudget] = useState<string>(v.ai.month.budget ? String(v.ai.month.budget) : "");
  const [smsBudget, setSmsBudget] = useState<string>(v.sms.month.budget ? String(v.sms.month.budget) : "");
  const [cap, setCap] = useState<string>(v.sms.dailyCap != null ? String(v.sms.dailyCap) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-usage"] });

  const saveAiBudget = async (hold?: boolean) => {
    const n = aiBudget.trim() === "" ? 0 : Number(aiBudget);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return toast.error("Enter a budget in US dollars, or leave it empty for none");
    setBusy("ai");
    try {
      await saveAi({ data: { monthlyUsd: n || null, holdBackground: hold ?? v.ai.holdBackground } });
      toast.success(n ? `AI budget: $${n} a month` : "AI budget off");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(null);
    }
  };
  const saveSmsField = async (patch: Record<string, number>, done: string) => {
    setBusy("sms");
    try {
      await saveSms({ data: patch as any });
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ["sms-settings"] });
      await qc.invalidateQueries({ queryKey: ["sms-cost-summary"] });
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(null);
    }
  };
  const suggest = useMemo(() => v.ai.suggestedBudget, [v.ai.suggestedBudget]);

  return (
    <IntelSection id="controls" title="Budgets & limits" sub="What protects the month. Coaching and client features never stop for a budget.">
      <div className="space-y-5">
        <div>
          <label htmlFor="ai-budget" className="text-[13px] font-medium">AI budget (US$ a month)</label>
          <p className="text-[12px] text-muted-foreground">You're pushed at 80% and 100%. {v.ai.month.budget ? "" : `At this pace, about $${suggest} leaves room.`}</p>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="ai-budget"
              inputMode="decimal"
              placeholder={v.ai.month.budget ? "" : String(suggest)}
              value={aiBudget}
              onChange={(e) => setAiBudget(e.target.value)}
              className="h-10 max-w-[10rem]"
            />
            <Button variant="outline" className="h-10" onClick={() => saveAiBudget()} disabled={busy === "ai"}>
              {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
          {v.ai.month.budget && <Meter pct={v.ai.month.pct} className="mt-2" />}
          <label className="mt-3 flex items-start justify-between gap-3">
            <span className="text-[13px]">
              <span className="font-medium">Hold background AI past the budget</span>
              <span className="block text-[12px] text-muted-foreground">The Crew post backlog waits until next month or a higher budget. Nothing else does.</span>
            </span>
            <Switch
              checked={v.ai.holdBackground}
              disabled={busy === "ai"}
              onCheckedChange={(c) => saveAiBudget(c)}
              aria-label="Hold background AI past the budget"
            />
          </label>
        </div>

        <div className="border-t pt-4">
          <label htmlFor="sms-budget" className="text-[13px] font-medium">Text budget (CAD a month)</label>
          <p className="text-[12px] text-muted-foreground">At 100% automatic texts pause; at 200% only sign-in and account texts go.</p>
          <div className="mt-1.5 flex gap-2">
            <Input id="sms-budget" inputMode="decimal" value={smsBudget} onChange={(e) => setSmsBudget(e.target.value)} className="h-10 max-w-[10rem]" />
            <Button
              variant="outline"
              className="h-10"
              disabled={busy === "sms"}
              onClick={() => {
                const n = Number(smsBudget);
                if (!Number.isFinite(n) || n < 1 || n > 10000) return toast.error("Enter $1 to $10,000");
                saveSmsField({ monthly_budget_cad: n }, `Text budget: $${n} a month`);
              }}
            >
              Save
            </Button>
          </div>
          <label htmlFor="sms-cap" className="mt-3 block text-[13px] font-medium">Automatic texts per person per day</label>
          <div className="mt-1.5 flex gap-2">
            <Input id="sms-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className="h-10 max-w-[6rem]" />
            <Button
              variant="outline"
              className="h-10"
              disabled={busy === "sms"}
              onClick={() => {
                const n = Number(cap);
                if (!Number.isInteger(n) || n < 1 || n > 20) return toast.error("Enter 1 to 20");
                saveSmsField({ client_daily_cap: n }, `Up to ${n} automatic texts a person a day`);
              }}
            >
              Save
            </Button>
          </div>
          <Link to="/admin/settings/sms" className="mt-3 inline-block text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline">
            All text settings
          </Link>
        </div>
      </div>
    </IntelSection>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-[320px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-2xl lg:col-span-3" />
      </div>
    </div>
  );
}
