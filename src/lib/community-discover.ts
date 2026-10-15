import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CommunityAuthor } from "@/lib/community";

/**
 * Finding athletes in the Crew: search by name or @username, and suggestions
 * that say why they're there. Everything comes from the server
 * (community_people_search / community_suggestions), which already leaves out
 * you, people you've blocked or who blocked you, and people who turned off
 * "Suggest my account" (unless you're connected).
 */
const db = supabase as any;

/** What people can say they train (up to 3), shown on their profile and used to suggest people. */
export const DISCIPLINES = [
  { key: "powerlifting", label: "Powerlifting" },
  { key: "bodybuilding", label: "Bodybuilding" },
  { key: "strength", label: "Strength" },
  { key: "glutes", label: "Glute training" },
  { key: "fitness", label: "General fitness" },
] as const;
export type Discipline = (typeof DISCIPLINES)[number]["key"];
export const MAX_DISCIPLINES = 3;
/** 3–24 lowercase letters, numbers, dots or underscores; not starting or ending with . or _, no "..". (No lookbehind: older iPhones can't parse it.) */
export function isValidUsername(u: string): boolean {
  return /^[a-z0-9._]{3,24}$/.test(u) && !/^[._]|[._]$|\.\./.test(u);
}

export function disciplineLabel(key: string): string {
  return DISCIPLINES.find((d) => d.key === key)?.label ?? key;
}

export type SuggestionReason =
  | { kind: "coach" }
  | { kind: "coach_any" }
  | { kind: "follows_you" }
  | { kind: "followed_by"; names?: string[]; count?: number }
  | { kind: "gym"; label?: string | null }
  | { kind: "new" }
  | { kind: "discipline"; label?: string | null }
  | { kind: "interacts" }
  | { kind: "popular" }
  | { kind: "active" }
  | { kind: "crew" };

export type DiscoverPerson = CommunityAuthor & {
  username?: string | null;
  is_private?: boolean;
  disciplines?: string[];
  follows_you?: boolean;
  reason?: SuggestionReason;
};

/** The one line under a suggested person: why they're here. */
export function reasonLabel(r: SuggestionReason | undefined): string {
  if (!r) return "In the Crew";
  switch (r.kind) {
    case "coach":
      return "Your coach";
    case "coach_any":
      return "Coach";
    case "follows_you":
      return "Follows you";
    case "followed_by": {
      const names = (r.names ?? []).filter(Boolean);
      const count = Math.max(r.count ?? names.length, names.length);
      if (!names.length) return "Followed by people you follow";
      const more = count - 1;
      return more > 0 ? `Followed by ${names[0]} + ${more} more` : `Followed by ${names[0]}`;
    }
    case "gym":
      return r.label ? `Trains at ${r.label}` : "Same gym";
    case "new":
      return "New to the Crew";
    case "discipline":
      return r.label ? `Also into ${disciplineLabel(r.label).toLowerCase()}` : "Trains like you";
    case "interacts":
      return "You interact";
    case "popular":
      return "Popular in Crew";
    case "active":
      return "Active this week";
    default:
      return "In the Crew";
  }
}

/** Reasons worth a card in the feed. Weaker ones ("active this week") stay in Find athletes. */
export function isStrongReason(r: SuggestionReason | undefined): boolean {
  return !!r && ["coach", "follows_you", "followed_by", "gym", "new", "discipline"].includes(r.kind);
}

export const discoverKeys = {
  suggestions: (context: string | null) => ["community-suggestions", context ?? "all"] as const,
  search: (q: string) => ["community-people-search", q] as const,
  gyms: (q: string) => ["community-gym-names", q] as const,
};

/** People to follow, best first. With a context person: people close to them (after you follow someone). */
export function useSuggestions(context: string | null = null, enabled = true, limit = 12) {
  return useQuery({
    queryKey: [...discoverKeys.suggestions(context), limit],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DiscoverPerson[]> => {
      const { data, error } = await db.rpc("community_suggestions", { _context: context, _limit: limit });
      if (error) throw error;
      return (data ?? []) as DiscoverPerson[];
    },
  });
}

/** The search box's query, trimmed and without a leading @ (what the server matches). */
export function searchTerm(q: string): string {
  return q.trim().replace(/^@+/, "").trim().toLowerCase().slice(0, 40);
}

export function usePeopleSearch(q: string) {
  const term = searchTerm(q);
  return useQuery({
    queryKey: discoverKeys.search(term),
    enabled: term.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<DiscoverPerson[]> => {
      const { data, error } = await db.rpc("community_people_search", { _q: term, _limit: 20 });
      if (error) throw error;
      return (data ?? []) as DiscoverPerson[];
    },
  });
}

/** "Not for me": that person stops being suggested (they're still findable by search). */
export function useHideSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await db.rpc("community_hide_suggestion", { _user_id: userId, _hidden: true });
      if (error) throw error;
    },
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: ["community-suggestions"] });
      const before = qc.getQueriesData<DiscoverPerson[]>({ queryKey: ["community-suggestions"] });
      qc.setQueriesData<DiscoverPerson[]>({ queryKey: ["community-suggestions"] }, (old) => old?.filter((p) => p.user_id !== userId));
      return { before };
    },
    onError: (_e, _v, ctx) => ctx?.before.forEach(([key, data]) => qc.setQueryData(key, data)),
  });
}

export type MyCommunitySettings = {
  auto_share_workouts: boolean;
  private_views: boolean;
  discoverable?: boolean;
  username?: string | null;
  disciplines?: string[];
  home_gym?: string | null;
};

/** Is this username free (and allowed)? Checked as they type. */
export function useUsernameCheck(username: string, enabled: boolean) {
  const u = username.trim().replace(/^@+/, "").toLowerCase();
  return useQuery({
    queryKey: ["community-username-check", u],
    enabled: enabled && isValidUsername(u),
    staleTime: 15_000,
    queryFn: async (): Promise<{ ok: boolean; reason?: "format" | "reserved" | "taken"; username: string }> => {
      const { data, error } = await db.rpc("community_username_check", { _username: u });
      if (error) throw error;
      return data;
    },
  });
}

function useProfileSave<V>(rpc: (v: V) => PromiseLike<{ data: any; error: any }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      const { data, error } = await rpc(v);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community-my-settings"] });
      qc.invalidateQueries({ queryKey: ["community-profile"] });
      qc.invalidateQueries({ queryKey: ["community-members"] });
      qc.invalidateQueries({ queryKey: ["community-suggestions"] });
    },
  });
}

export function useSetUsername() {
  return useProfileSave((username: string) => db.rpc("community_set_username", { _username: username }));
}

export function useSetTraining() {
  return useProfileSave(({ disciplines, homeGym }: { disciplines: string[]; homeGym: string | null }) =>
    db.rpc("community_set_training", { _disciplines: disciplines, _home_gym: homeGym }),
  );
}

export function useSetDiscoverable() {
  return useProfileSave((on: boolean) => db.rpc("community_set_discoverable", { _on: on }));
}

/** Gyms already on people's profiles, so the same gym gets typed the same way. */
export function useGymNames(q: string, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: discoverKeys.gyms(term.toLowerCase()),
    enabled: enabled && term.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db.rpc("community_gym_names", { _q: term });
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
}

/** Opens Find athletes from anywhere in the app (the coach's Crew header does). */
export const OPEN_DISCOVER_EVENT = "community:open-discover";
export function openCommunityDiscover() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_DISCOVER_EVENT));
}

/** "Followed by Nicole", "Followed by Nicole and Vicky", "Followed by Nicole, Vicky + 3 more" (people you follow). */
export function followedByLabel(f: { count: number; names: string[] } | null | undefined): string | null {
  if (!f || !f.count) return null;
  const names = f.names.filter(Boolean).slice(0, 2);
  if (!names.length) return `Followed by ${f.count} ${f.count === 1 ? "person" : "people"} you follow`;
  const rest = f.count - names.length;
  if (rest <= 0) return `Followed by ${names.join(" and ")}`;
  return `Followed by ${names.join(", ")} + ${rest} more`;
}
