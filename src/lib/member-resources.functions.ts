import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `r-${Date.now()}`;
}

/* ---------- admin: list/get ---------- */

export const adminListResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("member_resources").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const adminGetResource = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("member_resources").select("*").eq("id", data.id).maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Not found");
    return { resource: row };
  });

/* ---------- admin: create/update/delete ---------- */

const ResourceInput = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  kind: z.enum(["resource","tool"]).default("resource"),
  format: z.enum(["pdf","video","link","article","calculator","embed","image"]).default("link"),
  url: z.string().url().max(800).nullable().optional(),
  storage_path: z.string().max(400).nullable().optional(),
  thumbnail_url: z.string().url().max(800).nullable().optional(),
  body_md: z.string().max(50_000).nullable().optional(),
  required_access_level: z.string().min(1).max(64).default("app_membership"),
  status: z.enum(["Draft","Published","Archived"]).default("Draft"),
  featured: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export const adminCreateResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ResourceInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slug = data.slug || slugify(data.title);
    const { data: row, error } = await supabaseAdmin
      .from("member_resources").insert({ ...data, slug }).select("*").single();
    if (error) throw new Error(error.message);
    return { resource: row };
  });

export const adminUpdateResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).merge(ResourceInput.partial()).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("member_resources").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("member_resources").select("storage_path").eq("id", data.id).maybeSingle();
    if (row?.storage_path) {
      await supabaseAdmin.storage.from("member-resources").remove([row.storage_path]);
    }
    const { error } = await supabaseAdmin.from("member_resources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- admin: signed upload URL ---------- */

export const adminGetUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    filename: z.string().min(1).max(200),
    contentType: z.string().min(1).max(120),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `uploads/${Date.now()}-${crypto.randomUUID().slice(0,8)}-${safe}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("member-resources").createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Failed to sign upload");
    return { path, signedUrl: signed.signedUrl, token: signed.token };
  });

/* ---------- member: list & view ---------- */

export const memberListResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind?: "resource"|"tool" } | undefined) => i ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    const memberId = member?.id ?? null;
    let accessKeys: string[] = [];
    if (memberId) {
      const { data: acc } = await supabase
        .from("member_access").select("access_level_key").eq("member_id", memberId).eq("active", true);
      accessKeys = (acc ?? []).map((a: any) => a.access_level_key);
    }
    let q = supabase.from("member_resources").select("*").eq("status", "Published").order("sort_order").order("created_at", { ascending: false });
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return {
      items: (rows ?? []).map((r: any) => ({ ...r, locked: !accessKeys.includes(r.required_access_level) })),
      accessKeys,
    };
  });

export const memberGetResource = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ slug: z.string().min(1).max(80) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("member_resources").select("*").eq("slug", data.slug).eq("status", "Published").maybeSingle();
    if (!row) throw new Error("Not found");
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    let hasAccess = false;
    if (member?.id) {
      const { data: acc } = await supabase
        .from("member_access").select("id").eq("member_id", member.id).eq("active", true).eq("access_level_key", row.required_access_level).maybeSingle();
      hasAccess = !!acc;
    }
    let signedUrl: string | null = null;
    if (hasAccess && row.storage_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: sig } = await supabaseAdmin.storage.from("member-resources").createSignedUrl(row.storage_path, 3600);
      signedUrl = sig?.signedUrl ?? null;
    }
    return { resource: row, hasAccess, signedUrl };
  });