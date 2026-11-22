/**
 * A meal plan import's row, read with the person's own login (RLS: their own
 * rows only) and read again every few seconds while it's being read. Plain
 * state, not the query cache: an import's text can be large and its status
 * moves on the server, so it's never written to the phone's saved cache
 * (query-persister keeps everything in it on disk).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MealImportKind, MealImportResult, MealImportStatus, MealSourceKind } from "@/lib/nutrition-import/types";

export type MealImportRow = {
  id: string;
  kind: MealImportKind;
  audience: "member" | "staff";
  status: MealImportStatus;
  method: "parsed" | "ai" | null;
  source_kind: MealSourceKind;
  file_name: string | null;
  files_deleted_at: string | null;
  source_text: string | null;
  answers: any;
  result: MealImportResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, kind, audience, status, method, source_kind, file_name, files_deleted_at, source_text, answers, result, error, created_at, updated_at";

export const isRunning = (s: MealImportStatus | undefined | null) => s === "pending" || s === "reading";

/** One import (undefined while it loads, null when it isn't there). */
export function useMealImport(id: string | null) {
  const [row, setRow] = useState<MealImportRow | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: e } = await (supabase as any).from("nutrition_imports").select(COLUMNS).eq("id", id).maybeSingle();
    if (!alive.current) return;
    if (e) setError(true);
    else {
      setError(false);
      setRow((data ?? null) as MealImportRow | null);
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    setRow(undefined);
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // read again while it's being read, and on coming back to the app
  const running = isRunning(row?.status);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [running, load]);

  return { row, loading: row === undefined && !error, error, reload: load };
}

/** The person's latest import of a kind still open (being read, ready, or failed) in the last week, if any. */
export function useOpenMealImport(kind: MealImportKind, enabled = true) {
  // loading until a read has finished for this kind while enabled (never a stale "nothing" in between)
  const [found, setFound] = useState<{ kind: MealImportKind; id: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data } = await (supabase as any)
        .from("nutrition_imports")
        .select("id")
        .eq("kind", kind)
        .eq("audience", "member")
        .in("status", ["pending", "reading", "ready", "failed"])
        .gt("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (live) setFound({ kind, id: (data as Array<{ id: string }> | null)?.[0]?.id ?? null });
    })();
    return () => {
      live = false;
    };
  }, [kind, enabled]);
  const done = found?.kind === kind;
  return { id: done ? found!.id : null, loading: enabled && !done };
}
