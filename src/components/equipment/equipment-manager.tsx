/**
 * Equipment & setups, all in one place (Account → Equipment & setups, and the
 * coach's Athlete setup): the athlete's gyms and what's in them, and every
 * exercise's saved setups. The same sheets as the workout card: a setup opens
 * the setup sheet (manage mode), a piece of equipment its edit form.
 * Retired equipment (used, then removed) is folded away with Restore.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Dumbbell, HelpCircle, MoreHorizontal, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExercisePickerSheet } from "@/components/athlete-programs/exercise-picker-sheet";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL,
  currentSetup,
  equipmentDetail,
  equipmentName,
  likelyGym,
  settingsText,
  type Equipment,
  type ExerciseSetup,
} from "@/lib/equipment/equipment";
import { useAthleteEquipment, useEquipmentActions } from "@/lib/equipment/equipment-queries";
import { EquipmentForm } from "./equipment-form";
import { EquipmentThumb } from "./equipment-photo";
import { SetupSheet } from "./setup-sheet";

const sb = supabase as any;
const SEG = "h-9 flex-1 rounded-md text-[13px] font-medium transition-colors";

export function EquipmentManager({
  clientId,
  coachView = false,
  athleteFirstName = null,
  onShowGuide,
}: {
  clientId: string;
  coachView?: boolean;
  athleteFirstName?: string | null;
  /** "How it works": the walkthrough. */
  onShowGuide?: () => void;
}) {
  const { data, loaded } = useAthleteEquipment(clientId);
  const actions = useEquipmentActions(clientId);
  const [tab, setTab] = useState<"equipment" | "setups">("equipment");
  const [editing, setEditing] = useState<Equipment | "new" | null>(null);
  const [setupFor, setSetupFor] = useState<{ id: string; name: string; equipment?: string | null; equipmentId: string | null } | null>(null);
  const [pickExercise, setPickExercise] = useState(false);
  const [retiredOpen, setRetiredOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newGym, setNewGym] = useState<string | null>(null);

  const live = data.equipment.filter((e) => !e.archived_at);
  const retired = data.equipment.filter((e) => e.archived_at);
  const gyms = data.gyms.filter((g) => !g.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const groups = useMemo(() => {
    const out: Array<{ gym: (typeof gyms)[number] | null; items: Equipment[] }> = gyms.map((g) => ({
      gym: g,
      items: live.filter((e) => e.gym_id === g.id).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)),
    }));
    const loose = live.filter((e) => !e.gym_id || !gyms.some((g) => g.id === e.gym_id)).sort((a, b) => a.name.localeCompare(b.name));
    if (loose.length) out.push({ gym: null, items: loose });
    return out;
  }, [gyms, live]);

  // exercise names for the setups (only the ones they've saved)
  const exerciseIds = useMemo(() => Array.from(new Set(data.setups.map((s) => s.exercise_id))).sort(), [data.setups]);
  const { data: exerciseNames = {} } = useQuery({
    queryKey: ["equipment-exercise-names", exerciseIds.join(",")],
    enabled: exerciseIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const out: Record<string, { name: string; equipment: string | null }> = {};
      for (let i = 0; i < exerciseIds.length; i += 150) {
        const { data: rows } = await sb.from("exercises").select("id, name, equipment").in("id", exerciseIds.slice(i, i + 150));
        for (const r of rows ?? []) out[r.id] = { name: r.name, equipment: r.equipment ?? null };
      }
      return out;
    },
  });
  const setupsByExercise = useMemo(() => {
    const byEx = new Map<string, ExerciseSetup[]>();
    for (const s of data.setups) {
      if (s.equipment_id && !live.some((e) => e.id === s.equipment_id)) continue;
      // a pick with nothing saved and nothing in particular says nothing
      if (!s.equipment_id && !s.settings.length && !s.notes && !s.photo_path) continue;
      byEx.set(s.exercise_id, [...(byEx.get(s.exercise_id) ?? []), s]);
    }
    return [...byEx.entries()]
      .map(([id, list]) => ({ id, name: exerciseNames[id]?.name ?? "Exercise", equipment: exerciseNames[id]?.equipment ?? null, list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.setups, live, exerciseNames]);

  const setupCountAll = setupsByExercise.reduce((n, ex) => n + ex.list.length, 0);
  const who = coachView ? (athleteFirstName ? `${athleteFirstName}'s` : "their") : "your";
  const empty = loaded && live.length === 0 && setupsByExercise.length === 0;

  const saveGymName = async () => {
    if (!renaming) return;
    try {
      await actions.saveGym(renaming.name, renaming.id);
      setRenaming(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't rename it");
    }
  };
  const addGym = async () => {
    const n = (newGym ?? "").trim();
    if (!n) return setNewGym(null);
    try {
      const r = await actions.saveGym(n);
      if (r.existed) toast.message(`${n} is already there`);
      setNewGym(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add the gym");
    }
  };
  const removeGym = async (id: string, name: string) => {
    try {
      const r = await actions.removeGym(id);
      toast.success(
        r.retired > 0
          ? `${name} removed. ${r.retired} piece${r.retired === 1 ? "" : "s"} of equipment kept for ${who} history.`
          : `${name} removed`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove it");
    }
  };

  return (
    <div className="space-y-4" data-equipment-manager>
      <div className="flex gap-1 rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Equipment or setups">
        <button type="button" role="tab" aria-selected={tab === "equipment"} onClick={() => setTab("equipment")} className={cn(SEG, tab === "equipment" ? "bg-background text-foreground" : "text-muted-foreground")}>
          Equipment{live.length ? ` · ${live.length}` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "setups"} onClick={() => setTab("setups")} className={cn(SEG, tab === "setups" ? "bg-background text-foreground" : "text-muted-foreground")} data-manager-setups-tab>
          Setups{setupCountAll ? ` · ${setupCountAll}` : ""}
        </button>
      </div>

      {empty && (
        <div className="rounded-2xl bg-muted/50 p-4 text-center" data-equipment-empty>
          <div className="text-[15px] font-semibold text-foreground">No equipment saved yet</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {coachView
              ? `Save ${who} racks and machines and how they set each one up. It shows on ${who} workout cards.`
              : "Save the racks and machines you train on and how you set each one up. It shows right on your workout card."}
          </p>
        </div>
      )}

      {tab === "equipment" && (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.gym?.id ?? "none"} aria-label={g.gym?.name ?? "No gym"}>
              <div className="mb-1 flex min-h-9 items-center gap-2 px-1">
                {renaming && g.gym && renaming.id === g.gym.id ? (
                  <div className="flex w-full items-center gap-2">
                    <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} className="h-9 text-base" aria-label="Gym name" onKeyDown={(e) => e.key === "Enter" && void saveGymName()} />
                    <Button variant="outline" className="h-9" onClick={() => void saveGymName()}>Save</Button>
                  </div>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground">{g.gym?.name ?? "No gym"}</span>
                    {g.gym && (
                      <DropdownMenu>
                        <DropdownMenuTrigger className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground active:bg-muted" aria-label={`${g.gym.name} options`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setRenaming({ id: g.gym!.id, name: g.gym!.name })}>Rename</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => void removeGym(g.gym!.id, g.gym!.name)}>
                            Remove gym
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </>
                )}
              </div>
              {g.items.length === 0 ? (
                <p className="px-1 text-[13px] text-muted-foreground">Nothing saved here yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {g.items.map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => setEditing(e)} className="flex w-full items-center gap-3 rounded-xl px-1.5 py-2 text-left active:bg-muted" data-manager-equipment={e.id}>
                        <EquipmentThumb path={e.photo_path} className="h-11 w-11" icon={<Dumbbell className="h-4 w-4" aria-hidden />} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[15px] font-medium text-foreground">
                            <span className="truncate">{equipmentName(e)}</span>
                            {e.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" aria-label="Favorite" />}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {[KIND_LABEL[e.kind], equipmentDetail(e), setupCount(data.setups, e.id)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => setEditing("new")} data-manager-add-equipment>
              <Plus className="h-4 w-4" aria-hidden /> Add equipment
            </Button>
            {newGym === null ? (
              <Button type="button" variant="ghost" className="h-10 gap-1.5" onClick={() => setNewGym("")}>
                <Plus className="h-4 w-4" aria-hidden /> Add a gym
              </Button>
            ) : (
              <div className="flex w-full items-center gap-2">
                <Input autoFocus value={newGym} onChange={(e) => setNewGym(e.target.value)} placeholder="Gold's Gym, Home…" className="h-10 text-base" aria-label="New gym" onKeyDown={(e) => e.key === "Enter" && void addGym()} />
                <Button variant="outline" className="h-10" onClick={() => void addGym()}>Add</Button>
              </div>
            )}
          </div>

          {retired.length > 0 && (
            <section>
              <button type="button" onClick={() => setRetiredOpen((v) => !v)} aria-expanded={retiredOpen} className="flex h-10 w-full items-center gap-1 px-1 text-[13px] font-medium text-muted-foreground">
                Retired · {retired.length}
                <ChevronDown className={cn("h-4 w-4 transition-transform", retiredOpen && "rotate-180")} aria-hidden />
              </button>
              {retiredOpen && (
                <ul className="space-y-0.5">
                  <li className="px-1 pb-1 text-[12px] text-muted-foreground">Kept so {who} history and PRs still say what they were done on.</li>
                  {retired.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-1.5 py-1.5">
                      <EquipmentThumb path={e.photo_path} className="h-9 w-9 opacity-60" icon={<Dumbbell className="h-4 w-4" aria-hidden />} />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">{equipmentName(e)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9"
                        onClick={async () => {
                          try {
                            await actions.restoreEquipment(e.id);
                            toast.success(`${equipmentName(e)} is back`);
                          } catch (err: any) {
                            toast.error(err?.message ?? "Couldn't bring it back");
                          }
                        }}
                      >
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "setups" && (
        <div className="space-y-4">
          {setupsByExercise.length === 0 && !empty && (
            <p className="px-1 text-[13px] text-muted-foreground">No setups yet. Add one here, or from any exercise's ⋯ in a workout.</p>
          )}
          {setupsByExercise.map((ex) => {
            const cur = currentSetup(data, ex.id);
            return (
              <section key={ex.id} aria-label={ex.name}>
                <div className="mb-1 px-1 text-[13px] font-semibold text-muted-foreground">{ex.name}</div>
                <ul className="space-y-0.5">
                  {ex.list.map((s) => {
                    const eq = s.equipment_id ? data.equipment.find((e) => e.id === s.equipment_id) ?? null : null;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setSetupFor({ id: ex.id, name: ex.name, equipment: ex.equipment, equipmentId: s.equipment_id })}
                          className="flex w-full items-center gap-3 rounded-xl px-1.5 py-2 text-left active:bg-muted"
                          data-manager-setup={s.id}
                        >
                          <EquipmentThumb path={s.photo_path ?? eq?.photo_path} className="h-11 w-11" icon={<Dumbbell className="h-4 w-4" aria-hidden />} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[15px] font-medium text-foreground">
                              <span className="truncate">{eq ? equipmentName(eq) : "Nothing in particular"}</span>
                              {cur?.id === s.id && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">In use</span>}
                            </span>
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {settingsText(s.settings, 4) || "No settings yet"}
                              {s.source === "coach" ? " · by the coach" : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => setPickExercise(true)} data-manager-add-setup>
            <Plus className="h-4 w-4" aria-hidden /> Add a setup
          </Button>
        </div>
      )}

      {onShowGuide && (
        <button type="button" onClick={onShowGuide} className="inline-flex h-10 items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground" data-equipment-guide>
          <HelpCircle className="h-4 w-4" aria-hidden /> How it works
        </button>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" swipeToClose hideCloseButton className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 sm:mx-auto sm:max-w-[520px]" style={{ bottom: "var(--keyboard-inset, 0px)" }}>
          <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetHeader className="mb-3 min-h-0 space-y-0 pl-0 text-left">
            <SheetTitle className="text-[17px]">{editing === "new" ? "Add equipment" : editing ? `Edit ${equipmentName(editing)}` : ""}</SheetTitle>
            <SheetDescription className="text-[13px]">A rack, bench, machine or cable, in any gym.</SheetDescription>
          </SheetHeader>
          {editing && (
            <EquipmentForm
              key={editing === "new" ? "new" : editing.id}
              clientId={clientId}
              data={data}
              initial={editing === "new" ? null : editing}
              defaultGymId={likelyGym(data)}
              onCancel={() => setEditing(null)}
              onUseExisting={(id) => {
                const e = data.equipment.find((x) => x.id === id);
                setEditing(e ?? null);
              }}
              onSaved={(_, existed) => {
                if (existed) toast.message("You already had it");
                setEditing(null);
              }}
              onRemoved={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ExercisePickerSheet
        open={pickExercise}
        onOpenChange={setPickExercise}
        mode="single"
        room={1}
        title="Which exercise?"
        description="Pick the exercise to save a setup for."
        onPick={(picked) => {
          const ex = picked[0];
          setPickExercise(false);
          if (!ex) return;
          const cur = currentSetup(data, ex.id);
          setSetupFor({ id: ex.id, name: ex.name, equipment: (ex as any).equipment ?? null, equipmentId: cur?.equipment_id ?? null });
        }}
      />

      {setupFor && (
        <SetupSheet
          open
          onOpenChange={(o) => !o && setSetupFor(null)}
          clientId={clientId}
          exercise={{ id: setupFor.id, name: setupFor.name, equipment: setupFor.equipment }}
          mode="manage"
          shownEquipmentId={setupFor.equipmentId}
          coachView={coachView}
          athleteFirstName={athleteFirstName}
        />
      )}
    </div>
  );
}

function setupCount(setups: readonly ExerciseSetup[], equipmentId: string): string {
  const n = setups.filter((s) => s.equipment_id === equipmentId && (s.settings.length || s.notes)).length;
  return n ? `${n} setup${n === 1 ? "" : "s"}` : "";
}

/** One line for a summary row: "3 pieces · 5 setups", or nothing saved. */
export function equipmentSummaryLine(data: { equipment: Equipment[]; setups: ExerciseSetup[] }): string | null {
  const live = new Set(data.equipment.filter((e) => !e.archived_at).map((e) => e.id));
  const pieces = live.size;
  // the same setups the Setups tab lists
  const setups = data.setups.filter((s) => (s.equipment_id ? live.has(s.equipment_id) : s.settings.length > 0 || !!s.notes || !!s.photo_path)).length;
  if (!pieces && !setups) return null;
  return [pieces ? `${pieces} saved` : null, setups ? `${setups} setup${setups === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
}
