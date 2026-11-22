/**
 * Admin → Coach platform (/admin/coach-platform): the owner's own place for
 * JF Effect for coaches, apart from his coaching clients. Applications (the
 * early-access waitlist), Pricing (the recommendation, a calculator, what a
 * coach's billing screen would say, and publishing a price to the site) and
 * Launch (what has to be true before any coach gets a workspace, and what a
 * coach can never have). Nothing here bills anyone or opens registration.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ExternalLink, Instagram, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  getCoachPlatformSettings,
  listCoachApplications,
  setCoachPlatformPricing,
  updateCoachApplication,
  type CoachApplication,
} from "@/lib/coach-platform/coach-platform.functions";
import {
  APPLICATION_STATUSES,
  CLIENT_BANDS,
  CURRENT_PLATFORMS,
  SPECIALTIES,
  STATUS_WORDS,
  WORKS_AS,
  bandRank,
  labelOf,
  type ApplicationStatus,
} from "@/lib/coach-platform/apply";
import {
  BILLABLE_DEFINITION,
  DEFAULT_COSTS,
  PROPOSED_PRICING,
  RECOMMENDED_PRICING,
  breakEvenClients,
  cad,
  cleanPricing,
  coachEconomics,
  monthlyFeeCents,
  pricingSentence,
  seatChangePreview,
  seatSummary,
  type CostAssumptions,
  type SeatPricing,
} from "@/lib/coach-platform/seat-pricing";
import { MARKET, MARKET_SEEN, MARKET_SIZES } from "@/lib/coach-platform/market";
import { GATE_WORDS, launchGates, readyForPilot } from "@/lib/coach-platform/launch-gates";
import { CAPABILITIES } from "@/lib/coach-platform/capabilities";

type Tab = "applications" | "pricing" | "launch";

export function CoachPlatformPage({ tab, appId, onTab }: { tab: Tab; appId?: string; onTab: (t: Tab) => void }) {
  const getSettings = useServerFn(getCoachPlatformSettings);
  const settings = useQuery({ queryKey: ["coach-platform-settings"], queryFn: () => getSettings() });
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-24">
      <PageHeader title="Coach platform" subtitle="JF Effect for coaches · early access. Only you see this." />
      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="launch">Launch</TabsTrigger>
        </TabsList>
        <TabsContent value="applications" className="mt-4">
          <ApplicationsTab focusId={appId} />
        </TabsContent>
        <TabsContent value="pricing" className="mt-4">
          <PricingTab settings={settings.data ?? null} loading={settings.isLoading} />
        </TabsContent>
        <TabsContent value="launch" className="mt-4">
          <LaunchTab pricingPublished={!!settings.data?.published} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────── applications ───────────────────────── */

type Filter = "open" | ApplicationStatus | "all";
const OPEN: ApplicationStatus[] = ["new", "contacted", "waitlisted"];

function ApplicationsTab({ focusId }: { focusId?: string }) {
  const list = useServerFn(listCoachApplications);
  const q = useQuery({ queryKey: ["coach-platform-applications"], queryFn: () => list() });
  const [filter, setFilter] = useState<Filter>("open");
  const rows = useMemo(() => {
    const all = (q.data ?? []).filter((r) => !r.is_test);
    const shown = filter === "all" ? all : filter === "open" ? all.filter((r) => OPEN.includes(r.status)) : all.filter((r) => r.status === filter);
    // bigger books first among the new ones, then newest
    return [...shown].sort((a, b) => (a.status === "new" && b.status === "new" ? bandRank(b.client_band) - bandRank(a.client_band) : 0) || b.created_at.localeCompare(a.created_at));
  }, [q.data, filter]);
  const counts = useMemo(() => {
    const all = (q.data ?? []).filter((r) => !r.is_test);
    const c: Record<string, number> = { all: all.length, open: all.filter((r) => OPEN.includes(r.status)).length };
    for (const s of APPLICATION_STATUSES) c[s] = all.filter((r) => r.status === s).length;
    return c;
  }, [q.data]);

  if (q.isLoading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  if (q.error) return <Card className="p-4 text-[14px] text-destructive">{(q.error as Error).message}</Card>;

  const chips: Filter[] = ["open", ...APPLICATION_STATUSES, "all"];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter applications">
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              "h-9 rounded-full px-3.5 text-[13px] font-medium ring-1 ring-inset ring-border transition",
              filter === f ? "bg-foreground text-background ring-foreground" : "bg-background hover:bg-muted",
            )}
          >
            {f === "open" ? "Open" : f === "all" ? "All" : STATUS_WORDS[f]} <span className="tabular-nums opacity-70">{counts[f] ?? 0}</span>
          </button>
        ))}
      </div>
      {!rows.length ? (
        <Card className="p-6 text-center text-[14px] text-muted-foreground">
          {counts.all ? "Nothing here." : "No applications yet. They come from jfeffect.com/coaches/apply."}
        </Card>
      ) : (
        rows.map((r) => <ApplicationCard key={r.id} row={r} focused={r.id === focusId} />)
      )}
    </div>
  );
}

function ApplicationCard({ row, focused }: { row: CoachApplication; focused: boolean }) {
  const qc = useQueryClient();
  const update = useServerFn(updateCoachApplication);
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  useEffect(() => setNotes(row.admin_notes ?? ""), [row.admin_notes]);
  const save = useMutation({
    mutationFn: (patch: { status?: ApplicationStatus; admin_notes?: string | null }) => update({ data: { id: row.id, ...patch } }),
    onSuccess: (saved) => {
      qc.setQueryData<CoachApplication[]>(["coach-platform-applications"], (old) => (old ?? []).map((r) => (r.id === saved.id ? saved : r)));
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });
  const place = [row.region, row.country === "OTHER" ? null : row.country].filter(Boolean).join(", ") || "Outside Canada and the US";
  const site = row.website ? (/^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`) : null;
  return (
    <Card
      className={cn("space-y-3 p-4", focused && "ring-2 ring-foreground")}
      data-coach-application={row.id}
      ref={(el) => {
        if (focused && el) el.scrollIntoView({ block: "center" });
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{row.full_name}</h3>
          <p className="text-[13px] text-muted-foreground">
            {[row.business_name, place, new Date(row.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}
          </p>
        </div>
        <select
          aria-label="Status"
          value={row.status}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ status: e.target.value as ApplicationStatus })}
          className="h-9 rounded-lg border border-input bg-background px-2 text-[13px]"
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_WORDS[s]}
            </option>
          ))}
        </select>
      </div>
      <dl className="grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2">
        <Fact label="Coaches">{row.specialties.map((s) => labelOf(SPECIALTIES, s)).join(", ")}</Fact>
        <Fact label="Clients now">{labelOf(CLIENT_BANDS, row.client_band)}</Fact>
        <Fact label="Works">{labelOf(WORKS_AS, row.works_as)}</Fact>
        <Fact label="Uses now">{row.current_platform ? labelOf(CURRENT_PLATFORMS, row.current_platform) : "Didn't say"}</Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={`mailto:${row.email}`}>
            <Mail className="mr-1.5 h-4 w-4" /> {row.email}
          </a>
        </Button>
        {row.instagram && (
          <Button asChild variant="outline" size="sm">
            <a href={`https://instagram.com/${row.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer noopener">
              <Instagram className="mr-1.5 h-4 w-4" /> {row.instagram}
            </a>
          </Button>
        )}
        {site && (
          <Button asChild variant="outline" size="sm">
            <a href={site} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="mr-1.5 h-4 w-4" /> Website
            </a>
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {row.marketing_consent && !row.marketing_withdrawn_at
          ? "OK to email them JF Effect news for coaches."
          : "Emails about their application only. No marketing."}
      </p>
      <Textarea
        aria-label="Private notes"
        placeholder="Private notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (row.admin_notes ?? "") && save.mutate({ admin_notes: notes })}
        className="min-h-[64px] text-[14px]"
      />
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/* ───────────────────────── pricing ───────────────────────── */

type Settings = Awaited<ReturnType<typeof getCoachPlatformSettings>>;

function PricingTab({ settings, loading }: { settings: Settings | null; loading: boolean }) {
  const qc = useQueryClient();
  const setPricing = useServerFn(setCoachPlatformPricing);
  const [draft, setDraft] = useState<SeatPricing>(RECOMMENDED_PRICING);
  const [costs, setCosts] = useState<CostAssumptions>(DEFAULT_COSTS);
  const [confirm, setConfirm] = useState<null | "publish" | "unpublish">(null);
  const [coachClients, setCoachClients] = useState(12);
  useEffect(() => {
    if (settings?.published) setDraft(settings.pricing);
  }, [settings?.published, settings?.pricing]);
  const pricing = cleanPricing(draft);

  const save = useMutation({
    mutationFn: (published: boolean) =>
      setPricing({
        data: {
          published,
          freeClients: pricing.freeClients,
          perClientCents: pricing.perClientCents,
          volumeFrom: pricing.volume?.fromClient ?? null,
          volumeCents: pricing.volume?.perClientCents ?? null,
        },
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["coach-platform-settings"], saved);
      toast.success(saved.published ? "Published. jfeffect.com/coaches shows this price now." : "Taken down. The site shows no price.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const summary = seatSummary(coachClients, pricing);
  const change = seatChangePreview({
    before: coachClients,
    after: coachClients + 1,
    pricing,
    period: { start: new Date(Date.now() - 14 * 86_400_000), end: new Date(Date.now() + 16 * 86_400_000) },
  });
  const be = breakEvenClients(pricing, costs);
  const dollars = (c: number) => String(c / 100);
  const toCents = (v: string) => Math.round(Number(v) * 100);

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4" data-pricing-recommendation>
        <h2 className="text-[16px] font-semibold">The recommendation</h2>
        <p className="text-[14px] leading-relaxed">
          Keep the brief's offer: <strong>{pricingSentence(PROPOSED_PRICING)}</strong> It's the cheapest paid option at 1 to 10
          clients. Add one volume step: <strong>{pricingSentence(RECOMMENDED_PRICING)}</strong> Without it a coach with 50
          clients pays {cad(monthlyFeeCents(50, PROPOSED_PRICING))}, more than every flat plan below; with it,{" "}
          {cad(monthlyFeeCents(50, RECOMMENDED_PRICING))}.
        </p>
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          AI drafts are the biggest cost a client brings. Include a monthly allowance with each paid client and meter
          heavy use, or a coach who drafts every plan for 2 clients costs more than they pay. Keep text messages out of the
          coach plan (push and the chat cover it).
        </p>
      </Card>

      <Card className="space-y-4 p-4" data-pricing-calculator>
        <h2 className="text-[16px] font-semibold">Try a price</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <NumberField label="Free clients" value={String(pricing.freeClients)} onChange={(v) => setDraft({ ...draft, freeClients: Number(v) })} />
          <NumberField label="Per client ($)" value={dollars(pricing.perClientCents)} onChange={(v) => setDraft({ ...draft, perClientCents: toCents(v) })} />
          <NumberField
            label="Volume from client #"
            value={draft.volume ? String(draft.volume.fromClient) : ""}
            placeholder="None"
            onChange={(v) => setDraft({ ...draft, volume: v ? { fromClient: Number(v), perClientCents: draft.volume?.perClientCents ?? 300 } : null })}
          />
          <NumberField
            label="Volume price ($)"
            value={draft.volume ? dollars(draft.volume.perClientCents) : ""}
            placeholder="None"
            onChange={(v) => setDraft({ ...draft, volume: draft.volume ? { ...draft.volume, perClientCents: toCents(v) } : v ? { fromClient: 26, perClientCents: toCents(v) } : null })}
          />
        </div>
        <p className="text-[14px] font-medium">{pricingSentence(pricing)}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px] tabular-nums">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Clients</th>
                <th className="py-1.5 pr-3 font-medium">They pay</th>
                <th className="py-1.5 pr-3 font-medium">Cost to run</th>
                <th className="py-1.5 pr-3 font-medium">Card and billing fees</th>
                <th className="py-1.5 font-medium">Left over</th>
              </tr>
            </thead>
            <tbody>
              {MARKET_SIZES.map((n) => {
                const e = coachEconomics(n, pricing, costs);
                return (
                  <tr key={n} className="border-t border-border/70">
                    <td className="py-1.5 pr-3">{n}</td>
                    <td className="py-1.5 pr-3">{e.revenueCents ? cad(e.revenueCents) : "Free"}</td>
                    <td className="py-1.5 pr-3">{cad(e.costCents)}</td>
                    <td className="py-1.5 pr-3">{cad(e.feesCents)}</td>
                    <td className={cn("py-1.5", e.marginCents < 0 && "text-destructive")}>
                      {cad(e.marginCents)}
                      {e.marginPct != null && <span className="text-muted-foreground"> ({e.marginPct}%)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted-foreground">
          A month, CAD, before tax. {be ? `A coach covers their own costs from ${be} clients.` : "No size covers its costs at these numbers."}
          {" "}Costs are estimates; change them below.
        </p>
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium">Cost assumptions (a client, a month, in cents)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["infraPerClientCents", "Database and storage"],
                ["aiPerClientCents", "AI drafts and reads"],
                ["videoPerClientCents", "Video"],
                ["supportPerClientCents", "Support time"],
                ["perCoachCents", "Per coach account"],
                ["cloudTaxPercent", "RST on cloud bills (%)"],
              ] as Array<[keyof CostAssumptions, string]>
            ).map(([k, label]) => (
              <NumberField key={k} label={label} value={String(costs[k])} onChange={(v) => setCosts({ ...costs, [k]: Number(v) || 0 })} />
            ))}
          </div>
        </details>
      </Card>

      <Card className="space-y-3 p-4" data-coach-billing-preview>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">What a coach's billing screen would say</h2>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Clients
            <Input type="text" inputMode="numeric" value={String(coachClients)} onChange={(e) => setCoachClients(Math.max(0, Math.min(500, Number(e.target.value.replace(/\D/g, "")) || 0)))} className="h-9 w-20" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-border/70 sm:grid-cols-4">
          {[
            [String(summary.active), summary.active === 1 ? "Active client" : "Active clients"],
            [String(summary.free), summary.free === 1 ? "Free client" : "Free clients"],
            [String(summary.paid), summary.paid === 1 ? "Paid client" : "Paid clients"],
            [summary.monthlyLine, "Your monthly platform cost"],
          ].map(([v, l]) => (
            <div key={l} className="bg-card px-3 py-3">
              <div className="text-[20px] font-semibold tabular-nums">{v}</div>
              <div className="text-[12px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">{BILLABLE_DEFINITION}</p>
        <p className="text-[13px]">
          <span className="font-medium">Adding one more client:</span> {change.words}
          {change.needsPaymentSetup && " They'd set up a card and agree to monthly billing first."}
        </p>
      </Card>

      <Card className="space-y-3 p-4" data-market>
        <h2 className="text-[16px] font-semibold">What coaches pay elsewhere</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13px] tabular-nums">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">CAD a month</th>
                {MARKET_SIZES.map((n) => (
                  <th key={n} className="py-1.5 pr-3 font-medium">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/70 font-semibold">
                <td className="py-1.5 pr-3">This price</td>
                {MARKET_SIZES.map((n) => (
                  <td key={n} className="py-1.5 pr-3">
                    {cad(monthlyFeeCents(n, pricing))}
                  </td>
                ))}
              </tr>
              {MARKET.map((m) => (
                <tr key={m.name} className="border-t border-border/70" title={m.note}>
                  <td className="py-1.5 pr-3">{m.name}</td>
                  {MARKET_SIZES.map((n) => (
                    <td key={n} className="py-1.5 pr-3 text-muted-foreground">
                      {m.at[n] == null ? "–" : cad(Math.round((m.at[n] as number) * 100))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Seen {MARKET_SEEN}, mostly from third-party pricing pages, at 1.43 CAD a USD. Check the vendor's own page before
          quoting any of it. Never shown to the public.
        </p>
      </Card>

      <Card className="space-y-3 p-4" data-pricing-publish>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">Show a price on jfeffect.com/coaches</h2>
            <p className="text-[13px] text-muted-foreground">
              {loading
                ? "Loading…"
                : settings?.published
                  ? `Showing: ${pricingSentence(settings.pricing)}`
                  : "Off. The page says the first client is free and the exact price comes before anyone pays."}
            </p>
          </div>
          <Switch
            checked={!!settings?.published}
            disabled={loading || save.isPending}
            onCheckedChange={(v) => setConfirm(v ? "publish" : "unpublish")}
            aria-label="Show a price on the coaches page"
          />
        </div>
        {settings?.published && (
          <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => setConfirm("publish")}>
            Publish the price above instead
          </Button>
        )}
        <p className="text-[12px] text-muted-foreground">
          Publishing shows the price; it never charges anyone. No coach can be billed until seat billing is built and you
          approve it.
        </p>
        {!!settings?.history.length && (
          <details className="text-[13px]">
            <summary className="cursor-pointer font-medium">Price history</summary>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {settings.history.map((h, i) => (
                <li key={i}>
                  {new Date(h.changed_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}:{" "}
                  {h.after?.pricing_published ? `published at ${cad(Number(h.after.per_client_cents))} a client` : "not shown"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "publish" ? "Show this price on jfeffect.com?" : "Take the price down?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "publish"
                ? `"${pricingSentence(pricing)}" in Canadian dollars, plus tax, on the coaches page right away. It's your approval of the price as advertised. Nobody is charged.`
                : "The coaches page goes back to the planned model with no number."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => save.mutate(confirm === "publish")}>{confirm === "publish" ? "Publish" : "Take it down"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumberField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-[12px] text-muted-foreground">
      {label}
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className="mt-1 h-10 text-[15px] text-foreground"
      />
    </label>
  );
}

/* ───────────────────────── launch ───────────────────────── */

function LaunchTab({ pricingPublished }: { pricingPublished: boolean }) {
  const gates = launchGates({ pricingPublished });
  const ready = readyForPilot(gates);
  return (
    <div className="space-y-4">
      <Card className="p-4" data-launch-status>
        <h2 className="text-[16px] font-semibold">Registration: closed</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
          {ready
            ? "Everything before the pilot is done. Opening it is a migration, on purpose."
            : "No coach can make a workspace, and there's no switch for it: opening it is a migration once every step before the pilot is done. Revenue, seats and failed payments show here once a coach is billed; none is yet."}
        </p>
      </Card>
      <Card className="divide-y divide-border/70 p-0" data-launch-gates>
        {gates.map((g) => (
          <div key={g.key} className="flex gap-3 px-4 py-3">
            <span
              className={cn(
                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
                g.state === "done" ? "bg-success text-background" : "ring-1 ring-inset ring-muted-foreground/50",
              )}
              aria-hidden
            >
              {g.state === "done" && <Check className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[14px] font-medium">{g.label}</span>
                <span className={cn("text-[12px]", g.state === "owner" ? "text-warning" : g.state === "built" ? "text-foreground" : "text-muted-foreground")}>{GATE_WORDS[g.state]}</span>
              </div>
              <p className="text-[13px] text-muted-foreground">{g.detail}</p>
            </div>
          </div>
        ))}
      </Card>
      <Card className="space-y-2 p-4" data-capabilities>
        <h2 className="text-[16px] font-semibold">What an independent coach gets</h2>
        <ul className="space-y-1.5 text-[14px]">
          {CAPABILITIES.map((c) => (
            <li key={c.key} className="flex items-start justify-between gap-3">
              <span>{c.label}</span>
              <span className={cn("shrink-0 text-[12px]", c.allowed.includes("independent_coach") ? "text-success" : "text-muted-foreground")}>
                {c.allowed.includes("independent_coach") ? "Yes, reviewed by them" : "Only you"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
