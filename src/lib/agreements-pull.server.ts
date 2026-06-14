/**
 * Server-only helpers for pulling SignNow document state into our DB
 * and downloading the signed PDF into the `agreements` storage bucket.
 *
 * Imported lazily from server functions and the webhook route (never from
 * client-reachable code at module scope).
 */
import { downloadSignedDocument, getSignNowDocument, hasSignNowCredentials } from "@/lib/signnow.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface PullResult {
  ok: boolean;
  status: string;
  storagePath: string | null;
  signerName: string | null;
  signedAt: string | null;
  mismatch: boolean;
  reason?: string;
}

/**
 * Refresh one agreement against SignNow. If completed/signed, downloads the
 * flattened PDF and stores it in the `agreements` bucket. Mirrors status to
 * `clients.agreement_status` when appropriate.
 */
export async function pullSignedDocumentForAgreement(
  agreementId: string,
  opts: { event?: string } = {},
): Promise<PullResult> {
  if (!hasSignNowCredentials()) {
    return { ok: false, status: "manual", storagePath: null, signerName: null, signedAt: null, mismatch: false, reason: "SignNow API not configured." };
  }

  const { data: ag, error: agErr } = await supabaseAdmin
    .from("agreements")
    .select("id, client_id, signnow_document_id, correct_client_name, signed_copy_storage_path, status")
    .eq("id", agreementId)
    .single();
  if (agErr || !ag) {
    return { ok: false, status: "missing", storagePath: null, signerName: null, signedAt: null, mismatch: false, reason: agErr?.message ?? "Agreement not found." };
  }
  if (!ag.signnow_document_id) {
    return { ok: false, status: ag.status, storagePath: ag.signed_copy_storage_path ?? null, signerName: null, signedAt: null, mismatch: false, reason: "No SignNow document id on this agreement." };
  }

  const nowIso = new Date().toISOString();
  const doc = await getSignNowDocument(ag.signnow_document_id);

  const patch: Record<string, any> = {
    webhook_last_event: opts.event ?? "refresh",
    webhook_last_event_at: nowIso,
  };
  if (doc.signerName) patch.signer_name_in_signnow = doc.signerName;

  let storagePath: string | null = ag.signed_copy_storage_path ?? null;
  const mismatch = !!doc.signerName && normalizeName(doc.signerName) !== normalizeName(ag.correct_client_name);

  if (doc.status === "completed" || doc.status === "signed") {
    // Download & upload signed PDF (idempotent)
    if (!storagePath) {
      const { bytes, contentType } = await downloadSignedDocument(ag.signnow_document_id);
      storagePath = ag.client_id
        ? `clients/${ag.client_id}/${ag.id}.pdf`
        : `unlinked/${ag.id}.pdf`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("agreements")
        .upload(storagePath, bytes, { contentType, upsert: true });
      if (upErr) {
        return { ok: false, status: doc.status, storagePath: null, signerName: doc.signerName, signedAt: doc.signedAt, mismatch, reason: upErr.message };
      }
      patch.signed_copy_storage_path = storagePath;
      patch.signed_pdf_pulled_at = nowIso;
    }
    const signedAt = doc.signedAt ?? nowIso;
    patch.signed_at = signedAt;
    patch.completed_at = signedAt;
    patch.status = mismatch ? "Needs Manual Verification" : "Signed";
    patch.signer_mismatch = mismatch;
    patch.verification_status = mismatch ? "Signer Name Mismatch" : (doc.signerName ? "Auto-Matched" : "Not Verified");
  } else if (doc.status === "cancelled") {
    patch.status = "Cancelled";
    patch.cancelled_at = nowIso;
  } else if (doc.status === "expired") {
    patch.status = "Expired";
  } else if (doc.status === "pending" && ag.status === "Not Sent") {
    patch.status = "Waiting on Client";
  }

  const { error: updErr } = await supabaseAdmin.from("agreements").update(patch as any).eq("id", ag.id);
  if (updErr) {
    return { ok: false, status: doc.status, storagePath, signerName: doc.signerName, signedAt: doc.signedAt, mismatch, reason: updErr.message };
  }

  // Mirror to clients table when terminal
  if (patch.status === "Signed" || patch.status === "Needs Manual Verification") {
    if (ag.client_id) {
      await supabaseAdmin.from("clients").update({
        agreement_signed: patch.status === "Signed",
        agreement_signed_date: (patch.signed_at as string).slice(0, 10),
        agreement_status: patch.status,
      } as any).eq("id", ag.client_id);
    }
  } else if (patch.status === "Cancelled" || patch.status === "Expired") {
    if (ag.client_id) {
      await supabaseAdmin.from("clients").update({ agreement_status: patch.status } as any).eq("id", ag.client_id);
    }
  }

  await supabaseAdmin.from("agreement_audit_log").insert({
    agreement_id: ag.id,
    event: opts.event ? `webhook:${opts.event}` : "status_refreshed",
    actor_role: "system",
    details: { signnow_status: doc.status, mismatch, signer: doc.signerName } as any,
  } as any);

  return { ok: true, status: patch.status ?? doc.status, storagePath, signerName: doc.signerName, signedAt: doc.signedAt, mismatch };
}

/** Look up agreement by signnow document id (webhook entry point). */
export async function findAgreementByDocumentId(documentId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("agreements")
    .select("id")
    .eq("signnow_document_id", documentId)
    .maybeSingle();
  return data?.id ?? null;
}