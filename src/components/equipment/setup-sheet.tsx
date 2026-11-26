/**
 * An exercise's setup, in one compact bottom sheet: what it's done on (the
 * equipment used for it before and favorites one tap away), the settings that
 * matter for that equipment and lift (setup-fields.ts: a stepper for a
 * number, chips for a choice, what they used before one tap away), photos
 * (the camera or the library, shown at once, shrunk before they upload), and
 * a note.
 *
 * Everything saves as it's changed (setup-autosave.ts): a moment after typing
 * pauses, and at once when the sheet closes, the equipment changes or the app
 * goes to the background; there's no Save and nothing asks before closing. A
 * change that can't be sent waits on the phone (setup-outbox.ts) and goes by
 * itself when it can. Every earlier version is kept by the database
 * (athlete_exercise_setup_revisions), so a change made by accident is one tap
 * from undone: Earlier versions → Restore.
 *
 * This is the athlete's own setup, kept apart from what the coach prescribes:
 * the program's notes and cues stay on the card, never in here.
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check, ChevronRight, CloudOff, Dumbbell, History, Loader2, Pencil, Plus, RotateCcw, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFilmCamera } from "@/components/camera/use-film-camera";
import { useMediaViewer } from "@/components/media-viewer";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { noAutofill } from "@/lib/no-autofill";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import {
  KIND_LABEL,
  NOTE_MAX,
  PHOTOS_MAX,
  SETTINGS_MAX,
  SETTING_LABEL_MAX,
  SETTING_VALUE_MAX,
  cleanSettings,
  currentSetup,
  equipmentDetail,
  equipmentName,
  likelyGym,
  noteLooksLikeSetup,
  quickSwitch,
  settingsFromNote,
  settingsText,
  setupFields,
  setupFor,
  suggestKind,
  type Equipment,
  type Setting,
} from "@/lib/equipment/equipment";
import {
  equipmentKey,
  setupRevisionsKey,
  uploadEquipmentPhoto,
  useEquipmentPhotoUrl,
  useAthleteEquipment,
  useEquipmentActions,
  useSetupRevisions,
  type SetupRevision,
} from "@/lib/equipment/equipment-queries";
import { draftFromSetup, formKey, revealDelta, savedForm, switchPlan, type SetupDraft } from "@/lib/equipment/setup-draft";
import { FIELDS, controlFor, fieldFor, moreFieldsFor, optionsFor, previousValues, type FieldKey } from "@/lib/equipment/setup-fields";
import { createAutosave, type Autosave, type AutosaveStatus } from "@/lib/equipment/setup-autosave";
import { dropOutbox, outboxKey, putOutbox, readOutbox } from "@/lib/equipment/setup-outbox";
import { EquipmentForm, CHIP, CHIP_OFF } from "./equipment-form";
import { EquipmentPicker } from "./equipment-picker";
import { EquipmentThumb } from "./equipment-photo";
import { ChoiceChips, NumberStepper, PhotoStrip, type LocalPhoto } from "./setup-controls";

export type SetupSheetMode = "live" | "past" | "manage" | "view";

type View = "setup" | "pick" | "new" | "edit" | "history";

/** A setting row on screen: its id keeps the row (and the box being typed in) put when a row above it goes. */
type Row = Setting & { id: string; custom?: boolean };

let rowSeq = 0;
const rowsOf = (fields: readonly Setting[], custom = false): Row[] =>
  fields.map((f) => ({ label: f.label, value: f.value, id: `r${++rowSeq}`, custom: custom || !f.label }));

/** New rows from a fresh read, keeping the ids of rows with the same label (the box being typed in never remounts). */
function mergeRows(cur: readonly Row[], fields: readonly Setting[]): Row[] {
  const pool = [...cur];
  return fields.map((f) => {
    const i = pool.findIndex((r) => r.label.trim().toLowerCase() === f.label.trim().toLowerCase());
    if (i >= 0) {
      const [r] = pool.splice(i, 1);
      return { ...r, label: f.label, value: f.value };
    }
    return { label: f.label, value: f.value, id: `r${++rowSeq}`, custom: !f.label };
  });
}

type Snap = { form: ReturnType<typeof savedForm>; eqId: string | null; outbox: string; at: number };

const versionKey = (eqId: string | null, d: SetupDraft) => `${eqId ?? "none"}|${formKey(d)}`;
const EMPTY_FORM = formKey({ fields: [], notes: "", photos: [] });

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
  startOn = "setup",
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
  /** Open on Earlier versions (the card's ⋯). */
  startOn?: "setup" | "history";
}) {
  const { data, loaded } = useAthleteEquipment(clientId);
  const actions = useEquipmentActions(clientId);
  const qc = useQueryClient();
  const [view, setView] = useState<View>(startOn);
  const [eqId, setEqId] = useState<string | null>(shownEquipmentId);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const formSave = useRef<((opts?: { quiet?: boolean }) => Promise<boolean>) | null>(null);
  const readOnly = mode === "view";

  // Each open starts on what the card shows. While it's open the sheet keeps its
  // own place: a refetch that moves the card's equipment (a save, a pick, sets
  // logged meanwhile) never throws it back to the start or onto other equipment.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setView(startOn);
      setEqId(shownEquipmentId);
    }
    wasOpen.current = open;
  }, [open, shownEquipmentId, startOn]);

  const eq = eqId ? data.equipment.find((e) => e.id === eqId) ?? null : null;
  const gymName = (id: string | null) => (id ? data.gyms.find((g) => g.id === id)?.name ?? null : null);
  const kind = eq?.kind ?? suggestKind(exercise);
  const exerciseLike = useMemo(() => ({ name: exercise.name, equipment: exercise.equipment ?? null }), [exercise.name, exercise.equipment]);
  const { revisions } = useSetupRevisions(clientId, exercise.id, open);

  // ── the draft: what's on screen; what's saved is `base` ──
  const setup = setupFor(data, exercise.id, eqId);
  const key = outboxKey(clientId, exercise.id, eqId);
  const [base, setBase] = useState<SetupDraft>(() => draftFromSetup(kind, setup, exerciseLike));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(base.fields));
  const [notes, setNotes] = useState(base.notes);
  const [photos, setPhotos] = useState<string[]>(base.photos);
  const [uploading, setUploading] = useState<Array<LocalPhoto & { file: File; replace: number | null }>>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [offline, setOffline] = useState(false);
  const draft: SetupDraft = useMemo(() => ({ fields: rows, notes, photos }), [rows, notes, photos]);
  // where it's typed, whether it opened empty (a "nothing in particular" typed by mistake is tidied away on a carry)
  const openedEmpty = useRef(new Map<string, boolean>());
  const carry = useRef<{ key: string; draft: SetupDraft } | null>(null);
  const latest = useRef({ draft, eqId, key, base });
  latest.current = { draft, eqId, key, base };

  // ── the autosave: one per open sheet, sending the newest version a moment after a change ──
  const auto = useRef<Autosave<Snap> | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    if (readOnly) return;
    const a = createAutosave<Snap>({
      savedKey: "",
      onStatus: setStatus,
      onError: (e) => {
        const off = typeof navigator !== "undefined" && navigator.onLine === false;
        setOffline(off || /fetch|network|load failed/i.test(String((e as any)?.message ?? "")));
      },
      save: async (snap) => {
        // kept on the phone first: an app closed mid-save still sends it later
        putOutbox({ clientId, exerciseId: exercise.id, equipmentId: snap.eqId, ...snap.form, at: snap.at });
        await actionsRef.current.saveSetup({
          exerciseId: exercise.id,
          equipmentId: snap.eqId,
          settings: snap.form.settings,
          notes: snap.form.notes,
          photos: snap.form.photos,
        });
        dropOutbox(snap.outbox, snap.at);
        setOffline(false);
        if (latest.current.eqId === snap.eqId) {
          setBase({ fields: snap.form.settings, notes: snap.form.notes ?? "", photos: snap.form.photos });
          setRestored(false);
        }
      },
    });
    auto.current = a;
    return () => {
      // closing never loses a change: what's waiting is sent now (and kept on the phone until it's in)
      void a.flush();
      a.dispose();
      if (auto.current === a) auto.current = null;
    };
  }, [readOnly, clientId, exercise.id]);

  const change = useCallback(
    (d: SetupDraft, on: string | null) => {
      const a = auto.current;
      if (!a) return;
      const form = savedForm(d);
      a.change({ form, eqId: on, outbox: outboxKey(clientId, exercise.id, on), at: Date.now() }, versionKey(on, d));
    },
    [clientId, exercise.id],
  );

  // What's saved fills the sheet when it opens or the equipment changes, and
  // again when the saved setup changes (a restore, the coach) while nothing's
  // waiting to be sent. What's being typed is never written over by a refetch.
  useEffect(() => {
    if (!open || !loaded) return;
    const fresh = draftFromSetup(kind, setup, exerciseLike);
    const same = loadedKey === key;
    if (same) {
      if (auto.current?.busy()) return;
      if (formKey(fresh) === formKey(latest.current.draft)) {
        // our own save coming back: the same thing, nothing on screen moves
        setBase(fresh);
        auto.current?.reset(versionKey(eqId, fresh));
        return;
      }
      if (formKey(latest.current.draft) !== formKey(latest.current.base)) return; // a change on its way
      setBase(fresh);
      setRows((cur) => mergeRows(cur, fresh.fields));
      setNotes(fresh.notes);
      setPhotos(fresh.photos);
      auto.current?.reset(versionKey(eqId, fresh));
      return;
    }
    let next = fresh;
    let fromBefore = false;
    if (carry.current?.key === key) {
      next = { ...carry.current.draft, fields: setupFields(kind, cleanSettings(carry.current.draft.fields), exerciseLike) };
    } else if (!readOnly) {
      // a change this phone couldn't send last time: back on screen, and sent now
      const waiting = readOutbox(key);
      if (waiting) {
        const kept: SetupDraft = { fields: setupFields(kind, waiting.settings, exerciseLike), notes: waiting.notes ?? "", photos: waiting.photos };
        if (formKey(kept) !== formKey(fresh)) {
          next = kept;
          fromBefore = true;
        } else dropOutbox(key);
      }
    }
    if (!openedEmpty.current.has(key)) openedEmpty.current.set(key, !setup || formKey(fresh) === EMPTY_FORM);
    carry.current = null;
    setBase(fresh);
    setRows(rowsOf(next.fields));
    setNotes(next.notes);
    setPhotos(next.photos);
    setUploading([]);
    setRestored(fromBefore);
    setLoadedKey(key);
    // a change kept from before goes now (the change effect sends what's on screen)
    auto.current?.reset(versionKey(eqId, fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, key, kind, setup?.id, setup?.updated_at]);

  // every change goes to the autosave (only once this equipment's setup is on screen)
  useEffect(() => {
    if (!open || readOnly || loadedKey !== key) return;
    change(draft, eqId);
  }, [open, readOnly, loadedKey, key, draft, eqId, change]);

  // The app going to the background: what's waiting is kept on the phone and sent now.
  useEffect(() => {
    if (!open || readOnly) return;
    const now = () => {
      const a = auto.current;
      const w = a?.pending();
      if (w) putOutbox({ clientId, exerciseId: exercise.id, equipmentId: w.value.eqId, ...w.value.form, at: w.value.at });
      void a?.flush();
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
  }, [open, readOnly, clientId, exercise.id]);

  // ── closing: always just closes; what's waiting is sent on the way out ──
  const content = useRef<HTMLDivElement | null>(null);
  const blurTyping = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && content.current?.contains(a) && a.matches("input, textarea")) a.blur();
  };
  const close = async () => {
    blurTyping();
    // equipment being added or edited is kept when it has a name (never asked about)
    if ((view === "new" || view === "edit") && formDirty) await formSave.current?.({ quiet: true }).catch(() => false);
    const a = auto.current;
    if (a?.busy()) {
      void a.flush().then((ok) => {
        if (!ok) toast("Your setup will save once you're back online", { description: "It's kept on this phone until then." });
      });
    }
    onOpenChange(false);
  };
  const back = async () => {
    if ((view === "new" || view === "edit") && formDirty) {
      blurTyping();
      const ok = (await formSave.current?.({ quiet: true }).catch(() => false)) ?? false;
      if (ok) return; // saving it moves on by itself (onSaved)
    }
    setView(view === "new" ? "pick" : "setup");
  };

  // ── switching ──
  const [switching, setSwitching] = useState(false);
  const pick = async (id: string | null) => {
    if (readOnly || id === eqId) {
      setView("setup");
      return;
    }
    const l = latest.current;
    // typed this time with nothing picked (the autosave may have sent it already): it goes with the pick
    const typedHere = eqId === null && !!openedEmpty.current.get(outboxKey(clientId, exercise.id, null)) && formKey(l.draft) !== EMPTY_FORM;
    const dirty = typedHere || formKey(l.draft) !== formKey(l.base) || !!auto.current?.busy();
    const plan = switchPlan({ dirty, fromId: eqId, targetHasSetup: !!setupFor(data, exercise.id, id) });
    const from = eqId;
    const fromSetup = setupFor(data, exercise.id, from);
    if (plan === "carry") {
      // typed with nothing picked, and the pick has no setup yet: the settings go with the pick
      carry.current = { key: outboxKey(clientId, exercise.id, id), draft: l.draft };
    }
    // one machine's settings never land on another: what's waiting is saved where it was typed
    await auto.current?.flush();
    setView("setup");
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
      // a "nothing in particular" setup typed only to be carried over is tidied away
      if (plan === "carry" && from === null && openedEmpty.current.get(outboxKey(clientId, exercise.id, null))) {
        const typed = setupFor(qc.getQueryData(equipmentKey(clientId)) ?? data, exercise.id, null) ?? fromSetup;
        if (typed && !typed.id.startsWith("pending-")) void actions.removeSetup(typed.id, exercise.id).catch(() => {});
      }
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
      carry.current = null;
      setEqId(from);
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

  // ── settings ──
  const nextAfter = (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    for (const r of rows.slice(i + 1)) {
      const el = inputs.current.get(r.id);
      if (el) return el.focus();
    }
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const addField = (k: FieldKey | null) => {
    if (rows.length >= SETTINGS_MAX) return;
    const row: Row = k ? { id: `r${++rowSeq}`, label: FIELDS[k].label, value: "" } : { id: `r${++rowSeq}`, label: "", value: "", custom: true };
    // in the same tap, so iOS brings the keyboard up for a label of their own
    flushSync(() => setRows((cur) => [...cur, row]));
    if (!k) document.querySelector<HTMLInputElement>(`[data-setup-label-input="${row.id}"]`)?.focus();
  };
  const setRow = (id: string, patch: Partial<Setting>) => setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (r: Row) => {
    // a field the equipment offers stays (empty); one of their own goes
    if (!r.custom && !r.value) return;
    setRows((cur) => (r.custom ? cur.filter((x) => x.id !== r.id) : cur.map((x) => (x.id === r.id ? { ...x, value: "" } : x))));
  };
  const more = useMemo(() => (readOnly ? [] : moreFieldsFor(kind, exerciseLike, rows.map((r) => r.label))), [readOnly, kind, exerciseLike, rows]);
  const prevFor = useCallback(
    (label: string, current: string) =>
      previousValues({ data, revisions, exerciseId: exercise.id, equipmentId: eqId, label, kind, current, max: 2 }),
    [data, revisions, exercise.id, eqId, kind],
  );

  // ── photos: shown at once from the phone, shrunk and uploaded behind ──
  const fileInput = useRef<HTMLInputElement | null>(null);
  const captureInput = useRef<HTMLInputElement | null>(null);
  const replaceAt = useRef<number | null>(null);
  const upload = useCallback(
    async (item: LocalPhoto & { file: File; replace: number | null }) => {
      try {
        const path = await uploadEquipmentPhoto(clientId, item.file);
        setUploading((cur) => cur.filter((u) => u.id !== item.id));
        setPhotos((cur) => {
          if (item.replace != null && item.replace < cur.length) return cur.map((p, i) => (i === item.replace ? path : p));
          return cur.length < PHOTOS_MAX ? [...cur, path] : cur;
        });
      } catch (e: any) {
        setUploading((cur) => cur.map((u) => (u.id === item.id ? { ...u, failed: true } : u)));
        toast.error(e?.message ?? "Couldn't add the photo");
      }
    },
    [clientId],
  );
  const addFiles = useCallback(
    (files: File[]) => {
      const replace = replaceAt.current;
      replaceAt.current = null;
      const room = replace != null ? 1 : PHOTOS_MAX - photos.length - uploading.length;
      const list = files.filter((f) => !f.type || f.type.startsWith("image/")).slice(0, Math.max(0, room));
      if (!list.length) return;
      const items = list.map((file, i) => ({
        id: `u${++rowSeq}`,
        url: URL.createObjectURL(file),
        file,
        replace: replace != null && i === 0 ? replace : null,
      }));
      setUploading((cur) => [...cur, ...items]);
      for (const it of items) void upload(it);
    },
    [photos.length, uploading.length, upload],
  );
  // the app's own capture camera (media/capture.ts, purpose "setup"), Library inside it; where a page
  // can't use the camera, the phone's own (capture="environment")
  const camera = useFilmCamera({ purpose: "setup", title: "Setup photo", onClip: (f) => addFiles([f]), onLibrary: () => fileInput.current?.click() });
  const openCamera = (replace: number | null) => {
    replaceAt.current = replace;
    if (!camera.start()) captureInput.current?.click();
  };
  const openLibrary = () => {
    replaceAt.current = null;
    fileInput.current?.click();
  };

  // ── earlier versions ──
  const versions = useMemo(() => revisions.filter((r) => (r.equipment_id ?? null) === (eqId ?? null)), [revisions, eqId]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = async (r: SetupRevision) => {
    if (restoring) return;
    setRestoring(r.id);
    try {
      await auto.current?.flush();
      await actions.restoreSetup(r.id, exercise.id);
      setView("setup");
      feedback("complete");
      // what the restore replaced is now the newest version: Undo puts it back
      toast.success("Setup restored", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              const fresh = (await qc.fetchQuery({ queryKey: setupRevisionsKey(clientId, exercise.id), staleTime: 0 })) as SetupRevision[] | undefined;
              const undo = (fresh ?? []).find((x) => x.reason === "restore" && (x.equipment_id ?? null) === (r.equipment_id ?? null));
              if (undo) await actions.restoreSetup(undo.id, exercise.id);
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't undo");
            }
          },
        },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't restore it");
    } finally {
      setRestoring(null);
    }
  };

  const formView = view === "new" || view === "edit";
  const title = view === "pick" ? "Pick equipment" : view === "new" ? "New equipment" : view === "edit" ? "Edit equipment" : view === "history" ? "Earlier versions" : "Setup";
  const [savedShown, setSavedShown] = useState(false);
  useEffect(() => {
    if (status !== "saved") return setSavedShown(false);
    setSavedShown(true);
    const t = window.setTimeout(() => setSavedShown(false), 2500);
    return () => window.clearTimeout(t);
  }, [status]);
  const savedNow = status === "saved" && savedShown;
  const statusText =
    status === "pending" || status === "saving" ? "Saving…" : status === "error" ? (offline ? "Saved on this phone" : "Not saved yet") : savedNow ? "Saved" : "";

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void close())}>
      <SheetContent
        ref={content}
        side="bottom"
        swipeToClose={!kb}
        hideCloseButton
        className="flex flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[520px]"
        style={kb && vv ? { top: vv.top + 8, bottom: "auto", height: vv.height - 8, maxHeight: "none" } : { maxHeight: "calc(100dvh - 2.5rem)" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        data-setup-sheet
        data-setup-mode={mode}
        data-setup-keyboard={kb ? "up" : undefined}
      >
        <SheetHeader className="shrink-0 space-y-0 px-4 pb-1.5 pt-1.5 text-left">
          <span className="mx-auto mb-1.5 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="flex min-h-10 items-center gap-1.5">
            {view !== "setup" && (
              <button type="button" onClick={() => void back()} aria-label="Back" className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-foreground active:bg-muted">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-[16px] font-semibold leading-tight">{view === "setup" ? exercise.name : title}</SheetTitle>
              <SheetDescription className="sr-only">{view === "setup" ? `Your setup for ${exercise.name}` : exercise.name}</SheetDescription>
            </div>
            {!readOnly && !formView && statusText && (
              <span
                className={cn("inline-flex shrink-0 items-center gap-1 text-xs", status === "error" ? "text-warning" : "text-muted-foreground")}
                aria-live="polite"
                data-setup-save-state={status}
              >
                {status === "error" ? <CloudOff className="h-3.5 w-3.5" aria-hidden /> : savedNow ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                {statusText}
              </span>
            )}
            {!formView && (
              <button
                type="button"
                onClick={() => void close()}
                className="-mr-1.5 inline-flex h-10 items-center rounded-full px-3 text-[15px] font-semibold text-foreground active:bg-muted"
                data-setup-done
              >
                Done
              </button>
            )}
          </div>
        </SheetHeader>

        <div
          ref={box}
          onFocus={onFocusIn}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1"
          style={{ paddingBottom: kb ? "1rem" : "max(env(safe-area-inset-bottom), 14px)" }}
          data-setup-scroll
        >
          {view === "setup" && (
            <div className="space-y-3.5">
              {restored && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground" data-setup-restored>
                  Your last changes are back and saving now.
                </p>
              )}

              {/* What it's on: one row, Change beside it, the usual others one tap away. */}
              <section aria-label="Equipment" data-setup-equipment>
                <div className="flex items-center gap-2.5">
                  <EquipmentThumb path={eq?.photo_path} className="h-10 w-10 rounded-lg" icon={<Dumbbell className="h-4 w-4" aria-hidden />} alt={eq ? equipmentName(eq) : ""} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold leading-tight text-foreground" data-setup-equipment-name>
                      {eq ? equipmentName(eq) : "No equipment picked"}
                      {eq?.archived_at && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Retired</span>}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {eq ? equipmentDetail(eq, gymName(eq.gym_id)) || KIND_LABEL[eq.kind] : readOnly ? "No equipment saved" : "Optional: name the rack or machine"}
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
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[13px] font-semibold text-foreground active:bg-muted"
                      data-setup-change
                    >
                      {switching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      {eq ? "Change" : "Pick"}
                    </button>
                  )}
                </div>
                {chips.length > 0 && (
                  <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Switch to" data-setup-chips>
                    {chips.map((c) => (
                      <button key={c.id} type="button" onClick={() => void pick(c.id)} className={cn(CHIP, CHIP_OFF, "gap-1.5")} data-setup-chip={c.id}>
                        {c.favorite && <Star className="h-3 w-3 fill-warning text-warning" aria-hidden />}
                        {equipmentName(c)}
                        {gymName(c.gym_id) && <span className="text-muted-foreground">· {gymName(c.gym_id)}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {mode === "past" && <p className="mt-1.5 text-xs text-muted-foreground">A different pick fixes this workout's record only.</p>}
              </section>

              <section aria-label="Settings" data-setup-settings>
                {setup?.source === "coach" && (
                  <p className="mb-1 text-[12px] text-muted-foreground" data-setup-by-coach>
                    Set by {coachView ? "the coach" : "your coach"}
                  </p>
                )}
                {!loaded ? (
                  <div className="flex h-20 items-center justify-center" aria-label="Loading">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                  </div>
                ) : (
                  <>
                    {fromNote.length > 0 && (
                      <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-[13px]" data-setup-from-note>
                        <span className="min-w-0 flex-1 text-muted-foreground">
                          From {who === "you" ? "your" : `${who}'s`} note: <span className="text-foreground">{fromNote.map((s) => `${s.label} ${s.value}`).join(" · ")}</span>
                        </span>
                        <button
                          type="button"
                          className="h-9 shrink-0 rounded-lg px-2.5 font-semibold text-foreground active:bg-background"
                          onClick={() => setRows(rowsOf(setupFields(kind, fromNote, exerciseLike)))}
                        >
                          Use it
                        </button>
                      </div>
                    )}
                    {readOnly && !rows.some((f) => f.value) ? (
                      <p className="text-[13px] text-muted-foreground">No settings saved.</p>
                    ) : (
                      <ul className="divide-y divide-border/50">
                        {rows.map((f, i) => {
                          if (readOnly && !f.value) return null;
                          const def = fieldFor(f.label, kind);
                          const control = controlFor(f.label, f.value, kind);
                          const prev = !readOnly && control !== "choice" && !f.value.trim() ? prevFor(f.label, f.value) : [];
                          const name = f.label || `Setting ${i + 1}`;
                          const label =
                            f.custom && !readOnly ? (
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
                                className="h-10 w-full min-w-0 rounded-lg bg-muted/50 px-2 text-base text-foreground outline-none placeholder:text-muted-foreground/70"
                                data-setup-label-input={f.id}
                              />
                            ) : (
                              <span className="block truncate text-[15px] text-foreground" data-setup-label>
                                {f.label}
                              </span>
                            );
                          const remove = !readOnly && (f.value || f.custom) ? (
                            <button
                              type="button"
                              onClick={() => removeRow(f)}
                              aria-label={f.custom ? `Remove ${f.label || "this setting"}` : `Clear ${f.label}`}
                              className="grid h-10 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground active:bg-muted"
                              data-setup-clear
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          ) : !readOnly ? (
                            <span className="w-8 shrink-0" aria-hidden />
                          ) : null;
                          return (
                            <li key={f.id} className="py-1" data-setup-field data-setup-control={control}>
                              <div className="flex min-h-11 items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  {label}
                                  {prev.length > 0 && (
                                    <div className="mt-0.5 flex flex-wrap gap-1">
                                      {prev.map((v) => (
                                        <button
                                          key={v}
                                          type="button"
                                          onClick={() => {
                                            feedback("toggle");
                                            setRow(f.id, { value: v });
                                          }}
                                          className="inline-flex h-7 items-center rounded-full bg-muted px-2.5 text-[12px] font-medium text-foreground active:bg-muted-foreground/20"
                                          aria-label={`Use ${v} for ${name}, used before`}
                                          data-setup-previous={v}
                                        >
                                          Last {v}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {control === "number" ? (
                                  <NumberStepper
                                    value={f.value}
                                    onChange={(v) => setRow(f.id, { value: v })}
                                    def={def}
                                    fallback={prev[0] ?? null}
                                    label={name}
                                    readOnly={readOnly}
                                    name={`setup-value-${i}`}
                                    inputRef={(el) => {
                                      if (el) inputs.current.set(f.id, el);
                                      else inputs.current.delete(f.id);
                                    }}
                                    onEnter={() => nextAfter(f.id)}
                                  />
                                ) : control === "choice" ? (
                                  readOnly ? (
                                    <span className="shrink-0 text-[15px] font-semibold text-foreground" data-setup-value>{f.value}</span>
                                  ) : null
                                ) : readOnly ? (
                                  <span className="shrink-0 text-[15px] font-semibold text-foreground" data-setup-value>{f.value}</span>
                                ) : (
                                  <input
                                    ref={(el) => {
                                      if (el) inputs.current.set(f.id, el);
                                      else inputs.current.delete(f.id);
                                    }}
                                    value={f.value}
                                    maxLength={SETTING_VALUE_MAX}
                                    onChange={(e) => setRow(f.id, { value: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        nextAfter(f.id);
                                      }
                                    }}
                                    placeholder="–"
                                    aria-label={`${name} value`}
                                    {...noAutofill(`setup-value-${i}`)}
                                    autoCapitalize="sentences"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    enterKeyHint="next"
                                    className="h-10 w-32 shrink-0 rounded-lg bg-muted/50 px-2 text-center text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-muted"
                                    data-setup-value
                                  />
                                )}
                                {remove}
                              </div>
                              {control === "choice" && !readOnly && (
                                <ChoiceChips
                                  value={f.value}
                                  options={def ? optionsFor(def, exerciseLike) : []}
                                  onChange={(v) => setRow(f.id, { value: v })}
                                  label={name}
                                  name={`setup-choice-${i}`}
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {/* more settings: one tap each, or one of their own */}
                    {!readOnly && rows.length < SETTINGS_MAX && (
                      <div className="mt-1 flex flex-wrap gap-1.5" data-setup-add-fields>
                        {more.map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => addField(k)}
                            className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground active:bg-muted"
                            data-setup-add-field={k}
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden /> {FIELDS[k].label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => addField(null)}
                          className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground active:bg-muted"
                          data-setup-add-custom
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden /> Your own
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Photos and a note: always there, never in the way. */}
              <section aria-label="Photos" data-setup-photos-section>
                {(!readOnly || photos.length > 0) && (
                  <PhotoStrip
                    paths={photos}
                    uploading={uploading}
                    max={PHOTOS_MAX}
                    readOnly={readOnly}
                    onCamera={() => openCamera(null)}
                    onLibrary={openLibrary}
                    onRemove={(i) => setPhotos((cur) => cur.filter((_, j) => j !== i))}
                    onReplace={(i) => openCamera(i)}
                    onRetry={(id) => {
                      const it = uploading.find((u) => u.id === id);
                      if (!it) return;
                      setUploading((cur) => cur.map((u) => (u.id === id ? { ...u, failed: false } : u)));
                      void upload(it);
                    }}
                  />
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                  data-setup-photo-input
                />
                <input
                  ref={captureInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                {camera.element}
              </section>

              {readOnly ? (
                notes ? <p className="whitespace-pre-wrap text-[14px] text-foreground">{notes}</p> : null
              ) : (
                <AutoGrowNote value={notes} onChange={setNotes} />
              )}

              {/* the rest, quietly */}
              <div className="flex flex-col pb-1">
                {versions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      blurTyping();
                      setView("history");
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-1 text-left text-[13px] font-medium text-muted-foreground active:bg-muted"
                    data-setup-history
                  >
                    <History className="h-4 w-4" aria-hidden />
                    <span className="flex-1">Earlier versions</span>
                    <span className="tabular-nums">{versions.length}</span>
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                )}
                {!readOnly && eq && (
                  <button
                    type="button"
                    onClick={() => {
                      blurTyping();
                      setEditing(eq);
                      setView("edit");
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-1 text-left text-[13px] font-medium text-muted-foreground active:bg-muted"
                    data-setup-edit-equipment
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    <span className="flex-1 truncate">Edit {equipmentName(eq)}</span>
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                )}
                {mode === "manage" && setup && !setup.id.startsWith("pending-") && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await auto.current?.flush();
                        await actions.removeSetup(setup.id, exercise.id);
                        auto.current?.reset("");
                        dropOutbox(key);
                        onOpenChange(false);
                        // the removal kept what was removed: Undo puts it back
                        toast.success("Setup removed", {
                          action: {
                            label: "Undo",
                            onClick: async () => {
                              try {
                                const fresh = (await qc.fetchQuery({ queryKey: setupRevisionsKey(clientId, exercise.id), staleTime: 0 })) as SetupRevision[] | undefined;
                                const gone = (fresh ?? []).find((x) => x.reason === "removed" && x.setup_id === setup.id);
                                if (gone) await actions.restoreSetup(gone.id, exercise.id);
                              } catch (e: any) {
                                toast.error(e?.message ?? "Couldn't undo");
                              }
                            },
                          },
                        });
                      } catch (e: any) {
                        toast.error(e?.message ?? "Couldn't remove it");
                      }
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-1 text-left text-[13px] font-medium text-destructive"
                    data-setup-remove
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove this setup
                  </button>
                )}
              </div>
            </div>
          )}

          {view === "history" && (
            <SetupHistory
              current={savedForm(base)}
              versions={versions}
              kind={kind}
              readOnly={readOnly}
              restoring={restoring}
              athleteFirstName={athleteFirstName}
              coachView={coachView}
              onRestore={(r) => void restore(r)}
            />
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
  );
}

/** A note that starts one line tall and grows with what's typed. */
function AutoGrowNote({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      maxLength={NOTE_MAX}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Add a note"
      rows={1}
      {...noAutofill("setup-note")}
      className="block min-h-11 w-full resize-none rounded-xl bg-muted/50 px-3 py-2.5 text-base leading-snug outline-none placeholder:text-muted-foreground/70 focus:bg-muted"
      aria-label="Setup note"
      data-setup-note
    />
  );
}

const whenWords = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
};

/** Earlier versions of this setup on this equipment, newest first, each one tap from back. */
function SetupHistory({
  current,
  versions,
  kind,
  readOnly,
  restoring,
  coachView,
  athleteFirstName,
  onRestore,
}: {
  current: ReturnType<typeof savedForm>;
  versions: SetupRevision[];
  kind: Equipment["kind"] | null;
  readOnly: boolean;
  restoring: string | null;
  coachView: boolean;
  athleteFirstName: string | null;
  onRestore: (r: SetupRevision) => void;
}) {
  const describe = (s: { settings: Setting[]; notes: string | null; photos: number }) =>
    [settingsText(s.settings, 4, kind) || "No settings", s.notes ? `“${s.notes.length > 40 ? `${s.notes.slice(0, 40)}…` : s.notes}”` : "", s.photos ? `${s.photos} photo${s.photos === 1 ? "" : "s"}` : ""]
      .filter(Boolean)
      .join(" · ");
  const byWho = (src: SetupRevision["source"]) => (src === "coach" ? (coachView ? "Coach" : "Your coach") : coachView ? athleteFirstName ?? "Athlete" : "You");
  return (
    <div className="space-y-1 pb-2" data-setup-history-list>
      <div className="rounded-xl bg-muted/50 px-3 py-2">
        <div className="text-[12px] font-medium text-muted-foreground">Now</div>
        <div className="text-[14px] text-foreground">{describe({ ...current, photos: current.photos.length })}</div>
      </div>
      <ul className="divide-y divide-border/50">
        {versions.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2" data-setup-version={r.id}>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-muted-foreground">
                {whenWords(r.saved_at ?? r.created_at)} · {byWho(r.source)}
                {r.reason === "removed" ? " · before it was removed" : ""}
              </div>
              <div className="text-[14px] leading-snug text-foreground">{describe({ settings: r.settings, notes: r.notes, photos: r.photo_paths.length })}</div>
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onRestore(r)}
                disabled={!!restoring}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[13px] font-semibold text-foreground active:bg-muted disabled:opacity-60"
                data-setup-restore
              >
                {restoring === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="px-1 pt-1 text-[12px] text-muted-foreground">Every change is kept here. Restoring keeps what's there now too.</p>
    </div>
  );
}

/**
 * The card's setup line, right under the exercise's name and role: what's
 * saved, the most important settings first and whole parts only, on one line
 * ("J-hooks 9 · Safeties 4 · Rogue rack"), with its photo one tap away; empty,
 * a quiet "Add your setup". One slim line on every card; the tap target is
 * taller than the line it draws.
 */
export function SetupLine({
  text,
  onOpen,
  retired = false,
  photo = null,
  photoCount = 0,
}: {
  text: string;
  onOpen: () => void;
  retired?: boolean;
  /** The setup's first photo (null: none). */
  photo?: string | null;
  photoCount?: number;
}) {
  const empty = !text;
  return (
    <div className="mt-0.5 flex min-h-6 items-center gap-1.5" data-setup-line={empty ? "empty" : "saved"}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "relative -ml-1 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] leading-5 active:bg-muted",
          // a taller tap than the line it draws (40px), without making the card taller
          "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
          empty ? "text-muted-foreground" : "text-foreground/80",
        )}
        aria-label={empty ? "Add your setup for this exercise" : `Setup: ${text}${retired ? " (retired equipment)" : ""}. Open setup`}
        data-setup-line-open
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {/* whole parts only: what doesn't fit the line is left for the sheet, never cut mid-word */}
        <span className="flex h-5 min-w-0 flex-wrap overflow-hidden" data-setup-line-text>
          {empty ? (
            <span className="whitespace-nowrap">Add your setup</span>
          ) : (
            text.split(" · ").map((part, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 && <span className="text-muted-foreground">&nbsp;·&nbsp;</span>}
                {part}
              </span>
            ))
          )}
        </span>
        {retired && <span className="shrink-0 whitespace-nowrap text-[12px] text-muted-foreground">· retired</span>}
      </button>
      {photo && <SetupLinePhoto path={photo} count={photoCount} />}
    </div>
  );
}

/** The setup's photo on the card: a small thumbnail that opens it big. */
function SetupLinePhoto({ path, count }: { path: string; count: number }) {
  const url = useEquipmentPhotoUrl(path);
  const viewer = useMediaViewer();
  return (
    <button
      type="button"
      onClick={(e) => url && viewer.open(url, { alt: "Setup photo", from: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
      className="relative h-[22px] w-[22px] shrink-0 overflow-hidden rounded-[5px] bg-muted before:absolute before:-inset-2.5 before:content-['']"
      aria-label={count > 1 ? `See the setup photos (${count})` : "See the setup photo"}
      data-setup-line-photo
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />}
    </button>
  );
}
