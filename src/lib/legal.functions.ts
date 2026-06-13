import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============================================================================
// Legal & Safety — server functions
//
// All mutations are admin-gated server-side. Acceptance writes are
// authenticated as the signed-in user; RLS guarantees they can only insert
// their own row.
// ============================================================================

const DocSchema = z.object({
  id: z.string().uuid().optional(),
  doc_type: z.enum([
    "terms","privacy","coaching_disclaimer","medical_disclaimer","nutrition_disclaimer",
    "ai_disclosure","waiver","par_q","upload_consent","media_release",
    "communication_consent","cancellation_policy","custom",
  ]),
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  audience: z.enum(["everyone","all_clients","new_clients","selected_users","selected_products","selected_forms","staff"]).default("all_clients"),
  is_required: z.boolean().default(false),
  is_optional_consent: z.boolean().default(false),
  archived: z.boolean().optional(),
});

const VersionSchema = z.object({
  id: z.string().uuid().optional(),
  document_id: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  body: z.string().min(1),
  signature_method: z.enum(["checkbox","typed_name","signature","link_only"]).default("checkbox"),
  requires_reacceptance: z.boolean().default(true),
  reacceptance_audience: z.enum(["everyone","all_clients","new_clients","selected_users","selected_products","selected_forms","staff"]).default("all_clients"),
  effective_date: z.string().nullable().optional(),
  needs_legal_review: z.boolean().default(true),
  legal_review_note: z.string().nullable().optional(),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

// ----------------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------------
export const listLegalDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_documents")
      .select("*, current_version:legal_document_versions!legal_documents_current_version_id_fkey(*)")
      .order("doc_type", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("legal_document_versions")
      .select("*")
      .eq("document_id", data.documentId)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Resolves the set of currently-published documents (and their pending
 * acceptance status) for the calling user. Used by the client Legal & Safety
 * panel and by the onboarding gate.
 */
export const listMyLegalStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: docs, error: e1 } = await context.supabase
      .from("legal_documents")
      .select("id, doc_type, slug, title, audience, is_required, is_optional_consent, enforcement_mode, enforcement_enabled, emergency_disabled, effective_at, grace_period_days, current_version_id, current_version:legal_document_versions!legal_documents_current_version_id_fkey(id, version_number, title, summary, body, signature_method, requires_reacceptance, effective_date, status, needs_legal_review)")
      .eq("archived", false);
    if (e1) throw new Error(e1.message);
    const published = (docs ?? []).filter((d: any) => d.current_version && d.current_version.status === "published" && !d.current_version.needs_legal_review);

    const versionIds = published.map((d: any) => d.current_version.id);
    let acceptances: any[] = [];
    if (versionIds.length) {
      const { data: acc, error: e2 } = await context.supabase
        .from("legal_acceptances")
        .select("id, version_id, document_id, accepted_at, signature_method, revoked_at")
        .eq("user_id", context.userId)
        .in("version_id", versionIds);
      if (e2) throw new Error(e2.message);
      acceptances = acc ?? [];
    }

    // Resolve effective enforcement per doc for THIS user (kill switch,
    // emergency disable, audience, effective date, grace period).
    const effective = await Promise.all(published.map(async (d: any) => {
      const { data: eff } = await context.supabase.rpc("legal_effective_enforcement", {
        _doc_id: d.id, _user_id: context.userId,
      });
      return { id: d.id, effective: (eff as string) ?? "inactive" };
    }));

    return published.map((d: any) => {
      const accepted = acceptances.find((a) => a.version_id === d.current_version.id && !a.revoked_at);
      const eff = effective.find((e) => e.id === d.id)?.effective ?? "inactive";
      return {
        document_id: d.id,
        doc_type: d.doc_type,
        slug: d.slug,
        title: d.title,
        audience: d.audience,
        is_required: d.is_required,
        is_optional_consent: d.is_optional_consent,
        enforcement_mode: d.enforcement_mode,
        enforcement_enabled: d.enforcement_enabled,
        emergency_disabled: d.emergency_disabled,
        effective_enforcement: eff, // 'inactive'|'notice_only'|'workflow_gate'|'onboarding_gate'|'full_portal_gate'
        version: d.current_version,
        accepted_at: accepted?.accepted_at ?? null,
        acceptance_id: accepted?.id ?? null,
      };
    });
  });

export const listMyAcceptanceHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_acceptances")
      .select("id, document_id, version_id, context, signature_method, accepted_at, revoked_at, acknowledgement_text, document:legal_documents(title, doc_type), version:legal_document_versions(version_number, title)")
      .eq("user_id", context.userId)
      .order("accepted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAcceptancesForVersion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { versionId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("legal_acceptances")
      .select("id, user_id, client_id, context, signature_method, typed_name, accepted_at, ip_address, user_agent, revoked_at, client:clients(full_name, email)")
      .eq("version_id", data.versionId)
      .order("accepted_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    // Cast `inet` to string for serializability across the RPC boundary.
    return ((rows ?? []) as any[]).map((r) => ({ ...r, ip_address: r.ip_address ? String(r.ip_address) : null })) as Array<Record<string, any>>;
  });

// ----------------------------------------------------------------------------
// Write (admin)
// ----------------------------------------------------------------------------
export const upsertLegalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DocSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const payload: any = { ...data };
    if (!payload.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("legal_documents")
      .upsert({ ...payload, created_by: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveDraftVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => VersionSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.id) {
      // Update existing draft (the DB trigger blocks edits to published versions).
      const { data: row, error } = await context.supabase
        .from("legal_document_versions")
        .update({
          title: data.title,
          summary: data.summary ?? null,
          body: data.body,
          signature_method: data.signature_method,
          requires_reacceptance: data.requires_reacceptance,
          reacceptance_audience: data.reacceptance_audience,
          effective_date: data.effective_date ?? null,
          needs_legal_review: data.needs_legal_review,
          legal_review_note: data.legal_review_note ?? null,
        })
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    // New draft → next version number for this document
    const { data: existing } = await context.supabase
      .from("legal_document_versions")
      .select("version_number")
      .eq("document_id", data.document_id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const next = (existing?.version_number ?? 0) + 1;
    const { data: row, error } = await context.supabase
      .from("legal_document_versions")
      .insert({
        document_id: data.document_id,
        version_number: next,
        status: "draft",
        title: data.title,
        summary: data.summary ?? null,
        body: data.body,
        signature_method: data.signature_method,
        requires_reacceptance: data.requires_reacceptance,
        reacceptance_audience: data.reacceptance_audience,
        effective_date: data.effective_date ?? null,
        needs_legal_review: data.needs_legal_review,
        legal_review_note: data.legal_review_note ?? null,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const publishVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { versionId: string; confirmLegalReview: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.confirmLegalReview) {
      throw new Error("Publishing a legal document requires explicit confirmation that the language has been professionally reviewed.");
    }
    const { data: row, error } = await context.supabase
      .from("legal_document_versions")
      .update({ status: "published", needs_legal_review: false })
      .eq("id", data.versionId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const archiveVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { versionId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("legal_document_versions")
      .update({ status: "archived" })
      .eq("id", data.versionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// Acceptance (client)
// ----------------------------------------------------------------------------
const AcceptSchema = z.object({
  document_id: z.string().uuid(),
  version_id: z.string().uuid(),
  context: z.enum(["onboarding","account_centre","form_submission","agreement","upload","reaccept_prompt","public_form","signup","custom"]),
  context_ref: z.string().nullable().optional(),
  signature_method: z.enum(["checkbox","typed_name","signature","link_only"]),
  checkbox_checked: z.boolean(),
  typed_name: z.string().nullable().optional(),
  acknowledgement_text: z.string().min(1),
  user_agent: z.string().nullable().optional(),
});

export const recordAcceptance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AcceptSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Look up the version body to snapshot it as immutable evidence.
    const { data: ver, error: vErr } = await context.supabase
      .from("legal_document_versions")
      .select("body, status")
      .eq("id", data.version_id)
      .single();
    if (vErr) throw new Error(vErr.message);
    if (ver.status !== "published") {
      throw new Error("Cannot accept a non-published version.");
    }
    if (data.signature_method === "checkbox" && !data.checkbox_checked) {
      throw new Error("Acknowledgement checkbox is required.");
    }
    if (data.signature_method === "typed_name" && !data.typed_name?.trim()) {
      throw new Error("Typed name is required.");
    }

    // Resolve this user's client_id (if any) so coach/admin scoping works.
    const { data: clientRow } = await context.supabase
      .from("clients").select("id").eq("user_id", context.userId).maybeSingle();

    // Best-effort IP capture (forwarded header).
    let ipAddress: string | null = null;
    try {
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const xff = getRequestHeader("x-forwarded-for");
      if (xff) ipAddress = xff.split(",")[0]?.trim() || null;
    } catch { /* ignore — not available in some runtimes */ }

    const { data: row, error } = await context.supabase
      .from("legal_acceptances")
      .insert({
        user_id: context.userId,
        client_id: clientRow?.id ?? null,
        document_id: data.document_id,
        version_id: data.version_id,
        context: data.context,
        context_ref: data.context_ref ?? null,
        signature_method: data.signature_method,
        checkbox_checked: data.checkbox_checked,
        typed_name: data.typed_name ?? null,
        acknowledgement_text: data.acknowledgement_text,
        rendered_snapshot: ver.body,
        ip_address: ipAddress,
        user_agent: data.user_agent ?? null,
      })
      .select()
      .single();
    if (error) {
      // Idempotent: duplicate evidence row → return existing.
      if ((error as any).code === "23505") {
        const { data: existing } = await context.supabase
          .from("legal_acceptances")
          .select("*")
          .eq("user_id", context.userId)
          .eq("version_id", data.version_id)
          .eq("context", data.context)
          .is("revoked_at", null)
          .maybeSingle();
        return existing
          ? ({ ...(existing as any), ip_address: (existing as any).ip_address ? String((existing as any).ip_address) : null } as Record<string, any>)
          : null;
      }
      throw new Error(error.message);
    }
    return { ...(row as any), ip_address: (row as any)?.ip_address ? String((row as any).ip_address) : null } as Record<string, any>;
  });

// ----------------------------------------------------------------------------
// Consent preferences (separate from required acceptances)
// ----------------------------------------------------------------------------
export const setConsentPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { consent_key: string; granted: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { data: clientRow } = await context.supabase
      .from("clients").select("id").eq("user_id", context.userId).maybeSingle();
    const { data: row, error } = await context.supabase
      .from("legal_consent_preferences")
      .upsert(
        { user_id: context.userId, client_id: clientRow?.id ?? null, consent_key: data.consent_key, granted: data.granted },
        { onConflict: "user_id,consent_key" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_consent_preferences")
      .select("*")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ----------------------------------------------------------------------------
// Public (anon) Terms / Privacy reader — only returns docs explicitly marked
// public_read_allowed, not archived, not emergency-disabled, with a published
// current version. RLS on legal_documents / legal_document_versions enforces
// the same constraints server-side.
// ----------------------------------------------------------------------------
export const getPublicLegalDocument = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc, error } = await supabaseAdmin
      .from("legal_documents")
      .select("id, slug, title, doc_type, public_read_allowed, archived, emergency_disabled, current_version_id, current_version:legal_document_versions!legal_documents_current_version_id_fkey(id, version_number, title, summary, body, effective_date, status, needs_legal_review, published_at)")
      .eq("slug", data.slug)
      .eq("public_read_allowed", true)
      .eq("archived", false)
      .eq("emergency_disabled", false)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc || !doc.current_version || (doc.current_version as any).status !== "published") {
      return null;
    }
    const v: any = doc.current_version;
    return {
      slug: doc.slug,
      title: doc.title,
      doc_type: doc.doc_type,
      version: {
        version_number: v.version_number,
        title: v.title,
        summary: v.summary,
        body: v.body,
        effective_date: v.effective_date,
        published_at: v.published_at,
        needs_legal_review: v.needs_legal_review,
      },
    };
  });

export const listPublicLegalDocuments = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("legal_documents")
      .select("slug, title, doc_type")
      .eq("public_read_allowed", true)
      .eq("archived", false)
      .eq("emergency_disabled", false)
      .order("doc_type");
    if (error) throw new Error(error.message);
    return data ?? [];
  });