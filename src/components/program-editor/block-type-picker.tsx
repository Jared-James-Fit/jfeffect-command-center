/**
 * Picking a block's type, and the team's library of types (built-in and the
 * coach's own): colour, name, and the metadata Cleo and Program Check read.
 * One sheet for the template editor and a client's block alike.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BuilderSheet } from "./builder-sheet";
import {
  BLOCK_COLORS,
  BLOCK_COLOR_CLASS,
  BUILT_IN_BLOCK_TYPES,
  colorClass,
  findBlockType,
  type BlockColor,
  type BlockMeta,
  type BlockTypeDef,
  type Level,
  type ResolvedBlockType,
} from "@/lib/block-types";
import { saveBlockType, useBlockTypeLibrary, useInvalidateBlockTypes, type BlockTypeDraft } from "@/lib/block-types-queries";

/** A block's type as a chip: its colour beside its name, "suggested" when read from its words. */
export function BlockTypeChip({ resolved, onClick, className, empty = "Set block type" }: { resolved: ResolvedBlockType | null; onClick?: () => void; className?: string; empty?: string }) {
  const t = resolved?.type ?? null;
  const c = colorClass(t);
  const body = (
    <>
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", t ? c.dot : "border border-dashed border-muted-foreground/60")} />
      <span className="truncate">{t ? t.name : empty}</span>
      {t && resolved?.inferred ? <span className="shrink-0 text-[10px] font-normal opacity-70">suggested</span> : null}
    </>
  );
  const cls = cn(
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
    t ? c.chip : "bg-muted text-muted-foreground",
    onClick && "hover:opacity-90",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} data-block-type-chip={t?.key ?? ""}>
      {body}
    </button>
  ) : (
    <span className={cls} data-block-type-chip={t?.key ?? ""}>
      {body}
    </span>
  );
}

function Swatch({ color, picked, onPick }: { color: BlockColor; picked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={color}
      aria-pressed={picked}
      className={cn("h-9 w-9 rounded-full ring-offset-2 ring-offset-background transition", BLOCK_COLOR_CLASS[color].dot, picked ? "ring-2 ring-foreground" : "hover:scale-105")}
    />
  );
}

const LEVEL_LABEL: Record<Level, string> = { low: "Low", moderate: "Moderate", high: "High", very_high: "Very high" };

export function BlockTypeSheet({
  open,
  onOpenChange,
  title = "Block type",
  value,
  inferredKey,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  value: { type: string | null; meta: BlockMeta | null };
  /** What the block's own words suggest, offered first when nothing's picked. */
  inferredKey?: string | null;
  onSave: (type: string | null, meta: BlockMeta | null) => Promise<void> | void;
}) {
  const { library } = useBlockTypeLibrary();
  const [mode, setMode] = useState<"pick" | "manage">("pick");
  const [type, setType] = useState<string | null>(value.type ?? inferredKey ?? null);
  const [meta, setMeta] = useState<BlockMeta>(value.meta ?? {});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setMode("pick");
    setType(value.type ?? inferredKey ?? null);
    setMeta(value.meta ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const def = findBlockType(type, library);
  const visible = library.filter((t) => !t.archived || t.key === value.type);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(type, meta);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the block type.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BuilderSheet open={open} onOpenChange={onOpenChange} title={mode === "pick" ? title : "Block types"} description={mode === "pick" ? "Colours the program everywhere; Cleo plans from its purpose and progression, never the colour." : "Your team's types. Rename, recolour, reorder or add your own."} wide>
      {mode === "manage" ? (
        <BlockTypeManager onBack={() => setMode("pick")} />
      ) : (
        <div className="space-y-4" data-block-type-sheet>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Block type">
            {visible.map((t) => {
              const picked = t.key === type;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  onClick={() => setType(picked ? null : t.key)}
                  className={cn("flex min-h-[52px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition", picked ? "border-foreground bg-secondary" : "border-border hover:bg-muted/60")}
                  data-block-type-option={t.key}
                >
                  <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-full", BLOCK_COLOR_CLASS[t.color].dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.name}</span>
                    {t.key === inferredKey && !value.type ? <span className="block text-[11px] text-muted-foreground">Suggested from its name</span> : null}
                  </span>
                  {picked ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
              );
            })}
          </div>

          {def ? (
            <div className="space-y-3 rounded-xl bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">
                For this block. Leave a box empty to use the {def.name} default. Typical intensity {LEVEL_LABEL[def.intensity].toLowerCase()}, volume {LEVEL_LABEL[def.volume].toLowerCase()}.
              </div>
              {(["purpose", "emphasis", "progression"] as const).map((k) => (
                <label key={k} className="block space-y-1">
                  <span className="text-xs font-medium capitalize">{k === "emphasis" ? "Training emphasis" : k === "progression" ? "Progression approach" : "Purpose"}</span>
                  <Textarea
                    rows={2}
                    value={meta[k] ?? ""}
                    placeholder={def[k]}
                    onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value.slice(0, 400) }))}
                    className="text-base md:text-sm"
                    data-block-meta={k}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No type: the block keeps its name and phase only.</p>
          )}

          <div className="flex items-center gap-2">
            <Button variant="ghost" className="h-11" onClick={() => setMode("manage")} data-block-types-manage>
              Manage types
            </Button>
            <span className="flex-1" />
            <Button className="h-11 min-w-28" onClick={save} disabled={saving} data-block-type-save>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      )}
    </BuilderSheet>
  );
}

function BlockTypeManager({ onBack }: { onBack: () => void }) {
  const { library, rows, available } = useBlockTypeLibrary();
  const invalidate = useInvalidateBlockTypes();
  const [editing, setEditing] = useState<BlockTypeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const ordered = useMemo(() => library, [library]);

  const draftFor = (t: BlockTypeDef): BlockTypeDraft => {
    const row = rows.find((r) => (t.builtIn ? r.builtin_key === t.key : r.id === t.key));
    return {
      id: row?.id ?? null,
      builtinKey: t.builtIn ? t.key : null,
      name: t.name,
      color: t.color,
      purpose: row?.purpose ?? (t.builtIn ? "" : t.purpose),
      emphasis: row?.emphasis ?? (t.builtIn ? "" : t.emphasis),
      progression: row?.progression ?? (t.builtIn ? "" : t.progression),
      intensity: t.intensity,
      volume: t.volume,
      basedOn: t.builtIn ? null : t.basedOn ?? null,
      sortOrder: t.sortOrder,
      archived: !!t.archived,
    };
  };

  const persist = async (d: BlockTypeDraft, ok: string) => {
    setBusy(true);
    try {
      await saveBlockType(d);
      await invalidate();
      toast.success(ok);
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    const a = draftFor(ordered[i]);
    const b = draftFor(ordered[j]);
    setBusy(true);
    try {
      await saveBlockType({ ...a, sortOrder: ordered[j].sortOrder === ordered[i].sortOrder ? ordered[j].sortOrder + dir : ordered[j].sortOrder });
      await saveBlockType({ ...b, sortOrder: ordered[i].sortOrder });
      await invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reorder.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    const base = editing.basedOn ? findBlockType(editing.basedOn) : editing.builtinKey ? findBlockType(editing.builtinKey) : null;
    return (
      <div className="space-y-3" data-block-type-editor>
        <button type="button" onClick={() => setEditing(null)} className="inline-flex h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All types
        </button>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Name</span>
          <Input value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-11 text-base md:text-sm" data-block-type-name />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-medium">Colour</span>
          <div className="flex flex-wrap gap-2">
            {BLOCK_COLORS.map((c) => (
              <Swatch key={c} color={c} picked={editing.color === c} onPick={() => setEditing({ ...editing, color: c })} />
            ))}
          </div>
        </div>
        {!editing.builtinKey && (
          <label className="block space-y-1">
            <span className="text-xs font-medium">Works like</span>
            <Select value={editing.basedOn ?? "none"} onValueChange={(v) => setEditing({ ...editing, basedOn: v === "none" ? null : v })}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Its own approach</SelectItem>
                {BUILT_IN_BLOCK_TYPES.filter((t) => t.key !== "custom").map((t) => (
                  <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="block text-[11px] text-muted-foreground">How Program Check reads it (what volume and intensity to expect). Never a template it forces.</span>
          </label>
        )}
        {(["purpose", "emphasis", "progression"] as const).map((k) => (
          <label key={k} className="block space-y-1">
            <span className="text-xs font-medium">{k === "emphasis" ? "Training emphasis" : k === "progression" ? "Progression approach" : "Purpose"}</span>
            <Textarea rows={2} value={editing[k] ?? ""} placeholder={base?.[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value.slice(0, 400) })} className="text-base md:text-sm" />
          </label>
        ))}
        {!editing.builtinKey && (
          <div className="grid grid-cols-2 gap-2">
            {(["intensity", "volume"] as const).map((k) => (
              <label key={k} className="block space-y-1">
                <span className="text-xs font-medium capitalize">Typical {k}</span>
                <Select value={editing[k] ?? "moderate"} onValueChange={(v) => setEditing({ ...editing, [k]: v as Level })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
                      <SelectItem key={l} value={l}>{LEVEL_LABEL[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {editing.id || editing.builtinKey ? (
            <Button
              variant="ghost"
              className="h-11"
              disabled={busy}
              onClick={async () => {
                if (await persist({ ...editing, archived: !editing.archived }, editing.archived ? "Back in the list" : "Hidden from the list")) setEditing(null);
              }}
            >
              {editing.archived ? "Show in the list" : "Hide from the list"}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            className="h-11 min-w-28"
            disabled={busy || !editing.name.trim()}
            onClick={async () => {
              if (await persist(editing, editing.id || editing.builtinKey ? "Type saved" : "Type added")) setEditing(null);
            }}
            data-block-type-editor-save
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-block-type-manager>
      <button type="button" onClick={onBack} className="inline-flex h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </button>
      {!available && <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">Your own types save once the database is updated. The built-in types work now.</p>}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {ordered.map((t, i) => (
          <li key={t.key} className={cn("flex items-center gap-2 px-3 py-2", t.archived && "opacity-50")}>
            <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-full", BLOCK_COLOR_CLASS[t.color].dot)} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(draftFor(t))}>
              <span className="block truncate text-sm font-medium">{t.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t.builtIn ? "Built in" : "Your type"}{t.archived ? " · hidden" : ""}</span>
            </button>
            <Button size="icon" variant="ghost" className="h-9 w-9" disabled={busy || i === 0 || !available} aria-label={`Move ${t.name} up`} onClick={() => move(i, -1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" disabled={busy || i === ordered.length - 1 || !available} aria-label={`Move ${t.name} down`} onClick={() => move(i, 1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" className="h-11 w-full" disabled={!available} onClick={() => setEditing({ name: "", color: "cyan", basedOn: null, intensity: "moderate", volume: "moderate" })} data-block-type-new>
        <Plus className="mr-1.5 h-4 w-4" /> New type
      </Button>
    </div>
  );
}
