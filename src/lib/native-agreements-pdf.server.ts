import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

const RENDERER = "pdf-lib";
const RENDERER_VERSION = "1.1.0";
const BUCKET = "agreement-pdfs";

type SnapshotSource = {
  source_pdf_bucket: string | null;
  source_pdf_path: string | null;
  source_pdf_sha256: string | null;
};

async function ensureBucket() {
  try {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  } catch {
    // The private bucket may already exist.
  }
}

function wrap(text: string, max: number): string[] {
  const words = String(text ?? "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function loadImmutableSourcePdf(snapshot: SnapshotSource) {
  if (!snapshot.source_pdf_bucket || !snapshot.source_pdf_path || !snapshot.source_pdf_sha256) {
    throw new Error("Sealed agreement snapshot is missing its immutable source PDF reference");
  }

  const { data: sourceBlob, error } = await supabaseAdmin.storage
    .from(snapshot.source_pdf_bucket)
    .download(snapshot.source_pdf_path);
  if (error || !sourceBlob)
    throw new Error(error?.message ?? "Could not retrieve the immutable source PDF");

  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceHash !== snapshot.source_pdf_sha256) {
    throw new Error("Immutable source PDF hash mismatch");
  }

  return PDFDocument.load(sourceBytes, { updateMetadata: false });
}

export async function renderAgreementPdf(packageId: string): Promise<{
  documentId: string;
  storagePath: string;
  finalPdfHash: string;
  byteSize: number;
}> {
  const { data: pkg, error: packageError } = await supabaseAdmin
    .from("na_packages")
    .select("id, client_id, template_version_id")
    .eq("id", packageId)
    .maybeSingle();
  if (packageError || !pkg) throw new Error(packageError?.message ?? "Package not found");

  const { data: snapshot, error: snapshotError } = await supabaseAdmin
    .from("na_snapshots")
    .select("id, snapshot_hash, source_pdf_bucket, source_pdf_path, source_pdf_sha256")
    .eq("package_id", packageId)
    .eq("sealed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotError || !snapshot) throw new Error(snapshotError?.message ?? "No sealed snapshot");

  const { data: existing } = await supabaseAdmin
    .from("na_documents")
    .select("id, storage_path, final_pdf_hash, byte_size")
    .eq("package_id", packageId)
    .eq("kind", "agreement_pdf")
    .eq("snapshot_hash", snapshot.snapshot_hash)
    .order("document_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.storage_path && existing.final_pdf_hash) {
    await supabaseAdmin
      .from("na_packages")
      .update({
        artifact_status: "ready",
        artifact_error: null,
        artifact_ready_at: new Date().toISOString(),
      })
      .eq("id", packageId);
    return {
      documentId: existing.id,
      storagePath: existing.storage_path,
      finalPdfHash: existing.final_pdf_hash,
      byteSize: Number(existing.byte_size ?? 0),
    };
  }

  const signaturesResult = await supabaseAdmin
    .from("na_signatures")
    .select(
      "signer_role, typed_legal_name, signature_method, signature_representation, signed_at_server, snapshot_hash, intent_wording",
    )
    .eq("package_id", packageId)
    .order("signed_at_server");
  if (signaturesResult.error) throw new Error(signaturesResult.error.message);

  const document = await loadImmutableSourcePdf(snapshot);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([612, 792]);
  let y = 752;
  const x = 54;
  const lineHeight = 15;

  const line = (value: string, options: { size?: number; bold?: boolean } = {}) => {
    const size = options.size ?? 10;
    if (y < 48) return;
    page.drawText(value, {
      x,
      y,
      size,
      font: options.bold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= lineHeight + (options.size ? 2 : 0);
  };
  const paragraph = (value: string) => {
    for (const item of wrap(value, 88)) line(item);
    y -= 4;
  };

  line("JF Effect — Signed Agreement Certificate", { size: 15, bold: true });
  line(`Package ID: ${packageId}`);
  line(`Sealed snapshot: ${snapshot.snapshot_hash}`);
  line(`Authoritative source PDF hash: ${snapshot.source_pdf_sha256}`);
  line(
    "The preceding pages are the immutable authoritative agreement source. This certificate records the signature evidence bound to that source snapshot.",
  );
  y -= 6;
  line("Signatures", { size: 12, bold: true });
  for (const signature of signaturesResult.data ?? []) {
    line(`${String(signature.signer_role).toUpperCase()}: ${signature.typed_legal_name}`, {
      bold: true,
    });
    line(
      `Method: ${signature.signature_method} · Signed: ${new Date(signature.signed_at_server).toISOString()}`,
    );
    paragraph(`Intent: ${signature.intent_wording}`);
  }
  line(`Renderer: ${RENDERER} ${RENDERER_VERSION}`);
  line(`Certificate generated: ${new Date().toISOString()}`);

  const pdfBytes = await document.save();
  const finalPdfHash = createHash("sha256").update(pdfBytes).digest("hex");
  const storagePath = `native-signed/${pkg.client_id}/${packageId}/${snapshot.snapshot_hash}.pdf`;

  await ensureBucket();
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);

  const { data: versionRows, error: versionError } = await supabaseAdmin
    .from("na_documents")
    .select("document_version")
    .eq("package_id", packageId)
    .eq("kind", "agreement_pdf")
    .order("document_version", { ascending: false })
    .limit(1);
  if (versionError) throw new Error(versionError.message);
  const nextVersion = Number(versionRows?.[0]?.document_version ?? 0) + 1;

  const { data: documentRow, error: documentError } = await supabaseAdmin
    .from("na_documents")
    .insert({
      package_id: packageId,
      snapshot_id: snapshot.id,
      kind: "agreement_pdf",
      document_version: nextVersion,
      snapshot_hash: snapshot.snapshot_hash,
      final_pdf_hash: finalPdfHash,
      renderer: RENDERER,
      renderer_version: RENDERER_VERSION,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      byte_size: pdfBytes.byteLength,
      generated_at: new Date().toISOString(),
      drive_sync_status: "pending",
    })
    .select()
    .single();
  if (documentError || !documentRow)
    throw new Error(documentError?.message ?? "Could not persist signed agreement document");

  await supabaseAdmin
    .from("na_packages")
    .update({
      artifact_status: "ready",
      artifact_error: null,
      artifact_ready_at: new Date().toISOString(),
    })
    .eq("id", packageId);
  await supabaseAdmin.from("na_events").insert({
    package_id: packageId,
    snapshot_id: snapshot.id,
    event_type: "pdf.generated",
    actor_role: "system",
    details: { final_pdf_hash: finalPdfHash, byte_size: pdfBytes.byteLength, version: nextVersion },
  });

  return {
    documentId: documentRow.id,
    storagePath,
    finalPdfHash,
    byteSize: pdfBytes.byteLength,
  };
}

export async function getSignedPdfUrl(
  documentId: string,
  expiresSec: number = 300,
): Promise<string> {
  const { data: documentRow, error } = await supabaseAdmin
    .from("na_documents")
    .select("storage_bucket, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !documentRow?.storage_path || !documentRow.storage_bucket) {
    throw new Error(error?.message ?? "Document not found");
  }
  const { data, error: urlError } = await supabaseAdmin.storage
    .from(documentRow.storage_bucket)
    .createSignedUrl(documentRow.storage_path, expiresSec);
  if (urlError || !data) throw new Error(urlError?.message ?? "Could not create signed URL");
  return data.signedUrl;
}
