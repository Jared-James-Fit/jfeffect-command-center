import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Star, GripVertical, Check, Loader2, AlertCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------- Drag & drop payload helpers ----------------

export const DND_EXERCISE = "application/x-pb-exercise";
export const DND_ROW = "application/x-pb-row";

export function setDragExercise(e: React.DragEvent, exerciseId: string) {
  e.dataTransfer.setData(DND_EXERCISE, exerciseId);
  e.dataTransfer.effectAllowed = "copy";
}
export function setDragRow(e: React.DragEvent, rowId: string, fromDayId: string) {
  e.dataTransfer.setData(DND_ROW, JSON.stringify({ rowId, fromDayId }));
  e.dataTransfer.effectAllowed = "move";
}
export function readDrop(e: React.DragEvent):
  | { kind: "exercise"; exerciseId: string }
  | { kind: "row"; rowId: string; fromDayId: string }
  | null {
  const ex = e.dataTransfer.getData(DND_EXERCISE);
  if (ex) return { kind: "exercise", exerciseId: ex };
  const r = e.dataTransfer.getData(DND_ROW);
  if (r) {
    try {
      const p = JSON.parse(r);
      return { kind: "row", rowId: p.rowId, fromDayId: p.fromDayId };
    } catch {}
  }
  return null;
}

// ---------------- Density toggle ----------------

export type Density = "compact" | "comfortable";
const DENSITY_KEY = "pb.density";

export function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(() => {
    if (typeof window === "undefined") return "compact";
    return (localStorage.getItem(DENSITY_KEY) as Density) || "compact";
  });
  const set = (next: Density) => {
    setD(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch {}
  };
  return [d, set];
}

export const DENSITY_CLASSES: Record<Density, { row: string; cell: string; input: string }> = {
  compact: { row: "h-7", cell: "px-1 py-0.5", input: "h-6 text-[11px] px-1.5" },
  comfortable: { row: "h-9", cell: "px-2 py-1", input: "h-8 text-xs px-2" },
};

// ---------------- Save state pill ----------------

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useSaveState() {
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setState("saving");
    try {
      const r = await fn();
      setState("saved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 1500);
      return r;
    } catch (e) {
      setState("error");
      throw e;
    }
  };
  return { state, wrap, setState };
}

export function SaveStatePill({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <Badge variant="outline" className="gap-1 text-[10px] font-normal">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </Badge>
    );
  if (state === "saved")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500 text-[10px] font-normal">
        <Check className="h-3 w-3" /> Saved
      </Badge>
    );
  if (state === "error")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive text-[10px] font-normal">
        <AlertCircle className="h-3 w-3" /> Error
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
      <Circle className="h-2 w-2 fill-current" /> Auto-save
    </Badge>
  );
}

// ---------------- Cell input (Tab/Enter friendly) ----------------

export function CellInput({
  value,
  onCommit,
  placeholder,
  className,
  density = "compact",
  type = "text",
  inputMode,
}: {
  value: string | number | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  density?: Density;
  type?: string;
  inputMode?: any;
}) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setLocal(value == null ? "" : String(value));
  }, [value]);
  return (
    <Input
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== (value == null ? "" : String(value))) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          // jump down: find next .pb-cell-input one row below
          const all = Array.from(
            (e.target as HTMLInputElement)
              .closest("[data-pb-grid]")
              ?.querySelectorAll<HTMLInputElement>(".pb-cell-input") ?? [],
          );
          const idx = all.indexOf(e.target as HTMLInputElement);
          const cols = Number((e.target as HTMLInputElement).closest("[data-pb-grid]")?.getAttribute("data-pb-cols") ?? 1);
          const next = all[idx + cols];
          next?.focus();
          next?.select();
        } else if (e.key === "Escape") {
          setLocal(value == null ? "" : String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      onFocus={(e) => e.currentTarget.select()}
      className={cn("pb-cell-input", DENSITY_CLASSES[density].input, className)}
    />
  );
}

// ---------------- Exercise library panel ----------------

const FAV_KEY = "pb.favorites";
function readFavs(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function writeFavs(s: Set<string>) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch {}
}

export interface ExerciseRef {
  id: string;
  name: string;
  muscle_group?: string | null;
  category?: string | null;
  equipment?: string | null;
  tags?: string[] | null;
}

const QUICK_FILTERS = [
  "Squat", "Bench", "Deadlift", "Chest", "Back", "Shoulders",
  "Quads", "Hamstrings", "Glutes", "Arms", "Accessories", "Mobility",
];

function exerciseMatchesFilter(ex: ExerciseRef, f: string): boolean {
  const hay = [ex.name, ex.muscle_group, ex.category, ...(ex.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(f.toLowerCase());
}

export function ExerciseLibraryPanel({
  exercises,
  recentIds = [],
  onPick,
  collapsed,
  onToggleCollapse,
}: {
  exercises: ExerciseRef[];
  recentIds?: string[];
  onPick?: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [favs, setFavs] = useState<Set<string>>(() => readFavs());

  const toggleFav = (id: string) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavs(next);
    writeFavs(next);
  };

  const filtered = useMemo(() => {
    let list = exercises;
    if (filter) list = list.filter((e) => exerciseMatchesFilter(e, filter));
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(needle) ||
        (e.muscle_group ?? "").toLowerCase().includes(needle) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(needle))
      );
    }
    return list.slice(0, 200);
  }, [exercises, q, filter]);

  const recent = useMemo(() => {
    const map = new Map(exercises.map((e) => [e.id, e]));
    return recentIds.map((id) => map.get(id)).filter(Boolean) as ExerciseRef[];
  }, [exercises, recentIds]);

  const favList = useMemo(
    () => exercises.filter((e) => favs.has(e.id)).slice(0, 20),
    [exercises, favs],
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-r border-border bg-card">
        <Button size="icon" variant="ghost" className="mt-2" onClick={onToggleCollapse} title="Show exercise library">
          <Search className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card text-xs">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <Search className="h-3 w-3 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search exercises…"
          className="h-7 border-0 bg-transparent px-1 text-xs focus-visible:ring-0"
        />
        {onToggleCollapse && (
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onToggleCollapse} title="Hide">
            ×
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        <button
          onClick={() => setFilter(null)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            filter === null ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(filter === f ? null : f)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {favList.length > 0 && !q && !filter && (
          <Section label="Favorites">
            {favList.map((e) => (
              <ExerciseItem key={e.id} ex={e} fav onFav={toggleFav} onPick={onPick} />
            ))}
          </Section>
        )}
        {recent.length > 0 && !q && !filter && (
          <Section label="Recent">
            {recent.map((e) => (
              <ExerciseItem key={e.id} ex={e} fav={favs.has(e.id)} onFav={toggleFav} onPick={onPick} />
            ))}
          </Section>
        )}
        <Section label={q || filter ? "Results" : "Library"}>
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-muted-foreground">No exercises.</div>
          ) : (
            filtered.map((e) => (
              <ExerciseItem key={e.id} ex={e} fav={favs.has(e.id)} onFav={toggleFav} onPick={onPick} />
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-card/95 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ExerciseItem({
  ex,
  fav,
  onFav,
  onPick,
}: {
  ex: ExerciseRef;
  fav?: boolean;
  onFav: (id: string) => void;
  onPick?: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => setDragExercise(e, ex.id)}
      onDoubleClick={() => onPick?.(ex.id)}
      title="Drag into a day, or double-click to add to first day"
      className="group flex cursor-grab items-center gap-1 border-b border-border/50 px-2 py-1 hover:bg-secondary/50 active:cursor-grabbing"
    >
      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{ex.name}</div>
        {ex.muscle_group && (
          <div className="truncate text-[10px] text-muted-foreground">{ex.muscle_group}</div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onFav(ex.id); }}
        className={cn(
          "opacity-0 group-hover:opacity-100",
          fav && "opacity-100 text-yellow-500",
        )}
        title={fav ? "Unfavorite" : "Favorite"}
      >
        <Star className={cn("h-3 w-3", fav && "fill-current")} />
      </button>
    </div>
  );
}

// ---------------- Copy week dialog ----------------

export function CopyWeekDialog({
  open,
  onOpenChange,
  weeks,
  defaultSrcId,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  weeks: { id: string; week_index: number }[];
  defaultSrcId?: string;
  onCopy: (opts: { srcWeekId: string; targetWeekId: string; prescriptions: boolean; notes: boolean }) => Promise<void>;
}) {
  const [src, setSrc] = useState<string>(defaultSrcId ?? weeks[0]?.id ?? "");
  const [tgt, setTgt] = useState<string>(weeks[1]?.id ?? "");
  const [prescriptions, setPrescriptions] = useState(true);
  const [notes, setNotes] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSrc(defaultSrcId ?? weeks[0]?.id ?? "");
      const defIdx = weeks.findIndex((w) => w.id === (defaultSrcId ?? weeks[0]?.id));
      setTgt(weeks[defIdx + 1]?.id ?? weeks[1]?.id ?? "");
    }
  }, [open, defaultSrcId, weeks]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy week</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From</Label>
              <Select value={src} onValueChange={setSrc}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {weeks.map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_index}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Into</Label>
              <Select value={tgt} onValueChange={setTgt}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {weeks.filter((w) => w.id !== src).map((w) => (
                    <SelectItem key={w.id} value={w.id}>Week {w.week_index}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2">
              <Checkbox checked={prescriptions} onCheckedChange={(v) => setPrescriptions(!!v)} />
              <span>Copy prescriptions (sets, reps, RPE, %, load, rest, tempo)</span>
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={notes} onCheckedChange={(v) => setNotes(!!v)} />
              <span>Copy notes & cues</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Client results are never copied. The target week is replaced.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={!src || !tgt || src === tgt || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCopy({ srcWeekId: src, targetWeekId: tgt, prescriptions, notes });
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Copying…" : "Copy week"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Movement priority chip ----------------

export type MovementPriority = "Primary" | "Secondary" | "Tertiary" | "Accessory" | "Warm-Up" | "Conditioning";

export const PRIORITY_OPTIONS: MovementPriority[] = [
  "Primary", "Secondary", "Tertiary", "Accessory", "Warm-Up", "Conditioning",
];

/** Infer a movement priority from time_profile + exercise name (used when no explicit label). */
export function inferPriority(timeProfile?: string | null, name?: string | null): MovementPriority {
  if (timeProfile === "main_lift") return "Primary";
  if (timeProfile === "secondary_lift") return "Secondary";
  if (timeProfile === "warmup_mobility") return "Warm-Up";
  if (timeProfile === "conditioning") return "Conditioning";
  if (timeProfile === "accessory_compound") return "Tertiary";
  return "Accessory";
}

/** Tailwind color for a movement family (used as a left edge accent). */
export function movementAccent(name?: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (/squat/.test(n)) return "bg-yellow-500/70";
  if (/bench|press/.test(n)) return "bg-sky-500/70";
  if (/deadlift|pull|row/.test(n)) return "bg-emerald-500/70";
  if (/curl|tricep|arm/.test(n)) return "bg-purple-500/60";
  return "bg-muted-foreground/40";
}