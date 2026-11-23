/**
 * Starred clients (Nov 23 2026): each coach's or admin's own short list of the
 * athletes they keep coming back to, saved on their account
 * (`staff_client_stars`, own rows only; a coach can star only their own
 * clients), so it's the same on every device and session.
 *
 * Read once per login and shared: the Clients list (the star on each row, the
 * Starred filter, Starred first) and the workout quick view's switcher. The
 * client's name and photo come with it (the clients join, so RLS decides: a
 * star on a client the login can no longer see is left out).
 *
 * Until the migration is applied the table isn't there: `available` is false
 * and the stars simply don't show.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { feedback } from "@/lib/feedback";

export type StarredClient = {
  id: string;
  full_name: string | null;
  profile_picture_url: string | null;
  starred_at: string;
};

export const clientStarsKey = (userId: string | null | undefined) => ["client-stars", userId ?? "none"] as const;

/** The table not being there yet (PostgREST's "not in the schema cache", Postgres's "does not exist"). */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /could not find the table|does not exist|schema cache/i.test(error.message ?? "");
}

type StarsData = { available: boolean; list: StarredClient[] };

/** By name, so the switcher reads the same every time; a client with no name last. */
export function sortStarred(list: StarredClient[]): StarredClient[] {
  return [...list].sort((a, b) => {
    const an = (a.full_name ?? "").trim();
    const bn = (b.full_name ?? "").trim();
    if (!an !== !bn) return an ? -1 : 1;
    return an.localeCompare(bn, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  });
}

async function readStars(): Promise<StarsData> {
  const { data, error } = await (supabase as any)
    .from("staff_client_stars")
    .select("client_id, created_at, client:clients(id, full_name, profile_picture_url)")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    if (isMissingTable(error)) return { available: false, list: [] };
    throw new Error(error.message);
  }
  const list: StarredClient[] = [];
  for (const r of (data ?? []) as any[]) {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    // a client this login can't see any more (reassigned, deleted): left out
    if (!c?.id) continue;
    list.push({ id: c.id, full_name: c.full_name ?? null, profile_picture_url: c.profile_picture_url ?? null, starred_at: r.created_at });
  }
  return { available: true, list: sortStarred(list) };
}

/**
 * The signed-in person's stars. `canStar` is staff who can act (never a
 * view-only login); `toggle` is optimistic and puts it back if the save fails.
 */
export function useClientStars() {
  const { user, role, viewOnly } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const key = clientStarsKey(userId);
  const staff = role === "admin" || role === "coach";
  const query = useQuery({
    queryKey: key,
    enabled: !!userId && staff,
    queryFn: readStars,
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  const data = query.data;
  const list = useMemo(() => data?.list ?? [], [data]);
  const ids = useMemo(() => new Set(list.map((s) => s.id)), [list]);

  const mutation = useMutation({
    mutationFn: async ({ client, on }: { client: Omit<StarredClient, "starred_at">; on: boolean }) => {
      if (!userId) throw new Error("Not signed in");
      const t = (supabase as any).from("staff_client_stars");
      const { error } = on
        ? await t.upsert({ user_id: userId, client_id: client.id }, { onConflict: "user_id,client_id", ignoreDuplicates: true })
        : await t.delete().eq("user_id", userId).eq("client_id", client.id);
      if (error) throw new Error(isMissingTable(error) ? "Stars aren't set up yet" : error.message);
    },
    onMutate: async ({ client, on }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<StarsData>(key);
      qc.setQueryData<StarsData>(key, (prev) => {
        const cur = prev?.list ?? [];
        const next = on
          ? cur.some((s) => s.id === client.id)
            ? cur
            : sortStarred([...cur, { ...client, starred_at: new Date().toISOString() }])
          : cur.filter((s) => s.id !== client.id);
        return { available: prev?.available ?? true, list: next };
      });
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast.error(e instanceof Error ? e.message : "Couldn't save the star");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const toggle = useCallback(
    (client: Omit<StarredClient, "starred_at">) => {
      const on = !ids.has(client.id);
      feedback("save");
      mutation.mutate({ client, on });
    },
    [ids, mutation],
  );

  return {
    /** Starred clients by name. */
    list,
    ids,
    isStarred: (id: string) => ids.has(id),
    toggle,
    /** Staff who can star (never a view-only login), once the table is there. */
    canStar: staff && !viewOnly && !!userId && data?.available !== false,
    /** The table exists (false until the migration is applied). */
    available: data?.available !== false,
    loaded: query.isSuccess,
  };
}
