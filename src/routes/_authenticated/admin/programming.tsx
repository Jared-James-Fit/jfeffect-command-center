import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { ProgramLibrary } from "./program-library";
import { ExercisesAdmin } from "./exercises";
import { CardioDashboard } from "./cardio-targets";
import { WarmupProtocolsAdmin } from "./warmup-protocols";
import { AdminRecipes } from "./recipes";
import { ProgramFinder, type FinderItem } from "@/components/programs/program-finder";
import { useQuery } from "@tanstack/react-query";
import { listTemplates } from "@/lib/pl-programs";
import { supabase } from "@/integrations/supabase/client";

type TabKey = "programs" | "browse" | "exercises" | "cardio" | "warmups" | "recipes";
const TABS: { value: TabKey; label: string }[] = [
  { value: "programs", label: "Programs" },
  { value: "browse", label: "Browse" },
  { value: "exercises", label: "Exercises" },
  { value: "cardio", label: "Cardio" },
  { value: "warmups", label: "Warm-Ups" },
  { value: "recipes", label: "Recipes" },
];
const LAST_TAB_KEY = "jf-admin-programming-last-tab";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

export const Route = createFileRoute("/_authenticated/admin/programming")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey } => {
    const t = raw?.tab;
    if (isTab(t)) return { tab: t };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s }; } catch {}
    }
    return { tab: "programs" };
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
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  useMemo(() => { try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {} }, [tab]);
  const setTab = (n: TabKey) => navigate({ to: "/admin/programming", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Programming" subtitle="Programs, exercises, cardio, warm-ups, and recipes." />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button key={t.value} type="button" onClick={() => setTab(t.value)}
                className={cn("shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "programs" && <ProgramLibrary embedded />}
        {tab === "browse" && <AdminProgramBrowser />}
        {tab === "exercises" && <ExercisesAdmin embedded />}
        {tab === "cardio" && <CardioDashboard embedded />}
        {tab === "warmups" && <WarmupProtocolsAdmin embedded />}
        {tab === "recipes" && <AdminRecipes embedded />}
      </div>
    </>
  );
}

function AdminProgramBrowser() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-finder-templates"],
    queryFn: () => listTemplates({ type: "all", style: "all" }),
  });
  const items: FinderItem[] = useMemo(() => (data ?? []).map((t: any) => ({
    id: t.id,
    title: t.name,
    trainingStyle: t.training_style,
    level: t.difficulty ?? t.training_focus,
    weeks: t.weeks,
    daysPerWeek: t.days_per_week,
    goal: t.goal ?? t.training_focus,
    raw: t,
  })), [data]);
  return (
    <div className="p-3 sm:p-4 md:p-6">
      <ProgramFinder
        items={items}
        loading={isLoading}
        loadPayload={async (it) => {
          const { data } = await supabase.from("pl_templates").select("payload").eq("id", it.id).maybeSingle();
          return (data as any)?.payload ?? null;
        }}
      />
    </div>
  );
}