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
    return parsed as StoredShape;
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
  /** Record a snapshot of the payload *before* an edit, clearing redo. */
  pushSnapshot: (snapshot: string) => void;
  /** Pop one history entry; caller must pass the *current* snapshot so it can be pushed onto redo. */
  undo: (currentSnapshot: string) => string | undefined;
  /** Pop one redo entry; caller must pass the *current* snapshot so it can be pushed onto history. */
  redo: (currentSnapshot: string) => string | undefined;
  /** Clear both stacks and remove persisted entry. */
  clear: () => void;
};

/**
 * @param scope     Stable identifier for the editor scope (e.g. `tpl:<id>`, `block:<id>`).
 * @param baseline  Server-side version marker (e.g. `updated_at`). When this
 *                  differs from the persisted baseline the stored history is
 *                  discarded and the user is notified.
 * @param enabled   Whether persistence is active (false until the editor has hydrated).
 */
export function usePersistentUndoStack(opts: {
  scope: string | null | undefined;
  baseline: string | null | undefined;
  enabled: boolean;
}): PersistentUndoStack {
  const { scope, baseline, enabled } = opts;
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const [, bump] = useState(0);
  const hydratedScopeRef = useRef<string | null>(null);

  const key = userId && scope ? storageKey(userId, scope) : null;

  // Hydrate / re-hydrate whenever the scope or baseline changes. Stale data
  // is dropped and the coach gets a small notice so they understand why undo
  // is empty.
  useEffect(() => {
    if (!enabled || !key || !baseline) return;
    const stored = safeRead(key);
    const scopeSig = `${key}|${baseline}`;
    if (hydratedScopeRef.current === scopeSig) return;

    if (!stored) {
      historyRef.current = [];
      futureRef.current = [];
    } else if (stored.baseline !== baseline) {
      // Server version moved on while we were away — do not replay stale ops.
      historyRef.current = [];
      futureRef.current = [];
      safeRemove(key);
      if (stored.history.length || stored.future.length) {
        toast("Undo history was reset", {
          description: "This program changed elsewhere since you last edited it.",
        });
      }
    } else {
      historyRef.current = stored.history.slice(-MAX_STACK);
      futureRef.current = stored.future.slice(-MAX_STACK);
    }
    hydratedScopeRef.current = scopeSig;
    bump((n) => n + 1);
  }, [enabled, key, baseline]);

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
    });
  }, [key, baseline]);

  const pushSnapshot = useCallback((snapshot: string) => {
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
    historyRef.current.push(currentSnapshot);
    if (historyRef.current.length > MAX_STACK) {
      historyRef.current.splice(0, historyRef.current.length - MAX_STACK);
    }
    flush();
    bump((n) => n + 1);
    return next;
  }, [flush]);

  const clear = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
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