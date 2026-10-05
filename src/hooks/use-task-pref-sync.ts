import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { watchTasksRealtime } from "@/lib/tasks-realtime";
import { canonical, reconcilePref } from "@/lib/task-prefs-sync";
import { isMissingTableError, type TaskSyncScope } from "@/lib/task-notes-api";

// Untyped handle: the generated types learn this table after the migration.
const prefs = () => supabase.from("task_preferences" as never) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Mirrors one small Task Manager setting (stored as JSON in localStorage under
 * `storageKey`) to the `task_preferences` table so every device shows the same.
 * localStorage stays the source of truth for "what changed on this device",
 * so edits made elsewhere in the app (e.g. the Popups settings page) count too.
 * If the table isn't there yet, it quietly does nothing.
 */
export function useTaskPrefSync<T>(args: {
  scope: TaskSyncScope;
  field: "assignees" | "quadrant_styles";
  storageKey: string;
  /** Changes whenever the local value does — triggers an upload check. */
  value: unknown;
  merge: (local: T, remote: T) => T;
  /** Called when a value from another device should replace this device's state. */
  onAdopt: (next: T) => void;
}) {
  const { scope, field, storageKey, value, merge } = args;
  const baseKey = `${storageKey}__sync-base`;
  const onAdopt = useRef(args.onAdopt);
  onAdopt.current = args.onAdopt;
  const mergeRef = useRef(merge);
  mergeRef.current = merge;
  const chain = useRef<Promise<void>>(Promise.resolve());
  const disabled = useRef(false);

  const run = useCallback((): Promise<void> => {
    chain.current = chain.current.then(async () => {
      if (disabled.current) return;
      try {
        const { data, error } = await prefs().select(field).eq("scope", scope).maybeSingle();
        if (error) throw error;
        const remote = ((data as Record<string, T | null> | null)?.[field] ?? null) as T | null;
        let local: T | undefined;
        try {
          const raw = localStorage.getItem(storageKey);
          local = raw == null ? undefined : (JSON.parse(raw) as T);
        } catch { local = undefined; }
        let base: string | null = null;
        try { base = localStorage.getItem(baseKey); } catch { /* best-effort */ }

        const d = reconcilePref<T>({ local, remote, base, merge: (l, r) => mergeRef.current(l, r) });
        if (d.next === undefined) return;
        if (d.adopt) {
          try { localStorage.setItem(storageKey, JSON.stringify(d.next)); } catch { /* best-effort */ }
          onAdopt.current(d.next);
        }
        if (d.push) {
          const { data: s } = await supabase.auth.getSession();
          const uid = s.session?.user.id;
          if (!uid) return;
          const { error: e2 } = await prefs().upsert({ owner_id: uid, scope, [field]: d.next }, { onConflict: "owner_id,scope" });
          if (e2) throw e2;
        }
        try { localStorage.setItem(baseKey, canonical(d.next)); } catch { /* best-effort */ }
      } catch (e) {
        if (isMissingTableError(e)) disabled.current = true;
        // Anything else (offline…): the next change / resume tries again.
      }
    });
    return chain.current;
  }, [scope, field, storageKey, baseKey]);

  // Check shortly after mount and whenever the local value changes.
  useEffect(() => {
    const t = window.setTimeout(() => { void run(); }, 600);
    return () => window.clearTimeout(t);
  }, [value, run]);

  // Pick up changes from other devices, and re-check when the app resumes.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      await run();
      if (cancelled || disabled.current) return;
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (cancelled || !uid) return;
      stop = watchTasksRealtime({
        client: supabase,
        name: `${storageKey}-prefs-sync`,
        table: "task_preferences",
        filter: `owner_id=eq.${uid}`,
        onChange: () => { void run(); },
      });
    })();
    return () => { cancelled = true; stop?.(); };
  }, [run, storageKey]);
}
