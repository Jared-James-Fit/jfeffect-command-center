/**
 * Multi-block exercise editor — slice 3 of the multi-block rollout.
 *
 * Gated behind the `pl-multi-block-builder` admin flag. Opens as a
 * dialog from a single exercise row. Persists ordered blocks plus
 * per-block set rows (ascending / warm-up) and drop stages (drop set)
 * through `saveBlocksForRowFn` into the normalized
 * `pl_exercise_blocks` / `pl_block_set_rows` / `pl_block_drop_stages`
 * tables. Refresh restores every value the coach entered.
 *
 * Slice 3 deliberately does NOT touch the inline legacy prescription
 * UI (`sets`/`reps_text`/`rpe`/`rir`/`load` on `pl_exercise_rows`):
 *   - existing programs keep rendering exactly as before
 *   - the assignment guard in `applyTemplateToClientFn` blocks
 *     assigning any template that already contains non-legacy blocks
 *   - the client logger keeps reading the legacy fields
 * The slice 4+5 ship will: extend the assignment RPC to copy these
 * blocks into the client's program with `reference_block_id` remap,
 * and replace the logger to read this schema.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  BLOCK_TYPES,
  type BlockType,
  type ExerciseBlock,
  type LoadType,
  type LoadUnit,
  defaultBlockLabel,
  makeEmptyBlock,
  validateBlock,
} from "@/lib/exercise-blocks";
import { listBlocksForRowFn, saveBlocksForRowFn } from "@/lib/exercise-blocks.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowId: string;
  exerciseName: string;
}

function numOrNull(v: string): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: string): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const LOAD_TYPE_OPTIONS: { value: LoadType; label: string }[] = [
  { value: "none", label: "Bodyweight / none" },
  { value: "fixed", label: "Fixed weight" },
  { value: "pct_1rm", label: "% of 1RM" },
  { value: "rpe", label: "By RPE" },
  { value: "ref_pct", label: "% of reference block" },
  { value: "ref_minus", label: "Reference minus" },
];

export function ExerciseBlocksEditor({ open, onOpenChange, rowId, exerciseName }: Props) {
  const qc = useQueryClient();
  const list = useServerFn(listBlocksForRowFn);
  const save = useServerFn(saveBlocksForRowFn);

  const { data, isLoading } = useQuery({
    queryKey: ["pl-row-blocks", rowId],
    queryFn: () => list({ data: { rowId } }) as Promise<ExerciseBlock[]>,
    enabled: open,
  });

  const [blocks, setBlocks] = useState<ExerciseBlock[]>([]);
  const [dirty, setDirty] = useState(false);

  // Hydrate local working state when the dialog opens / data arrives.
  useEffect(() => {
    if (open && data) {
      setBlocks(data.map((b) => ({ ...b, set_rows: [...(b.set_rows ?? [])], drop_stages: [...(b.drop_stages ?? [])] })));
      setDirty(false);
    }
  }, [open, data]);

  const mutate = useMutation({
    mutationFn: async (next: ExerciseBlock[]) => (await save({ data: { rowId, blocks: next } })) as ExerciseBlock[],
    onSuccess: (fresh) => {
      qc.setQueryData(["pl-row-blocks", rowId], fresh);
      setBlocks(fresh.map((b) => ({ ...b, set_rows: [...(b.set_rows ?? [])], drop_stages: [...(b.drop_stages ?? [])] })));
      setDirty(false);
      toast.success("Blocks saved");
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to save blocks"),
  });

  const update = (next: ExerciseBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };
  const patchBlock = (idx: number, patch: Partial<ExerciseBlock>) => {
    update(blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const addBlock = (block_type: BlockType) => {
    const newBlock = makeEmptyBlock(block_type, rowId, blocks.length);
    update([...blocks, newBlock]);
  };
  const removeBlock = (idx: number) => {
    const removedId = blocks[idx].id;
    update(
      blocks
        .filter((_, i) => i !== idx)
        .map((b, i) => ({
          ...b,
          sort_order: i,
          reference_block_id: b.reference_block_id === removedId ? null : b.reference_block_id,
        })),
    );
  };
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const copy = blocks.slice();
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    update(copy.map((b, i) => ({ ...b, sort_order: i })));
  };

  const errors = useMemo(() => blocks.flatMap(validateBlock), [blocks]);

  const onSave = () => {
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    mutate.mutate(blocks);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && dirty && !confirm("Discard unsaved block changes?")) return; onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Multi-block editor <Badge variant="outline" className="text-[10px]">Preview</Badge>
          </DialogTitle>
          <DialogDescription>
            {exerciseName} — program ordered set-blocks below. Saves into the normalized blocks schema.
            Assignments are blocked while non-Straight blocks exist until the next release ships the
            client logger.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading blocks…</div>
        ) : (
          <div className="space-y-3">
            {blocks.map((b, idx) => (
              <BlockCard
                key={b.id}
                block={b}
                index={idx}
                total={blocks.length}
                siblings={blocks}
                onChange={(patch) => patchBlock(idx, patch)}
                onMoveUp={() => move(idx, -1)}
                onMoveDown={() => move(idx, 1)}
                onDelete={() => removeBlock(idx)}
              />
            ))}
            {blocks.length === 0 && (
              <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                No blocks yet. Add one below.
              </div>
            )}
            <AddBlockMenu onAdd={addBlock} />

            {errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={mutate.isPending || isLoading || errors.length > 0}>
            {mutate.isPending ? "Saving…" : dirty ? "Save blocks" : "Saved"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddBlockMenu({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {BLOCK_TYPES.map((t) => (
        <Button key={t} type="button" variant="outline" size="sm" onClick={() => onAdd(t)} className="h-7 text-xs">
          <Plus className="mr-1 h-3 w-3" />
          {defaultBlockLabel(t)}
        </Button>
      ))}
    </div>
  );
}

interface BlockCardProps {
  block: ExerciseBlock;
  index: number;
  total: number;
  siblings: ExerciseBlock[];
  onChange: (patch: Partial<ExerciseBlock>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function BlockCard({ block, index, total, siblings, onChange, onMoveUp, onMoveDown, onDelete }: BlockCardProps) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-[10px]">#{index + 1}</Badge>
        <Select value={block.block_type} onValueChange={(v) => onChange({ block_type: v as BlockType })}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BLOCK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{defaultBlockLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8 text-xs"
          placeholder={defaultBlockLabel(block.block_type)}
          value={block.label ?? ""}
          onChange={(e) => onChange({ label: strOrNull(e.target.value) })}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === 0} onClick={onMoveUp}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === total - 1} onClick={onMoveDown}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <BlockInputs block={block} siblings={siblings} onChange={onChange} />

      <Separator />

      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Rest (sec)" value={block.rest_seconds_override} onChange={(n) => onChange({ rest_seconds_override: n })} />
        <TextField label="Tempo" placeholder="3-1-1-0" value={block.tempo} onChange={(s) => onChange({ tempo: s })} />
        <div className="flex items-end gap-2 pb-1">
          <Switch id={`amrap-${block.id}`} checked={block.amrap} onCheckedChange={(c) => onChange({ amrap: c })} />
          <Label htmlFor={`amrap-${block.id}`} className="text-xs">AMRAP last set</Label>
        </div>
      </div>
      <TextareaField label="Notes" value={block.notes} onChange={(s) => onChange({ notes: s })} />
    </div>
  );
}

function BlockInputs({ block, siblings, onChange }: { block: ExerciseBlock; siblings: ExerciseBlock[]; onChange: (patch: Partial<ExerciseBlock>) => void }) {
  switch (block.block_type) {
    case "straight":
    case "top":
    case "custom":
      return <StraightLikeInputs block={block} siblings={siblings} onChange={onChange} />;
    case "backoff":
      return <BackoffInputs block={block} siblings={siblings} onChange={onChange} />;
    case "ascending":
    case "warmup":
      return <SetRowsInputs block={block} onChange={onChange} />;
    case "drop":
      return <DropInputs block={block} onChange={onChange} />;
  }
}

function StraightLikeInputs({ block, siblings, onChange }: { block: ExerciseBlock; siblings: ExerciseBlock[]; onChange: (p: Partial<ExerciseBlock>) => void }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        <NumberField label="Sets" value={block.sets} onChange={(n) => onChange({ sets: n })} />
        <TextField label="Reps" placeholder="5 / 8-12 / AMRAP" value={block.reps_text} onChange={(s) => onChange({ reps_text: s })} />
        <TextField label="RPE" placeholder="8" value={block.rpe} onChange={(s) => onChange({ rpe: s })} />
        <TextField label="RIR" placeholder="2" value={block.rir} onChange={(s) => onChange({ rir: s })} />
      </div>
      <LoadInputs block={block} siblings={siblings} onChange={onChange} />
    </>
  );
}

function BackoffInputs({ block, siblings, onChange }: { block: ExerciseBlock; siblings: ExerciseBlock[]; onChange: (p: Partial<ExerciseBlock>) => void }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        <NumberField label="Sets" value={block.sets} onChange={(n) => onChange({ sets: n })} />
        <TextField label="Reps" placeholder="5" value={block.reps_text} onChange={(s) => onChange({ reps_text: s })} />
        <TextField label="RPE" placeholder="7" value={block.rpe} onChange={(s) => onChange({ rpe: s })} />
        <TextField label="RIR" placeholder="3" value={block.rir} onChange={(s) => onChange({ rir: s })} />
      </div>
      <LoadInputs block={block} siblings={siblings} onChange={onChange} />
    </>
  );
}

function LoadInputs({ block, siblings, onChange }: { block: ExerciseBlock; siblings: ExerciseBlock[]; onChange: (p: Partial<ExerciseBlock>) => void }) {
  const isRef = block.load_type === "ref_pct" || block.load_type === "ref_minus" || block.block_type === "backoff";
  const refOptions = siblings.filter((s) => s.id !== block.id);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Load type</Label>
          <Select value={block.load_type ?? "none"} onValueChange={(v) => onChange({ load_type: v as LoadType })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOAD_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <NumberField label="Value" value={block.load_value} onChange={(n) => onChange({ load_value: n })} />
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Unit</Label>
          <Select value={block.load_unit ?? "kg"} onValueChange={(v) => onChange({ load_unit: v as LoadUnit })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">kg</SelectItem>
              <SelectItem value="lb">lb</SelectItem>
              <SelectItem value="pct">%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isRef && (
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Reference block</Label>
          <Select
            value={block.reference_block_id ?? ""}
            onValueChange={(v) => onChange({ reference_block_id: v || null })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a block above…" /></SelectTrigger>
            <SelectContent>
              {refOptions.length === 0 && <SelectItem value="__none" disabled>No other blocks</SelectItem>}
              {refOptions.map((o, i) => (
                <SelectItem key={o.id} value={o.id}>#{i + 1} {o.label ?? defaultBlockLabel(o.block_type)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function SetRowsInputs({ block, onChange }: { block: ExerciseBlock; onChange: (p: Partial<ExerciseBlock>) => void }) {
  const rows = block.set_rows ?? [];
  const setRows = (next: typeof rows) => onChange({ set_rows: next.map((r, i) => ({ ...r, sort_order: i })) });
  const addRow = () =>
    setRows([
      ...rows,
      { id: crypto.randomUUID(), sort_order: rows.length, reps_text: "", load_value: null, load_unit: "pct", rpe: null, rir: null, amrap: false },
    ]);
  return (
    <div className="space-y-2">
      <Label className="text-[10px] uppercase text-muted-foreground">Set rows (in order)</Label>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[24px_1fr_1fr_72px_64px_64px_56px_28px] items-end gap-1.5">
            <span className="text-xs text-muted-foreground">{i + 1}</span>
            <TextField label={i === 0 ? "Reps" : undefined} placeholder="5" value={r.reps_text} onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, reps_text: v } : x))} />
            <NumberField label={i === 0 ? "Load" : undefined} value={r.load_value} onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, load_value: v } : x))} />
            <div className="space-y-1">
              {i === 0 && <Label className="text-[10px] uppercase text-muted-foreground">Unit</Label>}
              <Select value={r.load_unit ?? "pct"} onValueChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, load_unit: v as LoadUnit } : x))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="lb">lb</SelectItem>
                  <SelectItem value="pct">%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TextField label={i === 0 ? "RPE" : undefined} placeholder="—" value={r.rpe} onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, rpe: v } : x))} />
            <TextField label={i === 0 ? "RIR" : undefined} placeholder="—" value={r.rir} onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, rir: v } : x))} />
            <div className="flex items-center gap-1 pb-1">
              <Switch checked={r.amrap} onCheckedChange={(c) => setRows(rows.map((x, j) => j === i ? { ...x, amrap: c } : x))} />
              {i === 0 && <span className="text-[10px]">AMRAP</span>}
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={addRow} className="h-7 text-xs">
        <Plus className="mr-1 h-3 w-3" /> Add set
      </Button>
    </div>
  );
}

function DropInputs({ block, onChange }: { block: ExerciseBlock; onChange: (p: Partial<ExerciseBlock>) => void }) {
  const stages = block.drop_stages ?? [];
  const setStages = (next: typeof stages) => onChange({ drop_stages: next.map((s, i) => ({ ...s, sort_order: i })) });
  const addStage = () =>
    setStages([
      ...stages,
      { id: crypto.randomUUID(), sort_order: stages.length, reduction_type: "pct", reduction_value: 20, reps_text: "AMRAP", rpe: null, rir: null, amrap: true, rest_seconds: 0 },
    ]);
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">Drive set</Label>
        <div className="grid grid-cols-5 gap-2">
          <TextField label="Reps" placeholder="8" value={block.reps_text} onChange={(s) => onChange({ reps_text: s })} />
          <NumberField label="Load" value={block.load_value} onChange={(n) => onChange({ load_value: n })} />
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Unit</Label>
            <Select value={block.load_unit ?? "kg"} onValueChange={(v) => onChange({ load_unit: v as LoadUnit })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">kg</SelectItem>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="pct">%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TextField label="RPE" placeholder="9" value={block.rpe} onChange={(s) => onChange({ rpe: s })} />
          <TextField label="RIR" placeholder="0" value={block.rir} onChange={(s) => onChange({ rir: s })} />
        </div>
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">Drop stages</Label>
        <div className="space-y-1">
          {stages.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[24px_88px_72px_1fr_64px_64px_72px_48px_28px] items-end gap-1.5">
              <span className="text-xs text-muted-foreground">↓{i + 1}</span>
              <div className="space-y-1">
                {i === 0 && <Label className="text-[10px] uppercase text-muted-foreground">Reduce</Label>}
                <Select value={s.reduction_type ?? "pct"} onValueChange={(v) => setStages(stages.map((x, j) => j === i ? { ...x, reduction_type: v as "pct" | "fixed" } : x))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pct">%</SelectItem>
                    <SelectItem value="fixed">−weight</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberField label={i === 0 ? "By" : undefined} value={s.reduction_value} onChange={(v) => setStages(stages.map((x, j) => j === i ? { ...x, reduction_value: v } : x))} />
              <TextField label={i === 0 ? "Reps" : undefined} placeholder="AMRAP" value={s.reps_text} onChange={(v) => setStages(stages.map((x, j) => j === i ? { ...x, reps_text: v } : x))} />
              <TextField label={i === 0 ? "RPE" : undefined} placeholder="—" value={s.rpe} onChange={(v) => setStages(stages.map((x, j) => j === i ? { ...x, rpe: v } : x))} />
              <TextField label={i === 0 ? "RIR" : undefined} placeholder="—" value={s.rir} onChange={(v) => setStages(stages.map((x, j) => j === i ? { ...x, rir: v } : x))} />
              <NumberField label={i === 0 ? "Rest s" : undefined} value={s.rest_seconds} onChange={(v) => setStages(stages.map((x, j) => j === i ? { ...x, rest_seconds: v } : x))} />
              <div className="flex items-center gap-1 pb-1">
                <Switch checked={s.amrap} onCheckedChange={(c) => setStages(stages.map((x, j) => j === i ? { ...x, amrap: c } : x))} />
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addStage} className="mt-1 h-7 text-xs">
          <Plus className="mr-1 h-3 w-3" /> Add drop stage
        </Button>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label?: string; value: number | null | undefined; onChange: (n: number | null) => void }) {
  return (
    <div className="space-y-1">
      {label && <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>}
      <Input
        inputMode="decimal"
        className="h-8 text-xs"
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(numOrNull(e.target.value))}
      />
    </div>
  );
}

function TextField({ label, placeholder, value, onChange }: { label?: string; placeholder?: string; value: string | null | undefined; onChange: (s: string | null) => void }) {
  return (
    <div className="space-y-1">
      {label && <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>}
      <Input
        className="h-8 text-xs"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(strOrNull(e.target.value))}
      />
    </div>
  );
}

function TextareaField({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (s: string | null) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Textarea
        rows={2}
        className="text-xs"
        value={value ?? ""}
        onChange={(e) => onChange(strOrNull(e.target.value))}
      />
    </div>
  );
}