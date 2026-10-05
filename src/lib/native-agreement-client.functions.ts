import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, resolvePovClientId, resolvePovUserId, type PovArgs } from "@/lib/client-pov.server";
import { getSignedPdfUrl, renderAgreementPdf } from "@/lib/native-agreements-pdf.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isNativeSignatureMethod, requireKnownDateOfBirth } from "@/lib/native-agreement-contract";

const CLIENT_INTENT =
  "I have reviewed this agreement, intend to be legally bound by it, and submit this electronic signature voluntarily.";

async function resolveClientSigningContext(supabase: any, userId: string, packageId: string) {
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, user_id, date_of_birth, first_name, last_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (clientError || !client) throw new Error(clientError?.message ?? "Client profile not found");
  requireKnownDateOfBirth(client.date_of_birth);

  const { data: pkg, error: packageError } = await supabase
    .from("na_packages")
    .select(
      "*, na_snapshots(id, snapshot_hash, sealed, content, source_pdf_bucket, source_pdf_path, source_pdf_sha256), na_signers(*)",
    )
    .eq("id", packageId)
    .eq("client_id", client.id)
    .maybeSingle();
  if (packageError || !pkg) throw new Error(packageError?.message ?? "Agreement not found");

  const signer = (pkg.na_signers ?? []).find(
    (item: any) => item.role === "client" && item.user_id === userId,
  );
  if (!signer) throw new Error("You are not the authorized signer for this agreement");
  const snapshot = (pkg.na_snapshots ?? []).find((item: any) => item.sealed);
  if (!snapshot) throw new Error("Agreement snapshot is missing");

  return { client, pkg, signer, snapshot };
}

export const listClientNativeAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data: pov, context }) => {
    const { supabase, userId } = context as any;
    // Coach "View as client" lists the viewed client's agreements (read-only).
    const clientId = await resolvePovClientId(supabase, userId, pov);
    if (!clientId) throw new Error("Client profile not found");
    const client = { id: clientId };

    const { data, error } = await supabase
      .from("na_packages")
      .select(
        "id, custom_title, status, sent_at, completed_at, created_at, artifact_status, artifact_error, na_documents(id, generated_at)",
      )
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getClientNativeAgreement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { packageId: string } & PovArgs) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    // Viewing only: coach POV can open it, but signing/acknowledging stays
    // with the client's own session (those fns never accept POV args).
    const userId = await resolvePovUserId(supabase, context.userId, data);
    const { pkg, signer, snapshot } = await resolveClientSigningContext(
      supabase,
      userId,
      data.packageId,
    );
    return {
      package: pkg,
      signer,
      snapshot,
      intentWording: CLIENT_INTENT,
    };
  });

export const acknowledgeClientNativeAgreementReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { packageId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { pkg, signer, snapshot } = await resolveClientSigningContext(
      supabase,
      userId,
      data.packageId,
    );
    if (!["sent", "delivered", "viewed", "in_progress"].includes(pkg.status)) {
      throw new Error(`This agreement is not available for review (status: ${pkg.status})`);
    }
    const now = new Date().toISOString();
    await (supabaseAdmin as any)
      .from("na_packages")
      .update({
        first_viewed_at: pkg.first_viewed_at ?? now,
        status: pkg.status === "sent" ? "in_progress" : pkg.status,
      })
      .eq("id", pkg.id);
    await supabaseAdmin.from("na_events").insert({
      package_id: pkg.id,
      snapshot_id: snapshot.id,
      signer_id: signer.id,
      event_type: "agreement.review_acknowledged",
      actor_user_id: userId,
      actor_role: "client",
      details: { authenticated: true },
    });
    return { ok: true };
  });

export const getClientNativeAgreementSourcePdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { packageId: string } & PovArgs) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const userId = await resolvePovUserId(supabase, context.userId, data);
    const { snapshot } = await resolveClientSigningContext(supabase, userId, data.packageId);
    if (!snapshot.source_pdf_bucket || !snapshot.source_pdf_path) {
      throw new Error("The immutable agreement PDF is not available for this package");
    }
    const { data: signed, error } = await supabaseAdmin.storage
      .from(snapshot.source_pdf_bucket)
      .createSignedUrl(snapshot.source_pdf_path, 600);
    if (error || !signed) throw new Error(error?.message ?? "Could not open the agreement PDF");
    return { url: signed.signedUrl };
  });

const SubmitClientSignature = z.object({
  packageId: z.string().uuid(),
  typedLegalName: z.string().min(2),
  intentWording: z.string().min(1),
  signatureMethod: z.enum(["typed", "drawn"]),
  signatureRepresentation: z.string().min(1).max(500_000),
  timezone: z.string().optional(),
});

export const submitClientNativeAgreementSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SubmitClientSignature.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!isNativeSignatureMethod(data.signatureMethod))
      throw new Error("Unsupported signature method");
    const { pkg, signer, snapshot } = await resolveClientSigningContext(
      supabase,
      userId,
      data.packageId,
    );

    if (!["sent", "delivered", "viewed", "in_progress"].includes(pkg.status)) {
      throw new Error(`This agreement is not available for signing (status: ${pkg.status})`);
    }
    if (signer.status === "signed") throw new Error("This agreement has already been signed");
    if (signer.full_name.trim().toLowerCase() !== data.typedLegalName.trim().toLowerCase()) {
      throw new Error("Typed legal name must match the signer name on file");
    }
    if (data.intentWording !== CLIENT_INTENT) {
      throw new Error(
        "The required signing acknowledgement has changed. Please review and try again.",
      );
    }

    const now = new Date().toISOString();
    const { error: signatureError } = await supabaseAdmin.from("na_signatures").insert({
      package_id: pkg.id,
      snapshot_id: snapshot.id,
      signer_id: signer.id,
      snapshot_hash: snapshot.snapshot_hash,
      signer_role: "client",
      typed_legal_name: data.typedLegalName.trim(),
      signature_method: data.signatureMethod,
      signature_representation: data.signatureRepresentation,
      intent_wording: data.intentWording,
      signer_timezone: data.timezone ?? null,
      verification_method: "authenticated_session",
      auth_session_ref: userId,
    });
    if (signatureError) throw new Error(signatureError.message);

    await supabaseAdmin
      .from("na_signers")
      .update({ status: "signed", signed_at: now })
      .eq("id", signer.id);
    await (supabaseAdmin as any)
      .from("na_packages")
      .update({
        status: "completed",
        completed_at: now,
        artifact_status: "pending",
        artifact_error: null,
        artifact_requested_at: now,
        client_dob_checked_at: now,
      })
      .eq("id", pkg.id);
    await supabaseAdmin.from("na_events").insert([
      {
        package_id: pkg.id,
        snapshot_id: snapshot.id,
        signer_id: signer.id,
        event_type: "signature.captured",
        actor_user_id: userId,
        actor_role: "client",
        details: { method: data.signatureMethod, authenticated: true },
      },
      {
        package_id: pkg.id,
        snapshot_id: snapshot.id,
        event_type: "package.completed",
        actor_user_id: userId,
        actor_role: "client",
        details: { artifact_status: "pending" },
      },
    ]);

    // Rendering is intentionally independent of completion evidence. The durable pending
    // state allows support/admin retry without changing the sealed snapshot or signature.
    queueMicrotask(async () => {
      try {
        await renderAgreementPdf(pkg.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await (supabaseAdmin as any)
          .from("na_packages")
          .update({ artifact_status: "failed", artifact_error: message })
          .eq("id", pkg.id);
        await supabaseAdmin.from("na_events").insert({
          package_id: pkg.id,
          snapshot_id: snapshot.id,
          event_type: "pdf.render_failed",
          actor_role: "system",
          details: { error: message },
        });
      }
    });

    return { ok: true, completed: true, artifactStatus: "pending" as const };
  });

export const getClientNativeAgreementPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { documentId: string } & PovArgs) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) throw new Error("Client profile not found");
    const client = { id: clientId };

    const { data: doc, error } = await supabase
      .from("na_documents")
      .select("id, package_id, na_packages!inner(client_id, status, artifact_status)")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error || !doc || (doc.na_packages as any)?.client_id !== client.id) {
      throw new Error("Signed agreement not found");
    }
    if (
      (doc.na_packages as any)?.status !== "completed" ||
      (doc.na_packages as any)?.artifact_status !== "ready"
    ) {
      throw new Error("Signed copy is still being prepared");
    }
    return { url: await getSignedPdfUrl(data.documentId, 600) };
  });
