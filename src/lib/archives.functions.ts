import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// Each archive source describes how to read archived rows from a table.
type Source = {
  type: string;
  label: string;
  table: string;
  nameField: string;
  hasArchivedAt: boolean;
  hasArchivedBy: boolean;
  hasClientId: boolean;
  // For tables without a boolean `archived` column, use a status filter.
  statusArchivedValue?: string;
};

const SOURCES: Source[] = [
  { type: "clients",             label: "Client",            table: "clients",                 nameField: "full_name", hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "offers",              label: "Offer",             table: "offers",                  nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "products",            label: "Product",           table: "coaching_products",       nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "program_templates",   label: "Program Template",  table: "pl_templates",            nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "agreement_templates", label: "Agreement Template",table: "agreement_templates",     nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "agreements",          label: "Agreement",         table: "agreements",              nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: true  },
  { type: "forms",               label: "Form",              table: "forms",                   nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "native_forms",        label: "Form (Native)",     table: "nf_forms",                nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "check_in_links",      label: "Check-In Link",     table: "check_in_links",          nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "exercises",           label: "Exercise",          table: "exercises",               nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "training_blocks",     label: "Training Block",    table: "pl_blocks",               nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: true  },
  { type: "training_preps",      label: "Training Prep",     table: "pl_preps",                nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: true  },
  { type: "lift_videos",         label: "Lift Video",        table: "lift_videos",             nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: true  },
  { type: "media_items",         label: "Media Item",        table: "media_items",             nameField: "title",     hasArchivedAt: true, hasArchivedBy: true, hasClientId: true  },
  { type: "coaches",             label: "Coach",             table: "coaches",                 nameField: "full_name", hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
  { type: "cardio_templates",    label: "Cardio Template",   table: "cardio_program_templates",nameField: "name",      hasArchivedAt: true, hasArchivedBy: true, hasClientId: false },
];

export type ArchivedRow = {
  id: string;
  type: string;
  type_label: string;
  table: string;
  name: string;
  client_id: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archived_by_name: string | null;
  client_name: string | null;
};

export const listArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      types: z.array(z.string()).optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const wanted = data.types && data.types.length > 0
      ? SOURCES.filter((s) => data.types!.includes(s.type))
      : SOURCES;

    const results: ArchivedRow[] = [];
    for (const src of wanted) {
      const cols = ["id", src.nameField, "archived_at", "archived_by"];
      if (src.hasClientId) cols.push("client_id");
      let q = supabaseAdmin.from(src.table).select(cols.join(",")).eq("archived", true).limit(data.limit);
      if (data.search) q = q.ilike(src.nameField, `%${data.search}%`);
      const { data: rows, error } = await q;
      if (error) {
        // Skip tables that fail (schema drift, etc.) instead of failing whole call
        continue;
      }
      for (const r of (rows ?? []) as any[]) {
        results.push({
          id: r.id,
          type: src.type,
          type_label: src.label,
          table: src.table,
          name: r[src.nameField] ?? "(untitled)",
          client_id: r.client_id ?? null,
          archived_at: r.archived_at ?? null,
          archived_by: r.archived_by ?? null,
          archived_by_name: null,
          client_name: null,
        });
      }
    }

    // Hydrate client names + archived_by names
    const clientIds = Array.from(new Set(results.map((r) => r.client_id).filter(Boolean) as string[]));
    const userIds = Array.from(new Set(results.map((r) => r.archived_by).filter(Boolean) as string[]));
    if (clientIds.length > 0) {
      const { data: cs } = await supabaseAdmin.from("clients").select("id, full_name").in("id", clientIds);
      const map = new Map<string, string>((cs ?? []).map((c: any) => [c.id, c.full_name]));
      for (const r of results) if (r.client_id) r.client_name = map.get(r.client_id) ?? null;
    }
    if (userIds.length > 0) {
      const { data: ps } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds);
      const map = new Map<string, string>((ps ?? []).map((p: any) => [p.id, p.full_name]));
      for (const r of results) if (r.archived_by) r.archived_by_name = map.get(r.archived_by) ?? null;
    }

    results.sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? ""));
    return { rows: results };
  });

const ItemRef = z.object({ type: z.string(), id: z.string() });

function sourceFor(type: string): Source {
  const s = SOURCES.find((x) => x.type === type);
  if (!s) throw new Error(`Unknown archive type: ${type}`);
  return s;
}

export const restoreArchivedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ items: z.array(ItemRef).min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: { type: string; id: string; ok: boolean; error?: string }[] = [];
    for (const it of data.items) {
      try {
        const src = sourceFor(it.type);
        const patch: any = { archived: false, archived_at: null, archived_by: null };
        if (src.table === "clients") patch.status = "Active";
        const { error } = await supabaseAdmin.from(src.table).update(patch).eq("id", it.id);
        if (error) throw new Error(error.message);
        results.push({ type: it.type, id: it.id, ok: true });
      } catch (e: any) {
        results.push({ type: it.type, id: it.id, ok: false, error: e?.message ?? "Failed" });
      }
    }
    return { results };
  });

export const permanentlyDeleteArchivedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      items: z.array(ItemRef).min(1).max(500),
      confirm: z.literal("DELETE"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: { type: string; id: string; ok: boolean; error?: string }[] = [];
    for (const it of data.items) {
      try {
        const src = sourceFor(it.type);
        const { error } = await supabaseAdmin.from(src.table).delete().eq("id", it.id);
        if (error) throw new Error(error.message);
        results.push({ type: it.type, id: it.id, ok: true });
      } catch (e: any) {
        results.push({ type: it.type, id: it.id, ok: false, error: e?.message ?? "Failed" });
      }
    }
    return { results };
  });

export const archiveTypeOptions = SOURCES.map((s) => ({ type: s.type, label: s.label }));