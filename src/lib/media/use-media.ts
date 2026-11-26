/**
 * Data for the GIF & sticker picker: live provider pages, the app's library
 * (as the fallback and for the coach's own picks), and a person's favourites
 * and recents. Nothing loads until the picker opens; pages load as you
 * scroll; identical requests share one call (React Query + the server cache).
 */
import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listGifs } from "@/lib/chat-gifs";
import {
  filterLibrary, fromLibrary, mergeUnique, MEDIA_CATEGORIES,
  type LibraryRow, type MediaItem, type MediaKind,
} from "@/lib/media/media";
import { browseMedia, registerMediaShare } from "@/lib/media/media.functions";

const db = supabase as any;

export const mediaKeys = {
  library: ["media-library"] as const,
  browse: (kind: MediaKind, q: string) => ["media-browse", kind, q] as const,
  saved: (userId: string | undefined) => ["media-saved", userId] as const,
};

/** The app's own library (one small table, cached for the session). */
export function useMediaLibrary(enabled: boolean) {
  return useQuery({
    queryKey: mediaKeys.library,
    queryFn: async () => (await listGifs()) as unknown as LibraryRow[],
    enabled,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
}

/**
 * Trending (q = "") or a search, paged. When the provider isn't available
 * (no key, outage, rate limit) the library answers instead, so the picker is
 * never empty.
 */
export function useMediaBrowse(kind: MediaKind, q: string, category: string | null, enabled: boolean) {
  const fetchPage = useServerFn(browseMedia);
  const query = (category ? MEDIA_CATEGORIES.find((c) => c.label === category)?.q ?? category : q).trim();
  const library = useMediaLibrary(enabled);
  const live = useInfiniteQuery({
    queryKey: mediaKeys.browse(kind, query.toLowerCase()),
    enabled,
    initialPageParam: 1,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async ({ pageParam }) => {
      const r = await fetchPage({ data: { kind, q: query, page: pageParam } });
      return r as { items: MediaItem[]; hasNext: boolean; available: boolean };
    },
    getNextPageParam: (last, all) => (last.available && last.hasNext && all.length < 20 ? all.length + 1 : undefined),
  });
  const available = live.data ? live.data.pages[0]?.available !== false : !live.isError;
  const items = useMemo(() => {
    const rows = library.data ?? [];
    // the coach's own library leads a matching category / search; on Trending only the featured picks do
    const matched = filterLibrary(rows, kind, category ? "" : q, category);
    const mine = (q.trim() || category ? matched : matched.filter((r) => r.is_featured)).map(fromLibrary);
    const remote = available ? (live.data?.pages ?? []).map((p) => p.items) : [];
    // without the provider: the whole library of this kind for trending
    const fallback = !available && !q.trim() && !category ? filterLibrary(rows, kind, "", null).map(fromLibrary) : [];
    return mergeUnique([mine, remote.flat(), fallback]);
  }, [library.data, live.data, available, kind, q, category]);
  return {
    items,
    available,
    loading: (enabled && live.isLoading) || library.isLoading,
    hasMore: !!live.hasNextPage,
    loadingMore: live.isFetchingNextPage,
    loadMore: () => { if (live.hasNextPage && !live.isFetchingNextPage) void live.fetchNextPage(); },
    error: live.isError && library.isError,
  };
}

type SavedRow = { ref: string; kind: MediaKind; item: MediaItem; is_favorite: boolean; last_used_at: string | null; favorited_at: string | null };

/** A person's favourites and recents, both kinds, in one small read. */
export function useSavedMedia(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: mediaKeys.saved(userId),
    enabled: enabled && !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<SavedRow[]> => {
      const { data, error } = await db
        .from("user_media_saved")
        .select("ref, kind, item, is_favorite, last_used_at, favorited_at")
        .eq("user_id", userId)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(150);
      if (error) throw error;
      return (data ?? []) as SavedRow[];
    },
  });
}

export function splitSaved(rows: SavedRow[] | undefined, kind: MediaKind) {
  const mine = (rows ?? []).filter((r) => r.kind === kind && r.item?.url);
  return {
    recent: mine.filter((r) => r.last_used_at).map((r) => r.item),
    favorites: mine
      .filter((r) => r.is_favorite)
      .sort((a, b) => (b.favorited_at ?? "").localeCompare(a.favorited_at ?? ""))
      .map((r) => r.item),
    favoriteRefs: new Set(mine.filter((r) => r.is_favorite).map((r) => r.ref)),
  };
}

const slim = (m: MediaItem): MediaItem => ({ ...m, blur: null });

/** Star / unstar and "used just now": instant on screen, synced in the background. */
export function useSavedMediaActions(userId: string | undefined) {
  const qc = useQueryClient();
  const share = useServerFn(registerMediaShare);
  const key = mediaKeys.saved(userId);

  const patch = useCallback((fn: (rows: SavedRow[]) => SavedRow[]) => {
    qc.setQueryData<SavedRow[]>(key, (old) => fn(old ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, userId]);

  const toggleFavorite = useMutation({
    mutationFn: async ({ item, on }: { item: MediaItem; on: boolean }) => {
      const now = new Date().toISOString();
      const { error } = await db.from("user_media_saved").upsert(
        { user_id: userId, ref: item.ref, kind: item.kind, item: slim(item), is_favorite: on, favorited_at: on ? now : null },
        { onConflict: "user_id,ref" },
      );
      if (error) throw error;
    },
    onMutate: ({ item, on }) => {
      const now = new Date().toISOString();
      patch((rows) => {
        const has = rows.some((r) => r.ref === item.ref);
        const next = rows.map((r) => (r.ref === item.ref ? { ...r, is_favorite: on, favorited_at: on ? now : null } : r));
        return has ? next : [{ ref: item.ref, kind: item.kind, item, is_favorite: on, favorited_at: on ? now : null, last_used_at: null }, ...next];
      });
    },
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });

  const markUsed = useCallback(async (item: MediaItem, q = "") => {
    if (!userId) return;
    const now = new Date().toISOString();
    patch((rows) => {
      const old = rows.find((r) => r.ref === item.ref);
      const row: SavedRow = { ref: item.ref, kind: item.kind, item, is_favorite: old?.is_favorite ?? false, favorited_at: old?.favorited_at ?? null, last_used_at: now };
      return [row, ...rows.filter((r) => r.ref !== item.ref)];
    });
    try {
      const old = (qc.getQueryData<SavedRow[]>(key) ?? []).find((r) => r.ref === item.ref);
      await db.from("user_media_saved").upsert(
        { user_id: userId, ref: item.ref, kind: item.kind, item: slim(item), last_used_at: now, is_favorite: old?.is_favorite ?? false, favorited_at: old?.favorited_at ?? null },
        { onConflict: "user_id,ref" },
      );
    } catch { /* recents are a convenience */ }
    if (item.provider === "klipy") void share({ data: { kind: item.kind, slug: item.providerId, q } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, patch, share, qc]);

  return { toggleFavorite: (item: MediaItem, on: boolean) => toggleFavorite.mutate({ item, on }), markUsed };
}
