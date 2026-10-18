import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MEMBERSHIP_AGREEMENT_SLUG, membershipAckText } from "@/lib/membership-agreement/acks";

/**
 * Version 3 is the first with the health, risk and release terms signed in the
 * app; earlier versions were accepted at checkout only and aren't re-asked.
 */
export const IN_APP_SIGNING_FROM_VERSION = 3;

type CurrentVersion = {
  documentId: string;
  id: string;
  version_number: number;
  title: string;
  body: string;
  effective_date: string | null;
};

/** The published Membership Agreement, if there is one live. */
async function loadCurrent(): Promise<CurrentVersion | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: doc } = await supabaseAdmin
    .from("legal_documents")
    .select("id, current_version_id, archived, emergency_disabled")
    .eq("slug", MEMBERSHIP_AGREEMENT_SLUG)
    .maybeSingle();
  const d = doc as { id: string; current_version_id: string | null; archived: boolean | null; emergency_disabled: boolean | null } | null;
  if (!d?.current_version_id || d.archived || d.emergency_disabled) return null;
  const { data: ver } = await supabaseAdmin
    .from("legal_document_versions")
    .select("id, version_number, title, body, effective_date, status")
    .eq("id", d.current_version_id)
    .maybeSingle();
  const v = ver as (Omit<CurrentVersion, "documentId"> & { status: string }) | null;
  if (!v || v.status !== "published") return null;
  return { documentId: d.id, id: v.id, version_number: v.version_number, title: v.title, body: v.body, effective_date: v.effective_date };
}

/**
 * A JF member's Membership Agreement: the live version and whether they've
 * accepted it. Coaching clients sign the Coaching Agreement instead, so for
 * them this is never applicable.
 */
export const getMyMembershipAgreement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: client } = await supabase.from("clients").select("id, service_tier").eq("user_id", userId).maybeSingle();
    if (!client || (client as any).service_tier !== "self_serve") return { applicable: false as const };
    const current = await loadCurrent();
    if (!current) return { applicable: false as const };
    const { data: acc } = await supabase
      .from("legal_acceptances")
      .select("version_id, accepted_at, signature_method")
      .eq("user_id", userId)
      .eq("document_id", current.documentId)
      .is("revoked_at", null)
      .order("accepted_at", { ascending: false });
    const rows = (acc ?? []) as Array<{ version_id: string; accepted_at: string; signature_method: string }>;
    const onThis = rows.filter((r) => r.version_id === current.id);
    // the checkout box accepts the terms; the health and risk ticks and a typed name are given in the app
    const signed = onThis.find((r) => r.signature_method === "typed_name") ?? null;
    return {
      applicable: true as const,
      version: current,
      /** signed in the app (typed name and every tick) */
      signedAt: signed?.accepted_at ?? null,
      /** accepted at checkout (the box) */
      acceptedAt: onThis[0]?.accepted_at ?? null,
      needsSigning: !signed && current.version_number >= IN_APP_SIGNING_FROM_VERSION,
      /** they accepted an earlier version (so this is an update, not a first time) */
      acceptedEarlier: onThis.length === 0 && rows.length > 0,
    };
  });

/** Record a member's acceptance: their typed name, every tick word for word, and the exact text. */
export const acceptMembershipAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        versionId: z.string().uuid(),
        typedName: z.string().trim().min(2).max(120),
        acks: z.array(z.string().max(20)).max(10),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: client } = await supabase.from("clients").select("id, service_tier").eq("user_id", userId).maybeSingle();
    if (!client || (client as any).service_tier !== "self_serve") {
      throw new Error("The Membership Agreement is for JF Membership accounts.");
    }
    const current = await loadCurrent();
    if (!current || current.id !== data.versionId) {
      throw new Error("The Membership Agreement was just updated. Close this and open it again to read the new version.");
    }
    const acknowledgement = membershipAckText(data.acks);
    if (!acknowledgement) throw new Error("Tick every box to accept.");

    const { getRequestMeta } = await import("@/lib/coaching-agreement.server");
    const meta = await getRequestMeta();
    const { error } = await supabase.from("legal_acceptances").insert({
      user_id: userId,
      client_id: (client as any).id,
      document_id: current.documentId,
      version_id: current.id,
      context: "reaccept_prompt",
      context_ref: "member_app",
      signature_method: "typed_name",
      checkbox_checked: true,
      typed_name: data.typedName,
      acknowledgement_text: acknowledgement,
      rendered_snapshot: current.body,
      ip_address: meta.ip,
      user_agent: meta.userAgent,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true as const, acceptedAt: new Date().toISOString() };
  });
