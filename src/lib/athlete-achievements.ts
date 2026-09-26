import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export type CatalogBadge = {
  badge_key: string;
  name: string;
  category: string;
  icon_key: string;
  rarity: Rarity;
  description: string;
  requirement: string;
  metric: string;
  threshold: number;
  sort_order: number;
  is_public: boolean;
};

export type EarnedBadge = { badge_key: string; earned_at: string };

/** Public badge as returned by get_athlete_public_badges — earned only. */
export type PublicBadge = Omit<CatalogBadge, "metric" | "threshold" | "sort_order" | "is_public"> & { earned_at: string };

export type AchievementMetrics = {
  workouts_completed: number;
  workouts_fully_logged: number;
  xp: number;
  days_since_first_workout: number;
};

export const RARITY_ORDER: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

export const RARITY_STYLE: Record<Rarity, { label: string; ring: string; text: string; glow: string }> = {
  common: { label: "Common", ring: "border-slate-400", text: "text-slate-700", glow: "bg-gradient-to-br from-slate-100 to-slate-300 shadow-sm" },
  rare: { label: "Rare", ring: "border-sky-500", text: "text-sky-700", glow: "bg-gradient-to-br from-sky-100 via-blue-200 to-cyan-300 shadow-md shadow-sky-500/25" },
  epic: { label: "Epic", ring: "border-violet-500", text: "text-violet-700", glow: "bg-gradient-to-br from-fuchsia-200 via-violet-300 to-indigo-400 shadow-md shadow-violet-500/30" },
  legendary: { label: "Legendary", ring: "border-amber-500", text: "text-amber-700", glow: "bg-gradient-to-br from-yellow-200 via-amber-300 to-orange-400 shadow-lg shadow-amber-500/35" },
};

const db = supabase as any;

export function useBadgeCatalog() {
  return useQuery({
    queryKey: ["athlete-badge-catalog"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("athlete_badge_catalog")
        .select("badge_key,name,category,icon_key,rarity,description,requirement,metric,threshold,sort_order,is_public")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as CatalogBadge[];
    },
  });
}

/** Own earned achievements (RLS: athletes read own rows). */
export function useMyAchievements(clientId: string) {
  return useQuery({
    queryKey: ["athlete-achievements", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("athlete_achievements")
        .select("badge_key,earned_at")
        .eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as EarnedBadge[];
    },
  });
}

/** Another athlete's PUBLIC EARNED badges only — never locked progress. */
export function usePublicAchievements(clientId: string) {
  return useQuery({
    queryKey: ["athlete-public-badges", clientId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_athlete_public_badges", { _client_id: clientId });
      if (error) throw error;
      return (data ?? []) as PublicBadge[];
    },
  });
}

export function featured<T extends { rarity: Rarity; earned_at?: string }>(list: T[], n = 3): T[] {
  return [...list]
    .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || (b.earned_at ?? "").localeCompare(a.earned_at ?? ""))
    .slice(0, n);
}

export function progressFor(badge: CatalogBadge, m: AchievementMetrics) {
  const value = Math.floor((m as any)[badge.metric] ?? 0);
  return { value: Math.min(value, badge.threshold), pct: Math.min(100, Math.round((value / badge.threshold) * 100)) };
}
