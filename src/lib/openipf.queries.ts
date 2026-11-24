/**
 * OpenIPF reads and actions from the app, with the signed-in coach's own login:
 * the suggestions their RLS shows (an admin all, a coach their own clients'),
 * and the database's functions, which check who's asking themselves
 * (20270525090000_openipf_discovery.sql).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OpenIpfSuggestion } from "@/lib/openipf";

const db = supabase as any;
const RECENT_DAYS = 30;

export const OPENIPF_KEY = ["openipf-suggestions"] as const;
export const openipfStatusKey = (clientId: string) => ["openipf-status", clientId] as const;

/** What's waiting, plus what was decided in the last 30 days (for Undo). */
export function useOpenIpfSuggestions(enabled = true) {
  return useQuery({
    queryKey: OPENIPF_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<OpenIpfSuggestion[]> => {
      const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
      const { data, error } = await db
        .from("openipf_suggestions")
        .select("*")
        .or(`status.eq.pending,decided_at.gte.${since}`)
        .neq("status", "expired")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        // before the migration is applied there's simply nothing to show
        if (/openipf_suggestions/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "")) return [];
        throw error;
      }
      return (data ?? []) as OpenIpfSuggestion[];
    },
  });
}

export type OpenIpfStatus = {
  eligible: boolean;
  athlete_id: string | null;
  url: string | null;
  linked: boolean;
  meet_count: number;
  last_meet: string | null;
  synced_at: string | null;
  sync_status: string | null;
  pending: number;
  history: { id: string; url: string; removed_at: string; meet_count: number }[];
};

export function useOpenIpfStatus(clientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: openipfStatusKey(clientId ?? ""),
    enabled: !!clientId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<OpenIpfStatus | null> => {
      const { data, error } = await db.rpc("openipf_status", { _client: clientId, _athlete: null });
      if (error) {
        if (/openipf_status/.test(error.message ?? "") && /could not find|does not exist/i.test(error.message ?? "")) return null;
        throw error;
      }
      return data as OpenIpfStatus;
    },
  });
}

/** Everything a decision can change on screen. */
function useRefresh() {
  const qc = useQueryClient();
  return (clientId?: string | null) => {
    void qc.invalidateQueries({ queryKey: OPENIPF_KEY });
    void qc.invalidateQueries({ queryKey: ["openipf-status"] });
    void qc.invalidateQueries({ queryKey: ["openipf-meets"] });
    if (clientId) {
      void qc.invalidateQueries({ queryKey: ["competition-data", clientId] });
      void qc.invalidateQueries({ queryKey: ["client", clientId] });
    }
    void qc.invalidateQueries({ queryKey: ["strength-board"] });
    void qc.invalidateQueries({ queryKey: ["powerlifting-career"] });
  };
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message || "Something went wrong");
  return data as T;
}

export function useDecideOpenIpf() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; action: "approve" | "dismiss" | "undo"; clientId?: string | null }) =>
      rpc<{ status: string; athlete_id?: string }>("openipf_decide", { _suggestion: v.id, _action: v.action }),
    onSettled: (_d, _e, v) => refresh(v.clientId),
  });
}

export function useOpenIpfLink() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { clientId: string | null; athleteId?: string | null; url: string }) =>
      rpc("openipf_link_url", { _client: v.clientId, _athlete: v.athleteId ?? null, _url: v.url.trim() }),
    onSettled: (_d, _e, v) => refresh(v.clientId),
  });
}

export function useOpenIpfRemove() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { athleteId: string; clientId?: string | null }) => rpc<string>("openipf_unlink", { _athlete: v.athleteId }),
    onSettled: (_d, _e, v) => refresh(v.clientId),
  });
}

export function useOpenIpfRestore() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { historyId: string; clientId?: string | null }) => rpc("openipf_restore", { _history: v.historyId }),
    onSettled: (_d, _e, v) => refresh(v.clientId),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long a search from the profile waits for OpenIPF before saying it's still going. */
export const FIND_WAIT_MS = 45_000;

/**
 * Search OpenIPF for one client now: the database sends the requests and reads
 * the answers as it's polled. Resolves with what it found (ids), or `done:
 * false` when it's still going after FIND_WAIT_MS (the tick finishes it).
 */
export async function findOnOpenIpf(clientId: string, onProgress?: () => void): Promise<{ done: boolean; suggestions: string[] }> {
  const scan = await rpc<string>("openipf_scan_start", { _client: clientId, _athlete: null });
  const until = Date.now() + FIND_WAIT_MS;
  let last: { done: boolean; suggestions: string[] } = { done: false, suggestions: [] };
  while (Date.now() < until) {
    await sleep(1200);
    last = await rpc("openipf_scan_step", { _scan: scan });
    onProgress?.();
    if (last.done) break;
  }
  return last;
}
