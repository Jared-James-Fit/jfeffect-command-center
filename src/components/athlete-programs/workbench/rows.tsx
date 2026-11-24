import { useEffect, useMemo } from "react";
import { GripVertical, Layers, MoreHorizontal } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  exerciseUnits,
  fmtWeight,
  linkedLoad,
  programWeek,
  scopeOptions,
  setGroupName,
  totalWeeks as totalWeeksOf,
  type Cursor,
  type ExerciseUnit,
  type PlanDay,
  type PlanExercise,
  type ProgramPlan,
  type Scope,
  type WeekRef,
} from "@/lib/program-plan";
import { CELL_LABEL, type CellField } from "@/lib/program-cells";
import { exerciseRole, ROLE_MARK } from "@/lib/exercise-role";
import { blockEvidence, colorClass, findBlockType, inferBlockType } from "@/lib/block-types";
import { Cell } from "./cells";

/** The columns, in the order a coach writes them. */
const FIELDS: CellField[] = ["sets", "reps", "effort", "load", "rest"];

/** Phone: the name over its five cells, full width. Desktop: one row of a sheet. */
export const PHONE_GRID = "grid grid-cols-[0.8fr_1.1fr_0.95fr_1.35fr_1fr] gap-1.5";
export const DESK_GRID =
  "grid grid-cols-[2rem_minmax(0,1fr)_4rem_5.5rem_4.5rem_6.5rem_5rem_2.5rem] items-center gap-2";

/** Column names, held at the top of the screen with the scope so a number always says what it is. */
export function ColumnHeads({ desktop }: { desktop: boolean }) {
  const heads = FIELDS.map((f) => (
    <span key={f} className="text-center">
      {CELL_LABEL[f]}
    </span>
  ));
  return desktop ? (
    <div className={cn(DESK_GRID, "px-3 pb-1.5 pt-1 text-[12px] font-medium text-muted-foreground")} aria-hidden data-column-heads>
      <span />
      <span>Exercise</span>
      {heads}
      <span />
    </div>
  ) : (
    <div className={cn(PHONE_GRID, "pb-1.5 pt-1 text-[12px] font-medium text-muted-foreground")} aria-hidden data-column-heads>
      {heads}
    </div>
  );
}

/**
 * Which weeks an edit changes, always in view above the exercises: each
 * choice named plainly with its exact weeks ("This week · Week 3", "Rest of
 * block · Weeks 3–4", "This block · Weeks 1–4", "All weeks · Weeks 1–12").
 * The weeks it reaches are outlined in the week bar too.
 */
export function ScopeBar({
  plan,
  cursor,
  scope,
  onScope,
}: {
  plan: ProgramPlan;
  cursor: Cursor;
  scope: Scope;
  onScope: (s: Scope) => void;
}) {
  const opts = scopeOptions(plan, cursor);
  if (opts.length < 2) return null;
  // four choices (a program in blocks) need a big phone for their full names
  const dense = opts.length >= 4;
  return (
    <div
      role="radiogroup"
      aria-label="Which weeks your changes reach"
      className="grid gap-1 rounded-xl bg-muted/70 p-1"
      style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}
      data-scope-bar
    >
      {opts.map((o) => {
        const on = o.scope === scope;
        return (
          <button
            key={o.scope}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${o.title}, ${o.range}`}
            onClick={() => onScope(o.scope)}
            className={cn(
              "min-w-0 rounded-lg px-1 py-1 text-center transition-colors",
              on ? "bg-background text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
            data-scope-option={o.scope}
            data-scope-on={on ? "" : undefined}
          >
            {/* the narrowest phones get the short words; the weeks are never cut */}
            <span className={cn("block truncate text-[13px] font-semibold leading-tight", dense ? "max-[429px]:hidden" : "max-[379px]:hidden")}>
              {o.title}
            </span>
            <span className={cn("block truncate text-[13px] font-semibold leading-tight", dense ? "min-[430px]:hidden" : "min-[380px]:hidden")}>
              {o.short}
            </span>
            <span className="block whitespace-nowrap text-[11px] leading-tight tabular-nums max-[379px]:hidden">{o.range}</span>
            <span className="block whitespace-nowrap text-[11px] leading-tight tabular-nums min-[380px]:hidden">{o.shortRange}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A set group's quiet mark at the row's left edge (top set strong, back-offs light, warm-ups dotted). */
function RoleBar({ e }: { e: PlanExercise }) {
  const role = e.role ? exerciseRole({ top: e.role === "top", backoff: e.role === "backoff", warmup: e.role === "warmup" }) : null;
  const bar = role ? ROLE_MARK[role].bar : null;
  if (!bar) return null;
  return <span aria-hidden className={cn("pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full", bar)} data-pb-role={role ?? undefined} />;
}

/** A block's colour, read from its name and its own sets (members' blocks have no picked type). */
export function memberBlockTint(block: { name: string; weeks: { days: { exercises: PlanExercise[] }[] }[] }) {
  const rows = block.weeks.flatMap((w) =>
    w.days.flatMap((d) =>
      d.exercises.map((e) => ({
        sets: e.sets,
        reps: e.reps,
        rpe: e.rpe,
        rir: e.rir,
        percentage: e.pct,
        percentage_basis: e.pct_of === "1rm" ? "1rm" : null,
        purpose_label: e.role === "top" ? "Top set" : e.role === "backoff" ? "Back-off" : null,
      })),
    ),
  );
  const key = inferBlockType({ name: block.name, evidence: blockEvidence(rows, block.weeks.length) });
  const type = findBlockType(key);
  return type ? { type, cls: colorClass(type) } : null;
}

/** The line over a set group of an exercise with more than one: its name, the weight a % of the top set comes to, its ⋯. */
function GroupCaption({
  e,
  day,
  onOpen,
  desktop,
}: {
  e: PlanExercise;
  day: Pick<PlanDay, "exercises">;
  onOpen: () => void;
  desktop: boolean;
}) {
  const linked = linkedLoad(day, e.key);
  const of = e.pct != null && e.pct_of === "top_set" ? (e.role === "warmup" ? `${fmtWeight(e.pct)}% of top set` : null) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-8 w-full min-w-0 items-center gap-1.5 text-left",
        desktop ? "pr-1" : "pt-2",
      )}
      aria-label={`${setGroupName(e)}: options`}
      data-pb-group={e.key}
      data-pb-role={e.role ?? undefined}
    >
      <span className={cn("shrink-0 text-[13px] font-semibold", e.role === "warmup" ? "text-muted-foreground" : "text-foreground")}>
        {setGroupName(e)}
      </span>
      {(linked || of) && (
        <span className="min-w-0 truncate text-[12px] tabular-nums text-muted-foreground" data-pb-linked>
          {linked ? `= ${fmtWeight(linked.load)} ${linked.unit}` : of}
        </span>
      )}
      <MoreHorizontal className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/**
 * One exercise: a handle to drag it by (press and hold on a phone), its name
 * (a tap opens what else it can do), and each set group's numbers typed
 * straight in. An exercise with more than one set group (a top set and its
 * back-offs, warm-ups, groups the person names) says what each group is over
 * its numbers.
 */
export function ExerciseBlock({
  unit,
  id,
  day,
  desktop,
  changedOf,
  onPatch,
  onOpen,
  onOpenGroup,
}: {
  unit: ExerciseUnit;
  /** the drag id (the exercise's group, else its key) */
  id: string;
  day: Pick<PlanDay, "exercises">;
  desktop: boolean;
  changedOf: (exKey: string) => Set<string>;
  onPatch: (exKey: string, p: Partial<PlanExercise>, session?: string) => void;
  onOpen: () => void;
  onOpenGroup: (exKey: string) => void;
}) {
  const sortable = useSortable({ id });
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = sortable;
  const head = unit.entries[0];
  const multi = unit.entries.length > 1;
  const backoff = !multi && head.pct != null && head.pct_of === "top_set";
  // an imported exercise still waiting for its library pick says so; one matched under
  // another name says what the file called it (both only while it's being reviewed)
  const unmatched = !head.exercise_id;
  const fromFile = !unmatched && head.source_name ? `From your file: ${head.source_name}` : null;
  const sub = unmatched
    ? null
    : [fromFile, backoff ? "Back-off sets" : null, head.tempo ? `Tempo ${head.tempo}` : null, head.notes].filter(Boolean).join(" · ");
  const name = (
    <>
      <span
        className={cn("block truncate text-[16px] font-semibold leading-snug", unmatched && "text-warning")}
        data-pb-name
      >
        {unmatched ? head.source_name ?? head.name ?? "Exercise" : head.name ?? "Exercise"}
      </span>
      {unmatched ? (
        <span className="block truncate text-[12px] font-medium text-warning" data-pb-unmatched>
          Not matched yet · tap to pick the exercise
        </span>
      ) : (
        sub && <span className="block truncate text-[12.5px] text-muted-foreground">{sub}</span>
      )}
    </>
  );
  const cells = (e: PlanExercise) => {
    const changed = changedOf(e.key);
    return FIELDS.map((f) => (
      <Cell
        key={f}
        e={e}
        field={f}
        onPatch={(p, session) => onPatch(e.key, p, session)}
        changed={changed.has(f === "effort" ? (e.rir ? "rir" : "rpe") : f)}
        label={!desktop}
      />
    ));
  };
  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${head.name ?? "exercise"}: press and hold, then drag`}
      aria-roledescription="Drag handle"
      className={cn(
        "grid shrink-0 cursor-grab touch-manipulation select-none place-items-center rounded-lg text-muted-foreground/80 transition-colors [-webkit-touch-callout:none] hover:bg-secondary hover:text-foreground active:cursor-grabbing",
        desktop ? "h-9 w-8" : "-ml-2 h-11 w-9",
        isDragging && "text-foreground",
      )}
      data-pb-grip
    >
      <GripVertical className="h-5 w-5" aria-hidden />
    </button>
  );
  const more = (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`More for ${head.name ?? "this exercise"}`}
      className={cn("grid shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary", desktop ? "h-9 w-9" : "-mr-1.5 h-11 w-10")}
      data-pb-more
    >
      <MoreHorizontal className="h-5 w-5" />
    </button>
  );
  const style = { transform: CSS.Translate.toString(transform), transition };
  // the exercise being dragged lifts off the list and follows the finger; the others slide out of its way
  const shell = cn(
    "relative bg-background",
    isDragging && "z-30 rounded-xl ring-1 ring-border shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35)]",
  );

  if (desktop) {
    return (
      <div ref={setNodeRef} style={style} className={cn(shell, "rounded-xl py-1 hover:bg-muted/30")} data-pb-unit={id} data-pb-row={head.key}>
        {unit.entries.map((e, i) => (
          <div key={e.key} className={cn(DESK_GRID, "relative px-3 py-0.5")} data-pb-entry={e.key}>
            <RoleBar e={e} />
            {i === 0 ? grip : <span />}
            {i === 0 ? (
              <button type="button" onClick={onOpen} className="min-w-0 text-left" aria-label={`${head.name ?? "Exercise"}: more`}>
                {name}
                {multi && (
                  <span className="mt-0.5 block text-[12px] font-medium text-muted-foreground">{setGroupName(e)}</span>
                )}
              </button>
            ) : (
              <GroupCaption e={e} day={day} onOpen={() => onOpenGroup(e.key)} desktop />
            )}
            {cells(e)}
            {i === 0 ? (
              more
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div ref={setNodeRef} style={style} className={cn(shell, "py-3")} data-pb-unit={id} data-pb-row={head.key}>
      <div className="flex items-center gap-1">
        {grip}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-1 text-left" aria-label={`${head.name ?? "Exercise"}: more`}>
          {name}
        </button>
        {more}
      </div>
      {unit.entries.map((e) => (
        <div key={e.key} className={cn("relative", multi && "pl-2.5")} data-pb-entry={e.key}>
          {multi && <RoleBar e={e} />}
          {multi && <GroupCaption e={e} day={day} onOpen={() => onOpenGroup(e.key)} desktop={false} />}
          <div className={cn(PHONE_GRID, multi ? "mt-1" : "mt-1.5")}>{cells(e)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The bottom of the builder, Google Sheets' tabs: every week of the program
 * as a tab (grouped by block), the one on screen filled and the other weeks
 * an edit will reach outlined, with the week's own tools in ⋯.
 */
export function WeekBar({
  plan,
  cursor,
  targets,
  onPick,
  weekMenu,
  desktop,
}: {
  plan: ProgramPlan;
  cursor: Cursor;
  targets: WeekRef[];
  onPick: (b: number, w: number) => void;
  weekMenu: React.ReactNode;
  desktop: boolean;
}) {
  const { ref: strip, style: stripFade } = useScrollFade([plan.blocks.length, totalWeeksOf(plan)]);
  const hit = new Set(targets.map((t) => `${t.b}:${t.w}`));
  const multi = plan.blocks.length > 1;
  const g = programWeek(plan, cursor);
  const total = totalWeeksOf(plan);
  // each block's colour (by what it is), only worth working out when there's more than one
  const tints = useMemo(() => (multi ? plan.blocks.map((bl) => memberBlockTint(bl)) : []), [multi, plan.blocks]);

  // the week on screen stays in view as it changes
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-week-tab="${cursor.b}:${cursor.w}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [cursor.b, cursor.w]);

  return (
    <div
      className={cn(
        "z-40 border-t border-border bg-background",
        desktop ? "sticky bottom-0 -mx-4 px-4 pb-3 pt-2" : "phone-column fixed inset-x-0 bottom-0 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5",
      )}
      data-week-bar
      data-hide-on-keyboard
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5 pb-0.5 text-[12px] text-muted-foreground">
        <span className="truncate" data-week-now>
          <span className="font-semibold text-foreground">Week {g}</span> of {total}
          {multi ? ` · ${plan.blocks[cursor.b].name}` : ""}
        </span>
        {hit.size > 1 && (
          <span className="shrink-0" data-week-reach>
            Outlined weeks change too
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div ref={strip} style={stripFade} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 no-scrollbar" role="tablist" aria-label="Weeks">
          {plan.blocks.map((block, b) => (
            <div key={block.key} className="flex shrink-0 items-center gap-1">
              {b > 0 && <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />}
              {multi && (
                <span className="mr-0.5 flex max-w-[6rem] shrink-0 items-center gap-1 truncate text-[11px] font-medium text-muted-foreground" title={tints[b]?.type.name ? `${block.name} · ${tints[b]!.type.name}` : block.name}>
                  {tints[b] ? (
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", tints[b]!.cls.dot)} />
                  ) : (
                    b === 0 && <Layers className="h-3 w-3 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{block.name}</span>
                </span>
              )}
              {block.weeks.map((week, w) => {
                const on = b === cursor.b && w === cursor.w;
                const reached = hit.has(`${b}:${w}`);
                return (
                  <button
                    key={week.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-label={`Week ${programWeek(plan, { b, w })}${reached && !on ? ", changes with your edits" : ""}`}
                    onClick={() => onPick(b, w)}
                    className={cn(
                      "grid h-10 min-w-10 shrink-0 place-items-center rounded-lg px-2 text-[14px] font-semibold tabular-nums transition-colors",
                      on
                        ? "bg-foreground text-background"
                        : reached
                          ? "bg-foreground/[0.07] text-foreground ring-1 ring-inset ring-foreground/35"
                          : "text-muted-foreground hover:bg-secondary",
                    )}
                    data-week-tab={`${b}:${w}`}
                    data-week-reached={reached ? "" : undefined}
                  >
                    {programWeek(plan, { b, w })}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {weekMenu}
      </div>
    </div>
  );
}

/** The training days of the week on screen, as tabs, with + for another day. */
export function DayTabs({
  days,
  active,
  onPick,
  onAdd,
  canAdd,
  onDayMenu,
}: {
  days: { key: string; title: string; exercises: PlanExercise[] }[];
  active: number;
  onPick: (i: number) => void;
  onAdd: () => void;
  canAdd: boolean;
  onDayMenu: () => void;
}) {
  const { ref: strip, style: stripFade } = useScrollFade([days.length]);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-day-tab="${active}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [active]);
  return (
    <div className="flex items-center gap-1.5">
      <div ref={strip} style={stripFade} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 no-scrollbar" role="tablist" aria-label="Training days">
        {days.map((d, i) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => (i === active ? onDayMenu() : onPick(i))}
            className={cn(
              "inline-flex h-9 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-colors",
              i === active ? "bg-foreground text-background" : "bg-secondary text-foreground",
            )}
            data-day-tab={i}
          >
            <span className="truncate">{d.title || `Day ${i + 1}`}</span>
            {d.exercises.length > 0 && (
              <span className={cn("text-[12px] tabular-nums", i === active ? "text-background/70" : "text-muted-foreground")}>
                {exerciseUnits(d).length}
              </span>
            )}
          </button>
        ))}
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-dashed border-border px-3 text-[14px] font-medium text-muted-foreground"
            data-add-day
          >
            + Day
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDayMenu}
        aria-label="This day's options"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
        data-day-menu
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger };
