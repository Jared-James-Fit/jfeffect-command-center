import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CopyPlus,
  Layers,
  MoreHorizontal,
  Plus,
  Repeat2,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ProgramDraft } from "@/lib/athlete-programs";
import {
  MAX_BLOCKS,
  MAX_WEEKS,
  PROGRESS_LIMITS,
  fieldNumber,
  progressionValues,
  programWeek,
  scopeWeeks,
  slotAcross,
  totalWeeks,
  type Cursor,
  type PlanExercise,
  type ProgramPlan,
  type ProgressField,
  type WeekRef,
} from "@/lib/program-plan";
import { ProgramDetailsFields, Stepper } from "../program-builder-parts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./rows";
import { Cell } from "./cells";
import { WeekPickerSheet } from "@/components/program-editor/week-picker-sheet";

/** A bottom sheet the builder's way: a grip that swipes down, a title, Done. */
export function BuilderSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        swipeToClose
        className={cn(
          "max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:mx-auto",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-start gap-3 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="break-words text-[18px] font-semibold leading-tight">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="mt-0.5 text-[13px]">{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Options</SheetDescription>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold hover:bg-secondary"
          >
            Done
          </button>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** A row of a grouped list: icon, words, a quieter line. */
export function ActionRow({
  icon: Icon,
  title,
  sub,
  onClick,
  destructive,
  disabled,
}: {
  icon: typeof Copy;
  title: string;
  sub?: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 w-full items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-secondary/40 disabled:opacity-40"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className={cn("h-[18px] w-[18px]", destructive && "text-destructive")} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[15px] font-medium", destructive && "text-destructive")}>{title}</span>
        {sub && <span className="block text-[12px] leading-snug text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

const Group = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border border-border bg-card">{children}</div>
);

/* ------------------------------------------------------------------ */
/*  An exercise                                                        */
/* ------------------------------------------------------------------ */

export function ExerciseSheet({
  open,
  onOpenChange,
  e,
  scopeText,
  canUp,
  canDown,
  onPatch,
  onSwap,
  onProgress,
  onBackoff,
  onMove,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  e: PlanExercise | null;
  scopeText: string;
  canUp: boolean;
  canDown: boolean;
  onPatch: (p: Partial<PlanExercise>, merge: string) => void;
  onSwap: () => void;
  onProgress: () => void;
  onBackoff: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  if (!e) return null;
  const backoff = e.pct != null && e.pct_of === "top_set";
  return (
    <BuilderSheet
      open={open}
      onOpenChange={onOpenChange}
      title={e.name ?? "Exercise"}
      description={<>Changes here apply to <span className="font-medium text-foreground">{scopeText}</span></>}
    >
      <div className="space-y-4">
        <Group>
          <ActionRow icon={Repeat2} title="Swap exercise" sub="Keeps its sets, reps and load" onClick={onSwap} />
          <ActionRow icon={TrendingUp} title="Progress across weeks" sub="See and set every week's numbers" onClick={onProgress} />
          {!backoff && (
            <ActionRow icon={CopyPlus} title="Add back-off sets" sub="The same lift after it, at 90% of the top set" onClick={onBackoff} />
          )}
        </Group>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-muted-foreground">Notes</span>
            <Textarea
              value={e.notes ?? ""}
              onChange={(ev) => onPatch({ notes: ev.target.value.slice(0, 200) || null }, `${e.key}:notes`)}
              placeholder="A cue, a setup, a substitution"
              className="min-h-[72px] text-base"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-muted-foreground">Tempo (optional)</span>
            <Input
              value={e.tempo ?? ""}
              onChange={(ev) => onPatch({ tempo: ev.target.value.slice(0, 12) || null }, `${e.key}:tempo`)}
              placeholder="3-1-1-0"
              className="h-11 text-base"
            />
          </label>
        </div>
        <Group>
          <ActionRow icon={ArrowUp} title="Move up" onClick={() => onMove(-1)} disabled={!canUp} />
          <ActionRow icon={ArrowDown} title="Move down" onClick={() => onMove(1)} disabled={!canDown} />
        </Group>
        <Group>
          <ActionRow icon={Trash2} title="Remove" sub={`From ${scopeText}`} onClick={onRemove} destructive />
        </Group>
      </div>
    </BuilderSheet>
  );
}

/* ------------------------------------------------------------------ */
/*  A day                                                              */
/* ------------------------------------------------------------------ */

export function DaySheet({
  open,
  onOpenChange,
  title,
  focus,
  scopeText,
  canAdd,
  canRemove,
  canLeft,
  canRight,
  onRename,
  onFocus,
  onDuplicate,
  onCopy,
  onMove,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  focus: string;
  scopeText: string;
  canAdd: boolean;
  canRemove: boolean;
  canLeft: boolean;
  canRight: boolean;
  onRename: (t: string) => void;
  onFocus: (t: string) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <BuilderSheet open={open} onOpenChange={onOpenChange} title={title || "Day"} description="Its name changes in every week">
      <div className="space-y-4">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-muted-foreground">Name</span>
            <Input value={title} onChange={(e) => onRename(e.target.value.slice(0, 40))} className="h-11 text-base" placeholder="Upper A" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-muted-foreground">Focus (optional)</span>
            <Input value={focus} onChange={(e) => onFocus(e.target.value.slice(0, 60))} className="h-11 text-base" placeholder="Squat, quads" />
          </label>
        </div>
        <Group>
          <ActionRow icon={Copy} title="Copy this day to other weeks" sub="Pick the weeks it should match" onClick={onCopy} />
          <ActionRow icon={CopyPlus} title="Duplicate day" sub={`A new day after it, in ${scopeText}`} onClick={onDuplicate} disabled={!canAdd} />
          <ActionRow icon={ArrowUp} title="Move earlier in the week" onClick={() => onMove(-1)} disabled={!canLeft} />
          <ActionRow icon={ArrowDown} title="Move later in the week" onClick={() => onMove(1)} disabled={!canRight} />
        </Group>
        <Group>
          <ActionRow icon={Trash2} title="Delete day" sub={`From ${scopeText}`} onClick={onRemove} destructive disabled={!canRemove} />
        </Group>
      </div>
    </BuilderSheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy to weeks                                                      */
/* ------------------------------------------------------------------ */

/** Pick weeks (grouped by block) that become exactly like the week (or day) on screen. */
export function CopyWeeksSheet({
  open,
  onOpenChange,
  plan,
  from,
  what,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plan: ProgramPlan;
  from: Cursor;
  /** null: the whole week; else the day's name */
  what: string | null;
  onCopy: (to: WeekRef[]) => void;
}) {
  const g = programWeek(plan, from);
  const id = (r: WeekRef) => `${r.b}:${r.w}`;
  const all = plan.blocks.flatMap((bl, b) => bl.weeks.map((_, w) => ({ b, w })));
  const restOfBlock = scopeWeeks(plan, from, "following");
  const later = all.filter((r) => programWeek(plan, r) > g);
  const quick = [
    { label: `Rest of ${plan.blocks.length > 1 ? plan.blocks[from.b].name : "the program"}`, ids: restOfBlock.map(id) },
    ...(plan.blocks.length > 1 ? [{ label: "Every later week", ids: later.map(id) }] : []),
    { label: "Every week", ids: all.map(id) },
  ];
  return (
    <WeekPickerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={what ? `Copy ${what} to other weeks` : `Copy week ${g} to other weeks`}
      description={
        what
          ? `${what} in each week you pick becomes exactly like week ${g}'s.`
          : `Each week you pick becomes exactly like week ${g}: every day, exercise and number.`
      }
      groups={plan.blocks.map((bl, b) => ({
        name: plan.blocks.length > 1 ? bl.name : undefined,
        weeks: bl.weeks.map((_, w) => ({ id: `${b}:${w}`, label: String(programWeek(plan, { b, w })) })),
      }))}
      fromId={id(from)}
      quick={quick}
      onConfirm={(ids) => onCopy(ids.map((k) => ({ b: Number(k.split(":")[0]), w: Number(k.split(":")[1]) })))}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Program: length, blocks, what it's for                             */
/* ------------------------------------------------------------------ */

export function ProgramSheet({
  open,
  onOpenChange,
  d,
  updateMeta,
  onLength,
  onBlockLength,
  onRenameBlock,
  onAddBlock,
  onDuplicateBlock,
  onMoveBlock,
  onRemoveBlock,
  onSplit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  d: ProgramDraft;
  updateMeta: (patch: Partial<Omit<ProgramDraft, "plan" | "id">>) => void;
  onLength: (n: number) => void;
  onBlockLength: (b: number, n: number) => void;
  onRenameBlock: (b: number, name: string) => void;
  onAddBlock: () => void;
  onDuplicateBlock: (b: number) => void;
  onMoveBlock: (b: number, dir: -1 | 1) => void;
  onRemoveBlock: (b: number) => void;
  onSplit: () => void;
}) {
  const plan = d.plan;
  const total = totalWeeks(plan);
  const multi = plan.blocks.length > 1;
  return (
    <BuilderSheet open={open} onOpenChange={onOpenChange} title="Program" description={`${total} ${total === 1 ? "week" : "weeks"} in ${plan.blocks.length} ${plan.blocks.length === 1 ? "block" : "blocks"}`} wide>
      <div className="space-y-6">
        <section className="space-y-3" aria-label="Length and blocks">
          {!multi ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium">Length</div>
                <div className="text-[13px] text-muted-foreground">New weeks copy the last one.</div>
              </div>
              <Stepper value={total} min={1} max={MAX_WEEKS} less="Fewer weeks" more="More weeks" onChange={onLength} />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[15px] font-medium">Blocks</div>
              {plan.blocks.map((bl, b) => (
                <div key={bl.key} className="flex items-center gap-2 rounded-2xl border border-border p-2.5" data-block-row={b}>
                  <Input
                    value={bl.name}
                    onChange={(e) => onRenameBlock(b, e.target.value)}
                    aria-label={`Block ${b + 1} name`}
                    className="h-10 min-w-0 flex-1 text-base"
                  />
                  <Stepper
                    value={bl.weeks.length}
                    min={1}
                    max={MAX_WEEKS - (total - bl.weeks.length)}
                    less={`Fewer weeks in ${bl.name}`}
                    more={`More weeks in ${bl.name}`}
                    onChange={(n) => onBlockLength(b, n)}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`${bl.name} options`} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-secondary">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={() => onDuplicateBlock(b)} disabled={plan.blocks.length >= MAX_BLOCKS || total + bl.weeks.length > MAX_WEEKS}>
                        <CopyPlus className="mr-2 h-4 w-4" /> Duplicate block
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onMoveBlock(b, -1)} disabled={b === 0}>
                        <ArrowUp className="mr-2 h-4 w-4" /> Move earlier
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onMoveBlock(b, 1)} disabled={b === plan.blocks.length - 1}>
                        <ArrowDown className="mr-2 h-4 w-4" /> Move later
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onRemoveBlock(b)} className="text-destructive focus:text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete block
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={onAddBlock}
              disabled={plan.blocks.length >= MAX_BLOCKS || total >= MAX_WEEKS}
              data-add-block
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add a block
            </Button>
            {!multi && total >= 4 && (
              <Button variant="ghost" className="h-11" onClick={onSplit} data-split-blocks>
                <Layers className="mr-1.5 h-4 w-4" /> Split into 4-week blocks
              </Button>
            )}
          </div>
          <p className="text-[12px] leading-snug text-muted-foreground">
            A block is a phase (base, build, peak): a new one starts from the last week before it, ready to change.
          </p>
        </section>
        <section aria-label="What it's for">
          <ProgramDetailsFields d={d} updateMeta={updateMeta} />
        </section>
      </div>
    </BuilderSheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Progression across weeks                                           */
/* ------------------------------------------------------------------ */

const FIELD_LABEL: Record<ProgressField, string> = {
  sets: "Sets",
  reps: "Reps",
  rpe: "RPE",
  rir: "RIR",
  load: "Weight",
  pct: "%",
};

/**
 * One exercise across the block's weeks, a spreadsheet's column at a time:
 * every week's numbers to type in, and a pattern to fill them ("RPE 7, +0.5
 * a week") in one tap.
 */
export function ProgressionSheet({
  open,
  onOpenChange,
  plan,
  cursor,
  dayKey,
  exKey,
  onPatchWeek,
  onFill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plan: ProgramPlan;
  cursor: Cursor;
  dayKey: string;
  exKey: string;
  onPatchWeek: (ref: WeekRef, p: Partial<PlanExercise>) => void;
  onFill: (refs: WeekRef[], field: ProgressField, values: number[]) => void;
}) {
  const weeks = useMemo(() => scopeWeeks(plan, cursor, "block"), [plan, cursor]);
  const slots = slotAcross(plan, weeks, dayKey, exKey);
  const rows = weeks.map((ref, i) => ({ ref, e: slots[i] })).filter((r) => r.e) as { ref: WeekRef; e: PlanExercise }[];
  const first = rows[0]?.e ?? null;
  const effort: ProgressField = first?.rir ? "rir" : "rpe";
  const loadField: ProgressField = first?.pct != null ? "pct" : "load";
  const fields: ProgressField[] = ["sets", "reps", effort, loadField];
  const [field, setField] = useState<ProgressField>(effort);
  const [start, setStart] = useState("");
  const [step, setStep] = useState("");
  const startNum = start.trim() ? Number(start) : fieldNumber(first, field);
  const stepNum = step.trim() ? Number(step) : PROGRESS_LIMITS[field].step;
  const preview =
    startNum != null && Number.isFinite(startNum) && Number.isFinite(stepNum)
      ? progressionValues(field, startNum, stepNum, rows.length)
      : null;
  if (!first) return null;
  const label = `${first.name ?? "Exercise"}`;
  const lo = rows.length ? programWeek(plan, rows[0].ref) : 0;
  const hi = rows.length ? programWeek(plan, rows[rows.length - 1].ref) : 0;
  return (
    <BuilderSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${label} across weeks`}
      description={plan.blocks.length > 1 ? `${plan.blocks[cursor.b].name}, weeks ${lo}–${hi}` : `Weeks ${lo}–${hi}`}
      wide
    >
      <div className="space-y-4">
        <section className="rounded-2xl bg-muted/50 p-3" aria-label="Fill a pattern" data-progress-pattern>
          <div className="mb-2 text-[13px] font-medium">Fill a pattern</div>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setField(f);
                  setStart("");
                  setStep("");
                }}
                className={cn(
                  "h-9 rounded-full px-3.5 text-[14px] font-medium",
                  field === f ? "bg-foreground text-background" : "bg-background",
                )}
              >
                {FIELD_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[12px] text-muted-foreground">Week {lo}</span>
              <Input
                inputMode="decimal"
                value={start}
                placeholder={fieldNumber(first, field)?.toString() ?? "—"}
                onChange={(e) => setStart(e.target.value)}
                className="h-11 text-base tabular-nums"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[12px] text-muted-foreground">Each week</span>
              <Input
                inputMode="decimal"
                value={step}
                placeholder={`+${PROGRESS_LIMITS[field].step}`}
                onChange={(e) => setStep(e.target.value.replace(/^\+/, ""))}
                className="h-11 text-base tabular-nums"
              />
            </label>
            <Button
              className="h-11 shrink-0"
              disabled={!preview}
              onClick={() => preview && onFill(rows.map((r) => r.ref), field, preview)}
              data-progress-fill
            >
              Fill
            </Button>
          </div>
          {preview && (
            <p className="mt-2 text-[12px] tabular-nums text-muted-foreground" data-progress-preview>
              {FIELD_LABEL[field]}: {preview.join(" → ")}
            </p>
          )}
        </section>

        <section aria-label="Every week">
          <div className="grid grid-cols-[3.25rem_repeat(5,minmax(0,1fr))] gap-1.5 px-1 pb-1 text-center text-[11px] font-medium text-muted-foreground">
            <span className="text-left">Week</span>
            <span>Sets</span>
            <span>Reps</span>
            <span>{effort === "rir" ? "RIR" : "RPE"}</span>
            <span>Load</span>
            <span>Rest</span>
          </div>
          <div className="space-y-1.5">
            {rows.map(({ ref, e }) => {
              const on = ref.b === cursor.b && ref.w === cursor.w;
              return (
                <div
                  key={`${ref.b}:${ref.w}`}
                  className={cn("grid grid-cols-[3.25rem_repeat(5,minmax(0,1fr))] items-center gap-1.5 rounded-xl px-1 py-0.5", on && "bg-muted/60")}
                  data-progress-week={programWeek(plan, ref)}
                >
                  <span className="text-[14px] font-semibold tabular-nums">{programWeek(plan, ref)}</span>
                  {(["sets", "reps", "effort", "load", "rest"] as const).map((f) => (
                    <Cell key={f} e={e} field={f} onPatch={(p) => onPatchWeek(ref, p)} />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </BuilderSheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Leaving with changes                                               */
/* ------------------------------------------------------------------ */

export function LeaveSheet({
  open,
  onOpenChange,
  saving,
  onSave,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  saving: boolean;
  onSave: () => void;
  onLeave: () => void;
}) {
  return (
    <BuilderSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Save your changes?"
      description="Not saved, they're kept on this phone and come back the next time you open the builder."
    >
      <div className="space-y-2">
        <Button className="h-12 w-full text-[15px]" onClick={onSave} disabled={saving} data-leave-save>
          Save
        </Button>
        <Button variant="secondary" className="h-12 w-full text-[15px]" onClick={onLeave} data-leave-anyway>
          Leave without saving
        </Button>
      </div>
    </BuilderSheet>
  );
}
