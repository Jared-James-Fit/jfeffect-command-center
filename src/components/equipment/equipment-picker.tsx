/**
 * The equipment picker inside the setup sheet: what this exercise was done
 * on, favorites, then everything by gym, a search once there's a lot, and
 * "Nothing in particular" (settings without naming a machine).
 */
import { useMemo, useState } from "react";
import { Check, Dumbbell, Plus, Search, Star, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { noAutofill } from "@/lib/no-autofill";
import { cn } from "@/lib/utils";
import { KIND_LABEL, equipmentDetail, equipmentName, pickerSections, type Equipment, type EquipmentData, type EquipmentKind } from "@/lib/equipment/equipment";
import { EquipmentThumb } from "./equipment-photo";

export function EquipmentPicker({
  data,
  exerciseId,
  kind,
  currentId,
  gymName,
  onPick,
  onNew,
  onFavorite,
}: {
  data: EquipmentData;
  exerciseId: string;
  kind: EquipmentKind | null;
  currentId: string | null;
  gymName: (id: string | null) => string | null;
  onPick: (id: string | null) => void;
  onNew: () => void;
  onFavorite: (e: Equipment) => void;
}) {
  const [q, setQ] = useState("");
  const sections = useMemo(() => pickerSections(data, exerciseId, kind), [data, exerciseId, kind]);
  const total = sections.forExercise.length + sections.favorites.length + sections.byGym.reduce((n, g) => n + g.items.length, 0);
  const match = (e: Equipment) => {
    const n = q.trim().toLowerCase();
    if (!n) return true;
    return [e.name, e.brand, e.model, gymName(e.gym_id)].some((s) => (s ?? "").toLowerCase().includes(n));
  };
  const groups: Array<{ title: string; items: Equipment[] }> = [
    { title: "Used for this exercise", items: sections.forExercise.filter(match) },
    { title: "Favorites", items: sections.favorites.filter(match) },
    ...sections.byGym.map((g) => ({ title: g.gym?.name ?? "No gym", items: g.items.filter(match) })),
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4" data-equipment-picker>
      <button
        type="button"
        onClick={onNew}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border px-3 py-3 text-left active:bg-muted"
        data-picker-new
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted"><Plus className="h-5 w-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">Add new equipment</span>
          <span className="block text-[13px] text-muted-foreground">A rack, bench, machine or cable, in any gym</span>
        </span>
      </button>

      {total > 8 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your equipment" className="h-11 pl-9 text-base" aria-label="Search your equipment" {...noAutofill("equipment-picker")} autoCorrect="off" spellCheck={false} enterKeyHint="search" />
        </div>
      )}

      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <div className="mb-1 px-1 text-[13px] font-semibold text-muted-foreground">{g.title}</div>
          <ul className="space-y-0.5">
            {g.items.map((e) => (
              <li key={e.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPick(e.id)}
                  className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 py-2 text-left active:bg-muted", currentId === e.id && "bg-muted/60")}
                  data-picker-item={e.id}
                >
                  <EquipmentThumb path={e.photo_path} className="h-10 w-10" icon={<Dumbbell className="h-4 w-4" aria-hidden />} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-foreground">{equipmentName(e)}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{[KIND_LABEL[e.kind], equipmentDetail(e, g.title === gymName(e.gym_id) ? null : gymName(e.gym_id))].filter(Boolean).join(" · ")}</span>
                  </span>
                  {currentId === e.id && <Check className="h-5 w-5 shrink-0 text-foreground" aria-label="In use" />}
                </button>
                <button
                  type="button"
                  onClick={() => onFavorite(e)}
                  aria-pressed={e.favorite}
                  aria-label={e.favorite ? `Remove ${equipmentName(e)} from favorites` : `Add ${equipmentName(e)} to favorites`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground active:bg-muted"
                >
                  <Star className={cn("h-4 w-4", e.favorite && "fill-warning text-warning")} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {q && groups.length === 0 && <p className="px-1 text-[13px] text-muted-foreground">Nothing saved matches “{q}”.</p>}

      <button
        type="button"
        onClick={() => onPick(null)}
        className={cn("flex w-full items-center gap-3 rounded-xl px-1.5 py-2 text-left active:bg-muted", currentId === null && "bg-muted/60")}
        data-picker-none
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground"><X className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-foreground">Nothing in particular</span>
          <span className="block text-[12px] text-muted-foreground">Keep settings without naming a machine</span>
        </span>
        {currentId === null && <Check className="h-5 w-5 shrink-0 text-foreground" aria-label="In use" />}
      </button>
    </div>
  );
}
