import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "From Google Calendar" on a client's Sessions tab: the coach's Google
 * appointments that name this client and aren't in the app yet, then the
 * import of the ones the coach keeps ticked. Admin only. The import re-reads
 * Google on the server; it never trusts a list sent from the phone.
 */
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r: any) => r.role === "admin")) throw new Error("Only an admin can import from Google Calendar");
}

const Range = z.object({
  client_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const previewGoogleSessionImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Range.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewGoogleImport } = await import("@/lib/gcal-session-import.server");
    const p = await previewGoogleImport(supabaseAdmin as any, { clientIds: [data.client_id], from: data.from, to: data.to });
    return {
      candidates: p.candidates,
      skipped: p.skipped.filter((s) => s.reason !== "already_in_app"),
      alreadyInApp: p.skipped.filter((s) => s.reason === "already_in_app").length,
      handCountedOnly: p.handCountedOnly[data.client_id] ?? [],
    };
  });

export const applyGoogleSessionImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Range.extend({ event_ids: z.array(z.string().min(1)).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewGoogleImport, applyGoogleImport } = await import("@/lib/gcal-session-import.server");
    const p = await previewGoogleImport(supabaseAdmin as any, { clientIds: [data.client_id], from: data.from, to: data.to });
    const wanted = new Set(data.event_ids);
    return applyGoogleImport(supabaseAdmin as any, p.candidates.filter((c) => wanted.has(c.eventId)));
  });
