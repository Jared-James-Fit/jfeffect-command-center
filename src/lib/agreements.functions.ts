import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdminOrCoach(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("coach")) {
    throw new Error("Forbidden");
  }
  return roles;
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
    const token = process.env.SIGNNOW_API_TOKEN;
    const now = new Date().toISOString();
    if (!token) {
      const result = "No SIGNNOW_API_TOKEN configured — running in Manual Mode.";
      await supabase.from("signnow_settings").update({
        status: "Manual Mode", last_test_at: now, last_test_result: result,
      } as any).eq("singleton", true);
      return { mode: "manual", ok: true, message: result };
    }
    try {
      const res = await fetch("https://api.signnow.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const ok = res.ok;
      const body = await res.text();
      let email: string | null = null;
      try { email = JSON.parse(body)?.primary_email ?? null; } catch { /* ignore */ }
      const result = ok
        ? `Connected as ${email ?? "SignNow user"}.`
        : `SignNow API error ${res.status}: ${body.slice(0, 200)}`;
      await supabase.from("signnow_settings").update({
        status: ok ? "Connected" : "Error",
        account_email: email,
        last_test_at: now,
        last_test_result: result,
      } as any).eq("singleton", true);
      return { mode: "api", ok, message: result };
    } catch (e: any) {
      const result = `SignNow connection failed: ${e?.message ?? "unknown error"}`;
      await supabase.from("signnow_settings").update({
        status: "Error", last_test_at: now, last_test_result: result,
      } as any).eq("singleton", true);
      return { mode: "api", ok: false, message: result };
    }
  });

// ---- Agreements ----

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
        "In-Person / iPad",
        "Kiosk Mode",
        "Manual Upload",
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
    const initialStatus = data.status_override
      ? data.status_override
      : data.send_now
        ? (data.signing_method === "Remote Invite" ? "Waiting on Client" : "Sent")
        : "Not Sent";
    const { data: ag, error } = await supabase.from("agreements").insert({
      client_id: data.client_id,
      template_id: data.template_id ?? null,
      template_name,
      agreement_type,
      signnow_template_id,
      signnow_signing_link: data.signnow_signing_link ?? null,
      purchase_record_id: data.purchase_record_id ?? null,
      offer_name: data.offer_name ?? null,
      client_full_name: client.full_name,
      client_email: client.email,
      client_phone: client.phone,
      client_address: address,
      correct_client_name: client.full_name,
      status: initialStatus,
      sent_at: data.send_now ? now : null,
      admin_notes: data.admin_notes ?? null,
      signing_method: data.signing_method ?? null,
      signed_in_person: inPerson,
      created_by: userId,
    } as any).select("*").single();
    if (error) throw new Error(error.message);

    await supabase.from("agreement_audit_log").insert({
      agreement_id: ag.id,
      event: data.send_now
        ? (data.signing_method === "Remote Invite" ? "invited" : "in_person_started")
        : "created",
      actor_role: "admin",
      actor_user_id: userId,
      details: { signing_method: data.signing_method ?? null } as any,
    } as any);

    return ag;
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
    await supabase.from("agreements")
      .update({ last_reminder_at: new Date().toISOString() } as any).eq("id", data.id);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id, event: "reminder_sent",
      actor_role: "admin", actor_user_id: userId,
    } as any);
    return { ok: true };
  });

export const cancelAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { error } = await supabase.from("agreements")
      .update({ status: "Cancelled", cancelled_at: new Date().toISOString() } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.id, event: "cancelled",
      actor_role: "admin", actor_user_id: userId,
    } as any);
    return { ok: true };
  });