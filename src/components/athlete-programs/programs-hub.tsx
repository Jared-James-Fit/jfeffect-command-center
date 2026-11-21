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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProgramStartOptions } from "@/components/program-import/program-start-options";
import { OpenImports } from "@/components/program-import/open-imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortalUserId } from "@/lib/client-impersonation";
import { useServiceTier } from "@/lib/service-tier";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/today";
import { GOALS, usePrograms, type BrowseFilters, type ProgramGoal } from "@/lib/athlete-programs";
import { pausedProgram, splitOwnPrograms } from "@/lib/my-program";
import { roadmapProgressLine } from "@/lib/training-roadmap";
import { ActiveProgramHeader, programHeading } from "@/components/workouts/program-roadmap";
import { PlanLibraryBody } from "@/route-pages/_authenticated/portal/plans";
import { ProgramListCard } from "./program-list-card";
import { ManageProgramSheet } from "./manage-program-sheet";
import { useMyCurrentProgram, useProgramHistory } from "./use-my-program";
import { PausedProgramCard, ProgramHistoryRow } from "./program-history";
import { useSavedPlans, type SavedPlan } from "./use-saved-plans";

export type ProgramsTab = "mine" | "jf" | "crew";

/** Each tab named for what's in it; the smallest phones get the short name. */
const TAB_LABEL: Record<ProgramsTab, { full: string; short: string }> = {
  mine: { full: "My programs", short: "Mine" },
  jf: { full: "JF Effect plans", short: "JF Effect" },
  crew: { full: "Crew programs", short: "Crew" },
};

/**
 * What each tab is, said once under the tabs, so someone new can tell the
 * three apart: theirs (and what's on their calendar), the coach-written
 * plans, and what other members built and shared.
 */
/** One quiet line under the tabs saying what each one holds. */
const TAB_LINE: Record<ProgramsTab, string> = {
  mine: "What's on your calendar, and programs you built or saved.",
  jf: "Plans written by JF Effect coaches. Pick one and start it today.",
  crew: "Programs members built and shared. Save a copy to make it yours.",
};

/**
 * Programs: one page for every program, each tab saying where they come from.
 * My programs is what's on your calendar (with Manage: edit, switch, pause,
 * end; a paused one with Resume) and everything you built, copied or saved,
 * in sections by source, then Program history; JF Effect is
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
  const [startOpen, setStartOpen] = useState(false);
  const setTab = (t: ProgramsTab) => {
    setTabState(t);
    navigate({ to: "/portal/programs", search: { tab: t }, replace: true } as any);
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      {/* A page under Workouts, so Back like every page beside it (a program,
          a plan, the builder, analytics): to wherever they came from, else Workouts. */}
      <PageHeader
        title="Programs"
        backTo="/portal/workouts"
        actions={
          <Button size="sm" variant="secondary" onClick={() => setStartOpen(true)} data-new-program>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            New program
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
                  "h-10 min-w-0 rounded-lg px-1 text-[14px] font-medium transition",
                  shown === t
                    ? "bg-background text-foreground shadow-sm dark:bg-secondary"
                    : "text-muted-foreground",
                )}
                data-programs-tab={t}
              >
                <span className="max-[359px]:hidden">{TAB_LABEL[t].full}</span>
                <span className="hidden max-[359px]:inline">{TAB_LABEL[t].short}</span>
              </button>
            ))}
          </div>
        )}

        {!loading && (
          <TabLine tab={shown} coachWrites={!isSelfServe} />
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
      <Sheet open={startOpen} onOpenChange={setStartOpen}>
        <SheetContent side="bottom" swipeToClose className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>New program</SheetTitle>
            <SheetDescription>Every way ends in a program you can edit and track.</SheetDescription>
          </SheetHeader>
          <ProgramStartOptions
            ways={isSelfServe ? ["follow", "build", "import"] : ["build", "import"]}
            onFollow={() => {
              setStartOpen(false);
              setTab("jf");
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TabLine({ tab, coachWrites }: { tab: ProgramsTab; coachWrites: boolean }) {
  return (
    <p className="-mt-1 px-1 text-[13px] leading-snug text-muted-foreground" data-tab-line={tab}>
      {tab === "mine" && coachWrites
        ? "Your coach writes your training. You can still build programs of your own and share them."
        : TAB_LINE[tab]}
    </p>
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
  // programs they paused, ended or switched from (members only)
  const history = useProgramHistory(isSelfServe);

  const { built, copied } = splitOwnPrograms(own.data ?? []);
  const savedPlans = isSelfServe ? saved.plans : [];
  const runningProgramId =
    current.origin.origin.kind === "own" ? current.origin.origin.programId : null;
  const runningPlanId = current.origin.planId;
  const hasRunning = !!current.roadmap;
  const paused = pausedProgram(history.data, hasRunning);
  const pastCount = history.data?.length ?? 0;
  const nothingSaved = !built.length && !copied.length && !savedPlans.length;

  if (current.isLoading || own.isLoading || (isSelfServe && (saved.loading || history.isLoading))) return <ListSkeleton />;

  return (
    <div className="space-y-6" data-my-programs>
      {hasRunning && <OnYourCalendar current={current} isSelfServe={isSelfServe} />}
      {/* nothing on their calendar but a program they paused: it comes back with one tap */}
      {!hasRunning && paused && (
        <PausedProgramCard entry={paused} chooseAnother={false} />
      )}

      {/* a program being imported, or read and waiting to be checked */}
      <OpenImports />

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
        <FindPrograms isSelfServe={isSelfServe} onTab={onTab} hasRunning={hasRunning || !!paused} />
      )}

      {/* every program they paused, ended or switched from: resume, start over or remove */}
      {isSelfServe && pastCount > 0 && <ProgramHistoryRow count={pastCount} />}
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
  const name = programHeading(roadmap.program);
  // the same heading as the Workouts card, with where it came from over the
  // name (this page sorts programs by where they're from)
  const line = roadmapProgressLine(roadmap, today);
  const canManage = isSelfServe && current.origin.owned && !!current.origin.blockId;

  return (
    <section className="space-y-2" aria-label="On your calendar">
      <SectionTitle icon={CalendarCheck}>On your calendar</SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-border bg-card" data-running-program>
        <div className="p-4">
          <ActiveProgramHeader
            name={name}
            eyebrow={current.origin.label}
            line={line}
            blocks={roadmap.blocks}
            onManage={canManage ? () => setManageOpen(true) : undefined}
          />
        </div>
        <Link
          to="/portal/workouts"
          className="flex min-h-12 items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-[14px] font-semibold transition hover:bg-secondary/40"
          data-open-workouts
        >
          <span>Go to your workouts</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Link>
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
  const words = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const meta = [
    p.weeks ? `${p.weeks} weeks` : null,
    p.days_per_week ? `${p.days_per_week} days a week` : null,
    p.est_minutes_per_workout ? `~${p.est_minutes_per_workout} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tags = ([p.difficulty, p.goal].filter(Boolean) as string[]).map(words).join(" · ");
  return (
    <Link
      to="/portal/plans/$planId"
      params={{ planId: p.id }}
      className="block rounded-2xl border border-border bg-card p-4 transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 truncate text-[16px] font-semibold">{p.public_title || p.name}</div>
        {running && <RunningChip />}
      </div>
      {meta && <div className="mt-0.5 text-[13px] text-muted-foreground">{meta}</div>}
      {tags && <div className="text-[13px] text-muted-foreground">{tags}</div>}
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
      <ProgramStartOptions
        ways={isSelfServe ? ["follow", "build", "import"] : ["build", "import"]}
        onFollow={() => onTab("jf")}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <FindRow
          icon={Users}
          title="Programs from the crew"
          sub="Save a copy of one someone shared and make it yours."
          onClick={() => onTab("crew")}
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
