import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FieldSnapshot } from "./agreements";

async function assertAdminOrCoach(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("coach")) {
    throw new Error("Forbidden");
  }
  return roles;
}

// ---- Templates ----
export const createTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional().nullable(),
      pdf_storage_path: z.string().min(1),
      page_count: z.number().int().min(1).max(500),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: tpl, error } = await supabase
      .from("agreement_templates")
      .insert({
        name: data.name,
        description: data.description ?? null,
        pdf_storage_path: data.pdf_storage_path,
        page_count: data.page_count,
        created_by: userId,
      })
      .select("*").single();
    if (error) throw new Error(error.message);
    return tpl;
  });

export const saveTemplateFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      template_id: z.string().uuid(),
      fields: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0.005).max(1),
        height: z.number().min(0.005).max(1),
        field_type: z.string(),
        signer_role: z.string(),
        label: z.string().max(200).optional().nullable(),
        internal_name: z.string().min(1).max(120),
        required: z.boolean(),
        placeholder: z.string().max(200).optional().nullable(),
        options: z.array(z.string()).optional().default([]),
        sort_order: z.number().int().default(0),
      })),
      requires_coach_signature: z.boolean().optional(),
      supports_payor: z.boolean().optional(),
      supports_minor: z.boolean().optional(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Replace fields
    const { error: delErr } = await supabase
      .from("agreement_template_fields").delete().eq("template_id", data.template_id);
    if (delErr) throw new Error(delErr.message);
    if (data.fields.length) {
      const rows = data.fields.map((f, i) => ({
        template_id: data.template_id,
        page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
        field_type: f.field_type, signer_role: f.signer_role,
        label: f.label ?? null, internal_name: f.internal_name,
        required: f.required, placeholder: f.placeholder ?? null,
        options: f.options ?? [], sort_order: i,
      }));
      const { error: insErr } = await supabase
        .from("agreement_template_fields").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    const patch: any = { version: undefined };
    if (data.requires_coach_signature !== undefined) patch.requires_coach_signature = data.requires_coach_signature;
    if (data.supports_payor !== undefined) patch.supports_payor = data.supports_payor;
    if (data.supports_minor !== undefined) patch.supports_minor = data.supports_minor;
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    delete patch.version;
    if (Object.keys(patch).length) {
      const { error } = await supabase
        .from("agreement_templates").update(patch).eq("id", data.template_id);
      if (error) throw new Error(error.message);
    }
    // bump version
    const { data: cur } = await supabase
      .from("agreement_templates").select("version").eq("id", data.template_id).single();
    if (cur) {
      await supabase
        .from("agreement_templates")
        .update({ version: (cur.version ?? 1) + 1 })
        .eq("id", data.template_id);
    }
    return { ok: true };
  });

export const duplicateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ template_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: src, error } = await supabase
      .from("agreement_templates").select("*").eq("id", data.template_id).single();
    if (error) throw new Error(error.message);
    const { data: copy, error: cErr } = await supabase
      .from("agreement_templates").insert({
        name: `${src.name} (Copy)`,
        description: src.description,
        pdf_storage_path: src.pdf_storage_path,
        page_count: src.page_count,
        requires_coach_signature: src.requires_coach_signature,
        supports_payor: src.supports_payor,
        supports_minor: src.supports_minor,
        created_by: userId,
      }).select("*").single();
    if (cErr) throw new Error(cErr.message);
    const { data: fields } = await supabase
      .from("agreement_template_fields").select("*").eq("template_id", data.template_id);
    if (fields?.length) {
      const rows = fields.map((f: any) => ({
        template_id: copy.id, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
        field_type: f.field_type, signer_role: f.signer_role, label: f.label,
        internal_name: f.internal_name, required: f.required, placeholder: f.placeholder,
        options: f.options, sort_order: f.sort_order,
      }));
      await supabase.from("agreement_template_fields").insert(rows);
    }
    return copy;
  });

// ---- Agreements (instances) ----
export const assignAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      template_id: z.string().uuid(),
      purchase_record_id: z.string().uuid().optional().nullable(),
      payor_required: z.boolean().optional(),
      minor_required: z.boolean().optional(),
      expires_in_days: z.number().int().min(1).max(365).optional(),
      send_now: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Load template + fields
    const { data: tpl, error: tErr } = await supabaseAdmin
      .from("agreement_templates").select("*").eq("id", data.template_id).single();
    if (tErr) throw new Error(tErr.message);
    const { data: fields, error: fErr } = await supabaseAdmin
      .from("agreement_template_fields").select("*").eq("template_id", data.template_id).order("sort_order");
    if (fErr) throw new Error(fErr.message);

    // Copy template PDF to instances/<id>/source.pdf
    const agreementId = crypto.randomUUID();
    const sourceObj = await supabaseAdmin.storage.from("agreements").download(tpl.pdf_storage_path);
    if (sourceObj.error) throw new Error("Failed to read template PDF: " + sourceObj.error.message);
    const sourceBytes = new Uint8Array(await sourceObj.data.arrayBuffer());
    const sourcePath = `instances/${agreementId}/source.pdf`;
    const up = await supabaseAdmin.storage.from("agreements").upload(sourcePath, sourceBytes, {
      contentType: "application/pdf", upsert: true,
    });
    if (up.error) throw new Error("Failed to copy PDF: " + up.error.message);

    const fieldsSnapshot: FieldSnapshot[] = (fields ?? []).map((f: any) => ({
      id: f.id, page: f.page, x: Number(f.x), y: Number(f.y),
      width: Number(f.width), height: Number(f.height),
      field_type: f.field_type, signer_role: f.signer_role,
      label: f.label, internal_name: f.internal_name,
      required: f.required, placeholder: f.placeholder,
      options: f.options ?? [], sort_order: f.sort_order,
    }));

    const signingToken = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = data.expires_in_days
      ? new Date(Date.now() + data.expires_in_days * 86400_000).toISOString()
      : null;

    const { data: ag, error: aErr } = await supabaseAdmin.from("agreements").insert({
      id: agreementId,
      client_id: data.client_id,
      template_id: tpl.id,
      template_version: tpl.version,
      template_name: tpl.name,
      template_pdf_path: sourcePath,
      fields_snapshot: fieldsSnapshot as any,
      status: data.send_now ? "Sent" : "Not Sent",
      sent_at: data.send_now ? new Date().toISOString() : null,
      signing_token: signingToken,
      payor_required: !!data.payor_required,
      minor_required: !!data.minor_required,
      requires_coach_signature: tpl.requires_coach_signature,
      purchase_record_id: data.purchase_record_id ?? null,
      expires_at: expiresAt,
      created_by: userId,
    }).select("*").single();
    if (aErr) throw new Error(aErr.message);

    await supabaseAdmin.from("agreement_audit_log").insert({
      agreement_id: ag.id, event: data.send_now ? "sent" : "created",
      actor_role: "admin", actor_user_id: userId,
    });

    return ag;
  });

export const sendAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ agreement_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { error } = await supabase.from("agreements")
      .update({ status: "Sent", sent_at: new Date().toISOString() })
      .eq("id", data.agreement_id);
    if (error) throw new Error(error.message);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.agreement_id, event: "sent",
      actor_role: "admin", actor_user_id: userId,
    });
    return { ok: true };
  });

export const sendReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ agreement_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    await supabase.from("agreements")
      .update({ last_reminder_at: new Date().toISOString() })
      .eq("id", data.agreement_id);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.agreement_id, event: "reminder_sent",
      actor_role: "admin", actor_user_id: userId,
    });
    return { ok: true };
  });

export const cancelAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ agreement_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrCoach(supabase, userId);
    const { error } = await supabase.from("agreements")
      .update({ status: "Cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", data.agreement_id);
    if (error) throw new Error(error.message);
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.agreement_id, event: "cancelled",
      actor_role: "admin", actor_user_id: userId,
    });
    return { ok: true };
  });

export const recordAgreementOpened = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ agreement_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ag } = await supabase.from("agreements")
      .select("opened_at,status").eq("id", data.agreement_id).single();
    if (!ag) return { ok: false };
    const patch: any = {};
    if (!ag.opened_at) patch.opened_at = new Date().toISOString();
    if (ag.status === "Sent") patch.status = "Opened";
    if (Object.keys(patch).length) {
      await supabase.from("agreements").update(patch).eq("id", data.agreement_id);
    }
    await supabase.from("agreement_audit_log").insert({
      agreement_id: data.agreement_id, event: "opened",
      actor_role: "client", actor_user_id: userId,
    });
    return { ok: true };
  });

export const saveAgreementValues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      agreement_id: z.string().uuid(),
      values: z.array(z.object({
        internal_name: z.string(),
        signer_role: z.string(),
        field_type: z.string(),
        value_text: z.string().nullable().optional(),
        value_signature_data_url: z.string().nullable().optional(),
      })),
      signer_name: z.string().max(200).optional(),
      signer_email: z.string().max(200).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    for (const v of data.values) {
      // Validate signature size to prevent abuse
      if (v.value_signature_data_url && v.value_signature_data_url.length > 500_000) {
        throw new Error(`Signature for ${v.internal_name} exceeds 500KB`);
      }
      const { error } = await supabase.from("agreement_field_values")
        .upsert({
          agreement_id: data.agreement_id,
          field_internal_name: v.internal_name,
          signer_role: v.signer_role,
          field_type: v.field_type,
          value_text: v.value_text ?? null,
          value_signature_data_url: v.value_signature_data_url ?? null,
          signer_name: data.signer_name ?? null,
          signer_email: data.signer_email ?? null,
        }, { onConflict: "agreement_id,field_internal_name" });
      if (error) throw new Error(error.message);
    }
    // Mark in progress
    await supabase.from("agreements")
      .update({ status: "In Progress" })
      .eq("id", data.agreement_id)
      .in("status", ["Sent", "Opened"] as any);
    return { ok: true };
  });

export const submitAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      agreement_id: z.string().uuid(),
      signer_role: z.enum(["client", "coach", "payor", "parent_guardian"]),
      signer_name: z.string().min(1).max(200),
      signer_email: z.string().email().max(200),
      ip: z.string().max(64).optional().nullable(),
      user_agent: z.string().max(500).optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ag, error: aErr } = await supabaseAdmin
      .from("agreements").select("*").eq("id", data.agreement_id).single();
    if (aErr) throw new Error(aErr.message);

    const fields = (ag.fields_snapshot as unknown as FieldSnapshot[]) ?? [];
    const requiredForRole = fields.filter(
      (f) => f.signer_role === data.signer_role && f.required,
    );
    const { data: values } = await supabaseAdmin
      .from("agreement_field_values").select("*").eq("agreement_id", ag.id);
    const valuesByName = new Map(
      (values ?? []).map((v: any) => [v.field_internal_name, v]),
    );
    for (const f of requiredForRole) {
      const v = valuesByName.get(f.internal_name) as any;
      const hasText = v?.value_text && String(v.value_text).trim().length > 0;
      const hasSig = !!v?.value_signature_data_url;
      if (f.field_type === "signature" || f.field_type === "initial") {
        if (!hasSig) throw new Error(`Missing signature/initial for "${f.label || f.internal_name}"`);
      } else if (f.field_type === "checkbox") {
        if (v?.value_text !== "true") throw new Error(`Required checkbox "${f.label || f.internal_name}" not checked`);
      } else {
        if (!hasText) throw new Error(`Missing value for "${f.label || f.internal_name}"`);
      }
    }

    // Stamp signer audit info on this role's values
    await supabaseAdmin.from("agreement_field_values")
      .update({
        signed_at: new Date().toISOString(),
        signer_name: data.signer_name,
        signer_email: data.signer_email,
        signer_ip: data.ip ?? null,
        signer_user_agent: data.user_agent ?? null,
      })
      .eq("agreement_id", ag.id).eq("signer_role", data.signer_role);

    const patch: any = {};
    if (data.signer_role === "client") patch.client_signed_at = new Date().toISOString();
    if (data.signer_role === "coach") patch.coach_signed_at = new Date().toISOString();

    // Determine status — if client signed and coach signature required but missing, Waiting On Coach.
    const needsCoach = ag.requires_coach_signature && data.signer_role === "client" && !ag.coach_signed_at;
    const clientDone = ag.client_signed_at || data.signer_role === "client";
    const coachDone = !ag.requires_coach_signature || ag.coach_signed_at || data.signer_role === "coach";
    let allDone = clientDone && coachDone;
    if (needsCoach) allDone = false;
    if (allDone) {
      patch.status = "Completed";
      patch.completed_at = new Date().toISOString();
    } else if (needsCoach) {
      patch.status = "Waiting On Coach";
    } else {
      patch.status = "In Progress";
    }

    // Flatten PDF if complete
    if (allDone) {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const dl = await supabaseAdmin.storage.from("agreements").download(ag.template_pdf_path);
      if (dl.error) throw new Error("Failed to load source PDF");
      const srcBytes = new Uint8Array(await dl.data.arrayBuffer());
      const pdf = await PDFDocument.load(srcBytes);
      const helv = await pdf.embedFont(StandardFonts.Helvetica);
      const pages = pdf.getPages();
      const allValues = await supabaseAdmin
        .from("agreement_field_values").select("*").eq("agreement_id", ag.id);
      const vMap = new Map((allValues.data ?? []).map((v: any) => [v.field_internal_name, v]));
      for (const f of fields) {
        const v = vMap.get(f.internal_name) as any;
        if (!v) continue;
        const pageIdx = Math.min(f.page - 1, pages.length - 1);
        if (pageIdx < 0) continue;
        const page = pages[pageIdx];
        const { width: pw, height: ph } = page.getSize();
        const px = f.x * pw;
        const py = ph - (f.y * ph) - (f.height * ph);
        const pwBox = f.width * pw;
        const phBox = f.height * ph;
        if ((f.field_type === "signature" || f.field_type === "initial") && v.value_signature_data_url) {
          try {
            const dataUrl = v.value_signature_data_url as string;
            const b64 = dataUrl.split(",")[1] ?? "";
            const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const img = await pdf.embedPng(raw);
            const scale = Math.min(pwBox / img.width, phBox / img.height);
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            page.drawImage(img, { x: px, y: py, width: drawW, height: drawH });
          } catch (e) { /* skip bad sig */ }
        } else if (f.field_type === "checkbox") {
          if (v.value_text === "true") {
            page.drawText("X", { x: px + 2, y: py + 2, size: Math.min(phBox - 2, 12), font: helv, color: rgb(0, 0, 0) });
          }
        } else {
          const text = (v.value_text ?? "") as string;
          if (text) {
            const size = Math.min(phBox * 0.7, 11);
            page.drawText(text, { x: px + 2, y: py + (phBox - size) / 2, size, font: helv, color: rgb(0, 0, 0), maxWidth: pwBox - 4 });
          }
        }
      }
      // Audit page
      const auditPage = pdf.addPage();
      const { width, height } = auditPage.getSize();
      const lines = [
        "AGREEMENT AUDIT TRAIL",
        "",
        `Agreement: ${ag.template_name} (v${ag.template_version})`,
        `Agreement ID: ${ag.id}`,
        `Completed: ${new Date().toISOString()}`,
        "",
        "Signers:",
      ];
      for (const v of (allValues.data ?? [])) {
        if ((v as any).signed_at) {
          lines.push(`- ${(v as any).signer_role}: ${(v as any).signer_name ?? ""} <${(v as any).signer_email ?? ""}>`);
          lines.push(`  signed_at: ${(v as any).signed_at}  ip: ${(v as any).signer_ip ?? "n/a"}`);
        }
      }
      let cy = height - 60;
      for (const line of lines) {
        auditPage.drawText(line, { x: 50, y: cy, size: 10, font: helv, color: rgb(0, 0, 0) });
        cy -= 14;
      }
      const out = await pdf.save();
      const signedPath = `instances/${ag.id}/signed.pdf`;
      const upRes = await supabaseAdmin.storage.from("agreements")
        .upload(signedPath, out, { contentType: "application/pdf", upsert: true });
      if (upRes.error) throw new Error("Failed to save signed PDF: " + upRes.error.message);
      // hash
      const hash = await crypto.subtle.digest("SHA-256", out);
      const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
      patch.signed_pdf_path = signedPath;
      patch.signed_pdf_sha256 = hex;

      // Update client's agreement status fields
      await supabaseAdmin.from("clients").update({
        agreement_signed: true,
        agreement_signed_date: new Date().toISOString().slice(0, 10),
        agreement_status: "Signed",
        agreement_version: `v${ag.template_version}`,
      }).eq("id", ag.client_id);

      // Update purchase record if linked
      if (ag.purchase_record_id) {
        await supabaseAdmin.from("purchase_records").update({
          agreement_signed_at_purchase: true,
          agreement_signed_date: new Date().toISOString().slice(0, 10),
          agreement_version: `v${ag.template_version}`,
          agreement_link: signedPath,
        }).eq("id", ag.purchase_record_id);
      }
    }

    await supabaseAdmin.from("agreements").update(patch).eq("id", ag.id);
    await supabaseAdmin.from("agreement_audit_log").insert({
      agreement_id: ag.id,
      event: allDone ? "completed" : "signed",
      actor_role: data.signer_role,
      actor_user_id: userId,
      signer_name: data.signer_name,
      signer_email: data.signer_email,
      ip: data.ip ?? null,
      user_agent: data.user_agent ?? null,
    });

    return { ok: true, completed: allDone };
  });

export const getAgreementsNeedingAttention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("agreements")
      .select("id, client_id, template_name, status, sent_at, expires_at, clients(full_name)")
      .in("status", ["Sent", "Opened", "In Progress", "Waiting On Client", "Waiting On Coach", "Expired", "Needs Update"])
      .order("sent_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });