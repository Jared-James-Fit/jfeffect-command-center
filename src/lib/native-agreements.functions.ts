import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "node:crypto";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

function canonicalize(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export const listNativeTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("na_templates")
      .select("id, slug, internal_name, client_facing_title, service_type, requires_health_screening, countersignature_required, archived, na_template_versions(id, version, status, published_at)")
      .eq("archived", false)
      .order("internal_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listNativePackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId?: string | null } = {}) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    let q = supabase
      .from("na_packages")
      .select("id, client_id, status, custom_title, contract_value_minor, currency, sent_at, completed_at, created_at, jurisdiction_supported, jurisdiction_block_reasons, clients!inner(id, first_name, last_name, email)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getNativePackage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packageId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: pkg, error } = await supabase
      .from("na_packages")
      .select("*, clients(id, first_name, last_name, email), na_template_versions(id, version, na_templates(id, slug, internal_name, client_facing_title, service_type)), jurisdiction_profiles(id, code, display_name, status)")
      .eq("id", data.packageId)
      .maybeSingle();
    if (error || !pkg) throw new Error(error?.message ?? "Package not found");
    const [signers, snapshots, signatures, events, documents, guestTokens] = await Promise.all([
      supabase.from("na_signers").select("*").eq("package_id", data.packageId).order("ordinal"),
      supabase.from("na_snapshots").select("id, snapshot_hash, sealed, sealed_at, created_at").eq("package_id", data.packageId).order("created_at", { ascending: false }),
      supabase.from("na_signatures").select("*").eq("package_id", data.packageId),
      supabase.from("na_events").select("*").eq("package_id", data.packageId).order("created_at", { ascending: false }).limit(100),
      supabase.from("na_documents").select("*").eq("package_id", data.packageId).order("document_version", { ascending: false }),
      supabase.from("na_guest_tokens").select("id, signer_id, email_to_verify, expires_at, used_at, revoked_at").eq("package_id", data.packageId),
    ]);
    return {
      package: pkg,
      signers: signers.data ?? [],
      snapshots: snapshots.data ?? [],
      signatures: signatures.data ?? [],
      events: events.data ?? [],
      documents: documents.data ?? [],
      guestTokens: guestTokens.data ?? [],
    };
  });

const CreateSchema = z.object({
  clientId: z.string().uuid(),
  templateId: z.string().uuid(),
  jurisdictionProfileId: z.string().uuid().optional(),
  customTitle: z.string().optional(),
  contractValueMinor: z.number().int().nonnegative(),
  currency: z.string().default("CAD"),
  serviceOrder: z.record(z.any()).default({}),
  financialTerms: z.record(z.any()).default({}),
  signers: z.array(z.object({
    role: z.string(),
    fullName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    ordinal: z.number().int().positive().default(1),
  })).min(1),
});

export const createNativePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    // Resolve latest template version
    const { data: tv, error: tvErr } = await supabase
      .from("na_template_versions")
      .select("id, version, status, na_templates(id, default_jurisdiction_id, client_facing_title, service_type, requires_health_screening, countersignature_required)")
      .eq("template_id", data.templateId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tvErr || !tv) throw new Error("No template version available");

    const jurisdictionId = data.jurisdictionProfileId ?? tv.na_templates?.default_jurisdiction_id;
    if (!jurisdictionId) throw new Error("No jurisdiction profile resolved");

    const { data: jp } = await supabase
      .from("jurisdiction_profiles")
      .select("*")
      .eq("id", jurisdictionId)
      .maybeSingle();
    if (!jp) throw new Error("Jurisdiction not found");

    // Compute publication blockers (Manitoba spec): require business_address, disclosure_text, approved_cancellation_wording
    const blockers: string[] = [];
    if (!jp.business_address) blockers.push("missing_business_address");
    if (jp.requires_cancellation_disclosure && !jp.approved_cancellation_wording) blockers.push("missing_cancellation_wording");
    if (!jp.legal_operator_name) blockers.push("missing_legal_operator");
    const jurisdictionSupported = jp.status === "published";
    const initialStatus = !jurisdictionSupported ? "unsupported_jurisdiction" : (blockers.length > 0 || tv.status !== "published" ? "legal_review_required" : "draft");

    const { data: pkg, error: pErr } = await supabase
      .from("na_packages")
      .insert({
        client_id: data.clientId,
        template_version_id: tv.id,
        jurisdiction_profile_id: jurisdictionId,
        custom_title: data.customTitle ?? tv.na_templates?.client_facing_title,
        status: initialStatus,
        service_order: data.serviceOrder,
        financial_terms: data.financialTerms,
        contract_value_minor: data.contractValueMinor,
        currency: data.currency,
        active_modules: [],
        jurisdiction_supported: jurisdictionSupported,
        jurisdiction_block_reasons: blockers,
        created_by: userId,
      })
      .select()
      .single();
    if (pErr) throw new Error(pErr.message);

    for (const s of data.signers) {
      await supabase.from("na_signers").insert({
        package_id: pkg.id,
        role: s.role,
        ordinal: s.ordinal,
        full_name: s.fullName,
        email: s.email.toLowerCase(),
        phone: s.phone ?? null,
      });
    }

    await supabase.from("na_events").insert({
      package_id: pkg.id,
      event_type: "package.created",
      actor_user_id: userId,
      actor_role: "admin",
      details: { template_version_id: tv.id, blockers, status: initialStatus },
    });

    return { packageId: pkg.id, status: initialStatus, blockers };
  });

export const sealAndSendPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packageId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: pkg } = await supabase.from("na_packages").select("*, na_template_versions(*, na_templates(*)), jurisdiction_profiles(*)").eq("id", data.packageId).maybeSingle();
    if (!pkg) throw new Error("Package not found");
    if (pkg.status === "sent" || pkg.status === "completed") throw new Error("Package already sent");
    if (!pkg.jurisdiction_supported) throw new Error("Jurisdiction not supported — cannot send");
    if ((pkg.jurisdiction_block_reasons ?? []).length > 0) throw new Error("Publication blockers must be resolved: " + (pkg.jurisdiction_block_reasons as string[]).join(", "));

    const { data: signers } = await supabase.from("na_signers").select("*").eq("package_id", data.packageId).order("ordinal");
    if (!signers || signers.length === 0) throw new Error("At least one signer is required");

    // Build snapshot content
    const snapshotContent = {
      package: {
        id: pkg.id,
        title: pkg.custom_title,
        contract_value_minor: pkg.contract_value_minor,
        currency: pkg.currency,
        service_order: pkg.service_order,
        financial_terms: pkg.financial_terms,
      },
      template: pkg.na_template_versions?.na_templates,
      template_version: { id: pkg.na_template_versions?.id, version: pkg.na_template_versions?.version },
      jurisdiction: pkg.jurisdiction_profiles,
      signers: signers.map((s: any) => ({ id: s.id, role: s.role, full_name: s.full_name, email: s.email, ordinal: s.ordinal })),
      generated_at: new Date().toISOString(),
    };
    const canonical = canonicalize(snapshotContent);
    const snapshotHash = sha256(canonical);

    // Insert snapshot (sealed). Admin client because trigger blocks update; insert sealed=true directly.
    const { data: snap, error: snapErr } = await supabaseAdmin
      .from("na_snapshots")
      .insert({
        package_id: pkg.id,
        snapshot_hash: snapshotHash,
        content: snapshotContent,
        jurisdiction_profile_snapshot: pkg.jurisdiction_profiles,
        template_version_snapshot: pkg.na_template_versions,
        modules_snapshot: [],
        service_order_snapshot: pkg.service_order,
        financial_terms_snapshot: pkg.financial_terms,
        signers_snapshot: snapshotContent.signers,
        required_acknowledgements_snapshot: [],
        sealed: true,
        sealed_at: new Date().toISOString(),
        created_by: userId,
      })
      .select()
      .single();
    if (snapErr) throw new Error(snapErr.message);

    // Generate guest tokens for every signer
    const tokens: { signerId: string; token: string; email: string; signingUrl: string }[] = [];
    for (const s of signers) {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = sha256(rawToken);
      const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const { error: gtErr } = await supabaseAdmin.from("na_guest_tokens").insert({
        package_id: pkg.id,
        signer_id: s.id,
        token_hash: tokenHash,
        email_to_verify: s.email,
        expires_at: expires,
      });
      if (gtErr) throw new Error(gtErr.message);
      await supabase.from("na_signers").update({ status: "invited", invited_at: new Date().toISOString() }).eq("id", s.id);
      tokens.push({ signerId: s.id, token: rawToken, email: s.email, signingUrl: `/sign/${rawToken}` });
    }

    await supabase.from("na_packages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", pkg.id);
    await supabase.from("na_events").insert({
      package_id: pkg.id,
      snapshot_id: snap.id,
      event_type: "package.sent",
      actor_user_id: userId,
      actor_role: "admin",
      details: { snapshot_hash: snapshotHash, signer_count: signers.length },
    });

    return { snapshotId: snap.id, snapshotHash, signingLinks: tokens };
  });

export const voidPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packageId: string; reason: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("na_packages").update({
      status: "voided", voided_at: new Date().toISOString(), voided_by: userId, void_reason: data.reason,
    }).eq("id", data.packageId);
    if (error) throw new Error(error.message);
    await supabase.from("na_events").insert({
      package_id: data.packageId, event_type: "package.voided",
      actor_user_id: userId, actor_role: "admin", details: { reason: data.reason },
    });
    return { ok: true };
  });

// ---------- Guest signing (no auth middleware) ----------

export const getGuestSigningContext = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = sha256(data.token);
    const { data: gt } = await supabaseAdmin
      .from("na_guest_tokens")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!gt) throw new Error("Invalid signing link");
    if (gt.revoked_at) throw new Error("This signing link has been revoked");
    if (gt.used_at) throw new Error("This signing link has already been used");
    if (new Date(gt.expires_at).getTime() < Date.now()) throw new Error("This signing link has expired");

    const { data: pkg } = await supabaseAdmin
      .from("na_packages")
      .select("id, status, custom_title, contract_value_minor, currency, service_order, financial_terms, jurisdiction_profiles(display_name, legal_operator_name, business_address)")
      .eq("id", gt.package_id)
      .maybeSingle();
    if (!pkg) throw new Error("Package not found");
    if (!["sent", "delivered", "viewed", "in_progress"].includes(pkg.status)) {
      throw new Error("This agreement is no longer available for signing (status: " + pkg.status + ")");
    }

    const { data: signer } = await supabaseAdmin.from("na_signers").select("*").eq("id", gt.signer_id).maybeSingle();
    const { data: snap } = await supabaseAdmin
      .from("na_snapshots")
      .select("id, snapshot_hash, content, sealed_at")
      .eq("package_id", gt.package_id)
      .eq("sealed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) throw new Error("Snapshot missing");

    // Mark first-view if not already
    if (!pkg.first_viewed_at) {
      await supabaseAdmin.from("na_packages").update({ first_viewed_at: new Date().toISOString(), status: pkg.status === "sent" ? "viewed" : pkg.status }).eq("id", pkg.id);
      await supabaseAdmin.from("na_events").insert({
        package_id: pkg.id, snapshot_id: snap.id, signer_id: signer?.id,
        event_type: "package.viewed", actor_role: "signer", details: { via: "guest_token" },
      });
    }

    return {
      package: pkg,
      signer,
      snapshot: snap,
      guestTokenId: gt.id,
    };
  });

const SubmitSig = z.object({
  token: z.string(),
  typedLegalName: z.string().min(2),
  intentWording: z.string().min(1),
  timezone: z.string().optional(),
  signatureRepresentation: z.string().optional(),
});

export const submitGuestSignature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SubmitSig.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = sha256(data.token);
    const { data: gt } = await supabaseAdmin.from("na_guest_tokens").select("*").eq("token_hash", tokenHash).maybeSingle();
    if (!gt) throw new Error("Invalid signing link");
    if (gt.revoked_at || gt.used_at) throw new Error("Link no longer valid");
    if (new Date(gt.expires_at).getTime() < Date.now()) throw new Error("Link expired");

    const { data: snap } = await supabaseAdmin
      .from("na_snapshots")
      .select("id, snapshot_hash")
      .eq("package_id", gt.package_id)
      .eq("sealed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) throw new Error("Snapshot missing");

    const { data: signer } = await supabaseAdmin.from("na_signers").select("*").eq("id", gt.signer_id).maybeSingle();
    if (!signer) throw new Error("Signer missing");

    if (signer.full_name.trim().toLowerCase() !== data.typedLegalName.trim().toLowerCase()) {
      throw new Error("Typed name must match the signer name on file");
    }

    // Insert signature (unique on snapshot+signer prevents dup)
    const { error: sigErr } = await supabaseAdmin.from("na_signatures").insert({
      package_id: gt.package_id,
      snapshot_id: snap.id,
      signer_id: signer.id,
      snapshot_hash: snap.snapshot_hash,
      signer_role: signer.role,
      typed_legal_name: data.typedLegalName,
      signature_method: "typed",
      signature_representation: data.signatureRepresentation ?? data.typedLegalName,
      intent_wording: data.intentWording,
      signer_timezone: data.timezone ?? null,
      verification_method: "guest_token",
      guest_token_id: gt.id,
    });
    if (sigErr) throw new Error(sigErr.message);

    await supabaseAdmin.from("na_signers").update({ status: "signed", signed_at: new Date().toISOString() }).eq("id", signer.id);
    await supabaseAdmin.from("na_guest_tokens").update({ used_at: new Date().toISOString() }).eq("id", gt.id);
    await supabaseAdmin.from("na_events").insert({
      package_id: gt.package_id, snapshot_id: snap.id, signer_id: signer.id,
      event_type: "signature.captured", actor_role: "signer", details: { method: "typed" },
    });

    // Check completion: all signers signed?
    const { data: allSigners } = await supabaseAdmin.from("na_signers").select("id, status").eq("package_id", gt.package_id);
    const allSigned = (allSigners ?? []).every((s: any) => s.status === "signed");
    if (allSigned) {
      await supabaseAdmin.from("na_packages").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", gt.package_id);
      await supabaseAdmin.from("na_events").insert({
        package_id: gt.package_id, snapshot_id: snap.id,
        event_type: "package.completed", actor_role: "system", details: {},
      });
      // Render PDF asynchronously (best-effort)
      try {
        const { renderAgreementPdf } = await import("@/lib/native-agreements-pdf.server");
        await renderAgreementPdf(gt.package_id);
      } catch (e) {
        await supabaseAdmin.from("na_events").insert({
          package_id: gt.package_id, snapshot_id: snap.id,
          event_type: "pdf.render_failed", actor_role: "system",
          details: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    return { ok: true, completed: allSigned };
  });

export const generateAgreementPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packageId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { renderAgreementPdf } = await import("@/lib/native-agreements-pdf.server");
    const res = await renderAgreementPdf(data.packageId);
    return res;
  });