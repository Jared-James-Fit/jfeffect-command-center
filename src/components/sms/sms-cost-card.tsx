/**
 * Settings → SMS → Cost this month. What texts cost, what they're for, who
 * gets them, what was stopped, and the budget that stops them.
 *
 * Every number comes from public.sms_cost_summary (the sms_log ledger every
 * send writes through sms-gateway.server.ts) and, once read, Twilio's own bill
 * for the month (sms_settings.twilio_usage). Estimates say they're estimates.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/calendar-sync";
import { getSmsCostSummary, refreshSmsCosts, updateSmsSettings } from "@/lib/sms.functions";
import { BUDGET_LEVEL_TEXT, budgetLevel, CATEGORY_LABEL, money } from "@/lib/sms-policy";

type Summary = {
  month: string;
  spent_usd: number;
  totals: {
    texts: number;
    segments: number;
    messages_usd: number;
    priced: number;
    priced_usd: number;
    delivered: number;
    undelivered: number;
    failed: number;
    duplicates: number;
    budget_blocked: number;
    capped: number;
    by_push: number;
  };
  by_category: Array<{ category: string; texts: number; segments: number; cost: number; prevented: number }>;
  by_person: Array<{ client_id: string | null; app_member_id: string | null; name: string; texts: number; segments: number; cost: number }>;
  history: Array<{ month: string; texts: number; segments: number; cost: number }>;
};

type Settings = {
  enabled?: boolean;
  monthly_budget_cad?: number | string;
  usd_to_cad?: number | string;
  number_fee_usd?: number | string;
  price_per_segment_usd?: number | string;
  client_daily_cap?: number;
  security_texts_enabled?: boolean;
  allowed_prefixes?: string[];
  twilio_usage?: {
    month?: string;
    fetched_at?: string;
    total?: number | null;
    price_unit?: string | null;
    sms_count?: number | null;
    error?: string | null;
  } | null;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

export function SmsCostCard({ settings }: { settings: Settings | null | undefined }) {
  const qc = useQueryClient();
  const fetchSummary = useServerFn(getSmsCostSummary);
  const refresh = useServerFn(refreshSmsCosts);
  const save = useServerFn(updateSmsSettings);
  const [refreshing, setRefreshing] = useState(false);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["sms-cost-summary"],
    queryFn: async () => (await fetchSummary({})) as Summary,
    staleTime: 30_000,
  });

  const rate = Number(settings?.usd_to_cad ?? 1.38) || 1.38;
  const budget = Number(settings?.monthly_budget_cad ?? 10) || 10;
  const usage = settings?.twilio_usage ?? null;
  const usageThisMonth = usage && summary && usage.month === summary.month ? usage : null;
  const spentCad = (summary?.spent_usd ?? 0) * rate;
  const { pct, level } = budgetLevel(spentCad, budget);
  const fixedCad = Number(settings?.number_fee_usd ?? 1.15) * rate;
  const actualCad =
    usageThisMonth?.total != null
      ? (String(usageThisMonth.price_unit ?? "USD").toUpperCase() === "USD" ? usageThisMonth.total * rate : usageThisMonth.total)
      : null;

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const r: any = await refresh({});
      if (r?.usage?.error) toast.message("Twilio's bill isn't readable yet", { description: "Delivery checks still ran. Estimates are shown." });
      else toast.success("Updated from Twilio");
      qc.invalidateQueries({ queryKey: ["sms-cost-summary"] });
      qc.invalidateQueries({ queryKey: ["sms-settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reach Twilio");
    } finally {
      setRefreshing(false);
    }
  };

  const saveField = async (patch: Record<string, unknown>, done?: string) => {
    try {
      await save({ data: patch as any });
      qc.invalidateQueries({ queryKey: ["sms-settings"] });
      qc.invalidateQueries({ queryKey: ["sms-cost-summary"] });
      if (done) toast.success(done);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    }
  };

  const t = summary?.totals;
  const prevented = (t?.duplicates ?? 0) + (t?.budget_blocked ?? 0) + (t?.capped ?? 0);
  const barTone = level === "ok" ? "bg-foreground" : level === "warn" || level === "alert" ? "bg-warning" : "bg-destructive";

  return (
    <Card className="space-y-5 rounded-2xl p-4 md:p-5" data-sms-cost>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <div className="text-base font-semibold">Cost this month</div>
        </div>
        <Button size="sm" variant="ghost" onClick={doRefresh} disabled={refreshing} aria-label="Update from Twilio" className="h-10 px-3">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          <span className="ml-1.5 hidden sm:inline">Update from Twilio</span>
        </Button>
      </div>

      {isLoading || !summary ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-semibold tabular-nums">{money(spentCad)}</span>
              <span className="text-sm text-muted-foreground">of {money(budget)} CAD budget</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className={cn("h-full rounded-full transition-all", barTone)} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            {level !== "ok" && (
              <div className={cn("text-sm font-medium", level === "warn" || level === "alert" ? "text-warning" : "text-destructive")} data-sms-budget-level={level}>
                {BUDGET_LEVEL_TEXT[level]} ({Math.round(pct)}%)
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Estimate: texts sent × segments × {money(Number(settings?.price_per_segment_usd ?? 0.0161) * rate)} each, plus the phone number ({money(fixedCad)}/month).{" "}
              {actualCad != null ? (
                <>Twilio's own bill so far: <span className="font-medium text-foreground">{money(actualCad)} CAD</span>{usageThisMonth?.fetched_at ? ` (read ${timeAgo(usageThisMonth.fetched_at)})` : ""}.</>
              ) : usage?.error ? (
                <>Twilio's own bill couldn't be read ({usage.error}).</>
              ) : (
                <>Twilio's own bill is read hourly once texts go out.</>
              )}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Texts sent" value={t?.texts ?? 0} sub={`${t?.segments ?? 0} segments`} />
            <Stat label="Failed" value={(t?.failed ?? 0) + (t?.undelivered ?? 0)} sub={t?.undelivered ? `${t.undelivered} undelivered` : "not billed if refused"} tone={(t?.failed ?? 0) + (t?.undelivered ?? 0) > 0 ? "warn" : undefined} />
            <Stat label="Stopped" value={prevented} sub={`${t?.duplicates ?? 0} duplicates`} />
          </div>
          {(t?.by_push ?? 0) > 0 && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-success">{t?.by_push}</span> unread-message nudges went as a free push instead of a text.
            </p>
          )}

          <Section title="By type">
            {summary.by_category.filter((c) => c.texts > 0 || c.prevented > 0).length === 0 ? (
              <Empty>No texts this month.</Empty>
            ) : (
              summary.by_category
                .filter((c) => c.texts > 0 || c.prevented > 0)
                .map((c) => (
                  <Row key={c.category} label={CATEGORY_LABEL[c.category] ?? c.category} detail={`${c.texts} sent${c.prevented ? ` · ${c.prevented} stopped` : ""}`} value={money(c.cost * rate)} />
                ))
            )}
          </Section>

          <Section title="Who gets the most">
            {summary.by_person.length === 0 ? (
              <Empty>No texts this month.</Empty>
            ) : (
              summary.by_person.slice(0, 5).map((p, i) => (
                <Row key={`${p.client_id ?? p.app_member_id ?? "x"}-${i}`} label={p.name} detail={`${p.texts} text${p.texts === 1 ? "" : "s"}`} value={money(p.cost * rate)} />
              ))
            )}
          </Section>

          {summary.history.length > 1 && (
            <Section title="Last months">
              {[...summary.history].reverse().map((h) => (
                <Row key={h.month} label={monthLabel(h.month)} detail={`${h.texts} texts`} value={`${money(h.cost * rate)} + number`} />
              ))}
            </Section>
          )}
        </>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <div className="text-base font-semibold">Limits</div>
        <BudgetInput value={budget} onSave={(v) => saveField({ monthly_budget_cad: v }, "Budget saved")} />
        <p className="text-xs text-muted-foreground">
          At 50% this card warns, at 80% admins get a push, at 100% automatic texts (unread nudges, payment and membership texts, staff alerts, bulk) stop until next month. Session reminders and texts you send yourself keep going up to 2× the budget. Account texts (password resets, setup links) never stop for the budget.
        </p>
        <ToggleRow
          label="Account & sign-in texts"
          hint="Password resets and setup links. Separate from the master switch so people can always get into their account."
          checked={settings?.security_texts_enabled !== false}
          onChange={(v) => saveField({ security_texts_enabled: v }, v ? "Account texts on" : "Account texts off")}
        />
        <CapInput value={settings?.client_daily_cap ?? 3} onSave={(v) => saveField({ client_daily_cap: v }, "Saved")} />
        <p className="text-xs text-muted-foreground">
          Texts only go to {(settings?.allowed_prefixes ?? ["+1"]).join(", ")} numbers (Canada and the US), which also blocks SMS-pumping fraud. The budget is the app's own limit, not a Twilio spending cap: the phone number, texts people send you and carrier fees are billed by Twilio either way.
        </p>
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "warn" && "text-warning")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-semibold">{title}</div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function Row({ label, detail, value }: { label: string; detail?: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      <div className="shrink-0 text-sm tabular-nums">{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-2 text-sm text-muted-foreground">{children}</div>;
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function BudgetInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft) * 100) / 100;
    if (!Number.isFinite(n) || n < 1) {
      toast.error("The budget has to be at least $1");
      setDraft(String(value));
      return;
    }
    if (n !== value) onSave(n);
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor="sms-budget" className="text-sm font-normal">Monthly budget (CAD)</Label>
      <div className="relative w-28">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input
          id="sms-budget"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="h-10 pl-6 text-right text-[16px] tabular-nums md:text-sm"
        />
      </div>
    </div>
  );
}

function CapInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      toast.error("Pick 1 to 20");
      setDraft(String(value));
      return;
    }
    if (n !== value) onSave(n);
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor="sms-cap" className="text-sm font-normal">Automatic texts per person a day</Label>
        <div className="text-xs text-muted-foreground">Reminders, nudges and automations combined.</div>
      </div>
      <Input
        id="sms-cap"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-10 w-20 text-right text-[16px] tabular-nums md:text-sm"
      />
    </div>
  );
}
