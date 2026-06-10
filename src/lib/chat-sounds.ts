import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type ChatSound = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  media_url: string;
  mime: string;
  duration_ms: number | null;
  is_featured: boolean;
  active: boolean;
  archived: boolean;
  sort_order: number;
  created_at: string;
};

export const SOUND_CATEGORIES = [
  "Hype", "PR / Wins", "Funny", "Coach Reactions",
  "Cardio", "Gym Pain", "Celebration", "Support",
] as const;

export const SOUND_BUCKET = "chat-sounds";

export async function listSounds(): Promise<ChatSound[]> {
  const { data, error } = await db
    .from("chat_sounds").select("*")
    .eq("active", true).eq("archived", false)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChatSound[];
}

export async function listAllSoundsAdmin(): Promise<ChatSound[]> {
  const { data, error } = await db
    .from("chat_sounds").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChatSound[];
}

export async function createSound(input: Partial<ChatSound>) {
  const { data, error } = await db.from("chat_sounds").insert({
    title: input.title,
    category: input.category,
    tags: input.tags ?? [],
    media_url: input.media_url,
    mime: input.mime ?? "audio/mpeg",
    duration_ms: input.duration_ms ?? null,
    is_featured: !!input.is_featured,
    active: input.active ?? true,
    archived: false,
    sort_order: input.sort_order ?? 0,
  }).select().single();
  if (error) throw error;
  return data as ChatSound;
}

export async function updateSound(id: string, patch: Partial<ChatSound>) {
  const { error } = await db.from("chat_sounds").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteSound(id: string) {
  const { error } = await db.from("chat_sounds").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadSoundFile(file: File): Promise<{ url: string; mime: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
  const path = `library/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(SOUND_BUCKET).upload(path, file, {
    contentType: file.type || "audio/mpeg",
    upsert: false,
  });
  if (error) throw error;
  const { data: signed, error: sErr } = await db.storage
    .from(SOUND_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (sErr) throw sErr;
  return { url: signed.signedUrl, mime: file.type || "audio/mpeg" };
}

export async function listFavorites(userId: string) {
  const { data, error } = await db
    .from("chat_sound_favorites").select("sound_id").eq("user_id", userId);
  if (error) throw error;
  return new Set<string>((data ?? []).map((r: any) => r.sound_id));
}

export async function toggleFavorite(userId: string, soundId: string, currentlyFav: boolean) {
  if (currentlyFav) {
    const { error } = await db.from("chat_sound_favorites")
      .delete().eq("user_id", userId).eq("sound_id", soundId);
    if (error) throw error;
  } else {
    const { error } = await db.from("chat_sound_favorites")
      .upsert({ user_id: userId, sound_id: soundId }, { onConflict: "user_id,sound_id" });
    if (error) throw error;
  }
}

export async function listRecent(userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("chat_sound_recent").select("sound_id,used_at")
    .eq("user_id", userId).order("used_at", { ascending: false }).limit(24);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.sound_id);
}

export async function markRecent(userId: string, soundId: string) {
  await db.from("chat_sound_recent").upsert(
    { user_id: userId, sound_id: soundId, used_at: new Date().toISOString() },
    { onConflict: "user_id,sound_id" },
  );
}