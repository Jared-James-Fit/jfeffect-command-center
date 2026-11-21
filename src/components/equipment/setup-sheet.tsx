/**
 * An exercise's setup, in one bottom sheet: what it's done on (with the
 * equipment used for it before and favorites one tap away), its settings
 * (J-hooks 9, Safeties 4…; the kind's usual ones offered, the number pad for
 * the ones that are numbers, more of their own with Add a setting), a note and
 * a photo. What's typed is a draft (setup-draft.ts) until Done saves it; a swipe
 * down, a tap outside or Escape with changes asks Save / Discard / Keep editing,
 * and a draft an interruption cut short is kept on the phone for next time.
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
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check, ChevronRight, Dumbbell, Loader2, Pencil, Plus, Search, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { noAutofill } from "@/lib/no-autofill";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL,
  NOTE_MAX,
  SETTINGS_MAX,
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
import { removeEquipmentPhoto, useAthleteEquipment, useEquipmentActions } from "@/lib/equipment/equipment-queries";
import {
  draftChanged,
  draftFromSetup,
  draftKey,
  forgetDraft,
  keepDraft,
  readKeptDraft,
  revealDelta,
  savedForm,
  settingInputMode,
  switchPlan,
  type SetupDraft,
} from "@/lib/equipment/setup-draft";
import { EquipmentForm, CHIP, CHIP_OFF, CHIP_ON } from "./equipment-form";
import { EquipmentThumb, PhotoSlot } from "./equipment-photo";

export type SetupSheetMode = "live" | "past" | "manage" | "view";

type View = "setup" | "pick" | "new" | "edit";

/** A setting row on screen: its id keeps the row (and the box being typed in) put when a row above it goes. */
type Row = Setting & { id: string; custom?: boolean };

let rowSeq = 0;
const rowsOf = (fields: readonly Setting[], custom = false): Row[] =>
  fields.map((f) => ({ label: f.label, value: f.value, id: `r${++rowSeq}`, custom: custom || !f.label }));

/** "Save your changes?": for the setup's draft, or for equipment being added or edited (then Save is that form's). */
type Confirm = { kind: "setup" | "form"; then: "close" | "back" };

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
  const { data, loaded } = useAthleteEquipment(clientId);
  const actions = useEquipmentActions(clientId);
  const [view, setView] = useState<View>("setup");
  const [eqId, setEqId] = useState<string | null>(shownEquipmentId);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const formSave = useRef<(() => Promise<boolean>) | null>(null);
  const readOnly = mode === "view";

  // Each open starts on what the card shows. While it's open the sheet keeps its
  // own place: a refetch that moves the card's equipment (a save, a pick, sets
  // logged meanwhile) never throws it back to the start or onto other equipment.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setView("setup");
      setEqId(shownEquipmentId);
      setConfirm(null);
    }
    wasOpen.current = open;
  }, [open, shownEquipmentId]);

  const eq = eqId ? data.equipment.find((e) => e.id === eqId) ?? null : null;
  const gymName = (id: string | null) => (id ? data.gyms.find((g) => g.id === id)?.name ?? null : null);
  const kind = eq?.kind ?? suggestKind(exercise);

  // ── the draft: what's typed, kept apart from what's saved until Done ──
  const setup = setupFor(data, exercise.id, eqId);
  const key = draftKey(clientId, exercise.id, eqId);
  const [base, setBase] = useState<SetupDraft>(() => draftFromSetup(kind, setup));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(base.fields));
  const [notes, setNotes] = useState(base.notes);
  const [photo, setPhoto] = useState<string | null>(base.photo);
  const [baseStamp, setBaseStamp] = useState<string | null>(setup?.updated_at ?? null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [extras, setExtras] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draft: SetupDraft = useMemo(() => ({ fields: rows, notes, photo }), [rows, notes, photo]);
  const dirty = !readOnly && loadedKey === key && draftChanged(draft, base);
  const carry = useRef<{ key: string; draft: SetupDraft } | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  // photos uploaded while it's open: only the one that's saved stays
  const uploads = useRef(new Set<string>());
  const latest = useRef({ draft, base, eqId, key, dirty, baseStamp });
  latest.current = { draft, base, eqId, key, dirty, baseStamp };

  const putDraft = (d: SetupDraft, custom = false) => {
    setRows(rowsOf(d.fields, custom));
    setNotes(d.notes);
    setPhoto(d.photo);
  };

  // What's saved fills the sheet when it opens or the equipment changes, and
  // again when the saved setup changes while nothing's being typed. What's
  // being typed (or saved) is never written over by a refetch.
  useEffect(() => {
    if (!open || !loaded) return;
    const same = loadedKey === key;
    if (same && (latest.current.dirty || saving.current)) return;
    const fresh = draftFromSetup(kind, setup);
    let next = fresh;
    let fromBefore = false;
    if (!same) {
      if (carry.current?.key === key) {
        next = { ...carry.current.draft, fields: setupFields(kind, cleanSettings(carry.current.draft.fields)) };
      } else if (!readOnly) {
        const kept = readKeptDraft(key, setup?.updated_at ?? null);
        if (kept && draftChanged(kept, fresh)) {
          next = kept;
          fromBefore = true;
        }
      }
      carry.current = null;
      setExtras(false);
      setSaveState("idle");
    }
    setBase(fresh);
    setBaseStamp(setup?.updated_at ?? null);
    putDraft(next);
    setRestored(fromBefore);
    setLoadedKey(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, key, kind, setup?.id, setup?.updated_at]);

  // A draft with changes is kept on the phone (an app closed or a page reloaded mid-edit
  // doesn't lose it); one with none, or once saved or discarded, is let go.
  useEffect(() => {
    if (!open || readOnly || loadedKey !== key) return;
    if (!dirty) {
      forgetDraft(key);
      return;
    }
    const t = window.setTimeout(() => keepDraft(key, draft, baseStamp), 250);
    return () => window.clearTimeout(t);
  }, [open, readOnly, loadedKey, key, dirty, draft, baseStamp]);
  useEffect(() => {
    if (!open || readOnly) return;
    const now = () => {
      const l = latest.current;
      if (l.dirty) keepDraft(l.key, l.draft, l.baseStamp);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") now();
    };
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", now);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [open, readOnly]);

  const edit = () => {
    if (saveState !== "saving") setSaveState("idle");
  };

  /**
   * Save the draft where it was typed. One save at a time (a second tap waits
   * for the first), "Saved" only once the server has it, and anything typed
   * while it was on its way stays a change to save.
   */
  const save = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    const l = latest.current;
    if (readOnly || !l.dirty) return Promise.resolve(true);
    const snap = l.draft;
    const before = l.base.photo;
    const onId = l.eqId;
    const snapKey = l.key;
    const run = (async () => {
      setSaveState("saving");
      try {
        const form = savedForm(snap);
        const saved = await actions.saveSetup({
          exerciseId: exercise.id,
          equipmentId: onId,
          settings: form.settings,
          notes: form.notes,
          photoPath: form.photo,
        });
        // the photo this replaced and any other upload not kept
        if (before && before !== form.photo) void removeEquipmentPhoto(before);
        for (const u of uploads.current) if (u !== form.photo) void removeEquipmentPhoto(u);
        uploads.current.clear();
        forgetDraft(snapKey);
        if (latest.current.key === snapKey) {
          setBase({ fields: snap.fields, notes: snap.notes, photo: snap.photo });
          setBaseStamp(saved?.updated_at ?? null);
          setRestored(false);
        }
        setSaveState("saved");
        return true;
      } catch (e: any) {
        setSaveState("error");
        // what's typed stays on screen (and on the phone), so say how to try again
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const network = offline || /fetch|network|load failed/i.test(String(e?.message ?? ""));
        toast.error(
          network
            ? "No connection. Your changes are still here: tap Done to try again."
            : e?.message
              ? `Couldn't save: ${e.message}`
              : "Couldn't save the setup. Your changes are still here: tap Done to try again.",
        );
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }, [actions, exercise.id, readOnly]);

  // ── closing: Done saves; any other way out with changes asks first ──
  const content = useRef<HTMLDivElement | null>(null);
  const settle = () => {
    // a swipe that didn't close leaves the sheet where the finger let go
    const el = content.current;
    if (!el) return;
    el.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = "";
  };
  const blurTyping = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && content.current?.contains(a) && a.matches("input, textarea")) a.blur();
  };
  const closeNow = () => {
    setConfirm(null);
    onOpenChange(false);
  };
  const dropUnsaved = () => {
    for (const u of uploads.current) void removeEquipmentPhoto(u);
    uploads.current.clear();
    forgetDraft(latest.current.key);
    putDraft(latest.current.base);
    setRestored(false);
    setSaveState("idle");
  };
  const [finishing, setFinishing] = useState(false);
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      if (saving.current) await saving.current;
      if (latest.current.dirty) {
        const ok = await save();
        if (!ok) return;
        toast.success("Setup saved");
      }
      closeNow();
    } finally {
      setFinishing(false);
    }
  };
  /** A swipe down, a tap outside, Escape or the browser's Back: never the end of a draft without asking. */
  const requestClose = () => {
    if (saving.current || finishing) return settle();
    const form = (view === "new" || view === "edit") && formDirty;
    if (latest.current.dirty || form) {
      settle();
      blurTyping();
      setConfirm({ kind: form ? "form" : "setup", then: "close" });
      return;
    }
    closeNow();
  };
  const back = () => {
    const to: View = view === "new" ? "pick" : "setup";
    if ((view === "new" || view === "edit") && formDirty) {
      blurTyping();
      setConfirm({ kind: "form", then: "back" });
      return;
    }
    setView(to);
  };
  const confirmSave = async () => {
    const c = confirm;
    if (!c) return;
    if (c.kind === "form") {
      const ok = (await formSave.current?.()) ?? false;
      if (!ok) return;
      setConfirm(null);
      if (c.then === "close") {
        if (latest.current.dirty && !(await save())) return;
        closeNow();
      }
      return;
    }
    setConfirm(null);
    await finish();
  };
  const confirmDiscard = () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    if (c.kind === "form") {
      // the form's own uploads go when it unmounts unsaved
      setFormDirty(false);
      // a setup draft typed before stays on the phone and comes back next time
      if (c.then === "back") setView(view === "new" ? "pick" : "setup");
      else closeNow();
      return;
    }
    dropUnsaved();
    closeNow();
  };

  // ── switching ──
  const [switching, setSwitching] = useState(false);
  const pick = async (id: string | null) => {
    if (readOnly || id === eqId) {
      setView("setup");
      return;
    }
    const plan = switchPlan({ dirty: latest.current.dirty, fromId: eqId, targetHasSetup: !!setupFor(data, exercise.id, id) });
    if (plan === "save" && !(await save())) return;
    if (plan === "carry") {
      carry.current = { key: draftKey(clientId, exercise.id, id), draft: latest.current.draft };
      forgetDraft(latest.current.key);
    }
    setView("setup");
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
      if (plan === "carry" && carry.current === null) {
        // what was being typed goes back where it was typed (kept on the phone meanwhile)
        keepDraft(draftKey(clientId, exercise.id, before), latest.current.draft, setupFor(data, exercise.id, before)?.updated_at ?? null);
      }
      setEqId(before);
      toast.error(e?.message ?? "Couldn't switch");
    } finally {
      setSwitching(false);
    }
  };

  const chips = useMemo(() => (readOnly ? [] : quickSwitch(data, exercise.id, eqId)), [data, exercise.id, eqId, readOnly]);
  // Settings they already typed into a note on this exercise ("Rack height 33"),
  // offered once while nothing's saved: today's note, else their latest one that reads like a setup.
  const empty = !rows.some((f) => f.value.trim());
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

  // ── the keyboard ──
  // With the keyboard up the sheet is the visible part of the screen, pinned to it
  // (top and height from the visual viewport, never the keyboard's height added to
  // the bottom: iOS also slides the page, and the two together jumped the sheet up
  // past the keyboard with the dimmed backdrop under it, where a tap closed it).
  const vv = useVisualViewportBox(open);
  const kb = !!vv?.keyboard;
  const box = useRef<HTMLDivElement | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const reveal = useCallback((el: Element | null) => {
    const sc = box.current;
    if (!sc || !el || !sc.contains(el)) return;
    const r = el.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    const d = revealDelta({ top: r.top, bottom: r.bottom, viewTop: b.top, viewBottom: b.bottom });
    if (d) sc.scrollTop += d;
  }, []);
  // the box being typed in stays in view as the keyboard comes up and the sheet resizes
  useEffect(() => {
    if (!kb) return;
    reveal(document.activeElement);
  }, [kb, vv?.height, vv?.top, reveal]);
  const onFocusIn = (e: React.FocusEvent) => {
    const t = e.target as Element;
    if (!t.matches?.("input, textarea")) return;
    for (const ms of [0, 160, 380]) window.setTimeout(() => reveal(t), ms);
  };
  // With the keyboard up, a pull down from the top takes the keyboard down (iOS's own
  // sheets) instead of closing the sheet; once it's down the same swipe closes it.
  const pull = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    pull.current = kb && (box.current?.scrollTop ?? 0) <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pull.current == null) return;
    if (e.touches[0].clientY - pull.current > 36) {
      pull.current = null;
      blurTyping();
    }
  };

  const nextAfter = (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    const next = rows[i + 1];
    if (next) inputs.current.get(next.id)?.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  };
  const addSetting = () => {
    const row: Row = { id: `r${++rowSeq}`, label: "", value: "", custom: true };
    // in the same tap, so iOS brings the keyboard up for it
    flushSync(() => setRows((cur) => [...cur, row]));
    document.querySelector<HTMLInputElement>(`[data-setup-label-input="${row.id}"]`)?.focus();
  };
  const setRow = (id: string, patch: Partial<Setting>) => {
    edit();
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const status =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : dirty ? "Unsaved" : saveState === "saved" ? "Saved" : "";
  const formView = view === "new" || view === "edit";

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}>
        <SheetContent
          ref={content}
          side="bottom"
          swipeToClose={!kb}
          hideCloseButton
          className="flex flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]"
          style={kb && vv ? { top: vv.top + 8, bottom: "auto", height: vv.height - 8, maxHeight: "none" } : { maxHeight: "calc(100dvh - 2.5rem)" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          data-setup-sheet
          data-setup-mode={mode}
          data-setup-keyboard={kb ? "up" : undefined}
        >
          <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-2.5 pt-2 text-left">
            <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
            <div className="flex min-h-10 items-center gap-2">
              {view !== "setup" && (
                <button type="button" onClick={back} aria-label="Back" className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-foreground active:bg-muted">
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-[17px] font-semibold">{title}</SheetTitle>
                <SheetDescription className="truncate text-[13px] text-muted-foreground">{exercise.name}</SheetDescription>
              </div>
              {!readOnly && !formView && (
                <span
                  className={cn("shrink-0 text-xs", saveState === "error" ? "font-medium text-destructive" : "text-muted-foreground")}
                  aria-live="polite"
                  data-setup-save-state={saveState === "idle" && dirty ? "unsaved" : saveState}
                >
                  {status}
                </span>
              )}
              {!formView && (
                <button
                  type="button"
                  onClick={() => void finish()}
                  disabled={finishing || saveState === "saving"}
                  className="-mr-1.5 inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-foreground active:bg-muted disabled:opacity-60"
                  data-setup-done
                >
                  {(finishing || saveState === "saving") && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Done
                </button>
              )}
            </div>
          </SheetHeader>

          <div
            ref={box}
            onFocus={onFocusIn}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3"
            style={{ paddingBottom: kb ? "1rem" : "max(env(safe-area-inset-bottom), 16px)" }}
            data-setup-scroll
          >
            {view === "setup" && (
              <div className="space-y-5">
                {restored && dirty && (
                  <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[13px]" data-setup-restored>
                    <span className="min-w-0 flex-1 text-muted-foreground">Your unsaved changes from before are back.</span>
                    <button type="button" onClick={dropUnsaved} className="h-9 shrink-0 rounded-lg px-2.5 font-semibold text-foreground active:bg-background">
                      Discard
                    </button>
                  </div>
                )}
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
                        onClick={() => {
                          blurTyping();
                          setView("pick");
                        }}
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
                  {mode === "past" && <p className="mt-2 text-xs text-muted-foreground">A change here fixes this workout's record only.</p>}
                </section>

                <section aria-label="Settings" data-setup-settings>
                  <div className="mb-1 flex items-baseline gap-1.5 text-[13px]">
                    <span className="font-semibold text-foreground">Settings</span>
                    {setup?.source === "coach" && (
                      <span className="text-muted-foreground" data-setup-by-coach>
                        · from {coachView ? "the coach" : "your coach"}
                      </span>
                    )}
                  </div>
                  {!loaded ? (
                    <div className="flex h-24 items-center justify-center" aria-label="Loading">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                    </div>
                  ) : (
                    <>
                      {fromNote.length > 0 && (
                        <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[13px]" data-setup-from-note>
                          <span className="min-w-0 flex-1 text-muted-foreground">
                            From {who === "you" ? "your" : `${who}'s`} note: <span className="text-foreground">{fromNote.map((s) => `${s.label} ${s.value}`).join(" · ")}</span>
                          </span>
                          <button
                            type="button"
                            className="h-9 shrink-0 rounded-lg px-2.5 font-semibold text-foreground active:bg-background"
                            onClick={() => {
                              edit();
                              setRows(rowsOf(setupFields(kind, fromNote)));
                            }}
                          >
                            Use it
                          </button>
                        </div>
                      )}
                      {readOnly && !rows.some((f) => f.value) ? (
                        <p className="text-[13px] text-muted-foreground">No settings saved.</p>
                      ) : (
                        <ul className="divide-y divide-border/60">
                          {rows.map((f, i) => {
                            if (readOnly && !f.value) return null;
                            const last = i === rows.length - 1;
                            return (
                              <li
                                key={f.id}
                                className="flex min-h-12 items-center gap-2"
                                // a tap anywhere on the row is the box: the label never opens the letters keyboard by mistake
                                onClick={(e) => {
                                  if ((e.target as Element).closest("input, button")) return;
                                  inputs.current.get(f.id)?.focus();
                                }}
                                data-setup-field
                              >
                                {f.custom && !readOnly ? (
                                  <input
                                    value={f.label}
                                    maxLength={SETTING_LABEL_MAX}
                                    onChange={(e) => setRow(f.id, { label: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        inputs.current.get(f.id)?.focus();
                                      }
                                    }}
                                    placeholder="Setting"
                                    aria-label={`Setting ${i + 1} label`}
                                    {...noAutofill(`setup-label-${i}`)}
                                    autoCapitalize="words"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    enterKeyHint="next"
                                    className="h-11 min-w-0 flex-1 rounded-lg bg-muted/50 px-2 text-base text-foreground outline-none placeholder:text-muted-foreground/70"
                                    data-setup-label-input={f.id}
                                  />
                                ) : (
                                  <span className="min-w-0 flex-1 truncate text-[15px] text-foreground" data-setup-label>
                                    {f.label}
                                  </span>
                                )}
                                <input
                                  ref={(el) => {
                                    if (el) inputs.current.set(f.id, el);
                                    else inputs.current.delete(f.id);
                                  }}
                                  value={f.value}
                                  readOnly={readOnly}
                                  maxLength={SETTING_VALUE_MAX}
                                  onChange={(e) => setRow(f.id, { value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      nextAfter(f.id);
                                    }
                                  }}
                                  placeholder="—"
                                  aria-label={`${f.label || `Setting ${i + 1}`} value`}
                                  inputMode={settingInputMode(f.label, f.value)}
                                  {...noAutofill(`setup-value-${i}`)}
                                  autoCapitalize="off"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  enterKeyHint={last ? "done" : "next"}
                                  className="h-11 w-24 shrink-0 rounded-lg border border-border/60 bg-muted/40 px-2 text-center text-base font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background focus-visible:ring-2 focus-visible:ring-ring/30 read-only:border-transparent read-only:bg-transparent"
                                  data-setup-value
                                />
                                {!readOnly && (f.value || f.custom) ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      edit();
                                      setRows((cur) => cur.filter((r) => r.id !== f.id));
                                    }}
                                    aria-label={`Remove ${f.label || "this setting"}`}
                                    className="grid h-11 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground active:bg-muted"
                                  >
                                    <X className="h-4 w-4" aria-hidden />
                                  </button>
                                ) : !readOnly ? (
                                  <span className="w-9 shrink-0" aria-hidden />
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {!readOnly && rows.length < SETTINGS_MAX && (
                        <button
                          type="button"
                          onClick={addSetting}
                          className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted-foreground active:bg-muted"
                          data-setup-add-field
                        >
                          <Plus className="h-4 w-4" aria-hidden /> Add a setting
                        </button>
                      )}
                    </>
                  )}
                </section>

                {/* A note and a photo: one quiet row until there's something in them. */}
                {readOnly ? (
                  notes ? <p className="whitespace-pre-wrap text-[14px] text-foreground">{notes}</p> : null
                ) : extras || notes || photo ? (
                  <section aria-label="Note and photo" className="space-y-3" data-setup-extras>
                    <textarea
                      value={notes}
                      maxLength={NOTE_MAX}
                      onChange={(e) => {
                        edit();
                        setNotes(e.target.value);
                      }}
                      placeholder="Anything else (feet on the second line, grip on the knurl…)"
                      rows={2}
                      {...noAutofill("setup-note")}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Setup note"
                      data-setup-note
                    />
                    <PhotoSlot
                      clientId={clientId}
                      path={photo}
                      onChange={(p) => {
                        edit();
                        if (p && p !== base.photo) uploads.current.add(p);
                        setPhoto(p);
                      }}
                      label="Add a photo of the setup"
                    />
                  </section>
                ) : (
                  <button
                    type="button"
                    onClick={() => setExtras(true)}
                    className="-mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted-foreground active:bg-muted"
                    data-setup-add-extras
                  >
                    <Plus className="h-4 w-4" aria-hidden /> Note or photo
                  </button>
                )}
                {readOnly && photo && <PhotoSlot clientId={clientId} path={photo} onChange={() => {}} disabled />}

                {!readOnly && eq && (
                  <button
                    type="button"
                    onClick={() => {
                      blurTyping();
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
                      try {
                        await actions.removeSetup(setup.id);
                        for (const u of uploads.current) void removeEquipmentPhoto(u);
                        uploads.current.clear();
                        forgetDraft(key);
                        toast.success("Setup removed");
                        closeNow();
                      } catch (e: any) {
                        toast.error(e?.message ?? "Couldn't remove it");
                      }
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
                onDirtyChange={setFormDirty}
                saveRef={formSave}
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
                onDirtyChange={setFormDirty}
                saveRef={formSave}
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

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="max-w-[340px] gap-3 rounded-2xl p-5" data-setup-confirm>
          <AlertDialogHeader className="space-y-1 text-left">
            <AlertDialogTitle className="text-[17px]">{confirm?.kind === "form" ? "Save this equipment?" : "Save your changes?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px]">
              {confirm?.kind === "form"
                ? "You've changed it and haven't saved it yet."
                : `Your setup for ${exercise.name} has changes you haven't saved.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-1 flex flex-col gap-2">
            <Button className="h-11" onClick={() => void confirmSave()} disabled={saveState === "saving" || finishing} data-setup-confirm-save>
              {saveState === "saving" || finishing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save changes
            </Button>
            <Button variant="outline" className="h-11 text-destructive hover:text-destructive" onClick={confirmDiscard} data-setup-confirm-discard>
              Discard changes
            </Button>
            <AlertDialogCancel className="mt-0 h-11" data-setup-confirm-keep>
              Keep editing
            </AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
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

/** The card's one quiet line when a setup is saved: tap it for the sheet. */
export function SetupLine({ text, onOpen, retired = false }: { text: string; onOpen: () => void; retired?: boolean }) {
  // The setup right under the name and role: the equipment, then its first
  // settings ("Rogue rack · J-hooks 9 · Safeties 4"), whole on up to two lines,
  // never cut mid-word. Empty: "Add your setup", only where a setup matters.
  const empty = !text;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "-ml-1 mt-0.5 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md px-1 text-left text-[14px] leading-snug active:bg-muted",
        empty ? "text-muted-foreground" : "text-foreground/80",
      )}
      aria-label={empty ? "Add your setup for this exercise" : `Setup: ${text}. Open setup`}
      data-setup-line={empty ? "empty" : "saved"}
    >
      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {/* the parts never break mid-phrase: "Back pad 3" stays together */}
      <span className="min-w-0 line-clamp-2">
        {empty ? "Add your setup" : text.split(" · ").map((part, i) => (
          <span key={i}>
            {i > 0 && " · "}
            <span className="whitespace-nowrap">{part}</span>
          </span>
        ))}
      </span>
      {retired && <span className="shrink-0 text-[12px] text-muted-foreground">· retired</span>}
    </button>
  );
}
