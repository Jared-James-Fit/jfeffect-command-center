/**
 * Program setup at a glance: the recommended values as tiles (each with where
 * it came from), the ones the coach changed marked, a tap to edit them all in
 * one sheet (the full setup and the advanced controls, exactly as before).
 */
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { EQUIPMENT_LABEL } from "@/lib/program-intel/equipment";
import type { GeneratorIntel } from "@/lib/program-intel/intelligence";
import { setupHorizon, type Conflict, type GenerationSetup, type SetupField } from "@/lib/program-intel/recommend";
import { BRAIN_LABEL } from "@/lib/program-intel/types";

function safeHorizon(setup: GenerationSetup, intel: GeneratorIntel) {
  try {
    return setupHorizon(setup, intel.ctx);
  } catch {
    return null;
  }
}
/** "Mon, Nov 30" from a yyyy-mm-dd. */
function dayWords(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

type Tile = { key: string; label: string; value: string; sub?: string | null; edited: boolean; warn?: boolean };

export function setupTiles(intel: GeneratorIntel, setup: GenerationSetup, edited: Set<SetupField>, conflicts: Conflict[]): Tile[] {
  const why = intel.recommendation.why;
  const short = (s?: { source: string } | null) => s?.source ?? null;
  const blocked = (field: string) => conflicts.some((c) => c.severity === "blocker" && c.id.includes(field));
  return [
    { key: "brain", label: "Program type", value: BRAIN_LABEL[setup.brain], sub: edited.has("brain") ? "set by you" : "recommended", edited: edited.has("brain") },
    { key: "goal", label: "Goal", value: setup.mainGoal || "Not on file", sub: setup.meetDate ? `meet ${setup.meetDate}` : short(why.mainGoal), edited: edited.has("mainGoal"), warn: !setup.mainGoal },
    { key: "weeks", label: "Length", value: `${setup.weeks} weeks`, sub: short(why.weeks), edited: edited.has("weeks") || edited.has("durationMode") },
    { key: "days", label: "Training days", value: `${setup.daysPerWeek} a week`, sub: setup.trainingDays.length ? setup.trainingDays.map((d) => d.slice(0, 3)).join(" ") : short(why.daysPerWeek), edited: edited.has("daysPerWeek") || edited.has("trainingDays"), warn: blocked("days") },
    { key: "session", label: "Session", value: setup.sessionMinutes ? `${setup.sessionMinutes} min` : "—", sub: setup.maxSessionMinutes ? `max ${setup.maxSessionMinutes} · ${short(why.maxSessionMinutes) ?? ""}` : short(why.sessionMinutes), edited: edited.has("sessionMinutes") || edited.has("maxSessionMinutes") },
    { key: "blocks", label: "Blocks", value: setup.blocks.length ? setup.blocks.map((b) => `${b.name} ${b.weeks}w`).join(" → ") : "Cleo decides", sub: setup.blocks.length ? null : "from the goal and their response", edited: edited.has("blocks") },
    { key: "equipment", label: "Equipment", value: setup.equipment.location ?? (setup.equipment.items.length ? `${setup.equipment.items.length} items` : "Not on file"), sub: setup.equipment.items.slice(0, 3).map((i) => EQUIPMENT_LABEL[i]).join(", ") || null, edited: edited.has("equipment"), warn: !setup.equipment.items.length },
    { key: "start", label: "Starts", value: dayWords(safeHorizon(setup, intel)?.start ?? setup.startDate), sub: edited.has("startDate") ? "set by you" : safeHorizon({ ...setup, startDate: null }, intel)?.startWhy ?? null, edited: edited.has("startDate") },
  ];
}

export function SetupSummary({ tiles, editedCount, onEdit, onReset }: { tiles: Tile[]; editedCount: number; onEdit: () => void; onReset: () => void }) {
  return (
    <Card className="space-y-3 p-4" data-testid="gen-setup-summary" data-workflow-section="setup">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold">Program setup</h2>
        {editedCount > 0 && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onReset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Back to recommended
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-9" onClick={onEdit} data-setup-edit>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={onEdit}
            className={cn("min-w-0 rounded-xl border p-2.5 text-left transition-colors hover:bg-muted/60", t.warn ? "border-warning/50" : "border-border")}
            data-setup-tile={t.key}
          >
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="truncate">{t.label}</span>
              {t.edited ? <span aria-label="changed by you" title="Changed by you" className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> : null}
            </div>
            <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug">{t.value}</div>
            {t.sub ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.sub}</div> : null}
          </button>
        ))}
      </div>
      {editedCount > 0 && <p className="text-xs text-muted-foreground">A dot means you changed it: Cleo treats it as a requirement.</p>}
    </Card>
  );
}

/** The full setup and advanced controls, in one sheet (bottom on a phone, side on a computer). */
export function SetupSheet({ open, onOpenChange, children }: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl" data-setup-sheet>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="min-w-0 flex-1 pl-24 sm:pl-0">
            <SheetTitle className="text-base">Program setup</SheetTitle>
            <SheetDescription className="text-xs">Every value says where it came from. What you change is a requirement.</SheetDescription>
          </div>
          <Button size="sm" className="h-9" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
        <div className="space-y-3 p-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
