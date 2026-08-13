/**
 * Persistent open/closed state for inline workout previews.
 *
 * The preview toggle used to live in component state on the workout card.
 * Any parent re-render that remounted the card (list re-order, query
 * refetch, duplicate React keys for stacked instances of the same source
 * day, navigating to the logger and back) silently reset `open` to false,
 * which is why the preview "sometimes" refused to open / collapsed while a
 * client was logging.
 *
 * Open state is therefore keyed by a STABLE workout identity
 * (dayId + optional scheduled-instance id) and kept in a module-level store
 * mirrored into sessionStorage, so it survives remounts and route changes
 * within the session. Never key this by progress, status, or updated_at.
 */
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "jf:workout-preview-open";
const listeners = new Set<() => void>();
let open: Record<string, true> = readInitial();

function readInitial(): Record<string, true> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    /* quota / private mode — in-memory state still works */
  }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

export function previewKey(dayId?: string | null, instanceId?: string | null): string {
  return `${dayId ?? "?"}::${instanceId ?? "-"}`;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isPreviewOpen(key: string): boolean {
  return open[key] === true;
}

export function setPreviewOpen(key: string, value: boolean) {
  if (!!open[key] === value) return;
  const next = { ...open };
  if (value) next[key] = true;
  else delete next[key];
  open = next;
  emit();
}

/** Stable open-state hook. Returns [open, setOpen, toggle]. */
export function usePreviewOpen(
  dayId?: string | null,
  instanceId?: string | null,
): [boolean, (v: boolean) => void, () => void] {
  const key = previewKey(dayId, instanceId);
  const value = useSyncExternalStore(
    subscribe,
    () => isPreviewOpen(key),
    () => false,
  );
  const set = useCallback((v: boolean) => setPreviewOpen(key, v), [key]);
  const toggle = useCallback(() => setPreviewOpen(key, !isPreviewOpen(key)), [key]);
  return [value, set, toggle];
}
