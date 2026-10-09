import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type BodyweightUnit = "kg" | "lb";

const db = supabase as any;
const cacheKey = (userId: string) => `jf-bw-unit:${userId}`;
const readCache = (userId: string | null | undefined): BodyweightUnit | null => {
  if (!userId) return null;
  try { const v = localStorage.getItem(cacheKey(userId)); return v === "kg" || v === "lb" ? v : null; } catch { return null; }
};
const writeCache = (userId: string, unit: BodyweightUnit) => {
  try { localStorage.setItem(cacheKey(userId), unit); } catch { /* storage unavailable */ }
};

export const bodyweightUnitKey = (userId: string | null | undefined) => ["bodyweight-unit", userId ?? null] as const;

/** Saved choice first, then the unit they last logged in, then the page's default. */
export function resolveBodyweightUnit(saved: BodyweightUnit | null | undefined, lastLogged: string | null | undefined, fallback: BodyweightUnit): BodyweightUnit {
  if (saved) return saved;
  if (lastLogged === "kg" || lastLogged === "lb") return lastLogged;
  return fallback;
}

/**
 * The kg / lb toggle on the bodyweight cards, remembered on the account
 * (bodyweight_unit_prefs) every time it changes, separate from the lifting unit.
 * A small per-device copy paints the right unit instantly while the account loads.
 * A coach viewing as the client can flip it for the look but never saves it.
 */
export function useBodyweightUnit(userId: string | null | undefined, opts: { lastLogged?: string | null; fallback?: BodyweightUnit } = {}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const own = !!userId && userId === user?.id;
  const key = bodyweightUnitKey(userId);
  const { data: saved } = useQuery({
    queryKey: key,
    enabled: own,
    staleTime: 5 * 60_000,
    placeholderData: () => readCache(userId),
    queryFn: async (): Promise<BodyweightUnit | null> => {
      const { data, error } = await db.from("bodyweight_unit_prefs").select("unit").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      const u = data?.unit === "kg" || data?.unit === "lb" ? (data.unit as BodyweightUnit) : null;
      if (u && userId) writeCache(userId, u);
      return u ?? readCache(userId);
    },
  });
  const [local, setLocal] = useState<BodyweightUnit | null>(null);
  // a different person (e.g. switching accounts) starts from their own choice
  useEffect(() => setLocal(null), [userId]);

  const unit = local ?? resolveBodyweightUnit(saved, opts.lastLogged, opts.fallback ?? "lb");

  const setUnit = (next: BodyweightUnit) => {
    setLocal(next);
    if (!own || !userId) return;
    writeCache(userId, next);
    qc.setQueryData(key, next);
    void db
      .from("bodyweight_unit_prefs")
      .upsert({ user_id: userId, unit: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      .then(({ error }: { error: unknown }) => {
        if (error) toast.error("Couldn't save your unit. It'll stay for now.");
      });
  };

  return { unit, setUnit };
}

/** The unit of the most recent entry (by date), or null with no entries. */
export function latestLoggedUnit(rows: Array<{ date: string; unit: string | null | undefined }>): string | null {
  let best: { date: string; unit: string | null | undefined } | null = null;
  for (const r of rows) if (r.unit && (!best || r.date > best.date)) best = r;
  return best?.unit ?? null;
}
