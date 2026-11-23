import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { haptic } from "@/platform/haptics";
import { rowKeysOf, type EditorRow } from "@/lib/program-editor-rows";
import { cn } from "@/lib/utils";

/**
 * Drag to reorder in the coach's program editor (StructureCanvas's DayEditor),
 * the member builder's way (athlete-programs/workbench): a handle on each
 * exercise; a mouse drags at once, a finger presses and holds the handle (so a
 * swipe anywhere still scrolls the page), arrow keys after Space for a
 * keyboard; the exercise lifts and follows, the others slide out of its way,
 * the page scrolls at its edges, and the phone taps as it picks up, passes
 * each exercise and lands.
 */

/** What the handle needs from its exercise's sortable item. */
export type GripHandle = {
  ref: (el: HTMLElement | null) => void;
  listeners: Record<string, unknown> | undefined;
  attributes: Record<string, unknown>;
  isDragging: boolean;
};

/** Dragging an exercise only ever moves it up or down. */
const upAndDown: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// unique across reloads too (an undo restored after a reload carries old keys)
const SESSION = Math.random().toString(36).slice(2, 7);
let seq = 0;
const newKey = () => `${SESSION}-${++seq}`;

/**
 * A key per row that stays with the row when it moves (rowKeysOf: the row's
 * own `_k`, else its position's), so a card keeps whatever it has open while
 * it's dragged, copied past or moved. `newKey` names a row about to be added.
 */
export function useRowKeys(rows: EditorRow[]): { keys: string[]; newKey: () => string } {
  const prev = useRef<string[]>([]);
  const keys = useMemo(() => {
    const out = rowKeysOf(rows, prev.current, newKey);
    prev.current = out;
    return out;
  }, [rows]);
  return { keys, newKey };
}

export function SortableUnits({
  ids,
  onMove,
  onStart,
  children,
}: {
  /** one id per exercise, in order */
  ids: string[];
  /** move exercise `from` to position `to` */
  onMove: (from: number, to: number) => void;
  onStart?: () => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // a mouse drags at once; a finger presses and holds the handle, so a swipe still scrolls
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const overRef = useRef<string | null>(null);
  const onDragStart = (ev: DragStartEvent) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    overRef.current = String(ev.active.id);
    onStart?.();
    haptic("medium");
  };
  const onDragOver = (ev: DragOverEvent) => {
    const id = ev.over ? String(ev.over.id) : null;
    if (id && id !== overRef.current) haptic("selection");
    overRef.current = id;
  };
  const onDragEnd = (ev: DragEndEvent) => {
    overRef.current = null;
    if (!ev.over) return;
    const from = ids.indexOf(String(ev.active.id));
    const to = ids.indexOf(String(ev.over.id));
    if (from < 0 || to < 0 || from === to) return;
    onMove(from, to);
    haptic("light");
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[upAndDown]}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={{ threshold: { x: 0, y: 0.25 }, acceleration: 14 }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => (overRef.current = null)}
      accessibility={{
        screenReaderInstructions: {
          draggable: "To move an exercise, press space or enter, use the arrow keys, then press space or enter again.",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** One exercise (a row and its back-offs) that drags as one. */
export function SortableUnit({
  id,
  className,
  flash,
  children,
}: {
  id: string;
  className?: string;
  /** lit for a moment where it landed (a copy, a new back-off) */
  flash?: boolean;
  children: (handle: GripHandle) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-pb-unit={id}
      data-pb-flash={flash ? "new" : undefined}
      className={cn(
        "relative bg-card",
        // the exercise being dragged lifts off the list and follows the finger
        isDragging && "z-30 rounded-xl ring-1 ring-border shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      {children({ ref: setActivatorNodeRef, listeners: listeners as Record<string, unknown> | undefined, attributes: attributes as unknown as Record<string, unknown>, isDragging })}
    </div>
  );
}

/** The handle: always there, a 40px tap on a phone, never opens the card. */
export function RowGrip({ handle, name, phone }: { handle: GripHandle; name: string; phone: boolean }) {
  return (
    <button
      type="button"
      ref={handle.ref}
      {...handle.attributes}
      {...(handle.listeners ?? {})}
      aria-label={`Reorder ${name || "exercise"}: ${phone ? "press and hold, then drag" : "drag, or press space and use the arrow keys"}`}
      aria-roledescription="Drag handle"
      title="Drag to reorder"
      data-row-grip
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "grid shrink-0 cursor-grab touch-manipulation select-none place-items-center rounded-lg text-muted-foreground/80 transition-colors [-webkit-touch-callout:none] hover:bg-secondary hover:text-foreground active:cursor-grabbing",
        phone ? "-my-1.5 -ml-2 h-10 w-8" : "-my-1 -ml-1.5 h-8 w-6",
        handle.isDragging && "text-foreground",
      )}
    >
      <GripVertical className={phone ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
    </button>
  );
}
