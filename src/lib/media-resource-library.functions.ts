import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "media-resource-library";

async function assertAdminOrMedia(ctx: any) {
  const { supabase, userId } = ctx;
  const { data, error } = await supabase.rpc("is_admin_or_media_manager", { _uid: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admins and media managers only");
}

/* ------------- folders ------------- */

export const listFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrMedia(context);
    const { data, error } = await context.supabase
      .from("media_resource_folders").select("*").order("sort_order").order("name");
    if (error) throw new Error(error.message);
    return { folders: data ?? [] };
  });

export const createFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    name: z.string().min(1).max(120),
    parent_id: z.string().uuid().nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { data: row, error } = await context.supabase
      .from("media_resource_folders")
      .insert({ name: data.name.trim(), parent_id: data.parent_id ?? null, color: data.color ?? null, icon: data.icon ?? null, created_by: context.userId })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { folder: row };
  });

export const updateFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    parent_id: z.string().uuid().nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("media_resource_folders").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { error } = await context.supabase.from("media_resource_folders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------- resources ------------- */

export const listResources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    folder_id: z.string().uuid().nullable().optional(),
    search: z.string().max(200).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const cols = "id,folder_id,name,description,tags,storage_path,external_url,mime_type,file_size,thumbnail_path,created_by,created_at,updated_at";
    let q = context.supabase.from("media_resources").select(cols).order("created_at", { ascending: false });
    const term = (data.search ?? "").trim();
    if (term) {
      const t = `%${term.replace(/[%_]/g, "")}%`;
      q = q.or(`name.ilike.${t},description.ilike.${t}`);
    } else if (data.folder_id !== undefined) {
      if (data.folder_id === null) q = q.is("folder_id", null);
      else q = q.eq("folder_id", data.folder_id);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let items = rows ?? [];
    if (term) {
      const lower = term.toLowerCase();
      const tagMatches = (await context.supabase
        .from("media_resources").select(cols).contains("tags", [lower])).data ?? [];
      const ids = new Set(items.map((r: any) => r.id));
      for (const r of tagMatches) if (!ids.has(r.id)) items.push(r);
    }
    return { items };
  });

export const getSignedReadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ path: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sig, error } = await supabaseAdmin.storage
      .from(BUCKET).createSignedUrl(data.path, 3600);
    if (error || !sig) throw new Error(error?.message ?? "Failed to sign URL");
    return { url: sig.signedUrl };
  });

export const getUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    filename: z.string().min(1).max(200),
    contentType: z.string().min(1).max(200),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `files/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Failed to sign upload");
    return { path, signedUrl: signed.signedUrl, token: signed.token };
  });

const ResourceInput = z.object({
  name: z.string().min(1).max(240),
  description: z.string().max(4000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(50).default([]),
  folder_id: z.string().uuid().nullable().optional(),
  storage_path: z.string().max(400).nullable().optional(),
  external_url: z.string().url().max(800).nullable().optional(),
  mime_type: z.string().max(200).nullable().optional(),
  file_size: z.number().int().nonnegative().nullable().optional(),
  thumbnail_path: z.string().max(400).nullable().optional(),
});

export const createResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ResourceInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const payload = {
      ...data,
      name: data.name.trim(),
      tags: (data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      folder_id: data.folder_id ?? null,
      created_by: context.userId,
    };
    const { data: row, error } = await context.supabase
      .from("media_resources").insert(payload)
      .select("id,folder_id,name,description,tags,storage_path,external_url,mime_type,file_size,thumbnail_path,created_by,created_at,updated_at").single();
    if (error) throw new Error(error.message);
    return { resource: row };
  });

export const updateResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).merge(ResourceInput.partial()).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { id, ...rest } = data;
    const patch: any = { ...rest };
    if (patch.tags) patch.tags = patch.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);
    if (patch.name) patch.name = patch.name.trim();
    const { error } = await context.supabase.from("media_resources").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { data: row } = await context.supabase
      .from("media_resources").select("storage_path,thumbnail_path").eq("id", data.id).maybeSingle();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const paths = [row?.storage_path, row?.thumbnail_path].filter(Boolean) as string[];
    if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths);
    const { error } = await context.supabase.from("media_resources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------- comments ------------- */

export const listComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ resource_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { data: rows, error } = await context.supabase
      .from("media_resource_comments").select("*").eq("resource_id", data.resource_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    let profiles: any[] = [];
    if (ids.length) {
      const { data: p } = await context.supabase
        .from("profiles").select("id, full_name, avatar_url").in("id", ids);
      profiles = p ?? [];
    }
    const byId = new Map(profiles.map((p: any) => [p.id, p]));
    return {
      items: (rows ?? []).map((c: any) => ({
        ...c,
        author_name: byId.get(c.user_id)?.full_name ?? "Member",
        author_avatar: byId.get(c.user_id)?.avatar_url ?? null,
      })),
    };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    resource_id: z.string().uuid(),
    body: z.string().min(1).max(4000),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { data: row, error } = await context.supabase
      .from("media_resource_comments")
      .insert({ resource_id: data.resource_id, body: data.body.trim(), user_id: context.userId })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { comment: row };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrMedia(context);
    const { error } = await context.supabase.from("media_resource_comments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });