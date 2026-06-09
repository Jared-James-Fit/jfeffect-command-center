import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type ChatGif = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  media_url: string;
  media_type: string;
  thumb_url: string | null;
  is_featured: boolean;
  active: boolean;
  archived: boolean;
  sort_order: number;
  created_at: string;
};

export const GIF_CATEGORIES = [
  "Hype", "PR / Wins", "Reviewed", "Support", "Celebration",
  "Funny", "Coach Reactions", "Gym Pain", "Cardio", "Food / Diet",
  "Excuses", "Deload / Dead", "Custom",
] as const;

export async function listGifs(): Promise<ChatGif[]> {
  const { data, error } = await db
    .from("chat_gifs")
    .select("*")
    .eq("active", true)
    .eq("archived", false)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChatGif[];
}

export async function listAllGifsAdmin(): Promise<ChatGif[]> {
  const { data, error } = await db
    .from("chat_gifs").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChatGif[];
}

export async function createGif(input: Partial<ChatGif>) {
  const { data, error } = await db.from("chat_gifs").insert({
    title: input.title,
    category: input.category,
    tags: input.tags ?? [],
    media_url: input.media_url,
    media_type: input.media_type ?? "image/gif",
    thumb_url: input.thumb_url ?? null,
    is_featured: !!input.is_featured,
    active: input.active ?? true,
    archived: false,
    sort_order: input.sort_order ?? 0,
  }).select().single();
  if (error) throw error;
  return data as ChatGif;
}

export async function updateGif(id: string, patch: Partial<ChatGif>) {
  const { error } = await db.from("chat_gifs").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteGif(id: string) {
  const { error } = await db.from("chat_gifs").delete().eq("id", id);
  if (error) throw error;
}

export async function listFavorites(userId: string) {
  const { data, error } = await db
    .from("chat_gif_favorites").select("gif_id").eq("user_id", userId);
  if (error) throw error;
  return new Set<string>((data ?? []).map((r: any) => r.gif_id));
}

export async function toggleFavorite(userId: string, gifId: string, currentlyFav: boolean) {
  if (currentlyFav) {
    const { error } = await db.from("chat_gif_favorites")
      .delete().eq("user_id", userId).eq("gif_id", gifId);
    if (error) throw error;
  } else {
    const { error } = await db.from("chat_gif_favorites")
      .upsert({ user_id: userId, gif_id: gifId }, { onConflict: "user_id,gif_id" });
    if (error) throw error;
  }
}

export async function listRecent(userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("chat_gif_recent").select("gif_id,used_at")
    .eq("user_id", userId)
    .order("used_at", { ascending: false })
    .limit(24);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.gif_id);
}

export async function markRecent(userId: string, gifId: string) {
  await db.from("chat_gif_recent").upsert(
    { user_id: userId, gif_id: gifId, used_at: new Date().toISOString() },
    { onConflict: "user_id,gif_id" },
  );
}