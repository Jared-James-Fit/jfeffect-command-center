/**
 * Membership home (/admin/membership, Nov 23 2026). JF Effect is free by application, so the page
 * leads with what decides whether membership works: is it growing, are members training, and what
 * needs the coach now; then the plans people can move to, then the members themselves. Rarely
 * needed tools (links, emails, legacy paid billing, checkout) sit in one menu, never deleted.
 */
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Eye, Loader2, MoreHorizontal, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CLIENT_VIEW_HOME } from "@/lib/launch-home";
import { setPovPersona } from "@/lib/pov.functions";
import { setPovFlag } from "@/components/pov-quick-toggle";
import { getMembershipOverviewFn } from "@/lib/admin-intel/membership.functions";
import { getRecentlyExpiredMembers, grantTemporaryAccess } from "@/lib/membership-admin.functions";
import { countChange } from "@/lib/admin-intel/usage-model";
import { MembersDirectory } from "@/components/members/members-directory";
import { useEnterClientPov } from "@/components/clients/use-enter-client-pov";
import { Funnel, IntelSection, Kpi, PeriodSwitch } from "./intel-ui";
import { ChangePlanSheet } from "./change-plan-sheet";

const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (ym: string) => MON[Number(ym.slice(5, 7)) - 1] ?? ym;
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const daysAgo = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);
const money = (minor: number) => `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)}`;

export function MembershipHome() {
  const [days, setDays] = useState<number>(30);
  const fetchOverview = useServerFn(getMembershipOverviewFn);
  const q = useQuery({
    queryKey: ["admin-membership-overview", days],
    queryFn: () => fetchOverview({ data: { days } }),
    refetchInterval: 120_000,
    placeholderData: (p) => p,
  });
  const d = q.data as any;
  const o = d?.overview ?? {};
  const mem = o.members ?? {};
  const apps = o.applications ?? {};
  const [planFor, setPlanFor] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-28 pt-2 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted-foreground">
          JF Effect is free by application. What matters: people joining, members training, and members ready for coaching.
        </p>
        <div className="flex items-center gap-2">
          <PeriodSwitch value={days} options={PERIODS as any} onChange={setDays} />
          <ToolsMenu />
        </div>
      </div>

      {q.isLoading && !d ? (
        <div className="space-y-4" aria-busy>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[112px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[240px] rounded-2xl" />
        </div>
      ) : q.error && !d ? (
        <IntelSection title="Couldn't load membership">
          <p className="text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</p>
          <Button className="mt-3" variant="outline" onClick={() => q.refetch()}>Try again</Button>
        </IntelSection>
      ) : (
        <>
          {/* 1. health and growth */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Members"
              value={mem.total ?? 0}
              sub={`+${mem.new ?? 0} in ${days} days${mem.deactivated ? ` · ${mem.deactivated} deactivated` : ""}`}
              delta={countChange(mem.new ?? 0, mem.new_prev ?? 0)}
            />
            <Kpi
              label="Active this week"
              value={mem.active7 ?? 0}
              sub={mem.total ? `${Math.round(((mem.active7 ?? 0) / mem.total) * 100)}% of members opened the app` : "No members yet"}
              tone={mem.total >= 5 && (mem.active7 ?? 0) / mem.total < 0.3 ? "warn" : "neutral"}
            />
            <Kpi
              label="Trained in 30 days"
              value={mem.trained30 ?? 0}
              sub={mem.total ? `${Math.round(((mem.trained30 ?? 0) / mem.total) * 100)}% logged a workout` : "—"}
            />
            <Kpi
              label="Became coaching clients"
              value={o.conversions?.to_coaching ?? 0}
              sub={`in ${days} days · ${o.conversions?.clients_from_membership ?? 0} ${(o.conversions?.clients_from_membership ?? 0) === 1 ? "client" : "clients"} started as a member · ${money(Number(o.revenue?.from_converted_minor ?? 0))} paid by them`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <IntelSection className="lg:col-span-3" title="Growth" sub="Members at each month's end, and how many of them opened the app that month.">
              <GrowthBars rows={o.growth ?? []} />
            </IntelSection>
            <IntelSection className="lg:col-span-2" title="Joining" sub={`Applications in the last ${days} days.`}>
              <Funnel
                steps={[
                  { label: "Applied", value: Number(d?.funnel?.submitted ?? apps.received ?? 0) },
                  { label: "Approved", value: Number(d?.funnel?.approved ?? apps.approved ?? 0) },
                  { label: "Joined", value: Number(d?.funnel?.activated ?? apps.joined ?? 0) },
                  { label: "Trained in week 1", value: Number(d?.funnel?.trained ?? 0) },
                ]}
              />
              <Link to="/admin/leads" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
                Applications <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </IntelSection>
          </div>

          {/* 2. what needs the coach */}
          <NeedsYou o={o} onChangePlan={setPlanFor} />

          {/* 3. plans */}
          <Plans packages={d?.packages ?? []} legacy={o.legacy_paid} programs={o.programs} revenue={o.revenue} days={days} />

          {/* 4. members */}
          <IntelSection
            title="Members"
            sub="Open a member for their account, access and plan. Their own record holds every workout and post."
            action={
              <Button asChild size="sm" variant="outline" className="h-9">
                <Link to="/admin/members/new"><UserPlus className="mr-1.5 h-4 w-4" />Add</Link>
              </Button>
            }
          >
            <MembersDirectory />
          </IntelSection>
        </>
      )}
      <ChangePlanSheet clientId={planFor} open={!!planFor} onOpenChange={(o2) => !o2 && setPlanFor(null)} />
    </div>
  );
}

function GrowthBars({ rows }: { rows: { month: string; joined: number; total: number; active: number }[] }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No members yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Number(r.total)));
  return (
    <div>
      <div className="mb-2 flex gap-3 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/35" aria-hidden />Members</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-1)" }} aria-hidden />Opened the app</span>
      </div>
      <div className="flex h-44 items-end gap-2" role="img" aria-label={rows.map((r) => `${monthShort(r.month)}: ${r.total} members, ${r.active} active, ${r.joined} joined`).join("; ")}>
        {rows.map((r) => (
          <div key={r.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${monthShort(r.month)}: ${r.total} members, ${r.active} opened the app, ${r.joined} joined`}>
            <span className="text-[11px] tabular-nums text-muted-foreground">{r.total}</span>
            <div className="relative w-full max-w-12 rounded-t bg-muted-foreground/20" style={{ height: `${Math.max(2, (Number(r.total) / max) * 100)}%` }}>
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t"
                style={{ height: `${r.total ? Math.min(100, (Number(r.active) / Number(r.total)) * 100) : 0}%`, background: "var(--viz-1)" }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">{monthShort(r.month)}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">+{r.joined}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NeedsYou({ o, onChangePlan }: { o: any; onChangePlan: (clientId: string) => void }) {
  const qc = useQueryClient();
  const fetchExpired = useServerFn(getRecentlyExpiredMembers);
  const grant = useServerFn(grantTemporaryAccess);
  const expired = useQuery({ queryKey: ["jf-recently-expired"], queryFn: () => fetchExpired(), staleTime: 60_000 });
  const pov = useEnterClientPov();
  const [granting, setGranting] = useState<string | null>(null);
  const apps = o.applications ?? {};
  const notTrained: any[] = o.not_trained ?? [];
  const setup: any[] = o.setup_list ?? [];
  const legacyFailing = Number(o.legacy_paid?.failing ?? 0);
  const expiredList: any[] = (expired.data as any)?.members ?? [];
  const nothing = !apps.waiting && !apps.approved_not_joined && !notTrained.length && !setup.length && !legacyFailing && !expiredList.length;

  const onGrant = async (memberId: string, name: string) => {
    setGranting(memberId);
    try {
      await grant({ data: { memberId, days: 7 } });
      toast.success(`7 days of access for ${name}`);
      await qc.invalidateQueries({ queryKey: ["jf-recently-expired"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't grant access");
    } finally {
      setGranting(null);
    }
  };

  return (
    <IntelSection title="Needs you" sub={nothing ? undefined : "Most important first."}>
      {nothing ? (
        <p className="text-[14px] text-muted-foreground">All caught up: no applications waiting and every member is set up and training.</p>
      ) : (
        <div className="space-y-4">
          {(apps.waiting > 0 || apps.approved_not_joined > 0) && (
            <Group
              title={apps.waiting > 0 ? `${apps.waiting} application${apps.waiting === 1 ? "" : "s"} waiting` : `${apps.approved_not_joined} approved, not joined yet`}
              hint={apps.oldest_waiting ? `oldest from ${shortDate(apps.oldest_waiting)} (${daysAgo(apps.oldest_waiting)} days)` : undefined}
              tone={apps.waiting > 0 && (daysAgo(apps.oldest_waiting) ?? 0) >= 2 ? "warn" : undefined}
              action={<Button asChild size="sm" className="h-9"><Link to="/admin/leads">Review</Link></Button>}
            >
              {(apps.list ?? []).map((a: any) => (
                <Row key={a.id} name={a.name} line={`Applied ${shortDate(a.created_at)}${a.coaching_interest === "yes" ? " · wants coaching" : a.coaching_interest === "maybe" ? " · maybe coaching" : ""}`} />
              ))}
              {apps.approved_not_joined > 0 && apps.waiting > 0 && (
                <p className="px-2 pt-1 text-[12px] text-muted-foreground">{apps.approved_not_joined} approved and not joined yet: a nudge in Applications helps.</p>
              )}
            </Group>
          )}
          {notTrained.length > 0 && (
            <Group title={`${o.members?.never_trained ?? notTrained.length} joined a week+ ago and haven't trained`} hint="A message and a first program usually gets them going.">
              {notTrained.map((m) => (
                <Row
                  key={m.client_id}
                  name={m.name}
                  line={`Joined ${shortDate(m.joined)} · last in the app ${m.last_active ? shortDate(m.last_active) : "never"}`}
                  actions={
                    <>
                      {pov.canPov && (
                        <Button size="sm" variant="ghost" className="h-9 px-2" onClick={() => pov.enter(m.client_id, { fallbackName: m.name })} disabled={pov.busy} aria-label={`See ${m.name}'s app`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-9 px-2 text-[12px]" onClick={() => onChangePlan(m.client_id)}>
                        Plan
                      </Button>
                    </>
                  }
                  to={`/admin/clients/${m.client_id}`}
                />
              ))}
            </Group>
          )}
          {setup.length > 0 && (
            <Group title={`${o.members?.setup_unfinished ?? setup.length} haven't finished setup`} hint="Their goal and training days decide their first program.">
              {setup.map((m) => (
                <Row key={m.client_id} name={m.name} line={`Joined ${shortDate(m.joined)}`} to={m.member_id ? `/admin/members/${m.member_id}` : `/admin/clients/${m.client_id}`} />
              ))}
            </Group>
          )}
          {(legacyFailing > 0 || expiredList.length > 0) && (
            <Group title="Legacy paid membership" hint="From before membership was free.">
              {legacyFailing > 0 && (
                <Row name={`${legacyFailing} payment${legacyFailing === 1 ? "" : "s"} failing`} line="Stripe couldn't charge a legacy subscription" to="/admin/membership/action-needed" />
              )}
              {expiredList.map((m) => (
                <Row
                  key={m.id}
                  name={m.full_name || m.email}
                  line={`Access ended ${shortDate(m._expiredAt)}`}
                  actions={
                    <Button size="sm" variant="outline" className="h-9" onClick={() => onGrant(m.id, m.full_name || m.email)} disabled={granting === m.id}>
                      {granting === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant 7 days"}
                    </Button>
                  }
                />
              ))}
            </Group>
          )}
        </div>
      )}
    </IntelSection>
  );
}

function Group({ title, hint, tone, action, children }: { title: string; hint?: string; tone?: "warn"; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border", tone === "warn" && "border-amber-500/40")}>
      <div className="flex items-start justify-between gap-3 border-b px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{title}</div>
          {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
        </div>
        {action}
      </div>
      <div className="divide-y p-1">{children}</div>
    </div>
  );
}

function Row({ name, line, actions, to }: { name: string; line: string; actions?: React.ReactNode; to?: string }) {
  const body = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[14px] font-medium">{name}</span>
      <span className="block truncate text-[12px] text-muted-foreground">{line}</span>
    </span>
  );
  return (
    <div className="flex min-h-12 items-center gap-2 px-2 py-1.5">
      {to ? (
        <Link to={to as any} className="flex min-w-0 flex-1 items-center gap-2 rounded-md hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
      {actions}
    </div>
  );
}

function Plans({ packages, legacy, programs, revenue, days }: { packages: any[]; legacy: any; programs: any; revenue: any; days: number }) {
  const paid = packages.filter((p) => p.priceCents > 0 && p.listed);
  return (
    <IntelSection
      title="Plans"
      sub="What members have, and what they can move up to."
      action={
        <Button asChild size="sm" variant="outline" className="h-9">
          <Link to="/admin/sales" search={{ tab: "coaching" } as any}>Packages</Link>
        </Button>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border p-3">
          <div className="text-[13px] text-muted-foreground">Free membership</div>
          <div className="mt-0.5 text-xl font-semibold">$0</div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            The app, Crew and {programs?.library_live ?? 0} JF Effect programs. {programs?.on_program ?? 0} members are on a program.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Credits sold in {days} days: {revenue?.credit_packs ?? 0} pack{revenue?.credit_packs === 1 ? "" : "s"} · {money(Number(revenue?.credit_packs_minor ?? 0))}
          </p>
        </div>
        <div className="rounded-xl border p-3 md:col-span-2">
          <div className="text-[13px] text-muted-foreground">Coaching, the next step up</div>
          {paid.length ? (
            <ul className="mt-1 divide-y text-[13px]">
              {paid.map((p) => (
                <li key={p.slug} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate font-medium">
                    {p.name}
                    {p.recommended && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">recommended</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{money(p.priceCents)}{p.interval === "month" ? "/month" : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">No coaching package is on the site.</p>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">Move a member to coaching from their row (Plan) or their member page; it keeps every record and charges nothing.</p>
        </div>
      </div>
      {Number(legacy?.total ?? 0) > 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Paid membership is retired. {legacy.total} legacy subscription{legacy.total === 1 ? "" : "s"} on record:{" "}
          {Object.entries(legacy.by_status ?? {}).map(([k, n]) => `${n} ${k}`).join(", ")}.{" "}
          <Link to="/admin/membership/billing" className="underline-offset-2 hover:underline">See them</Link>
        </p>
      )}
    </IntelSection>
  );
}

/** Everything set once or needed rarely, in one place: none of it is gone, it's just not in the way. */
function ToolsMenu() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setPersona = useServerFn(setPovPersona);
  const [busy, setBusy] = useState(false);
  const preview = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setPersona({ data: { persona: "app_member" } as any });
      setPovFlag("app_member", "/admin/membership");
      await qc.invalidateQueries({ queryKey: ["m-me"] });
      await qc.invalidateQueries({ queryKey: ["current-member-access"] });
      toast.success("Showing the member app as your test member");
      navigate({ to: CLIENT_VIEW_HOME });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open the member app");
    } finally {
      setBusy(false);
    }
  };
  const links: [string, string][] = [
    ["/admin/leads", "Applications"],
    ["/admin/members", "All members"],
    ["/admin/membership/sms-email", "Setup & reset links"],
    ["/admin/membership/onboarding-email", "Onboarding email"],
    ["/admin/membership/action-needed", "Access & setup issues"],
  ];
  const legacy: [string, string][] = [
    ["/admin/membership/billing", "Legacy subscriptions"],
    ["/admin/membership/billing-events", "Stripe membership events"],
    ["/admin/membership/checkout-settings", "Paid checkout settings"],
    ["/admin/discount-codes", "Discount codes"],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Membership tools">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={preview} disabled={busy}>
          <Eye className="mr-2 h-4 w-4" /> Preview the member app
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {links.map(([to, label]) => (
          <DropdownMenuItem key={to} onSelect={() => navigate({ to: to as any })}>{label}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Legacy paid membership</DropdownMenuLabel>
        {legacy.map(([to, label]) => (
          <DropdownMenuItem key={to} onSelect={() => navigate({ to: to as any })}>{label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
