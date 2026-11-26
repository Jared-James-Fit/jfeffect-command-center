/**
 * Equipment & setups: one read per athlete (their gyms, equipment and setups,
 * small enough to load whole) and the writes, all through the equipment_* RPCs
 * (20270420090000_equipment_setups.sql). The read is kept on the phone for a
 * day so a workout card shows its setup line on the first frame.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compress";
import { createSignedUrlCache } from "@/lib/signed-url-cache";
import {
  cleanSettings,
  EMPTY_EQUIPMENT,
  type Equipment,
  type EquipmentData,
  type EquipmentKind,
  type ExerciseSetup,
  type Gym,
  type Setting,
} from "./equipment";
import { flushOutbox, type OutboxEntry } from "./setup-outbox";

const sb = supabase as any;

export const EQUIPMENT_BUCKET = "equipment-photos";
export const equipmentKey = (clientId: string | null | undefined) => ["athlete-equipment", clientId ?? null] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const SETUP_COLUMNS = "id, client_id, exercise_id, equipment_id, settings, notes, photo_path, photo_paths, source, last_used_at, updated_at";
/** The columns before photo_paths (a database a migration behind still answers). */
const SETUP_COLUMNS_V1 = "id, client_id, exercise_id, equipment_id, settings, notes, photo_path, source, last_used_at, updated_at";

async function fetchSetups(clientId: string) {
  const r = await sb.from("athlete_exercise_setups").select(SETUP_COLUMNS).eq("client_id", clientId);
  if (r.error && /photo_paths/.test(String(r.error.message ?? ""))) {
    return sb.from("athlete_exercise_setups").select(SETUP_COLUMNS_V1).eq("client_id", clientId);
  }
  return r;
}

export async function fetchEquipment(clientId: string): Promise<EquipmentData> {
  const [g, e, s] = await Promise.all([
    sb.from("athlete_gyms").select("id, client_id, name, archived_at").eq("client_id", clientId),
    sb
      .from("athlete_equipment")
      .select("id, client_id, gym_id, kind, name, brand, model, notes, photo_path, favorite, last_used_at, archived_at, created_at")
      .eq("client_id", clientId),
    fetchSetups(clientId),
  ]);
  const err = g.error ?? e.error ?? s.error;
  if (err) throw err;
  return {
    gyms: (g.data ?? []) as Gym[],
    equipment: (e.data ?? []) as Equipment[],
    setups: ((s.data ?? []) as any[]).map((row) => ({ ...row, settings: cleanSettings(row.settings) })) as ExerciseSetup[],
  };
}

/** An athlete's gyms, equipment and setups (EMPTY while it loads or when it can't be read). */
export function useAthleteEquipment(clientId: string | null | undefined, opts: { enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const on = !!clientId && opts.enabled !== false;
  // a setup change that couldn't be sent goes as soon as it can (setup-outbox.ts)
  useEffect(() => {
    if (on && clientId) ensureOutboxFlush(clientId, qc);
  }, [on, clientId, qc]);
  const q = useQuery({
    queryKey: equipmentKey(clientId),
    enabled: !!clientId && opts.enabled !== false,
    staleTime: 60_000,
    gcTime: DAY_MS,
    retry: 1,
    queryFn: () => fetchEquipment(clientId!),
  });
  return { data: q.data ?? EMPTY_EQUIPMENT, loaded: q.isSuccess, loading: q.isLoading, error: q.error };
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const e = new Error(error.message ?? "Couldn't save") as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
  return data as T;
}

/** The save itself (the sheet's autosave and the outbox both send through it). */
export async function sendSetup(input: {
  clientId: string;
  exerciseId: string;
  equipmentId: string | null;
  settings: Setting[];
  notes: string | null;
  photos: string[];
  makeCurrent?: boolean;
}): Promise<ExerciseSetup> {
  const row = await rpc("equipment_setup_save", {
    _client_id: input.clientId,
    _exercise_id: input.exerciseId,
    _equipment_id: input.equipmentId,
    _settings: cleanSettings(input.settings),
    _notes: input.notes ?? null,
    _photo_path: input.photos[0] ?? null,
    _make_current: !!input.makeCurrent,
    _photo_paths: input.photos,
  });
  return { ...row, settings: cleanSettings(row?.settings) } as ExerciseSetup;
}

const flushingFor = new Set<string>();

/**
 * Send a client's waiting setup changes now, when the phone comes back online
 * and when the app comes back to the screen (installed once per athlete).
 */
export function ensureOutboxFlush(clientId: string, qc: QueryClient) {
  if (typeof window === "undefined" || flushingFor.has(clientId)) return;
  flushingFor.add(clientId);
  const go = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void flushOutbox(clientId, async (e: OutboxEntry) => {
      const saved = await sendSetup({ clientId: e.clientId, exerciseId: e.exerciseId, equipmentId: e.equipmentId, settings: e.settings, notes: e.notes, photos: e.photos });
      patch(qc, clientId, (d) => ({ ...d, setups: [...d.setups.filter((s) => s.id !== saved.id), saved] }));
    }).then((n) => {
      if (n > 0) void qc.invalidateQueries({ queryKey: equipmentKey(clientId) });
    });
  };
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") go();
  });
  go();
}

export type SetupRevision = {
  id: string;
  setup_id: string;
  exercise_id: string;
  equipment_id: string | null;
  settings: Setting[];
  notes: string | null;
  photo_paths: string[];
  source: "athlete" | "coach";
  saved_by: string | null;
  saved_at: string | null;
  reason: "edit" | "restore" | "removed";
  created_at: string;
};

export const setupRevisionsKey = (clientId: string | null | undefined, exerciseId: string | null | undefined) =>
  ["athlete-setup-revisions", clientId ?? null, exerciseId ?? null] as const;

/** Earlier versions of an exercise's setups, newest first (empty until the history migration is in). */
export function useSetupRevisions(clientId: string | null | undefined, exerciseId: string | null | undefined, enabled = true) {
  const q = useQuery({
    queryKey: setupRevisionsKey(clientId, exerciseId),
    enabled: !!clientId && !!exerciseId && enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<SetupRevision[]> => {
      const { data, error } = await sb
        .from("athlete_exercise_setup_revisions")
        .select("id, setup_id, exercise_id, equipment_id, settings, notes, photo_paths, source, saved_by, saved_at, reason, created_at")
        .eq("client_id", clientId)
        .eq("exercise_id", exerciseId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) {
        // a database without the table yet: no history, never an error on screen
        if (/athlete_exercise_setup_revisions|does not exist|schema cache/i.test(String(error.message ?? ""))) return [];
        throw error;
      }
      return ((data ?? []) as any[]).map((r) => ({ ...r, settings: cleanSettings(r.settings), photo_paths: Array.isArray(r.photo_paths) ? r.photo_paths : [] }));
    },
  });
  return { revisions: q.data ?? [], loaded: q.isSuccess };
}

function patch(qc: QueryClient, clientId: string, fn: (d: EquipmentData) => EquipmentData) {
  qc.setQueryData<EquipmentData>(equipmentKey(clientId), (d) => fn(d ?? EMPTY_EQUIPMENT));
}

export type EquipmentInput = {
  id?: string | null;
  name: string;
  kind: EquipmentKind;
  gymId: string | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  photoPath?: string | null;
};

export type SetupInput = {
  exerciseId: string;
  equipmentId: string | null;
  settings: Setting[];
  notes?: string | null;
  /** Its photos, in order (the first is the cover). */
  photos?: string[];
  /** Put it on their workout card from now on. */
  makeCurrent?: boolean;
};

export type ChooseInput = {
  exerciseId: string;
  equipmentId: string | null;
  /** The workout the pick is made in: its sets logged today move to it (and the "you're at Gold's" move). */
  dayId?: string | null;
  /** A past workout: fix its record only, nothing else changes. */
  thisWorkoutOnly?: boolean;
  instance?: string | null;
};

export function useEquipmentActions(clientId: string | null | undefined) {
  const qc = useQueryClient();
  const refresh = () => (clientId ? qc.invalidateQueries({ queryKey: equipmentKey(clientId) }) : Promise.resolve());
  const need = () => {
    if (!clientId) throw new Error("No athlete");
    return clientId;
  };
  return {
    refresh,

    async saveGym(name: string, id?: string | null): Promise<{ id: string; existed: boolean }> {
      const c = need();
      const r = await rpc("equipment_gym_save", { _client_id: c, _name: name, _id: id ?? null });
      await refresh();
      return { id: r.id, existed: !!r.existed };
    },

    async removeGym(id: string): Promise<{ gym: string; retired: number; deleted: number }> {
      const r = await rpc("equipment_gym_remove", { _id: id });
      await refresh();
      return r;
    },

    async saveEquipment(input: EquipmentInput): Promise<{ id: string; existed: boolean }> {
      const c = need();
      const r = await rpc("equipment_save", {
        _client_id: c,
        _name: input.name,
        _kind: input.kind,
        _gym_id: input.gymId,
        _brand: input.brand ?? null,
        _model: input.model ?? null,
        _notes: input.notes ?? null,
        _photo_path: input.photoPath ?? null,
        _id: input.id ?? null,
      });
      await refresh();
      return { id: r.id, existed: !!r.existed };
    },

    async setFavorite(id: string, on: boolean) {
      const c = need();
      patch(qc, c, (d) => ({ ...d, equipment: d.equipment.map((e) => (e.id === id ? { ...e, favorite: on } : e)) }));
      try {
        await rpc("equipment_set_favorite", { _id: id, _on: on });
      } finally {
        void refresh();
      }
    },

    /** Retired when it's in their history, deleted when it never was. */
    async removeEquipment(id: string): Promise<"archived" | "deleted" | "gone"> {
      const r = await rpc<string>("equipment_remove", { _id: id });
      await refresh();
      return r as "archived" | "deleted" | "gone";
    },

    async restoreEquipment(id: string) {
      await rpc("equipment_restore", { _id: id });
      await refresh();
    },

    async saveSetup(input: SetupInput): Promise<ExerciseSetup> {
      const c = need();
      const saved = await sendSetup({
        clientId: c,
        exerciseId: input.exerciseId,
        equipmentId: input.equipmentId,
        settings: input.settings,
        notes: input.notes ?? null,
        photos: input.photos ?? [],
        makeCurrent: input.makeCurrent,
      });
      patch(qc, c, (d) => ({ ...d, setups: [...d.setups.filter((s) => s.id !== saved.id), saved] }));
      void qc.invalidateQueries({ queryKey: setupRevisionsKey(c, input.exerciseId) });
      return saved;
    },

    async removeSetup(id: string, exerciseId?: string | null) {
      const c = need();
      patch(qc, c, (d) => ({ ...d, setups: d.setups.filter((s) => s.id !== id) }));
      try {
        await rpc("equipment_setup_remove", { _id: id });
      } finally {
        void refresh();
        if (exerciseId) void qc.invalidateQueries({ queryKey: setupRevisionsKey(c, exerciseId) });
      }
    },

    /** Put an earlier version back (what it replaces is kept, so this can be undone too). */
    async restoreSetup(revisionId: string, exerciseId: string): Promise<ExerciseSetup> {
      const c = need();
      const row = await rpc("equipment_setup_restore", { _revision_id: revisionId });
      const saved = { ...row, settings: cleanSettings(row?.settings) } as ExerciseSetup;
      patch(qc, c, (d) => ({ ...d, setups: [...d.setups.filter((s) => s.id !== saved.id), saved] }));
      void qc.invalidateQueries({ queryKey: setupRevisionsKey(c, exerciseId) });
      return saved;
    },

    /**
     * Switch what an exercise is done on. The card moves at once (the pick is
     * the newest); the server moves today's sets with it and may move the
     * workout's other exercises to the same gym ("moved").
     */
    async choose(input: ChooseInput): Promise<{ restamped: number; moved: Array<{ exercise_id: string; equipment_id: string }> }> {
      const c = need();
      if (!input.thisWorkoutOnly) {
        const at = new Date().toISOString();
        patch(qc, c, (d) => {
          const has = d.setups.some((s) => s.exercise_id === input.exerciseId && (s.equipment_id ?? null) === (input.equipmentId ?? null));
          const setups = has
            ? d.setups.map((s) => (s.exercise_id === input.exerciseId && (s.equipment_id ?? null) === (input.equipmentId ?? null) ? { ...s, last_used_at: at } : s))
            : [...d.setups, {
                id: `pending-${input.exerciseId}-${input.equipmentId ?? "none"}`,
                client_id: c,
                exercise_id: input.exerciseId,
                equipment_id: input.equipmentId,
                settings: [],
                notes: null,
                photo_path: null,
                photo_paths: [],
                source: "athlete" as const,
                last_used_at: at,
                updated_at: at,
              }];
          return { ...d, setups };
        });
      }
      try {
        const r = await rpc("equipment_choose", {
          _client_id: c,
          _exercise_id: input.exerciseId,
          _equipment_id: input.equipmentId,
          _day_id: input.dayId ?? null,
          _this_workout_only: !!input.thisWorkoutOnly,
          _instance: input.instance ?? null,
        });
        return { restamped: Number(r?.restamped ?? 0), moved: Array.isArray(r?.moved) ? r.moved : [] };
      } finally {
        await refresh();
        if (input.dayId) {
          void qc.invalidateQueries({ queryKey: ["pl-day-results", input.dayId] });
        }
        void qc.invalidateQueries({ queryKey: ["exercise-history"] });
        void qc.invalidateQueries({ queryKey: ["workout-previous-lifts"], refetchType: "none" });
      }
    },
  };
}

// ─────────────────────────── Photos ───────────────────────────

const photoUrls = createSignedUrlCache(async (paths) => {
  const { data, error } = await sb.storage.from(EQUIPMENT_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
});

/** A saved photo's link (null while it signs, or when there's none). */
export function useEquipmentPhotoUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? photoUrls.get(path) ?? null : null));
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const have = photoUrls.get(path);
    if (have) {
      setUrl(have);
      return;
    }
    let live = true;
    void photoUrls.ensure([path]).then(() => {
      if (live) setUrl(photoUrls.get(path) ?? null);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

/**
 * Upload a photo (shrunk on the phone first: 1280 px on its long side, about
 * 150–300 KB, which still reads a pin number) into the athlete's folder; its path.
 */
export async function uploadEquipmentPhoto(clientId: string, file: File): Promise<string> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("That isn't a photo");
  const small = await compressImage(file, { maxDimension: 1280, quality: 0.78, skipUnder: 200 * 1024 });
  const type = (small as File).type || file.type || "image/jpeg";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type.includes("hei") ? "heic" : "jpg";
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const path = `${clientId}/${id}.${ext}`;
  const { error } = await sb.storage.from(EQUIPMENT_BUCKET).upload(path, small, { contentType: type, upsert: false });
  if (error) throw new Error(error.message ?? "Couldn't upload the photo");
  try {
    photoUrls.seed(path, URL.createObjectURL(small), 30 * 60_000);
  } catch {
    /* no blob URLs here: it signs on first show */
  }
  return path;
}

/** Best effort: a replaced or removed photo's file. */
export async function removeEquipmentPhoto(path: string | null | undefined) {
  if (!path) return;
  try {
    await sb.storage.from(EQUIPMENT_BUCKET).remove([path]);
  } catch {
    /* left behind: harmless */
  }
}
