import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type RecipeStatus = "Draft" | "Published" | "Archived";
export type RecipeAccessScope =
  | "everyone"
  | "coaching_clients"
  | "app_members"
  | "program_members"
  | "selected_clients"
  | "hidden";

export type Recipe = {
  id: string;
  title: string;
  category: string;
  status: RecipeStatus;
  access_scope: RecipeAccessScope;
  body: string;
  video_url: string | null;
  tags: string[];
  author_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export const RECIPE_ACCESS_LABELS: Record<RecipeAccessScope, string> = {
  everyone: "Everyone",
  coaching_clients: "All Active Coaching Clients",
  app_members: "App Members",
  program_members: "Program-Only Members",
  selected_clients: "Selected Clients",
  hidden: "Hidden / Draft",
};

export async function listRecipesAdmin() {
  const { data, error } = await db
    .from("recipes")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Recipe[];
}

export async function listRecipesForViewer() {
  // RLS filters by visibility; we additionally enforce Published.
  const { data, error } = await db
    .from("recipes")
    .select("*")
    .eq("status", "Published")
    .order("published_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Recipe[];
}

export async function getRecipe(id: string) {
  const { data, error } = await db.from("recipes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Recipe | null;
}

export async function createRecipe(input: Partial<Recipe> & { title: string; authorId?: string }) {
  const { data, error } = await db
    .from("recipes")
    .insert({
      title: input.title,
      category: input.category ?? "Breakfast",
      status: input.status ?? "Draft",
      access_scope: input.access_scope ?? "hidden",
      body: input.body ?? "",
      video_url: input.video_url ?? null,
      tags: input.tags ?? [],
      author_id: input.authorId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Recipe;
}

export async function updateRecipe(id: string, patch: Partial<Recipe>) {
  const row: Record<string, unknown> = { ...patch };
  if (patch.status === "Published") row.published_at = patch.published_at ?? new Date().toISOString();
  const { data, error } = await db.from("recipes").update(row).eq("id", id).select().single();
  if (error) throw error;
  return data as Recipe;
}

export async function deleteRecipe(id: string) {
  const { error } = await db.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

export async function setRecipeSelectedClients(recipeId: string, clientIds: string[]) {
  await db.from("recipe_client_access").delete().eq("recipe_id", recipeId);
  if (clientIds.length === 0) return;
  const rows = clientIds.map((cid) => ({ recipe_id: recipeId, client_id: cid }));
  const { error } = await db.from("recipe_client_access").insert(rows);
  if (error) throw error;
}

export async function getRecipeSelectedClients(recipeId: string): Promise<string[]> {
  const { data, error } = await db
    .from("recipe_client_access")
    .select("client_id")
    .eq("recipe_id", recipeId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.client_id as string);
}

/* Notifications */

export async function ensureRecipeNotification(recipeId: string, userId: string) {
  await db
    .from("recipe_notifications")
    .upsert({ recipe_id: recipeId, user_id: userId }, { onConflict: "recipe_id,user_id", ignoreDuplicates: true });
}

export async function markRecipeSeen(recipeId: string, userId: string) {
  await db
    .from("recipe_notifications")
    .upsert(
      { recipe_id: recipeId, user_id: userId, seen_at: new Date().toISOString() },
      { onConflict: "recipe_id,user_id" },
    );
}

export async function listRecipeUnseen(userId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from("recipe_notifications")
    .select("recipe_id, seen_at")
    .eq("user_id", userId);
  if (error) return new Set();
  return new Set(((data ?? []) as any[]).filter((r) => !r.seen_at).map((r) => r.recipe_id));
}

/* App settings: format prompt */
export async function getFormatPrompt(): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "recipe_format_prompt").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

export async function saveFormatPrompt(value: string) {
  const { error } = await db
    .from("app_settings")
    .upsert({ key: "recipe_format_prompt", value }, { onConflict: "key" });
  if (error) throw error;
}

export function statusTone(s: RecipeStatus) {
  if (s === "Published") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (s === "Archived") return "bg-muted text-muted-foreground border-border";
  return "bg-amber-500/15 text-amber-300 border-amber-500/30";
}