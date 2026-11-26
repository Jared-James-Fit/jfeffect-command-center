import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MEMBERSHIP_AGREEMENT_SLUG, membershipAckText, isMemberAppAcceptance, CLICK_ACCEPTANCE_VERSION_ID } from "@/lib/membership-agreement/acks";

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
  signature_method: "typed_name" | "checkbox";
  requires_reacceptance: boolean;
};

/** The published Membership Agreement, if there is one live. */
async function loadCurrent(): Promise<CurrentVersion | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: doc, error: docError } = await supabaseAdmin
    .from("legal_documents")
    .select("id, current_version_id, archived, emergency_disabled")
    .eq("slug", MEMBERSHIP_AGREEMENT_SLUG)
    .maybeSingle();
  if (docError) throw new Error(docError.message);
  const d = doc as { id: string; current_version_id: string | null; archived: boolean | null; emergency_disabled: boolean | null } | null;
  if (!d?.current_version_id || d.archived || d.emergency_disabled) return null;
  const { data: ver, error: versionError } = await supabaseAdmin
    .from("legal_document_versions")
    .select("id, version_number, title, body, effective_date, status, signature_method, requires_reacceptance")
    .eq("id", d.current_version_id)
    .maybeSingle();
  if (versionError) throw new Error(versionError.message);
  const v = ver as (Omit<CurrentVersion, "documentId"> & { status: string }) | null;
  if (!v || v.status !== "published") return null;
  if (v.signature_method !== "typed_name" && v.signature_method !== "checkbox") throw new Error("Unsupported membership acceptance method.");
  return { documentId: d.id, id: v.id, version_number: v.version_number, title: v.title, body: v.body, effective_date: v.effective_date, signature_method: v.signature_method, requires_reacceptance: v.requires_reacceptance };
}

/**
 * A JF member's Membership Agreement: the live version and whether they've
 * accepted it. Coaching clients sign the Coaching Agreement instead, so for
 * them this is never applicable.
 */
export const getMyMembershipAgreement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => readMembershipAgreement(context));

async function readMembershipAgreement(context: { supabase: any; userId: string }) {
    const { supabase, userId } = context;
    const { data: client, error: clientError } = await supabase.from("clients").select("id, service_tier").eq("user_id", userId).maybeSingle();
    if (clientError) throw new Error(clientError.message);
    if (!client || (client as any).service_tier !== "self_serve") return { applicable: false as const };
    const current = await loadCurrent();
    if (!current) return { applicable: false as const };
    const { data: acc, error: acceptanceError } = await supabase
      .from("legal_acceptances")
      .select("version_id, accepted_at, signature_method, context_ref, checkbox_checked, acknowledgement_text")
      .eq("user_id", userId)
      .eq("document_id", current.documentId)
      .is("revoked_at", null)
      .order("accepted_at", { ascending: false });
    if (acceptanceError) throw new Error(acceptanceError.message);
    const rows = (acc ?? []) as Array<{ version_id: string; accepted_at: string; signature_method: string; context_ref: string | null; checkbox_checked: boolean | null; acknowledgement_text: string | null }>;
    const onThis = rows.filter((r) => r.version_id === current.id);
    // Checkout acceptance is not the in-app health and risk acknowledgement.
    let signed = onThis.find(isMemberAppAcceptance) ?? null;
    let acceptedVersionNumber = signed ? current.version_number : null;
    // This exact non-substantive method-only revision honors existing v6 evidence.
    // Do not treat arbitrary older signatures as acceptance of future material changes.
    if (!signed && current.id === CLICK_ACCEPTANCE_VERSION_ID && !current.requires_reacceptance) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: prior, error } = await supabaseAdmin.from("legal_document_versions")
        .select("id").eq("document_id", current.documentId).eq("version_number", 6).maybeSingle();
      if (error) throw new Error(error.message);
      signed = rows.find(r => r.version_id === prior?.id && isMemberAppAcceptance(r)) ?? null;
      if (signed) acceptedVersionNumber = 6;
    }
    return {
      applicable: true as const,
      version: current,
      /** accepted in the app (every required tick, plus name on legacy versions) */
      signedAt: signed?.accepted_at ?? null,
      acceptedVersionNumber,
      /** accepted at checkout (the box) */
      acceptedAt: onThis[0]?.accepted_at ?? null,
      needsSigning: !signed && current.version_number >= IN_APP_SIGNING_FROM_VERSION,
      /** they accepted an earlier version (so this is an update, not a first time) */
      acceptedEarlier: onThis.length === 0 && rows.length > 0,
    };
}

/** Read exactly the selected account, only after checking staff access. */
export const previewMembershipAgreement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { agreementReadContext } = await import("@/lib/agreement-preview.server");
    return readMembershipAgreement(await agreementReadContext(context, data.clientId));
  });

/** Record a member's acceptance: authenticated identity, every tick word for word, and the exact text. */
export const acceptMembershipAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        versionId: z.string().uuid(),
        typedName: z.string().trim().min(2).max(120).optional(),
        acks: z.array(z.string().max(20)).max(10),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    if (getRequest()?.headers.get("x-jf-pov-session")) throw new Error("Only the member can accept their agreement.");
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
    if (current.signature_method === "typed_name" && !data.typedName) throw new Error("Enter your name for this version of the agreement.");

    const { getRequestMeta } = await import("@/lib/coaching-agreement.server");
    const meta = await getRequestMeta();
    // Only the server writes acceptance records (the database stamps the time
    // and the published text; 20270423090000_security_hardening.sql).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("legal_acceptances").insert({
      user_id: userId,
      client_id: (client as any).id,
      document_id: current.documentId,
      version_id: current.id,
      context: "reaccept_prompt",
      context_ref: "member_app",
      signature_method: current.signature_method,
      checkbox_checked: true,
      typed_name: current.signature_method === "typed_name" ? data.typedName : null,
      acknowledgement_text: acknowledgement,
      rendered_snapshot: current.body,
      ip_address: meta.ip,
      user_agent: meta.userAgent,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true as const, acceptedAt: new Date().toISOString() };
  });
