import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Copy, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobileNow } from "@/hooks/use-mobile";
import {
  useProgram,
  type ProgramDay,
  type ProgramDraft,
  type ProgramExercise,
} from "@/lib/athlete-programs";
import {
  MAX_DAYS,
  MAX_EXERCISES,
  REST_CHOICES,
  addExercises,
  duplicateDay,
  moveItem,
  newDay,
  removeAt,
} from "@/lib/athlete-program-draft";
import { ProgramDetailsFields } from "./program-builder-parts";
import { ExercisePickerSheet } from "./exercise-picker-sheet";
import { MobileProgramBuilder } from "./program-builder-mobile";
import { useProgramEditor, type ProgramEditor } from "./use-program-editor";

const EMPTY: ProgramDraft = {
  id: null,
  title: "",
  description: "",
  goal: null,
  level: null,
  weeks: 4,
  days: [newDay(0)],
};

/**
 * Build or edit your own program: a week of training days, each a list of
 * library exercises with sets, reps and (if you use it) RPE and rest. That
 * week repeats for the weeks you pick. Saved privately; sharing is a switch
 * on the program's page. A phone gets its own layout (one day at a time, big
 * taps, MobileProgramBuilder); both edit the same draft.
 */
export function ProgramBuilder({ editId }: { editId: string | null }) {
  const { data: existing, isLoading } = useProgram(editId);
  if (editId && isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Edit program" backTo="/portal/programs" />
        <div className="space-y-3 px-4 py-3 md:px-8" aria-hidden>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (editId && (!existing || !existing.is_mine)) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Edit program" backTo="/portal/programs" />
        <div className="px-4 py-6 text-center text-sm text-muted-foreground md:px-8">
          You can only edit your own programs.{" "}
          <Link to="/portal/programs" className="underline">
            Back to programs
          </Link>
        </div>
      </div>
    );
  }
  const start: ProgramDraft = existing
    ? {
        id: existing.id,
        title: existing.title,
        description: existing.description ?? "",
        goal: existing.goal,
        level: existing.level,
        weeks: existing.weeks,
        days: existing.days.map((d) => ({
          title: d.title,
          focus: d.focus ?? null,
          exercises: d.exercises.map((e) => ({ ...e })),
        })),
      }
    : EMPTY;
  return <Builder initial={start} base={existing?.updated_at ?? null} />;
}

function Builder({ initial, base }: { initial: ProgramDraft; base: string | null }) {
  const editor = useProgramEditor(initial, base);
  const phone = useIsMobileNow();
  return phone ? <MobileProgramBuilder editor={editor} /> : <DesktopBuilder editor={editor} />;
}

/** Everything on one page: every day open, every number a box. */
function DesktopBuilder({ editor }: { editor: ProgramEditor }) {
  const { d, update, setDay } = editor;

  const onSave = async () => {
    const r = await editor.save();
    if (!r.ok && typeof r.at === "number") {
      document
        .getElementById(`program-day-${r.at}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader
        title={editor.editing ? "Edit program" : "New program"}
        backTo={editor.backTo}
        actionsInline
        actions={
          <Button onClick={onSave} disabled={editor.saving} className="min-w-[76px]">
            {editor.saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
            ) : (
              "Save"
            )}
          </Button>
        }
      />

      <div className="space-y-5 px-4 py-2 md:px-8">
        <Input
          value={d.title}
          onChange={(e) => update((x) => ({ ...x, title: e.target.value.slice(0, 80) }))}
          placeholder="Program name, like Upper / Lower 4x"
          aria-label="Program name"
          className="h-12 text-[17px] font-semibold"
        />

        <div className="space-y-3">
          {d.days.map((day, i) => (
            <DayEditor
              key={i}
              day={day}
              index={i}
              count={d.days.length}
              onChange={(fn) => setDay(i, fn)}
              onMove={(dir) => update((x) => ({ ...x, days: moveItem(x.days, i, dir) }))}
              onDuplicate={() => update((x) => ({ ...x, days: duplicateDay(x.days, i) }))}
              onDelete={() => update((x) => ({ ...x, days: removeAt(x.days, i) }))}
            />
          ))}
          {d.days.length < MAX_DAYS ? (
            <Button
              variant="outline"
              className="h-12 w-full border-dashed"
              onClick={() => update((x) => ({ ...x, days: [...x.days, newDay(x.days.length)] }))}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Add a training day
            </Button>
          ) : (
            <p className="text-center text-[13px] text-muted-foreground">
              That's 7 days, a full week.
            </p>
          )}
        </div>

        <section className="rounded-2xl border border-border bg-card p-4">
          <ProgramDetailsFields d={d} update={update} />
        </section>
      </div>
    </div>
  );
}

function DayEditor({
  day,
  index,
  count,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  day: ProgramDay;
  index: number;
  count: number;
  onChange: (fn: (day: ProgramDay) => ProgramDay) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const setEx = (j: number, patch: Partial<ProgramExercise>) =>
    onChange((x) => ({
      ...x,
      exercises: x.exercises.map((e, k) => (k === j ? { ...e, ...patch } : e)),
    }));

  return (
    <section
      id={`program-day-${index}`}
      className="scroll-mt-4 rounded-2xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="shrink-0 pl-1 text-[12px] font-medium text-muted-foreground">
          Day {index + 1}
        </span>
        <Input
          value={day.title}
          onChange={(e) => onChange((x) => ({ ...x, title: e.target.value.slice(0, 40) }))}
          aria-label={`Day ${index + 1} name`}
          placeholder="Upper, Legs, Push…"
          className="h-10 border-0 bg-transparent px-1 text-[16px] font-semibold shadow-none focus-visible:ring-0"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label={`Day ${index + 1} options`}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
              <ArrowUp className="mr-2 h-4 w-4" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
              <ArrowDown className="mr-2 h-4 w-4" />
              Move down
            </DropdownMenuItem>
            <DropdownMenuItem disabled={count >= MAX_DAYS} onSelect={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate day
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              disabled={count <= 1}
              onSelect={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete day
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ol className="divide-y divide-border">
        {day.exercises.map((e, j) => (
          <li key={`${e.exercise_id}-${j}`} className="space-y-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 pl-1 pt-2 text-[15px] font-medium">
                {e.name ?? "Exercise"}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={`${e.name ?? "Exercise"} options`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={j === 0}
                    onSelect={() =>
                      onChange((x) => ({ ...x, exercises: moveItem(x.exercises, j, -1) }))
                    }
                  >
                    <ArrowUp className="mr-2 h-4 w-4" />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={j === day.exercises.length - 1}
                    onSelect={() =>
                      onChange((x) => ({ ...x, exercises: moveItem(x.exercises, j, 1) }))
                    }
                  >
                    <ArrowDown className="mr-2 h-4 w-4" />
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() =>
                      onChange((x) => ({ ...x, exercises: removeAt(x.exercises, j) }))
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Field label="Sets">
                <Input
                  inputMode="numeric"
                  value={String(e.sets ?? "")}
                  aria-label="Sets"
                  onChange={(ev) =>
                    setEx(j, {
                      sets:
                        Number(ev.target.value.replace(/\D/g, "").slice(0, 2)) ||
                        ("" as unknown as number),
                    })
                  }
                  className="h-10 text-center text-base"
                />
              </Field>
              <Field label="Reps">
                <Input
                  value={e.reps ?? ""}
                  aria-label="Reps"
                  placeholder="8-10"
                  onChange={(ev) => setEx(j, { reps: ev.target.value.slice(0, 20) })}
                  className="h-10 text-center text-base"
                />
              </Field>
              <Field label="RPE">
                <Input
                  inputMode="decimal"
                  value={e.rpe ?? ""}
                  aria-label="RPE"
                  placeholder="—"
                  onChange={(ev) =>
                    setEx(j, { rpe: ev.target.value.replace(/[^\d.-]/g, "").slice(0, 7) || null })
                  }
                  className="h-10 text-center text-base"
                />
              </Field>
              <Field label="Rest">
                <select
                  value={e.rest_seconds ?? ""}
                  aria-label="Rest"
                  onChange={(ev) =>
                    setEx(j, { rest_seconds: ev.target.value ? Number(ev.target.value) : null })
                  }
                  className="h-10 w-full rounded-lg border border-input bg-background px-1 text-center text-base"
                >
                  {REST_CHOICES.map((r) => (
                    <option key={r.label} value={r.seconds ?? ""}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Input
              value={e.notes ?? ""}
              placeholder="Note (optional): tempo, cue, setup"
              aria-label="Note"
              onChange={(ev) => setEx(j, { notes: ev.target.value.slice(0, 200) || null })}
              className="h-10 text-base"
            />
          </li>
        ))}
      </ol>

      <div className="p-3">
        {day.exercises.length < MAX_EXERCISES ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            onClick={() => setPicking(true)}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Add exercises
          </Button>
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">
            20 exercises is the most for one day.
          </p>
        )}
      </div>

      <ExercisePickerSheet
        open={picking}
        onOpenChange={setPicking}
        mode="multi"
        room={MAX_EXERCISES - day.exercises.length}
        title={`Add to ${day.title.trim() || `Day ${index + 1}`}`}
        description="Pick from the JF Effect exercise library, as many as you want."
        onPick={(list) => {
          const r = addExercises(day, list);
          onChange(() => r.day);
          if (r.skipped)
            toast(`${r.skipped} didn't fit: ${MAX_EXERCISES} is the most for one day.`);
        }}
      />
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-center text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
