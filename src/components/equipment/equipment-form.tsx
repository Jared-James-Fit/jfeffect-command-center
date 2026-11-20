/**
 * Add or edit a piece of equipment: what they call it, what kind it is, which
 * gym it's in, and (folded) its brand, model, a note and a photo. Typing a
 * name they already have offers that one instead of a second copy; the
 * database refuses a duplicate either way (equipment_save).
 */
import { useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  EQUIPMENT_KINDS,
  NAME_MAX,
  NOTE_MAX,
  equipmentName,
  findDuplicate,
  similarEquipment,
  type Equipment,
  type EquipmentData,
  type EquipmentKind,
} from "@/lib/equipment/equipment";
import { removeEquipmentPhoto, useEquipmentActions } from "@/lib/equipment/equipment-queries";
import { PhotoSlot } from "./equipment-photo";

export const CHIP = "inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium transition-colors";
export const CHIP_ON = "border-foreground bg-foreground text-background";
export const CHIP_OFF = "border-border bg-background text-foreground active:bg-muted";

export function EquipmentForm({
  clientId,
  data,
  initial = null,
  defaultKind = null,
  defaultGymId = null,
  onSaved,
  onCancel,
  onRemoved,
  onUseExisting,
}: {
  clientId: string;
  data: EquipmentData;
  /** Editing this one (null: adding). */
  initial?: Equipment | null;
  defaultKind?: EquipmentKind | null;
  defaultGymId?: string | null;
  onSaved: (id: string, existed: boolean) => void;
  onCancel: () => void;
  /** After Remove (edit only). */
  onRemoved?: (result: "archived" | "deleted" | "gone") => void;
  /** "You already have it": use that one instead. */
  onUseExisting?: (id: string) => void;
}) {
  const actions = useEquipmentActions(clientId);
  const gyms = useMemo(() => data.gyms.filter((g) => !g.archived_at).sort((a, b) => a.name.localeCompare(b.name)), [data.gyms]);
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<EquipmentKind>(initial?.kind ?? defaultKind ?? "other");
  const [gymId, setGymId] = useState<string | null>(initial ? initial.gym_id : defaultGymId ?? null);
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [photo, setPhoto] = useState<string | null>(initial?.photo_path ?? null);
  const [more, setMore] = useState(!!(initial?.brand || initial?.model || initial?.notes));
  const [newGym, setNewGym] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [favorite, setFavorite] = useState(!!initial?.favorite);

  const trimmed = name.trim();
  const duplicate = !initial ? findDuplicate(data, trimmed, gymId) : findDuplicate(data, trimmed, gymId, initial.id);
  const similar = !initial && !duplicate ? similarEquipment(data, trimmed).filter((e) => e.gym_id !== gymId || e.name.trim().toLowerCase() !== trimmed.toLowerCase()) : [];
  const gymName = (id: string | null) => gyms.find((g) => g.id === id)?.name ?? null;

  const addGym = async () => {
    const n = (newGym ?? "").trim();
    if (!n) {
      setNewGym(null);
      return;
    }
    try {
      const r = await actions.saveGym(n);
      setGymId(r.id);
      setNewGym(null);
      if (r.existed) toast.message(`You already had ${n}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add the gym");
    }
  };

  const save = async () => {
    if (!trimmed) {
      toast.error("Give it a name");
      return;
    }
    if (duplicate && !initial && onUseExisting) {
      onUseExisting(duplicate.id);
      return;
    }
    setSaving(true);
    try {
      const r = await actions.saveEquipment({
        id: initial?.id ?? null,
        name: trimmed,
        kind,
        gymId,
        brand: brand.trim() || null,
        model: model.trim() || null,
        notes: notes.trim() || null,
        photoPath: photo,
      });
      if (initial && favorite !== initial.favorite) await actions.setFavorite(initial.id, favorite);
      onSaved(r.id, r.existed);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    // a photo added to equipment that was never saved goes with it
    if (!initial && photo) void removeEquipmentPhoto(photo);
    if (initial && photo && photo !== initial.photo_path) void removeEquipmentPhoto(photo);
    onCancel();
  };

  const remove = async () => {
    if (!initial) return;
    setConfirmRemove(false);
    try {
      const r = await actions.removeEquipment(initial.id);
      toast.success(r === "archived" ? `${equipmentName(initial)} retired. Your history keeps it.` : `${equipmentName(initial)} deleted`);
      onRemoved?.(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove it");
    }
  };

  return (
    <div className="space-y-4" data-equipment-form>
      <div>
        <label className="text-[13px] font-medium text-muted-foreground" htmlFor="eq-name">Name</label>
        <div className="mt-1 flex items-center gap-2">
          <Input
            id="eq-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rogue rack, Hammer row, Cable stack 2…"
            className="h-11 text-base"
            autoComplete="off"
            enterKeyHint="done"
          />
          {initial && (
            <button
              type="button"
              aria-pressed={favorite}
              aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => setFavorite((v) => !v)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground active:bg-muted"
              data-equipment-favorite
            >
              <Star className={cn("h-5 w-5", favorite && "fill-warning text-warning")} aria-hidden />
            </button>
          )}
        </div>
        {duplicate && (
          <p className="mt-1.5 text-[13px] text-muted-foreground" data-equipment-duplicate>
            You already have {equipmentName(duplicate)}{gymName(duplicate.gym_id) ? ` at ${gymName(duplicate.gym_id)}` : ""}.
            {!initial && onUseExisting && (
              <button type="button" className="ml-1 font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => onUseExisting(duplicate.id)}>
                Use it
              </button>
            )}
          </p>
        )}
        {similar.length > 0 && onUseExisting && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground" data-equipment-similar>
            <span>Already saved:</span>
            {similar.map((e) => (
              <button key={e.id} type="button" onClick={() => onUseExisting(e.id)} className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground active:bg-secondary">
                {equipmentName(e)}{gymName(e.gym_id) ? ` · ${gymName(e.gym_id)}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[13px] font-medium text-muted-foreground">Kind</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of equipment">
          {EQUIPMENT_KINDS.map((k) => (
            <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)} className={cn(CHIP, kind === k.key ? CHIP_ON : CHIP_OFF)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[13px] font-medium text-muted-foreground">Gym</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Gym">
          {gyms.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={gymId === g.id} onClick={() => setGymId(g.id)} className={cn(CHIP, gymId === g.id ? CHIP_ON : CHIP_OFF)}>
              {g.name}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={gymId === null} onClick={() => setGymId(null)} className={cn(CHIP, gymId === null ? CHIP_ON : CHIP_OFF)}>
            No gym
          </button>
          {newGym === null ? (
            <button type="button" onClick={() => setNewGym("")} className={cn(CHIP, CHIP_OFF, "gap-1 border-dashed text-muted-foreground")} data-equipment-new-gym>
              <Plus className="h-3.5 w-3.5" aria-hidden /> New gym
            </button>
          ) : (
            <div className="flex w-full items-center gap-2">
              <Input
                autoFocus
                value={newGym}
                maxLength={NAME_MAX}
                onChange={(e) => setNewGym(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addGym();
                  }
                }}
                placeholder="Gold's Gym, Home, Work…"
                className="h-10 text-base"
                enterKeyHint="done"
              />
              <Button type="button" variant="outline" className="h-10" onClick={() => void addGym()}>
                Add
              </Button>
            </div>
          )}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="inline-flex h-9 items-center gap-1 text-[13px] font-medium text-muted-foreground"
        >
          Brand, model and a note
          <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} aria-hidden />
        </button>
        {more && (
          <div className="mt-1.5 grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Input value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" className="h-10 text-base" aria-label="Brand" />
              <Input value={model} maxLength={60} onChange={(e) => setModel(e.target.value)} placeholder="Model" className="h-10 text-base" aria-label="Model" />
            </div>
            <textarea
              value={notes}
              maxLength={NOTE_MAX}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember about it (the holes are numbered top down…)"
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Note"
            />
          </div>
        )}
      </div>

      <PhotoSlot clientId={clientId} path={photo} onChange={(p) => setPhoto(p)} label="Add a photo of it" />

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" className="h-11 flex-1" onClick={() => void save()} disabled={saving || !trimmed} data-equipment-save>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : duplicate && !initial && onUseExisting ? "Use it" : "Save"}
        </Button>
      </div>

      {initial && (
        <>
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="inline-flex h-10 items-center gap-1.5 text-[13px] font-medium text-destructive"
            data-equipment-remove
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Remove {equipmentName(initial)}
          </button>
          <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {equipmentName(initial)}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Sets you logged on it keep its name in your history and PRs, and it moves to Retired, where you can bring it back. If you never logged a set on it, it's deleted with its setups.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
