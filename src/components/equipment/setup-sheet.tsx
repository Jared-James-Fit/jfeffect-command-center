/**
 * An exercise's setup, in one bottom sheet: what it's done on (with the
 * equipment used for it before and favorites one tap away), its settings
 * (J-hooks 9, Safeties 4…; the kind's usual ones offered, every one
 * renameable), a note and a photo. Settings save as they're typed.
 *
 * Modes:
 *   live    a workout being logged: a pick is the exercise's setup from now on,
 *           today's logged sets move to it, and when it's in a gym the workout's
 *           other exercises move to their setups in that gym (equipment_choose)
 *   past    a finished workout: a pick fixes that workout's record only
 *   manage  Account → Equipment & setups (no workout): a pick is the current setup
 *   view    read only (a finished workout someone can't change)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check, ChevronRight, Dumbbell, Loader2, Pencil, Plus, Search, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL,
  NOTE_MAX,
  SETTING_LABEL_MAX,
  SETTING_VALUE_MAX,
  cleanSettings,
  currentSetup,
  equipmentDetail,
  equipmentName,
  likelyGym,
  noteLooksLikeSetup,
  pickerSections,
  quickSwitch,
  settingsFromNote,
  setupFields,
  setupFor,
  suggestKind,
  type Equipment,
  type EquipmentData,
  type Setting,
} from "@/lib/equipment/equipment";
import { useAthleteEquipment, useEquipmentActions } from "@/lib/equipment/equipment-queries";
import { EquipmentForm, CHIP, CHIP_OFF, CHIP_ON } from "./equipment-form";
import { EquipmentThumb, PhotoSlot } from "./equipment-photo";

export type SetupSheetMode = "live" | "past" | "manage" | "view";

type View = "setup" | "pick" | "new" | "edit";

const SAVE_DELAY_MS = 700;
const KEYBOARD_SAFE = { bottom: "var(--keyboard-inset, 0px)", maxHeight: "calc(100dvh - var(--keyboard-inset, 0px) - 2.5rem)" } as const;

export function SetupSheet({
  open,
  onOpenChange,
  clientId,
  exercise,
  mode,
  dayId = null,
  instance = null,
  shownEquipmentId,
  noteText = null,
  coachView = false,
  athleteFirstName = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  exercise: { id: string; name: string; equipment?: string | null };
  mode: SetupSheetMode;
  dayId?: string | null;
  instance?: string | null;
  /** What the card shows it's on (null: nothing in particular / nothing saved). */
  shownEquipmentId: string | null;
  /** Their own note on this exercise: settings typed there are offered as a start. */
  noteText?: string | null;
  /** The coach is looking (in their client's profile, or viewing as them). */
  coachView?: boolean;
  athleteFirstName?: string | null;
}) {
  const { data } = useAthleteEquipment(clientId);
  const actions = useEquipmentActions(clientId);
  const [view, setView] = useState<View>("setup");
  const [eqId, setEqId] = useState<string | null>(shownEquipmentId);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const readOnly = mode === "view";

  // Each open starts on what the card shows.
  useEffect(() => {
    if (open) {
      setView("setup");
      setEqId(shownEquipmentId);
    }
  }, [open, shownEquipmentId]);

  const eq = eqId ? data.equipment.find((e) => e.id === eqId) ?? null : null;
  const gymName = (id: string | null) => (id ? data.gyms.find((g) => g.id === id)?.name ?? null : null);
  const kind = eq?.kind ?? suggestKind(exercise);

  // ── settings, saved as they're typed ──
  const setup = setupFor(data, exercise.id, eqId);
  const key = `${exercise.id}:${eqId ?? "none"}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [fields, setFields] = useState<Setting[]>([]);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number | null>(null);
  const latest = useRef({ fields, notes, photo, eqId, dirty });
  latest.current = { fields, notes, photo, eqId, dirty };

  useEffect(() => {
    if (!open) return;
    if (loadedKey === key && dirty) return;
    setFields(setupFields(kind, setup?.settings ?? []));
    setNotes(setup?.notes ?? "");
    setPhoto(setup?.photo_path ?? null);
    setLoadedKey(key);
    setDirty(false);
    // a refetch of the same setup never overwrites what's being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, setup?.id, setup?.updated_at]);

  const saveNow = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const cur = latest.current;
    if (!cur.dirty || readOnly) return;
    setSaveState("saving");
    try {
      await actions.saveSetup({
        exerciseId: exercise.id,
        equipmentId: cur.eqId,
        settings: cleanSettings(cur.fields),
        notes: cur.notes.trim() || null,
        photoPath: cur.photo,
      });
      setDirty(false);
      setSaveState("saved");
    } catch (e: any) {
      setSaveState("error");
      toast.error(e?.message ?? "Couldn't save the setup");
    }
  }, [actions, exercise.id, readOnly]);

  useEffect(() => {
    if (!dirty || readOnly) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNow(), SAVE_DELAY_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [fields, notes, photo, dirty, readOnly, saveNow]);

  const change = (fn: () => void) => {
    fn();
    setDirty(true);
    setSaveState("idle");
  };

  const close = () => {
    void saveNow();
    onOpenChange(false);
  };

  // ── switching ──
  const [switching, setSwitching] = useState(false);
  const pick = async (id: string | null) => {
    await saveNow();
    setView("setup");
    if (readOnly || id === eqId) return;
    const before = eqId;
    setEqId(id);
    setSwitching(true);
    try {
      const r = await actions.choose({
        exerciseId: exercise.id,
        equipmentId: id,
        dayId: mode === "manage" ? null : dayId,
        thisWorkoutOnly: mode === "past",
        instance,
      });
      const name = id ? equipmentName(data.equipment.find((e) => e.id === id)) : "nothing in particular";
      if (mode === "past") {
        toast.success(`This workout's ${exercise.name} is now on ${name}`);
      } else if (r.moved.length > 0) {
        const gym = gymName(data.equipment.find((e) => e.id === id)?.gym_id ?? null);
        toast.success(`On ${name}`, {
          description: `${r.moved.length} more exercise${r.moved.length === 1 ? "" : "s"} switched to your ${gym ?? "same-gym"} setup${r.moved.length === 1 ? "" : "s"}.`,
        });
      } else if (r.restamped > 0) {
        toast.success(`Today's ${exercise.name} sets are on ${name}`);
      }
    } catch (e: any) {
      setEqId(before);
      toast.error(e?.message ?? "Couldn't switch");
    } finally {
      setSwitching(false);
    }
  };

  const chips = useMemo(() => (readOnly ? [] : quickSwitch(data, exercise.id, eqId)), [data, exercise.id, eqId, readOnly]);
  // Settings they already typed into a note on this exercise ("Rack height 33"),
  // offered once while nothing's saved: today's note, else their latest one that reads like a setup.
  const empty = !fields.some((f) => f.value.trim());
  const { data: pastNote = null } = useQuery({
    queryKey: ["setup-note-suggestion", clientId, exercise.id],
    enabled: open && !readOnly && empty && !noteLooksLikeSetup(noteText),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: notes } = await (supabase as any)
        .from("pl_exercise_notes")
        .select("content, created_at")
        .eq("client_id", clientId)
        .eq("exercise_id", exercise.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return ((notes ?? []) as Array<{ content: string }>).find((n) => noteLooksLikeSetup(n.content))?.content ?? null;
    },
  });
  const fromNote = useMemo(() => {
    if (readOnly || !empty) return [];
    return settingsFromNote(noteLooksLikeSetup(noteText) ? noteText : pastNote);
  }, [noteText, pastNote, empty, readOnly]);
  const who = coachView ? athleteFirstName ?? "they" : "you";
  const title = view === "pick" ? "Pick equipment" : view === "new" ? "New equipment" : view === "edit" ? "Edit equipment" : "Setup";

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent
        side="bottom"
        swipeToClose
        hideCloseButton
        className="flex flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]"
        style={KEYBOARD_SAFE}
        data-setup-sheet
        data-setup-mode={mode}
      >
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-2.5 pt-2 text-left">
          <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="flex min-h-10 items-center gap-2">
            {view !== "setup" && (
              <button type="button" onClick={() => setView(view === "new" ? "pick" : "setup")} aria-label="Back" className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-foreground active:bg-muted">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-[17px] font-semibold">{title}</SheetTitle>
              <SheetDescription className="truncate text-[13px] text-muted-foreground">{exercise.name}</SheetDescription>
            </div>
            {view === "setup" && (
              <span className="text-xs text-muted-foreground" aria-live="polite" data-setup-save-state={saveState}>
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
              </span>
            )}
            <button type="button" onClick={close} className="-mr-1.5 h-10 rounded-full px-3 text-[15px] font-semibold text-foreground active:bg-muted" data-setup-done>
              Done
            </button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          {view === "setup" && (
            <div className="space-y-5">
              <section aria-label="Equipment" data-setup-equipment>
                <div className="flex items-center gap-3">
                  <EquipmentThumb path={eq?.photo_path} className="h-14 w-14" icon={<Dumbbell className="h-5 w-5" aria-hidden />} alt={eq ? equipmentName(eq) : ""} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold text-foreground" data-setup-equipment-name>
                      {eq ? equipmentName(eq) : "Nothing in particular"}
                      {eq?.archived_at && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Retired</span>}
                    </div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      {eq ? equipmentDetail(eq, gymName(eq.gym_id)) || KIND_LABEL[eq.kind] : readOnly ? "No equipment saved" : "Pick the rack or machine you're on"}
                    </div>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setView("pick")}
                      disabled={switching}
                      className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-semibold text-foreground active:bg-muted"
                      data-setup-change
                    >
                      {switching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      {eq ? "Change" : "Pick"}
                    </button>
                  )}
                </div>
                {chips.length > 0 && (
                  <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" aria-label="Switch to" data-setup-chips>
                    {chips.map((c) => (
                      <button key={c.id} type="button" onClick={() => void pick(c.id)} className={cn(CHIP, CHIP_OFF, "gap-1.5")} data-setup-chip={c.id}>
                        {c.favorite && <Star className="h-3 w-3 fill-warning text-warning" aria-hidden />}
                        {equipmentName(c)}
                        {gymName(c.gym_id) && <span className="text-muted-foreground">· {gymName(c.gym_id)}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {mode === "past" && (
                  <p className="mt-2 text-xs text-muted-foreground">A change here fixes this workout's record only.</p>
                )}
              </section>

              <section aria-label="Settings" data-setup-settings>
                <div className="mb-1.5 text-[13px] font-semibold text-foreground">Settings</div>
                {fromNote.length > 0 && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[13px]" data-setup-from-note>
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      From {who === "you" ? "your" : `${who}'s`} note: <span className="text-foreground">{fromNote.map((s) => `${s.label} ${s.value}`).join(" · ")}</span>
                    </span>
                    <button
                      type="button"
                      className="h-9 shrink-0 rounded-lg px-2.5 font-semibold text-foreground active:bg-background"
                      onClick={() => change(() => setFields(setupFields(kind, fromNote)))}
                    >
                      Use it
                    </button>
                  </div>
                )}
                {readOnly && !fields.some((f) => f.value) ? (
                  <p className="text-[13px] text-muted-foreground">No settings saved.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {fields.map((f, i) => (readOnly && !f.value ? null : (
                      <li key={i} className="flex items-center gap-2" data-setup-field>
                        <input
                          value={f.label}
                          readOnly={readOnly}
                          maxLength={SETTING_LABEL_MAX}
                          onChange={(e) => change(() => setFields((cur) => cur.map((x, k) => (k === i ? { ...x, label: e.target.value } : x))))}
                          placeholder="Setting"
                          aria-label={`Setting ${i + 1} name`}
                          className="h-11 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-muted/50"
                        />
                        <input
                          value={f.value}
                          readOnly={readOnly}
                          maxLength={SETTING_VALUE_MAX}
                          onChange={(e) => change(() => setFields((cur) => cur.map((x, k) => (k === i ? { ...x, value: e.target.value } : x))))}
                          placeholder="—"
                          aria-label={`${f.label || `Setting ${i + 1}`} value`}
                          autoCapitalize="off"
                          autoCorrect="off"
                          enterKeyHint="done"
                          className="h-11 w-24 shrink-0 rounded-lg border border-input bg-background px-2 text-center text-base font-semibold tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          data-setup-value
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => change(() => setFields((cur) => cur.filter((_, k) => k !== i)))}
                            aria-label={`Remove ${f.label || "this setting"}`}
                            className="grid h-11 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground active:bg-muted"
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                      </li>
                    )))}
                  </ul>
                )}
                {!readOnly && fields.length < 12 && (
                  <button
                    type="button"
                    onClick={() => setFields((cur) => [...cur, { label: "", value: "" }])}
                    className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted-foreground active:bg-muted"
                    data-setup-add-field
                  >
                    <Plus className="h-4 w-4" aria-hidden /> Add a setting
                  </button>
                )}
              </section>

              <section aria-label="Note and photo" className="space-y-3">
                {readOnly ? (
                  notes ? <p className="whitespace-pre-wrap text-[14px] text-foreground">{notes}</p> : null
                ) : (
                  <textarea
                    value={notes}
                    maxLength={NOTE_MAX}
                    onChange={(e) => change(() => setNotes(e.target.value))}
                    placeholder="Anything else (feet on the second line, grip on the knurl…)"
                    rows={2}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Setup note"
                    data-setup-note
                  />
                )}
                <PhotoSlot clientId={clientId} path={photo} onChange={(p) => change(() => setPhoto(p))} label="Add a photo of the setup" disabled={readOnly} />
              </section>

              {setup?.source === "coach" && (
                <p className="text-xs text-muted-foreground" data-setup-by-coach>
                  {coachView ? "Set up by the coach." : "Set up by your coach. Change anything that's different for you."}
                </p>
              )}

              {!readOnly && eq && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(eq);
                    setView("edit");
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-1 py-2 text-left text-[13px] font-medium text-muted-foreground active:bg-muted"
                  data-setup-edit-equipment
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  <span className="flex-1">Edit {equipmentName(eq)}</span>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              )}

              {mode === "manage" && setup && !setup.id.startsWith("pending-") && (
                <button
                  type="button"
                  onClick={async () => {
                    if (timer.current) window.clearTimeout(timer.current);
                    setDirty(false);
                    await actions.removeSetup(setup.id);
                    toast.success("Setup removed");
                    onOpenChange(false);
                  }}
                  className="inline-flex h-10 items-center gap-1.5 px-1 text-[13px] font-medium text-destructive"
                  data-setup-remove
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Remove this setup
                </button>
              )}
            </div>
          )}

          {view === "pick" && (
            <EquipmentPicker
              data={data}
              exerciseId={exercise.id}
              kind={kind}
              currentId={eqId}
              gymName={gymName}
              onPick={(id) => void pick(id)}
              onNew={() => setView("new")}
              onFavorite={(e) => void actions.setFavorite(e.id, !e.favorite)}
            />
          )}

          {view === "new" && (
            <EquipmentForm
              clientId={clientId}
              data={data}
              defaultKind={kind}
              defaultGymId={(eq?.gym_id ?? likelyGym(data)) ?? null}
              onCancel={() => setView("pick")}
              onUseExisting={(id) => void pick(id)}
              onSaved={(id, existed) => {
                if (existed) toast.message("You already had it, so that's the one in use");
                void pick(id);
              }}
            />
          )}

          {view === "edit" && editing && (
            <EquipmentForm
              clientId={clientId}
              data={data}
              initial={editing}
              onCancel={() => setView("setup")}
              onSaved={() => setView("setup")}
              onRemoved={() => {
                setEditing(null);
                // what it falls back to: their most recent setup still in use
                const next = currentSetup({ ...data, equipment: data.equipment.map((e) => (e.id === editing.id ? { ...e, archived_at: new Date().toISOString() } : e)) }, exercise.id);
                setEqId(next?.equipment_id ?? null);
                setView("setup");
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EquipmentPicker({
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
  kind: ReturnType<typeof suggestKind>;
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
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your equipment" className="h-11 pl-9 text-base" aria-label="Search your equipment" />
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

/** The card's one quiet line when a setup is saved: tap it for the sheet. */
export function SetupLine({ text, onOpen, retired = false }: { text: string; onOpen: () => void; retired?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="-ml-1 mt-1 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md px-1 text-left text-[13px] leading-snug text-muted-foreground active:bg-muted"
      aria-label={`Setup: ${text}. Open setup`}
      data-setup-line
    >
      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{text}</span>
      {retired && <span className="shrink-0 text-[11px]">· retired</span>}
    </button>
  );
}
