/**
 * Admin → Settings → AI: the AI credits card. The monthly free credits for
 * members and coaching clients, what the last 30 days cost against what
 * credit packs brought in, who uses the AI most, recent purchases, and
 * giving someone credits (or taking them back).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getAiCreditsOverview,
  grantAiCredits,
  searchAiCreditPeople,
  setAiCreditAllowances,
} from "@/lib/ai-credits.functions";
import { CREDIT_PACKS, creditsNumber, packPrice } from "@/lib/ai-credits/packs";

const money = (minor: number) => `$${(Number(minor || 0) / 100).toFixed(2)}`;
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${Number(n || 0).toFixed(2)}`);
const tierLabel = (t: string) =>
  t === "coaching" ? "Coaching client" : t === "staff" ? "Staff" : "Member";

export function AiCreditsAdminCard() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getAiCreditsOverview);
  const q = useQuery({
    queryKey: ["ai-credits-overview"],
    queryFn: () => overviewFn({ data: { days: 30 } }),
  });
  const d = q.data as any;
  const allowances = d?.settings?.allowances as { member: number; coaching: number } | undefined;

  return (
    <Card className="space-y-4 p-4" data-ai-credits-admin>
      <div>
        <h2 className="text-base font-semibold">AI credits</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Members and clients get free AI credits each month (1 credit = 1 AI food log) and can buy
          more on the web through Stripe. Staff are never charged. A failed AI call gives its credit
          back.
        </p>
      </div>
      {q.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : q.error ? (
        <p className="text-[13px] text-destructive">
          {String((q.error as any)?.message ?? q.error)}
        </p>
      ) : (
        <>
          {allowances && (
            <AllowancesForm
              key={`${allowances.member}:${allowances.coaching}`}
              initial={allowances}
              onSaved={() => qc.invalidateQueries({ queryKey: ["ai-credits-overview"] })}
            />
          )}

          <div>
            <div className="mb-2 text-[13px] font-semibold">Last {d?.days ?? 30} days</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="AI uses"
                value={creditsNumber(d?.uses?.count ?? 0)}
                sub={`${creditsNumber(d?.uses?.people ?? 0)} people`}
              />
              <Stat
                label="AI cost (est.)"
                value={usd(Number(d?.uses?.cost_usd ?? 0))}
                sub="US$, from tokens"
              />
              <Stat
                label="Credits sold"
                value={money(d?.sales?.amount_minor ?? 0)}
                sub={`${creditsNumber(d?.sales?.count ?? 0)} packs, before tax`}
              />
              <Stat
                label="Refunded"
                value={money(d?.sales?.refunded_minor ?? 0)}
                sub={`${creditsNumber(d?.uses?.failed ?? 0)} failed calls refunded`}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 text-[13px] font-semibold">Packs (CAD, before tax)</div>
            <p className="text-[13px] text-muted-foreground">
              {CREDIT_PACKS.map((p) => `${creditsNumber(p.credits)} for ${packPrice(p)}`).join(
                " · ",
              )}
              . Each is a product in your Stripe account; Stripe Tax adds GST at checkout and the
              sales show in Taxes & Books.
            </p>
          </div>

          <GiveCredits onDone={() => qc.invalidateQueries({ queryKey: ["ai-credits-overview"] })} />

          {(d?.people ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-[13px] font-semibold">Who uses it</div>
              <ul className="divide-y divide-border/60">
                {(d.people as any[]).map((p) => (
                  <li
                    key={p.user_id}
                    className="flex items-center justify-between gap-3 py-2 text-[13px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name ?? "Unnamed"}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {tierLabel(p.tier)} · {creditsNumber(p.uses)} uses
                        {Number(p.cost_usd) > 0 ? ` · ${usd(Number(p.cost_usd))}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                      {p.tier === "staff" ? "Unlimited" : `${creditsNumber(p.left ?? 0)} left`}
                      {Number(p.extra) > 0 ? ` · ${creditsNumber(p.extra)} bought` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(d?.purchases ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-[13px] font-semibold">Recent purchases</div>
              <ul className="divide-y divide-border/60">
                {(d.purchases as any[]).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 py-2 text-[13px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name ?? "Unnamed"}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {creditsNumber(p.credits)} credits ·{" "}
                        {new Date(p.at).toLocaleDateString("en-CA", {
                          month: "short",
                          day: "numeric",
                        })}
                        {p.mode === "test" ? " · test" : ""}
                        {p.status !== "paid"
                          ? ` · ${p.status === "refunded" ? "refunded" : "part refunded"}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(p.total_minor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[17px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function AllowancesForm({
  initial,
  onSaved,
}: {
  initial: { member: number; coaching: number };
  onSaved: () => void;
}) {
  const save = useServerFn(setAiCreditAllowances);
  const [member, setMember] = useState(String(initial.member));
  const [coaching, setCoaching] = useState(String(initial.coaching));
  const changed = member !== String(initial.member) || coaching !== String(initial.coaching);
  const m = useMutation({
    mutationFn: () => {
      const a = Number.parseInt(member, 10);
      const b = Number.parseInt(coaching, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0)
        throw new Error("Use whole numbers, 0 or more.");
      return save({ data: { member: a, coaching: b } });
    },
    onSuccess: () => {
      toast.success("Monthly credits saved");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });
  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold">Free credits each month</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[12px] text-muted-foreground">
          JF members
          <Input
            inputMode="numeric"
            value={member}
            onChange={(e) => setMember(e.target.value.replace(/\D/g, ""))}
            className="mt-1 h-10"
          />
        </label>
        <label className="text-[12px] text-muted-foreground">
          Coaching clients
          <Input
            inputMode="numeric"
            value={coaching}
            onChange={(e) => setCoaching(e.target.value.replace(/\D/g, ""))}
            className="mt-1 h-10"
          />
        </label>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        They start over on the 1st of each month (Winnipeg time). Bought credits never expire.
      </p>
      {changed && (
        <Button className="mt-2 h-10" onClick={() => m.mutate()} disabled={m.isPending}>
          {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
        </Button>
      )}
    </div>
  );
}

function GiveCredits({ onDone }: { onDone: () => void }) {
  const search = useServerFn(searchAiCreditPeople);
  const grant = useServerFn(grantAiCredits);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ userId: string; name: string } | null>(null);
  const [amount, setAmount] = useState("50");
  const results = useQuery({
    queryKey: ["ai-credit-people", q.trim()],
    queryFn: () => search({ data: { q: q.trim() } }),
    enabled: !pick && q.trim().length >= 2,
    staleTime: 30_000,
  });
  const m = useMutation({
    mutationFn: (sign: 1 | -1) => {
      const n = Number.parseInt(amount, 10);
      if (!pick || !Number.isFinite(n) || n <= 0)
        throw new Error("Pick someone and a number of credits.");
      return grant({ data: { userId: pick.userId, credits: sign * n } });
    },
    onSuccess: (state: any, sign) => {
      toast.success(
        `${sign > 0 ? "Gave" : "Took back"} credits. ${pick?.name ?? "They"} now ${state?.left != null ? `has ${creditsNumber(state.left)}` : "have unlimited"}.`,
      );
      setPick(null);
      setQ("");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change their credits"),
  });
  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold">Give credits</div>
      {pick ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-[14px]">
            <span className="truncate font-medium">{pick.name}</span>
            <button
              type="button"
              className="h-9 shrink-0 px-2 text-[13px] text-muted-foreground"
              onClick={() => setPick(null)}
            >
              Change
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              className="h-10 w-28"
              aria-label="Credits"
            />
            <Button className="h-10" onClick={() => m.mutate(1)} disabled={m.isPending}>
              Give
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => m.mutate(-1)}
              disabled={m.isPending}
            >
              Take back
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Given credits never expire, like bought ones.
          </p>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a member or client"
              className="h-10 pl-9"
            />
          </div>
          {results.isFetching && (
            <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {(results.data ?? []).length > 0 && (
            <ul className="mt-1 divide-y divide-border/60">
              {(results.data ?? []).map((r) => (
                <li key={r.userId}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left text-[14px]"
                    onClick={() => setPick({ userId: r.userId, name: r.name })}
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{r.tier}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && !results.isFetching && (results.data ?? []).length === 0 && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Nobody with a login by that name.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
