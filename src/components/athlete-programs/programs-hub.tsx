import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useServiceTier } from "@/lib/service-tier";
import { cn } from "@/lib/utils";
import { GOALS, usePrograms, type BrowseFilters, type ProgramGoal } from "@/lib/athlete-programs";
import { ProgramListCard } from "./program-list-card";

type Tab = "crew" | "mine";

/**
 * Programs: what the crew shares and what you've built or saved. JF Effect's
 * own coach-written plans live in the Plan Library, one tap away.
 */
export function ProgramsHub({ initialTab = "crew" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const { isSelfServe } = useServiceTier();

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
        <div
          className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
          role="tablist"
          aria-label="Programs"
        >
          {(["crew", "mine"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "h-10 rounded-lg text-[14px] font-medium transition",
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t === "crew" ? "From the crew" : "My programs"}
            </button>
          ))}
        </div>

        {isSelfServe && (
          <Link
            to="/portal/plans"
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">JF Effect plans</div>
              <div className="text-[13px] text-muted-foreground">
                Written by our coaches. Pick one and start today.
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}

        {tab === "crew" ? <CrewPrograms /> : <MyPrograms onBrowse={() => setTab("crew")} />}
      </div>
    </div>
  );
}

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
          placeholder="Search programs"
          className="h-11 pl-9 text-base"
          aria-label="Search programs"
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
      <div className="flex items-center justify-end gap-1 text-[13px]">
        {(["popular", "new"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={cn(
              "h-9 rounded-lg px-3",
              sort === s ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {s === "popular" ? "Most saved" : "Newest"}
          </button>
        ))}
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
            <Button asChild>
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

function MyPrograms({ onBrowse }: { onBrowse: () => void }) {
  const { data, isLoading, isError, refetch } = usePrograms("mine", {});
  if (isLoading) return <ListSkeleton />;
  if (isError)
    return (
      <Empty
        title="Couldn't load your programs"
        body="Check your connection."
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  if (!data?.length) {
    return (
      <Empty
        title="No programs yet"
        body="Build your own week of training, or save a copy of one from the crew and make it yours."
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link to="/portal/programs/new">Build a program</Link>
            </Button>
            <Button variant="secondary" onClick={onBrowse}>
              Browse the crew's
            </Button>
          </div>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {data.map((p) => (
        <ProgramListCard key={p.id} program={p} showAuthor={false} />
      ))}
    </div>
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
