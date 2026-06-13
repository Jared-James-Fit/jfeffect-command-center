import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { ProgramLibrary } from "./program-library";
import { ExercisesAdmin } from "./exercises";
import { CardioDashboard } from "./cardio-targets";
import { WarmupProtocolsAdmin } from "./warmup-protocols";
import { AdminRecipes } from "./recipes";

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
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey } => {
    const t = raw?.tab;
    if (isTab(t)) return { tab: t };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s }; } catch {}
    }
    return { tab: "programs" };
  },
  component: ProgrammingWorkspace,
});

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
        {tab === "exercises" && <ExercisesAdmin embedded />}
        {tab === "cardio" && <CardioDashboard embedded />}
        {tab === "warmups" && <WarmupProtocolsAdmin embedded />}
        {tab === "recipes" && <AdminRecipes embedded />}
      </div>
    </>
  );
}