// Durable client-side queue for workout log writes that must survive
// network blips and page reloads. Wraps any async mutation in a retry
// envelope keyed by a stable id (so the same set/notes save is replaced
// instead of duplicated). Persisted to localStorage and replayed on mount,
// reconnect, and every 10s while items remain.
//
// On the 3rd consecutive failure for a single item, it fires an `onStuck`
// callback so the page can escalate (toast + support-alert report).

import { useSyncExternalStore } from "react";

export type QueueStatus = "idle" | "syncing" | "synced" | "failed" | "stuck";

type QueueItem = {
  id: string;
  label: string;
  /** Serialized payload — opaque to the queue; only the handler reads it. */
  payload: any;
  /** Handler key registered via `registerQueueHandler`. */
  handlerKey: string;
  attempts: number;
  lastError: string | null;
  enqueuedAt: number;
  lastTriedAt: number | null;
};

const STORE_KEY = "lov:wo-queue:v1";
const STUCK_AFTER = 3;

type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();
let stuckListener: ((item: QueueItem) => void) | null = null;

let items: QueueItem[] = load();
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

// Cached snapshot for useSyncExternalStore. We MUST return a stable
// reference whenever underlying state hasn't changed, otherwise React
// re-renders forever ("Maximum update depth exceeded").
type AggregateSnapshot = { status: QueueStatus; pending: number; stuck: QueueItem[] };
let cachedSnapshot: AggregateSnapshot | null = null;
let cachedItemsRef: QueueItem[] | null = null;
let cachedRunning = false;

function getAggregateSnapshot(): AggregateSnapshot {
  if (cachedSnapshot && cachedItemsRef === items && cachedRunning === running) {
    return cachedSnapshot;
  }
  cachedItemsRef = items;
  cachedRunning = running;
  cachedSnapshot = {
    status: getAggregateStatus(),
    pending: items.length,
    stuck: items.filter((i) => i.attempts >= STUCK_AFTER),
  };
  return cachedSnapshot;
}

const SERVER_SNAPSHOT: AggregateSnapshot = { status: "synced", pending: 0, stuck: [] };

function load(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    /* quota — best effort */
  }
}

function notify() {
  // Invalidate cache so the next getSnapshot() recomputes once.
  cachedSnapshot = null;
  for (const l of listeners) l();
}

export function registerQueueHandler(key: string, fn: Handler) {
  handlers.set(key, fn);
}

export function setStuckListener(cb: ((item: QueueItem) => void) | null) {
  stuckListener = cb;
}

export function enqueueOfflineWrite(args: {
  id: string;
  label: string;
  handlerKey: string;
  payload: any;
}) {
  const existing = items.findIndex((i) => i.id === args.id);
  const item: QueueItem = {
    id: args.id,
    label: args.label,
    handlerKey: args.handlerKey,
    payload: args.payload,
    attempts: existing >= 0 ? items[existing].attempts : 0,
    lastError: null,
    enqueuedAt: existing >= 0 ? items[existing].enqueuedAt : Date.now(),
    lastTriedAt: null,
  };
  if (existing >= 0) items[existing] = item;
  else items.push(item);
  persist();
  notify();
  void runQueue();
}

export async function runQueue() {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    scheduleRetry(8000);
    return;
  }
  running = true;
  notify();
  try {
    for (const item of [...items]) {
      const handler = handlers.get(item.handlerKey);
      if (!handler) continue; // handler not registered yet (e.g. before mount)
      item.attempts += 1;
      item.lastTriedAt = Date.now();
      persist();
      notify();
      try {
        await handler(item.payload);
        items = items.filter((i) => i.id !== item.id);
        persist();
        notify();
      } catch (e: any) {
        item.lastError = (e?.message ?? String(e)).slice(0, 500);
        persist();
        notify();
        if (item.attempts >= STUCK_AFTER) {
          try {
            stuckListener?.(item);
          } catch {
            /* swallow */
          }
        }
      }
    }
  } finally {
    running = false;
    notify();
    if (items.length > 0) scheduleRetry(10_000);
  }
}

function scheduleRetry(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runQueue();
  }, ms);
}

export function clearStuckItem(id: string) {
  items = items.filter((i) => i.id !== id);
  persist();
  notify();
}

export function getQueueSnapshot() {
  return items.slice();
}

export function getAggregateStatus(): QueueStatus {
  if (items.length === 0) return "synced";
  if (running) return "syncing";
  if (items.some((i) => i.attempts >= STUCK_AFTER)) return "stuck";
  if (items.some((i) => i.attempts > 0)) return "failed";
  return "idle";
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void runQueue());
  // Kick once on import so any pending items from the previous session try ASAP.
  setTimeout(() => void runQueue(), 1500);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useQueueAggregateStatus(): {
  status: QueueStatus;
  pending: number;
  stuck: QueueItem[];
} {
  return useSyncExternalStore(
    subscribe,
    getAggregateSnapshot,
    () => SERVER_SNAPSHOT,
  );
}

export function retryAllNow() {
  // Reset attempt counters so stuck items get a fresh chance.
  items = items.map((i) => ({ ...i, attempts: 0, lastError: null }));
  persist();
  notify();
  void runQueue();
}