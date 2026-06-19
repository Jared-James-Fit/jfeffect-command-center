// Phase 2: durable local store for offline workout completions.
//
// When a client taps "Finish Workout" while offline, the completion payload
// (rating, notes, duration, computed summary) is saved here so it survives
// app close + reopen. Phase 3 will register a sync handler that drains this
// store back to the server. For now this is a write-only persistence layer.

const KEY = "lov:offline-workout-completions:v1";

export type OfflineWorkoutCompletion = {
  /** Stable id — `${dayId}:${clientId}` — used to de-dupe and replace. */
  id: string;
  dayId: string;
  clientId: string;
  /** Opaque payload accepted by the future sync handler. */
  payload: Record<string, unknown>;
  savedAt: number;
};

function readAll(): OfflineWorkoutCompletion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OfflineWorkoutCompletion[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: OfflineWorkoutCompletion[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota — best effort */
  }
}

export function saveOfflineCompletion(entry: Omit<OfflineWorkoutCompletion, "savedAt">) {
  const items = readAll().filter((i) => i.id !== entry.id);
  items.push({ ...entry, savedAt: Date.now() });
  writeAll(items);
}

export function getOfflineCompletion(dayId: string, clientId: string): OfflineWorkoutCompletion | null {
  const id = `${dayId}:${clientId}`;
  return readAll().find((i) => i.id === id) ?? null;
}

export function listOfflineCompletions(): OfflineWorkoutCompletion[] {
  return readAll();
}

export function clearOfflineCompletion(dayId: string, clientId: string) {
  const id = `${dayId}:${clientId}`;
  writeAll(readAll().filter((i) => i.id !== id));
}