import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkoutAddExercise } from "@/components/workout-day/workout-add-exercise";
import { cn } from "@/lib/utils";
import {
  GOALS,
  LEVELS,
  draftProblem,
  programError,
  useProgram,
  useProgramActions,
  type ProgramDay,
  type ProgramDraft,
  type ProgramExercise,
} from "@/lib/athlete-programs";
import { moveItem, newDay, REST_CHOICES } from "@/lib/athlete-program-draft";

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
 * on the program's page.
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
  return <Builder initial={start} />;
}

function Builder({ initial }: { initial: ProgramDraft }) {
  const navigate = useNavigate();
  const { save } = useProgramActions();
  const [d, setD] = useState<ProgramDraft>(initial);
  const [dirty, setDirty] = useState(false);
  const editing = !!initial.id;

  // a half-built program shouldn't vanish on a stray back tap
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (fn: (x: ProgramDraft) => ProgramDraft) => {
    setD(fn);
    setDirty(true);
  };
  const setDay = (i: number, fn: (day: ProgramDay) => ProgramDay) =>
    update((x) => ({ ...x, days: x.days.map((day, j) => (j === i ? fn(day) : day)) }));

  const onSave = async () => {
    const problem = draftProblem(d);
    if (problem) return toast.error(problem);
    try {
      const id = await save.mutateAsync(d);
      setDirty(false);
      toast.success(editing ? "Saved" : "Program saved. Share it or start it from here.");
      navigate({ to: "/portal/programs/$programId", params: { programId: id }, replace: editing });
    } catch (e) {
      toast.error(programError(e, "Couldn't save it. Try again."));
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader
        title={editing ? "Edit program" : "New program"}
        backTo={editing ? `/portal/programs/${initial.id}` : "/portal/programs"}
        actionsInline
        actions={
          <Button onClick={onSave} disabled={save.isPending} className="min-w-[76px]">
            {save.isPending ? (
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
              onDuplicate={() =>
                update((x) =>
                  x.days.length >= 7
                    ? x
                    : {
                        ...x,
                        days: [
                          ...x.days.slice(0, i + 1),
                          {
                            ...day,
                            title: `${day.title} (copy)`.slice(0, 40),
                            exercises: day.exercises.map((e) => ({ ...e })),
                          },
                          ...x.days.slice(i + 1),
                        ],
                      },
                )
              }
              onDelete={() => update((x) => ({ ...x, days: x.days.filter((_, j) => j !== i) }))}
            />
          ))}
          {d.days.length < 7 ? (
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

        <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-medium">Weeks</div>
              <div className="text-[13px] text-muted-foreground">
                This week repeats this many times.
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10"
                aria-label="Fewer weeks"
                disabled={d.weeks <= 1}
                onClick={() => update((x) => ({ ...x, weeks: Math.max(1, x.weeks - 1) }))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span
                className="w-8 text-center text-[17px] font-semibold tabular-nums"
                aria-live="polite"
              >
                {d.weeks}
              </span>
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10"
                aria-label="More weeks"
                disabled={d.weeks >= 16}
                onClick={() => update((x) => ({ ...x, weeks: Math.min(16, x.weeks + 1) }))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ChoiceRow
            label="Goal"
            options={GOALS}
            value={d.goal}
            onChange={(goal) => update((x) => ({ ...x, goal }))}
          />
          <ChoiceRow
            label="Level"
            options={LEVELS}
            value={d.level}
            onChange={(level) => update((x) => ({ ...x, level }))}
          />
          <div>
            <div className="mb-1.5 text-[15px] font-medium">
              About it <span className="font-normal text-muted-foreground">(optional)</span>
            </div>
            <Textarea
              value={d.description}
              onChange={(e) =>
                update((x) => ({ ...x, description: e.target.value.slice(0, 1000) }))
              }
              placeholder="Who it's for, how to progress, what it's good at"
              className="min-h-[88px] text-base"
            />
          </div>
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
  const setEx = (j: number, patch: Partial<ProgramExercise>) =>
    onChange((x) => ({
      ...x,
      exercises: x.exercises.map((e, k) => (k === j ? { ...e, ...patch } : e)),
    }));

  return (
    <section className="rounded-2xl border border-border bg-card">
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
            <DropdownMenuItem disabled={count >= 7} onSelect={onDuplicate}>
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
                      onChange((x) => ({ ...x, exercises: x.exercises.filter((_, k) => k !== j) }))
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
                      sets: Number(ev.target.value.replace(/\D/g, "").slice(0, 2)) || ("" as any),
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
        {day.exercises.length < 20 ? (
          <WorkoutAddExercise
            className="border-solid border-border bg-transparent font-medium text-foreground"
            description="Pick from the JF Effect exercise library."
            onAdd={async (ex) => {
              onChange((x) => ({
                ...x,
                exercises: [
                  ...x.exercises,
                  {
                    exercise_id: ex.id,
                    name: ex.name,
                    sets: 3,
                    reps: "8-10",
                    rpe: null,
                    rest_seconds: 120,
                    notes: null,
                  },
                ],
              }));
            }}
          />
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">
            20 exercises is the most for one day.
          </p>
        )}
      </div>
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

function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[15px] font-medium">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(value === o.id ? null : o.id)}
            className={cn(
              "h-10 rounded-full border px-3.5 text-[14px] transition",
              value === o.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
