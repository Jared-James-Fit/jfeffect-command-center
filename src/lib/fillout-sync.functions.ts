import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SyncResult = {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  error?: string;
};

/**
 * Pulls every form from the user's Fillout account and upserts them as
 * external forms in nf_forms. Matches existing rows by the Fillout form id
 * embedded in `external_url` (e.g. https://forms.fillout.com/t/<formId>).
 * Newly created rows default to active=false / visibility=selected so admin
 * can choose audience before publishing.
 */
export const syncFilloutForms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const apiKey = process.env.FILLOUT_API_KEY;
    if (!apiKey) return { ok: false, fetched: 0, created: 0, updated: 0, error: "FILLOUT_API_KEY not set" };

    const res = await fetch("https://api.fillout.com/v1/api/forms", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, fetched: 0, created: 0, updated: 0, error: `Fillout API ${res.status}: ${body.slice(0, 200)}` };
    }
    const forms = (await res.json()) as Array<{ id: string; name: string; url?: string }>;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let created = 0;
    let updated = 0;

    for (const f of forms) {
      const url = f.url || `https://forms.fillout.com/t/${f.id}`;
      // Find existing by external_url containing the fillout id
      const { data: existing } = await supabaseAdmin
        .from("nf_forms")
        .select("id")
        .ilike("external_url", `%${f.id}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabaseAdmin
          .from("nf_forms")
          .update({
            title: f.name || "Untitled Fillout Form",
            external_url: url,
            requires_client_identity: true,
          })
          .eq("id", existing[0].id);
        updated++;
      } else {
        await supabaseAdmin.from("nf_forms").insert({
          title: f.name || "Untitled Fillout Form",
          form_type: "check_in",
          recurrence: "none",
          active: false,
          archived: false,
          kind: "external",
          external_url: url,
          open_style: "embed",
          visibility: "selected",
          auto_assign_new_clients: false,
          requires_client_identity: true,
        });
        created++;
      }
    }

    return { ok: true, fetched: forms.length, created, updated };
  });