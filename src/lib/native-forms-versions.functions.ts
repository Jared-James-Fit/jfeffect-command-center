import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PublishSchema = z.object({
  formId: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
});

const RestoreSchema = z.object({
  versionId: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
});

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only admins can publish or restore form versions.");
  return supabaseAdmin;
}

export const publishFormVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PublishSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const supabaseAdmin = await assertAdmin(context.userId);
      const { data: row, error } = await (supabaseAdmin as any).rpc("nf_publish_form_version", {
        _form_id: data.formId,
        _reason: data.reason ?? null,
      });
      if (error) throw new Error(error.message);
      return { ok: true as const, version: row, error: null as string | null };
    } catch (e: any) {
      return { ok: false as const, version: null, error: e?.message ?? "Publish failed" };
    }
  });

export const restoreFormVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RestoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const supabaseAdmin = await assertAdmin(context.userId);
      const { data: row, error } = await (supabaseAdmin as any).rpc("nf_restore_form_version", {
        _version_id: data.versionId,
        _reason: data.reason ?? null,
      });
      if (error) throw new Error(error.message);
      return { ok: true as const, version: row, error: null as string | null };
    } catch (e: any) {
      return { ok: false as const, version: null, error: e?.message ?? "Restore failed" };
    }
  });