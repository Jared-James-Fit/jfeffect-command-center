import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Bookmark,
  CalendarCheck,
  ChevronRight,
  Hammer,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortalUserId } from "@/lib/client-impersonation";
import { useServiceTier } from "@/lib/service-tier";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/today";
import { GOALS, usePrograms, type BrowseFilters, type ProgramGoal } from "@/lib/athlete-programs";
import { programProgress, programProgressLine, splitOwnPrograms } from "@/lib/my-program";
import { programName } from "@/components/workouts/program-roadmap";
import { PlanLibraryBody } from "@/route-pages/_authenticated/portal/plans";
import { ProgramListCard } from "./program-list-card";
import { ManageProgramSheet } from "./manage-program-sheet";
import { useMyCurrentProgram } from "./use-my-program";
import { useSavedPlans, type SavedPlan } from "./use-saved-plans";

export type ProgramsTab = "mine" | "jf" | "crew";

const TAB_LABEL: Record<ProgramsTab, string> = {
  mine: "My programs",
  jf: "JF Effect",
  crew: "Crew",
};

/**
 * Programs: one page for every program, each tab saying where they come from.
 * My programs is what's on your calendar (with Manage: edit, switch, end) and
 * everything you built, copied or saved, in sections by source; JF Effect is
 * the coach-written library (members only: a coaching client's coach writes
 * their program); Crew is what the crew shares. The tab rides in the address,
 * so Back from a program lands on the tab it was opened from.
 */
export function ProgramsHub({ initialTab }: { initialTab?: ProgramsTab }) {
  const navigate = useNavigate();
  const { isSelfServe, loading } = useServiceTier();
  const tabs: ProgramsTab[] = isSelfServe ? ["mine", "jf", "crew"] : ["mine", "crew"];
  const wanted = initialTab ?? "mine";
  const [tab, setTabState] = useState<ProgramsTab>(wanted);
  // a link to a tab (or Back to one) moves the page there
  useEffect(() => setTabState(wanted), [wanted]);
  const shown: ProgramsTab = tabs.includes(tab) ? tab : "mine";
  const setTab = (t: ProgramsTab) => {
    setTabState(t);
    navigate({ to: "/portal/programs", search: { tab: t }, replace: true } as any);
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader
        title="Programs"
        actionsInline
        actions={
          <Button asChild size="sm">
            <Link to="/portal/programs/new">
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              Build
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 px-4 py-3 md:px-8">
        {loading ? (
          <Skeleton className="h-12 w-full rounded-xl" />
        ) : (
          <div
            className={cn(
              "grid gap-1 rounded-xl bg-muted p-1",
              tabs.length === 3 ? "grid-cols-3" : "grid-cols-2",
            )}
            role="tablist"
            aria-label="Programs"
          >
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={shown === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-10 rounded-lg text-[14px] font-medium transition",
                  shown === t
                    ? "bg-background text-foreground shadow-sm dark:bg-secondary"
                    : "text-muted-foreground",
                )}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <ListSkeleton />
        ) : shown === "mine" ? (
          <MyPrograms isSelfServe={isSelfServe} onTab={setTab} />
        ) : shown === "jf" ? (
          <JfTab />
        ) : (
          <CrewPrograms />
        )}
      </div>
    </div>
  );
}

/* ── My programs ─────────────────────────────────────────────────────── */

function MyPrograms({
  isSelfServe,
  onTab,
}: {
  isSelfServe: boolean;
  onTab: (t: ProgramsTab) => void;
}) {
  const { clientId } = useServiceTier();
  const userId = usePortalUserId();
  const current = useMyCurrentProgram(clientId, userId);
  const own = usePrograms("mine", {});
  const saved = useSavedPlans(isSelfServe);

  const { built, copied } = splitOwnPrograms(own.data ?? []);
  const savedPlans = isSelfServe ? saved.plans : [];
  const runningProgramId =
    current.origin.origin.kind === "own" ? current.origin.origin.programId : null;
  const runningPlanId = current.origin.planId;
  const hasRunning = !!current.roadmap;
  const nothingSaved = !built.length && !copied.length && !savedPlans.length;

  if (current.isLoading || own.isLoading || (isSelfServe && saved.loading)) return <ListSkeleton />;

  return (
    <div className="space-y-6" data-my-programs>
      {hasRunning && <OnYourCalendar current={current} isSelfServe={isSelfServe} />}

      {own.isError && (
        <Empty
          title="Couldn't load your programs"
          body="Check your connection."
          action={
            <Button variant="secondary" onClick={() => own.refetch()}>
              Try again
            </Button>
          }
        />
      )}

      {built.length > 0 && (
        <Section title="Built by you" count={built.length} icon={Hammer}>
          {built.map((p) => (
            <ProgramListCard
              key={p.id}
              program={p}
              showAuthor={false}
              running={p.id === runningProgramId}
            />
          ))}
        </Section>
      )}

      {copied.length > 0 && (
        <Section title="Copied from the crew" count={copied.length} icon={Users}>
          {copied.map((p) => (
            <ProgramListCard
              key={p.id}
              program={p}
              showAuthor={false}
              running={p.id === runningProgramId}
            />
          ))}
        </Section>
      )}

      {savedPlans.length > 0 && (
        <Section title="Saved JF Effect plans" count={savedPlans.length} icon={Bookmark}>
          {savedPlans.map((p) => (
            <SavedPlanCard key={p.id} plan={p} running={p.id === runningPlanId} />
          ))}
        </Section>
      )}

      {nothingSaved && !own.isError && (
        <FindPrograms isSelfServe={isSelfServe} onTab={onTab} hasRunning={hasRunning} />
      )}
    </div>
  );
}

function OnYourCalendar({
  current,
  isSelfServe,
}: {
  current: ReturnType<typeof useMyCurrentProgram>;
  isSelfServe: boolean;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const roadmap = current.roadmap!;
  const today = todayLocalISO();
  const facts = {
    programWeek: roadmap.programWeek,
    totalWeeks: roadmap.totalWeeks,
    start: roadmap.start,
    end: roadmap.end,
    today,
  };
  const name = programName(roadmap.program);
  const line = programProgressLine(facts);
  const pct = Math.round(programProgress(facts) * 100);
  const canManage = isSelfServe && current.origin.owned && !!current.origin.blockId;

  return (
    <section className="space-y-2" aria-label="On your calendar">
      <SectionTitle icon={CalendarCheck}>On your calendar</SectionTitle>
      <div className="rounded-2xl border border-border bg-card p-4" data-running-program>
        <div className="text-[13px] text-muted-foreground">{current.origin.label}</div>
        <div className="mt-0.5 text-[18px] font-semibold leading-snug">{name}</div>
        {line && (
          <div className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">{line}</div>
        )}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted-foreground/20" aria-hidden>
          <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button asChild variant="secondary" className="h-11 flex-1">
            <Link to="/portal/workouts">Open workouts</Link>
          </Button>
          {canManage && (
            <Button variant="outline" className="h-11 flex-1" onClick={() => setManageOpen(true)}>
              Manage
            </Button>
          )}
        </div>
      </div>
      {canManage && (
        <ManageProgramSheet
          open={manageOpen}
          onOpenChange={setManageOpen}
          name={name}
          progressLine={line}
          origin={current.origin}
        />
      )}
    </section>
  );
}

function SavedPlanCard({ plan: p, running }: { plan: SavedPlan; running: boolean }) {
  const meta = [
    p.weeks ? `${p.weeks} weeks` : null,
    p.days_per_week ? `${p.days_per_week} days a week` : null,
    p.est_minutes_per_workout ? `~${p.est_minutes_per_workout} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tags = [p.difficulty, p.goal].filter(Boolean) as string[];
  return (
    <Link
      to="/portal/plans/$planId"
      params={{ planId: p.id }}
      className="block rounded-2xl border border-border bg-card p-4 transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{p.public_title || p.name}</div>
          {meta && <div className="mt-0.5 text-[13px] text-muted-foreground">{meta}</div>}
        </div>
        {running ? <RunningChip /> : <SourceChip>JF Effect</SourceChip>}
      </div>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground"
            >
              {t.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

/** Nothing built or saved yet: the three ways to get a program, one tap each. */
function FindPrograms({
  isSelfServe,
  onTab,
  hasRunning,
}: {
  isSelfServe: boolean;
  onTab: (t: ProgramsTab) => void;
  hasRunning: boolean;
}) {
  return (
    <section className="space-y-2" aria-label="Find a program">
      {!hasRunning && (
        <div className="px-1 pb-1">
          <div className="text-[16px] font-semibold">No programs yet</div>
          <p className="text-[14px] text-muted-foreground">
            {isSelfServe
              ? "Start a JF Effect plan, copy one from the crew or build your own. Whatever you save or start shows up here."
              : "Copy one from the crew or build your own. Whatever you save shows up here."}
          </p>
        </div>
      )}
      {hasRunning && <SectionTitle icon={Search}>Find another program</SectionTitle>}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isSelfServe && (
          <FindRow
            icon={BookOpen}
            title="JF Effect plans"
            sub="Written by our coaches. Pick one and start today."
            onClick={() => onTab("jf")}
          />
        )}
        <FindRow
          icon={Users}
          title="Programs from the crew"
          sub="Save a copy of one someone shared and make it yours."
          onClick={() => onTab("crew")}
        />
        <FindRow
          icon={Hammer}
          title="Build your own"
          sub="Your week of training, from the exercise library."
          to="/portal/programs/new"
        />
      </div>
    </section>
  );
}

function FindRow({
  icon: Icon,
  title,
  sub,
  onClick,
  to,
}: {
  icon: typeof BookOpen;
  title: string;
  sub: string;
  onClick?: () => void;
  to?: string;
}) {
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] leading-snug text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
  const cls =
    "flex min-h-[64px] w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition last:border-b-0 hover:bg-secondary/40 active:bg-secondary/60";
  return to ? (
    <Link to={to as any} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

/* ── JF Effect ───────────────────────────────────────────────────────── */

function JfTab() {
  const { clientId } = useServiceTier();
  const userId = usePortalUserId();
  const current = useMyCurrentProgram(clientId, userId);
  return <PlanLibraryBody runningPlanId={current.origin.planId} />;
}

/* ── Crew ────────────────────────────────────────────────────────────── */

function CrewPrograms() {
  const [q, setQ] = useState("");
  const [goal, setGoal] = useState<ProgramGoal | null>(null);
  const [sort, setSort] = useState<"popular" | "new">("popular");
  // one search per pause in typing, not one per key
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const filters: BrowseFilters = { q: search, goal, sort };
  const { data, isLoading, isError, refetch } = usePrograms("community", filters);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the crew's programs"
          className="h-11 pl-9 text-base"
          aria-label="Search the crew's programs"
        />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" aria-label="Goal">
        <Chip on={!goal} onClick={() => setGoal(null)}>
          All
        </Chip>
        {GOALS.map((g) => (
          <Chip key={g.id} on={goal === g.id} onClick={() => setGoal(goal === g.id ? null : g.id)}>
            {g.label}
          </Chip>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Shared by people in JF Effect</p>
        <div className="flex items-center gap-1 text-[13px]">
          {(["popular", "new"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={cn(
                "h-9 rounded-lg px-3",
                sort === s ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {s === "popular" ? "Most saved" : "Newest"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton />
      ) : isError ? (
        <Empty
          title="Couldn't load programs"
          body="Check your connection."
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data?.length ? (
        <Empty
          title={q || goal ? "Nothing matches yet" : "No shared programs yet"}
          body="Build one and share it. The crew can save their own copy."
          action={
            <Button asChild variant="secondary">
              <Link to="/portal/programs/new">Build a program</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {data.map((p) => (
            <ProgramListCard key={p.id} program={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function Section({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <SectionTitle icon={icon} count={count}>
        {title}
      </SectionTitle>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SectionTitle({
  icon: Icon,
  count,
  children,
}: {
  icon: typeof BookOpen;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 px-1 text-[13px] font-semibold text-muted-foreground">
      <Icon className="h-4 w-4" aria-hidden />
      {children}
      {typeof count === "number" && <span className="font-normal tabular-nums">{count}</span>}
    </h2>
  );
}

function SourceChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function RunningChip() {
  return (
    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
      <CalendarCheck className="h-3 w-3" aria-hidden /> On your calendar
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full border px-3.5 text-[13px] transition",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[118px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
      <div className="text-[16px] font-semibold">{title}</div>
      <p className="mx-auto mt-1 max-w-[320px] text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
