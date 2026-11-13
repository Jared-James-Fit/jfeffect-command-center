import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { ProgramLibrary } from "@/route-pages/_authenticated/admin/program-library";
import { ExercisesAdmin } from "@/route-pages/_authenticated/admin/exercises";
import { CardioDashboard } from "@/route-pages/_authenticated/admin/cardio-targets";
import { WarmupProtocolsAdmin } from "@/route-pages/_authenticated/admin/warmup-protocols";
import { AdminRecipes } from "@/route-pages/_authenticated/admin/recipes";

// One program library for coaching and the membership app: a program is in
// the membership app when its listing is on (the Membership app chip), never
// a second library. The old "List" tab (a second view of the same programs)
// and the membership pages (/admin/membership/programs, /admin/member-plans)
// land here.
type TabKey = "programs" | "exercises" | "cardio" | "warmups" | "recipes";
const TABS: { value: TabKey; label: string }[] = [
  { value: "programs", label: "Programs" },
  { value: "exercises", label: "Exercises" },
  { value: "cardio", label: "Cardio" },
  { value: "warmups", label: "Warm-Ups" },
  { value: "recipes", label: "Recipes" },
];
const LAST_TAB_KEY = "jf-admin-programming-last-tab";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

export const Route = createFileRoute("/_authenticated/admin/programming")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey; audience?: "membership"; new?: 1 } => {
    const t = raw?.tab === "browse" ? "programs" : raw?.tab;
    const audience = raw?.audience === "membership" ? "membership" as const : undefined;
    const extra = { audience, ...(raw?.new === 1 || raw?.new === "1" ? { new: 1 as const } : {}) };
    if (isTab(t)) return { tab: t, ...extra };
    if (audience || extra.new) return { tab: "programs", ...extra };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s, ...extra }; } catch {}
    }
    return { tab: "programs", ...extra };
  },
  component: ProgrammingWorkspace,
  pendingComponent: ProgrammingSkeleton,
});

function ProgrammingSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div className="h-10 w-48 animate-pulse rounded bg-muted" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="h-72 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

function ProgrammingWorkspace() {
  const { tab, audience, new: openNew } = Route.useSearch();
  const navigate = useNavigate();
  useMemo(() => { try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {} }, [tab]);
  const setTab = (n: TabKey) => navigate({ to: "/admin/programming", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Programming" />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button key={t.value} type="button" onClick={() => setTab(t.value)}
                className={cn("shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "programs" && <ProgramLibrary embedded initialAudience={audience === "membership" ? "membership" : "all"} openNew={openNew === 1} />}
        {tab === "exercises" && <ExercisesAdmin embedded />}
        {tab === "cardio" && <CardioDashboard embedded />}
        {tab === "warmups" && <WarmupProtocolsAdmin embedded />}
        {tab === "recipes" && <AdminRecipes embedded />}
      </div>
    </>
  );
}
