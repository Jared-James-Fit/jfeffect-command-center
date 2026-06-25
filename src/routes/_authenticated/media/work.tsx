import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { TasksPage } from "@/components/tasks/tasks-page";
import { MediaHeader } from "@/components/media/media-header";
import { Button } from "@/components/ui/button";
import { List, LayoutGrid, Grid3x3, Calendar as CalendarIcon } from "lucide-react";
import { WorkListView } from "@/components/media/work/work-list-view";
import { WorkBoardView } from "@/components/media/work/work-board-view";
import { WorkCalendarView } from "@/components/media/work/work-calendar-view";
import { QuickNotesDBPanel } from "@/components/media/quick-notes-db-panel";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  view: fallback(z.enum(["list", "board", "eisenhower", "calendar"]), "list").default("list"),
  filter: fallback(z.string().optional(), undefined).optional(),
});

export const Route = createFileRoute("/_authenticated/media/work")({
  validateSearch: zodValidator(searchSchema),
  component: MyWorkPage,
});

const VIEWS = [
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: LayoutGrid },
  { value: "eisenhower", label: "Eisenhower", icon: Grid3x3 },
  { value: "calendar", label: "Calendar", icon: CalendarIcon },
] as const;

function MyWorkPage() {
  const { view, filter } = Route.useSearch();
  const navigate = useNavigate({ from: "/media/work" });

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="My Work"
        description="Your tasks, Quick Notes, and the Eisenhower matrix in one place."
        actions={
          <div className="flex gap-1 rounded-md border border-border bg-card p-0.5">
            {VIEWS.map((v) => (
              <Button
                key={v.value}
                size="sm"
                variant={view === v.value ? "default" : "ghost"}
                className={cn("h-8", view === v.value && "shadow-sm")}
                onClick={() => navigate({ search: (prev: any) => ({ ...prev, view: v.value }) })}
              >
                <v.icon className="mr-1 h-4 w-4" />{v.label}
              </Button>
            ))}
          </div>
        }
      />

      {filter && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-widest text-primary">Filter:</span>
          <span>{filter}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => navigate({ search: (prev: any) => ({ ...prev, filter: undefined }) })}>Clear</Button>
        </div>
      )}

      <div className="space-y-6">
        {view === "list" && <WorkListView filter={filter} />}
        {view === "board" && <WorkBoardView />}
        {view === "eisenhower" && <TasksPage scope="media" storagePrefix="media" title="Eisenhower Matrix" subtitle="Drag-free priority quadrants." />}
        {view === "calendar" && <WorkCalendarView />}

        {view !== "eisenhower" && <QuickNotesDBPanel />}
      </div>
    </div>
  );
}