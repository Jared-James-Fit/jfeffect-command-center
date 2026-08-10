import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

/**
 * Durable per-scope undo/redo for the program builder.
 *
 * - Persists history + future snapshot stacks to localStorage so a refresh
 *   preserves both stacks for the active template/block.
 * - Each scope (template id, block id) gets its own isolated stacks.
 * - A baseline marker (server `updated_at`) is stored alongside the stacks.
 *   When the saved baseline no longer matches the current server version,
 *   the stored history is dropped and the coach is notified — we never
 *   apply stale operations to a newer payload.
 * - Row-level editors (client programs) save rows individually, so the
 *   parent's `updated_at` never moves. For those, a `lastKnown` content
 *   fingerprint (JSON of the editor state at the last history write) is
 *   compared against the freshly hydrated state on load; any mismatch
 *   means the data moved on and the stored stacks are dropped. Without
 *   this, a weeks-old undo snapshot can be replayed onto newer rows and
 *   silently null out fields (RPE / RIR / percentages) added since.
 * - Schema-versioned. Any malformed / older data is discarded silently.
 * - Max 20 entries per stack. Snapshots are caller-provided JSON strings.
 *
 * The hook intentionally does NOT touch the active payload. The caller
 * owns the `payload` state and uses `pushSnapshot` / `undo` / `redo` to
 * coordinate transitions.
 */

const SCHEMA_VERSION = 1;
const MAX_STACK = 20;
const KEY_PREFIX = "lov.undo.v1";

type StoredShape = {
  v: number;
  baseline: string;
  history: string[];
  future: string[];
  lastKnown: string | null;
};

function storageKey(userId: string, scope: string) {
  return `${KEY_PREFIX}:${userId}:${scope}`;
}

function safeRead(key: string): StoredShape | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== SCHEMA_VERSION) return null;
    if (typeof parsed.baseline !== "string") return null;
    if (!Array.isArray(parsed.history) || !Array.isArray(parsed.future)) return null;
    if (!parsed.history.every((s: unknown) => typeof s === "string")) return null;
    if (!parsed.future.every((s: unknown) => typeof s === "string")) return null;
    return {
      v: parsed.v,
      baseline: parsed.baseline,
      history: parsed.history,
      future: parsed.future,
      lastKnown: typeof parsed.lastKnown === "string" ? parsed.lastKnown : null,
    };
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: StoredShape) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / serialization issue — silently drop. History is best-effort.
  }
}

function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

export type PersistentUndoStack = {
  canUndo: boolean;
  canRedo: boolean;
  historySize: number;
  futureSize: number;
  /** Record a snapshot of the payload *before* an edit, clearing redo.
   *  `current` is the post-edit JSON used as the content fingerprint. */
  pushSnapshot: (snapshot: string, current?: string) => void;
  /** Pop one history entry; caller must pass the *current* snapshot so it can be pushed onto redo. */
  undo: (currentSnapshot: string) => string | undefined;
  /** Pop one redo entry; caller must pass the *current* snapshot so it can be pushed onto history. */
  redo: (currentSnapshot: string) => string | undefined;
  /** Record the current state as the clean baseline without touching the
   *  stacks. Call after a successful save so the content fingerprint tracks
   *  server truth (including any ids attached during the save). */
  markClean: (currentSnapshot: string) => void;
  /** Clear both stacks and remove persisted entry. */
  clear: () => void;
};

/**
 * @param scope     Stable identifier for the editor scope (e.g. `tpl:<id>`, `block:<id>`).
 * @param baseline  Server-side version marker (e.g. `updated_at`). When this
 *                  differs from the persisted baseline the stored history is
 *                  discarded and the user is notified.
 * @param freshSnapshot  JSON of the just-hydrated editor state. Compared
 *                  against the stored `lastKnown` fingerprint — a mismatch
 *                  drops the stored history even when `baseline` matches.
 * @param enabled   Whether persistence is active (false until the editor has hydrated).
 */
export function usePersistentUndoStack(opts: {
  scope: string | null | undefined;
  baseline: string | null | undefined;
  freshSnapshot?: string | null;
  enabled: boolean;
}): PersistentUndoStack {
  const { scope, baseline, freshSnapshot = null, enabled } = opts;
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const lastKnownRef = useRef<string | null>(null);
  const [, bump] = useState(0);
  const hydratedScopeRef = useRef<string | null>(null);

  const key = userId && scope ? storageKey(userId, scope) : null;

  // Hydrate / re-hydrate whenever the scope or baseline changes. Stale data
  // is dropped and the coach gets a small notice so they understand why undo
  // is empty.
  useEffect(() => {
    if (!enabled || !key || !baseline) return;
    const stored = safeRead(key);
    const scopeSig = `${key}|${baseline}|${freshSnapshot ?? ""}`;
    if (hydratedScopeRef.current === scopeSig) return;

    if (!stored) {
      historyRef.current = [];
      futureRef.current = [];
      lastKnownRef.current = null;
    } else if (stored.baseline !== baseline) {
      // Server version moved on while we were away — do not replay stale ops.
      historyRef.current = [];
      futureRef.current = [];
      lastKnownRef.current = null;
      safeRemove(key);
      if (stored.history.length || stored.future.length) {
        toast("Undo history was reset", {
          description: "This program changed elsewhere since you last edited it.",
        });
      }
    } else if (stored.lastKnown != null && freshSnapshot != null && stored.lastKnown !== freshSnapshot) {
      // Version marker matches but the CONTENT doesn't — this happens for
      // row-level saves (client programs) where pl_blocks.updated_at never
      // bumps. The stored snapshots describe an older shape of the data;
      // replaying them would clobber newer field values, so drop them.
      historyRef.current = [];
      futureRef.current = [];
      lastKnownRef.current = null;
      safeRemove(key);
      if (stored.history.length || stored.future.length) {
        toast("Undo history was reset", {
          description: "This program changed since your last edit.",
        });
      }
    } else {
      historyRef.current = stored.history.slice(-MAX_STACK);
      futureRef.current = stored.future.slice(-MAX_STACK);
      lastKnownRef.current = stored.lastKnown;
    }
    hydratedScopeRef.current = scopeSig;
    bump((n) => n + 1);
  }, [enabled, key, baseline, freshSnapshot]);

  const flush = useCallback(() => {
    if (!key || !baseline) return;
    if (historyRef.current.length === 0 && futureRef.current.length === 0) {
      safeRemove(key);
      return;
    }
    safeWrite(key, {
      v: SCHEMA_VERSION,
      baseline,
      history: historyRef.current.slice(-MAX_STACK),
      future: futureRef.current.slice(-MAX_STACK),
      lastKnown: lastKnownRef.current,
    });
  }, [key, baseline]);

  const pushSnapshot = useCallback((snapshot: string, current?: string) => {
    lastKnownRef.current = current ?? snapshot;
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_STACK) {
      historyRef.current.splice(0, historyRef.current.length - MAX_STACK);
    }
    futureRef.current = [];
    flush();
    bump((n) => n + 1);
  }, [flush]);

  const undo = useCallback((currentSnapshot: string): string | undefined => {
    const prev = historyRef.current.pop();
    if (prev === undefined) return undefined;
    lastKnownRef.current = prev;
    futureRef.current.push(currentSnapshot);
    if (futureRef.current.length > MAX_STACK) {
      futureRef.current.splice(0, futureRef.current.length - MAX_STACK);
    }
    flush();
    bump((n) => n + 1);
    return prev;
  }, [flush]);

  const redo = useCallback((currentSnapshot: string): string | undefined => {
    const next = futureRef.current.pop();
    if (next === undefined) return undefined;
    lastKnownRef.current = next;
    historyRef.current.push(currentSnapshot);
    if (historyRef.current.length > MAX_STACK) {
      historyRef.current.splice(0, historyRef.current.length - MAX_STACK);
    }
    flush();
    bump((n) => n + 1);
    return next;
  }, [flush]);

  const markClean = useCallback((currentSnapshot: string) => {
    lastKnownRef.current = currentSnapshot;
    flush();
  }, [flush]);

  const clear = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
    lastKnownRef.current = null;
    if (key) safeRemove(key);
    bump((n) => n + 1);
  }, [key]);

  return {
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    historySize: historyRef.current.length,
    futureSize: futureRef.current.length,
    pushSnapshot,
    undo,
    redo,
    markClean,
    clear,
  };
}

/**
 * Imperatively drop persisted undo history for a scope. Useful when the
 * underlying template/block is deleted and we don't want orphaned entries.
 */
export function clearPersistentUndoFor(userId: string, scope: string) {
  safeRemove(storageKey(userId, scope));
}