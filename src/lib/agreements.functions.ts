import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  hasSignNowCredentials,
  whoami as signnowWhoami,
  listSignNowTemplates,
  copyTemplateToDocument,
  createSignNowInvite as apiCreateSignNowInvite,
  remindSignNowInvite,
  SignNowNotConfiguredError,
  SignNowApiError,
} from "@/lib/signnow.server";

async function assertAdminOrCoach(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("coach")) {
    throw new Error("Forbidden");
  }
  return roles;
}

/**
 * Resolve the caller's effective role for a given client_id.
 * - "admin"  → unrestricted
 * - "coach"  → only if assigned to that client (is_assigned_coach)
 * - "owner"  → the signed-in user IS the client (clients.user_id = auth.uid())
 * Throws "Forbidden" otherwise.
 *
 * This is intentionally redundant with RLS: it gives server-fn code an
 * explicit, auditable permission gate that does not silently degrade if RLS
 * is ever changed.
 */
async function assertClientAccess(
  supabase: any,
  userId: string,
  clientId: string,
): Promise<"admin" | "coach" | "owner"> {
  const { data: rolesRows } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (rolesRows ?? []).map((r: any) => r.role);
  if (roles.includes("admin")) return "admin";

  // Client owner?
  const { data: ownerRow } = await supabase
    .from("clients").select("id").eq("id", clientId).eq("user_id", userId).maybeSingle();
  if (ownerRow) return "owner";

  // Assigned coach? Check via the security-definer RPC used by RLS.
  if (roles.includes("coach")) {
    const { data: isCoach } = await supabase.rpc("is_assigned_coach", { _client_id: clientId });
    if (isCoach === true) return "coach";
  }

  throw new Error("Forbidden");
}

function nameNormalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ---- Templates ----

const TemplateInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  signnow_template_id: z.string().max(200).optional().nullable(),
  signnow_url: z.string().url().max(500).optional().nullable(),
  agreement_type: z.string().max(120).optional().nullable(),
  version: z.string().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const createTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TemplateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { data: tpl, error } = await supabase
      .from("agreement_templates")
      .insert({
        name: data.name,
        description: data.description ?? null,
        signnow_template_id: data.signnow_template_id ?? null,
        signnow_url: data.signnow_url ?? null,
        agreement_type: data.agreement_type ?? null,
        version: data.version ?? "1",
        notes: data.notes ?? null,
        is_active: data.is_active ?? true,
        created_by: userId,
      } as any)
      .select("*").single();
    if (error) throw new Error(error.message);
    return tpl;
  });

export const updateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).merge(TemplateInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { id, ...patch } = data;
    const { error } = await supabase.from("agreement_templates").update(patch as any).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const archiveTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { error } = await supabase.from("agreement_templates")
      .update({ archived: true, is_active: false } as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTemplateActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { error } = await supabase.from("agreement_templates")
      .update({ is_active: data.is_active } as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- SignNow settings ----

export const updateSignNowSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      status: z.string().max(40).optional(),
      account_email: z.string().email().max(200).nullable().optional(),
      default_template_id: z.string().uuid().nullable().optional(),
      auto_reminders_enabled: z.boolean().optional(),
      signnow_dashboard_url: z.string().url().max(500).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      api_client_id: z.string().max(200).nullable().optional(),
      api_basic_auth_token: z.string().max(500).nullable().optional(),
      redirect_uri: z.string().url().max(500).nullable().optional(),
      app_mode_note: z.string().max(500).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("signnow_settings")
      .update(data as any).eq("singleton", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testSignNowConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const now = new Date().toISOString();
    if (!hasSignNowCredentials()) {
      const result = "No SignNow OAuth credentials configured — running in Manual Mode Only.";
      await supabase.from("signnow_settings").update({
        status: "Manual Mode Only",
        last_test_at: now,
        last_test_result: result,
        access_token_status: "Missing",
        refresh_token_status: "Missing",
        last_error: null,
      } as any).eq("singleton", true);
      return { mode: "manual", ok: true, message: result };
    }
    try {
      const { email } = await signnowWhoami();
      const result = `Connected as ${email ?? "SignNow user"}.`;
      await supabase.from("signnow_settings").update({
        status: "Connected",
        account_email: email,
        last_test_at: now,
        last_test_result: result,
        access_token_status: "Valid",
        last_error: null,
      } as any).eq("singleton", true);
      return { mode: "api", ok: true, message: result };
    } catch (e: any) {
      const isConfig = e instanceof SignNowNotConfiguredError;
      const result = isConfig
        ? "SignNow API not configured — Manual Mode Only."
        : `SignNow connection failed: ${e?.message ?? "unknown error"}`;
      await supabase.from("signnow_settings").update({
        status: isConfig ? "Manual Mode Only" : "Error",
        last_test_at: now,
        last_test_result: result,
        last_error: isConfig ? null : result,
        access_token_status: isConfig ? "Missing" : "Invalid",
      } as any).eq("singleton", true);
      return { mode: isConfig ? "manual" : "api", ok: false, message: result };
    }
  });

// ---- Agreements ----

// Pulls templates from SignNow and upserts matches into agreement_templates by signnow_template_id.
// New templates appear as inactive so admin can review names/types before exposing them.
export const syncSignNowTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    if (!hasSignNowCredentials()) {
      throw new Error("SignNow API is not configured. Add the SIGNNOW_* secrets to enable template sync.");
    }
    const remote = await listSignNowTemplates();
    const { data: existing } = await supabase
      .from("agreement_templates")
      .select("id, signnow_template_id, name, is_active");
    const byId = new Map<string, any>();
    for (const t of existing ?? []) {
      if (t.signnow_template_id) byId.set(t.signnow_template_id, t);
    }
    let created = 0;
    let updated = 0;
    for (const r of remote) {
      const match = byId.get(r.id);
      if (match) {
        if (match.name !== r.name) {
          await supabase.from("agreement_templates")
            .update({ name: r.name } as any).eq("id", match.id);
          updated += 1;
        }
      } else {
        await supabase.from("agreement_templates").insert({
          name: r.name,
          signnow_template_id: r.id,
          version: "1",
          is_active: false,
          created_by: userId,
          notes: "Synced from SignNow. Review and activate.",
        } as any);
        created += 1;
      }
    }
    await supabase.from("signnow_settings").update({
      last_synced_at: new Date().toISOString(),
    } as any).eq("singleton", true);
    return { ok: true, total: remote.length, created, updated };
  });

export const createAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      template_id: z.string().uuid().nullable().optional(),
      agreement_type: z.string().max(120).optional().nullable(),
      signnow_signing_link: z.string().url().max(500).optional().nullable(),
      purchase_record_id: z.string().uuid().optional().nullable(),
      offer_name: z.string().max(200).optional().nullable(),
      send_now: z.boolean().optional(),
      admin_notes: z.string().max(2000).optional().nullable(),
      signing_method: z.enum([
        "Remote Invite",
        "Manual Link",
      ]).optional(),
      status_override: z.string().max(60).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { data: client, error: cErr } = await supabase
      .from("clients").select("id, full_name, email, phone, address, city, province, postal_code, country")
      .eq("id", data.client_id).single();
    if (cErr) throw new Error(cErr.message);

    let template_name = "Custom Agreement";
    let agreement_type = data.agreement_type ?? null;
    let signnow_template_id: string | null = null;
    if (data.template_id) {
      const { data: tpl } = await supabase
        .from("agreement_templates").select("name, agreement_type, signnow_template_id")
        .eq("id", data.template_id).single();
      if (tpl) {
        template_name = tpl.name;
        agreement_type = agreement_type ?? tpl.agreement_type;
        signnow_template_id = tpl.signnow_template_id ?? null;
      }
    }

    const address = [client.address, client.city, client.province, client.postal_code, client.country]
      .filter(Boolean).join(", ") || null;

    const now = new Date().toISOString();
    const inPerson = data.signing_method === "In-Person / iPad" || data.signing_method === "Kiosk Mode";

    // Real SignNow Invite (API mode) — only attempted for Remote Invite,
    // only when settings show Connected, credentials are present, the template has a
    // signnow_template_id, and the client has an email.
    let apiSigningLink: string | null = data.signnow_signing_link ?? null;
    let apiDocumentId: string | null = null;
    let apiError: string | null = null;
    let apiAttempted = false;
    if (
      data.send_now &&
      data.signing_method === "Remote Invite" &&
      signnow_template_id &&
      client.email &&
      hasSignNowCredentials()
    ) {
      const { data: settings } = await supabase
        .from("signnow_settings").select("status, account_email").eq("singleton", true).maybeSingle();
      if (settings?.status === "Connected" && settings?.account_email) {
        apiAttempted = true;
        try {
          const docName = `${template_name} — ${client.full_name}`;
          const documentId = await copyTemplateToDocument(signnow_template_id, docName);
          const invite = await apiCreateSignNowInvite({
            documentId,
            signerEmail: client.email,
            signerName: client.full_name,
            fromEmail: settings.account_email,
            subject: `Please sign: ${template_name}`,
            message: `Hi ${client.full_name ?? ""}, please review and sign your ${template_name}.`,
            expirationDays: 30,
          });
          apiDocumentId = documentId;
          apiSigningLink = invite.signingLink ?? apiSigningLink;
        } catch (e: any) {
          apiError = e instanceof SignNowApiError
            ? e.message
            : `SignNow invite failed: ${e?.message ?? "unknown error"}`;
        }
      }
    }

    const initialStatus = data.status_override
      ? data.status_override
      : apiError
        ? "Manual Action Needed"
        : apiAttempted && apiDocumentId
          ? "Waiting on Client"
      : data.send_now
        ? (data.signing_method === "Remote Invite" ? "Waiting on Client" : "Sent")
        : "Not Sent";
    const { data: ag, error } = await supabase.from("agreements").insert({
      client_id: data.client_id,
      template_id: data.template_id ?? null,
      template_name,
      agreement_type,
      signnow_template_id,
      signnow_signing_link: apiSigningLink,
      signnow_document_id: apiDocumentId,
      purchase_record_id: data.purchase_record_id ?? null,
      offer_name: data.offer_name ?? null,
      client_full_name: client.full_name,
      client_email: client.email,
      client_phone: client.phone,
      client_address: address,
      correct_client_name: client.full_name,
      status: initialStatus,
      sent_at: data.send_now && !apiError ? now : null,
      admin_notes: apiError
        ? `${data.admin_notes ? data.admin_notes + "\n\n" : ""}[SignNow API error] ${apiError}`
        : data.admin_notes ?? null,
      signing_method: data.signing_method ?? null,
      signed_in_person: inPerson,
      created_by: userId,
    } as any).select("*").single();
    if (error) throw new Error(error.message);

    await supabase.from("agreement_audit_log").insert({
      agreement_id: ag.id,
      event: apiError
        ? "invite_api_failed"
        : apiAttempted && apiDocumentId
          ? "invited_via_api"
          : data.send_now
            ? (data.signing_method === "Remote Invite" ? "invited_manual" : "in_person_started")
            : "created",
      actor_role: "admin",
      actor_user_id: userId,
      details: {
        signing_method: data.signing_method ?? null,
        api_attempted: apiAttempted,
        api_document_id: apiDocumentId,
        api_error: apiError,
      } as any,
    } as any);

    // Mirror high-level status to clients.agreement_status so dashboards/lists
    // stay accurate without requiring the agreements row to be re-read.
    await supabase.from("clients").update({
      agreement_status: initialStatus,
    } as any).eq("id", data.client_id);

    return { ...ag, _api_error: apiError, _api_attempted: apiAttempted, _api_document_id: apiDocumentId };
  });

export const updateAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.string().max(60).optional(),
      signnow_signing_link: z.string().url().max(500).nullable().optional(),
      signnow_completed_link: z.string().url().max(500).nullable().optional(),
      signnow_document_id: z.string().max(200).nullable().optional(),
      signed_copy_url: z.string().url().max(500).nullable().optional(),
      signed_copy_storage_path: z.string().max(500).nullable().optional(),
      drive_file_id: z.string().max(200).nullable().optional(),
      drive_file_url: z.string().url().max(500).nullable().optional(),
      signed_at: z.string().datetime().nullable().optional(),
      signer_name_in_signnow: z.string().max(200).nullable().optional(),
      offer_name: z.string().max(200).nullable().optional(),
      admin_notes: z.string().max(2000).nullable().optional(),
      sent_at: z.string().datetime().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { id, ...patch } = data;

    // Mismatch detection if signer name provided
    let mismatchPatch: any = {};
    if (patch.signer_name_in_signnow !== undefined) {
      const { data: cur } = await supabase.from("agreements")
        .select("correct_client_name, verification_status").eq("id", id).single();
      const correct = cur?.correct_client_name ?? "";
      const mm = !!patch.signer_name_in_signnow &&
        nameNormalize(patch.signer_name_in_signnow) !== nameNormalize(correct);
      mismatchPatch.signer_mismatch = mm;
      if (mm) mismatchPatch.verification_status = "Signer Name Mismatch";
    }

    const { error } = await supabase.from("agreements")
      .update({ ...patch, ...mismatchPatch } as any).eq("id", id);
    if (error) throw new Error(error.message);

    await supabase.from("agreement_audit_log").insert({
      agreement_id: id, event: "updated", actor_role: "admin", actor_user_id: userId,
      details: patch as any,
    } as any);
    return { ok: true };
  });

export const markAgreementSigned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      signed_at: z.string().datetime().optional(),
      signnow_completed_link: z.string().url().max(500).nullable().optional(),
      signnow_document_id: z.string().max(200).nullable().optional(),
      signer_name_in_signnow: z.string().max(200).nullable().optional(),
      signed_copy_url: z.string().url().max(500).nullable().optional(),
      signed_copy_storage_path: z.string().max(500).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { data: ag } = await supabase.from("agreements")
      .select("correct_client_name, client_id, purchase_record_id").eq("id", data.id).single();
    const correct = ag?.correct_client_name ?? "";
    const mm = !!data.signer_name_in_signnow &&
      nameNormalize(data.signer_name_in_signnow) !== nameNormalize(correct);
    const signedAt = data.signed_at ?? new Date().toISOString();
    const verification_status = mm
      ? "Signer Name Mismatch"
      : data.signer_name_in_signnow ? "Auto-Matched" : "Not Verified";
    const status = mm ? "Needs Manual Verification" : "Signed";
    const { error } = await supabase.from("agreements").update({
      status,
      signed_at: signedAt,
      completed_at: signedAt,
      signnow_completed_link: data.signnow_completed_link ?? null,
      signnow_document_id: data.signnow_document_id ?? null,
      signer_name_in_signnow: data.signer_name_in_signnow ?? null,
      signed_copy_url: data.signed_copy_url ?? null,
      signed_copy_storage_path: data.signed_copy_storage_path ?? null,
      signer_mismatch: mm,
      verification_status,
    } as any).eq("id", data.id);
    if (error) throw new Error(error.message);

    if (ag?.client_id) {
      await supabase.from("clients").update({
        agreement_signed: !mm,
        agreement_signed_date: signedAt.slice(0, 10),
        agreement_status: mm ? "Needs Manual Verification" : "Signed",
      } as any).eq("id", ag.client_id);
    }

    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id, event: mm ? "mismatch_flagged" : "signed",
      actor_role: "admin", actor_user_id: userId,
    } as any);
    return { ok: true, mismatch: mm };
  });

export const verifyAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      note: z.string().max(2000).optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { error } = await supabase.from("agreements").update({
      verification_status: "Manually Verified",
      verified_by: userId,
      verified_at: new Date().toISOString(),
      verification_note: data.note ?? null,
      status: "Verified",
    } as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id, event: "verified",
      actor_role: "admin", actor_user_id: userId,
      details: { note: data.note ?? null } as any,
    } as any);
    return { ok: true };
  });

export const sendAgreementReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { data: ag } = await supabase.from("agreements")
      .select("signnow_document_id, status").eq("id", data.id).single();
    let apiSent = false;
    let apiError: string | null = null;
    if (ag?.signnow_document_id && hasSignNowCredentials()) {
      try {
        await remindSignNowInvite(ag.signnow_document_id);
        apiSent = true;
      } catch (e: any) {
        apiError = e?.message ?? "SignNow reminder failed";
      }
    }
    await supabase.from("agreements")
      .update({ last_reminder_at: new Date().toISOString() } as any).eq("id", data.id);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id,
      event: apiSent ? "reminder_sent_api" : apiError ? "reminder_api_failed" : "reminder_logged",
      actor_role: "admin",
      actor_user_id: userId,
      details: { api_sent: apiSent, api_error: apiError } as any,
    } as any);
    return { ok: true, apiSent, apiError };
  });

export const cancelAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { data: ag } = await supabase.from("agreements").select("client_id").eq("id", data.id).single();
    const { error } = await supabase.from("agreements")
      .update({ status: "Cancelled", cancelled_at: new Date().toISOString() } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    if (ag?.client_id) {
      await supabase.from("clients")
        .update({ agreement_status: "Cancelled" } as any).eq("id", ag.client_id);
    }
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id, event: "cancelled",
      actor_role: "admin", actor_user_id: userId,
    } as any);
    return { ok: true };
  });

/** Manually refresh an agreement's status from SignNow and pull the signed
 *  PDF into storage if available. Safe to call repeatedly. */
export const refreshAgreementStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    if (!hasSignNowCredentials()) {
      return { ok: false, reason: "SignNow API not configured." };
    }
    const { pullSignedDocumentForAgreement } = await import("@/lib/agreements-pull.server");
    const result = await pullSignedDocumentForAgreement(data.id, { event: "manual_refresh" });
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id, event: "status_refreshed",
      actor_role: "admin", actor_user_id: userId,
      details: result as any,
    } as any);
    return result;
  });

/** Return a short-lived signed download URL for the stored signed PDF.
 *  Visible to admins/coaches and to the owning client. */
export const getSignedAgreementUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // RLS-scoped read: returns null for rows the caller can't see.
    const { data: ag, error } = await supabase
      .from("agreements")
      .select("id, client_id, signed_copy_storage_path, signed_copy_url, signnow_completed_link")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ag) throw new Error("Agreement not found");

    // Belt-and-suspenders: explicitly re-validate the caller can access this
    // agreement's client. Defends against future RLS regressions and produces
    // a clear server-side audit if someone tries to fish for IDs.
    const accessRole = await assertClientAccess(supabase, userId, ag.client_id);

    if (!ag.signed_copy_storage_path) {
      return {
        url: ag.signed_copy_url ?? ag.signnow_completed_link ?? null,
        source: ag.signed_copy_url ? "external" : ag.signnow_completed_link ? "signnow" : null,
        accessRole,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("agreements")
      .createSignedUrl(ag.signed_copy_storage_path, 60 * 10);
    if (sErr) throw new Error(sErr.message);
    return { url: signed?.signedUrl ?? null, source: "storage" as const, accessRole };
  });

/**
 * Return short-lived signed URLs for every signed PDF attached to a purchase
 * record. Requires the caller to have access to the purchase's client
 * (admin, assigned coach, or the client themselves).
 *
 * This is what UIs that show "download signed copy" on a purchase should call
 * — it never trusts a client-supplied agreement id and never accepts a raw
 * storage path.
 */
export const getSignedAgreementUrlsForPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ purchase_record_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Step 1: RLS-scoped purchase lookup — returns null if caller can't see it.
    const { data: purchase, error: pErr } = await supabase
      .from("purchase_records")
      .select("id, client_id")
      .eq("id", data.purchase_record_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!purchase) throw new Error("Purchase not found");

    // Step 2: Explicit re-validation against the purchase's client.
    const accessRole = await assertClientAccess(supabase, userId, purchase.client_id);

    // Step 3: Pull agreements linked to that purchase (RLS-scoped again).
    const { data: ags, error: aErr } = await supabase
      .from("agreements")
      .select("id, client_id, status, template_name, signed_at, signed_copy_storage_path, signed_copy_url, signnow_completed_link")
      .eq("purchase_record_id", purchase.id);
    if (aErr) throw new Error(aErr.message);

    // Step 4: Defence-in-depth — drop any row whose client_id drifted away
    // from the purchase. This should be impossible under current RLS but
    // guarantees we never mint a signed URL for an agreement that no longer
    // belongs to the validated client.
    const safe = (ags ?? []).filter((a) => a.client_id === purchase.client_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: Array<{
      id: string;
      template_name: string | null;
      status: string | null;
      signed_at: string | null;
      url: string | null;
      source: "storage" | "external" | "signnow" | null;
    }> = [];
    for (const a of safe) {
      let url: string | null = null;
      let source: "storage" | "external" | "signnow" | null = null;
      if (a.signed_copy_storage_path) {
        const { data: signed, error: sErr } = await supabaseAdmin.storage
          .from("agreements")
          .createSignedUrl(a.signed_copy_storage_path, 60 * 10);
        if (sErr) throw new Error(sErr.message);
        url = signed?.signedUrl ?? null;
        source = "storage";
      } else if (a.signed_copy_url) {
        url = a.signed_copy_url; source = "external";
      } else if (a.signnow_completed_link) {
        url = a.signnow_completed_link; source = "signnow";
      }
      out.push({
        id: a.id,
        template_name: a.template_name,
        status: a.status,
        signed_at: a.signed_at,
        url,
        source,
      });
    }
    return { accessRole, agreements: out };
  });