import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

const RENDERER = "pdf-lib";
const RENDERER_VERSION = "1.0.0";
const BUCKET = "agreement-pdfs";

async function ensureBucket() {
  try {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  } catch {
    // ignore — already exists
  }
}

function fmtMoney(minor: number | null | undefined, currency: string = "CAD") {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(minor / 100);
}

function wrap(text: string, max: number): string[] {
  const words = String(text ?? "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line ? line + " " : "") + w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderAgreementPdf(packageId: string): Promise<{ documentId: string; storagePath: string; finalPdfHash: string; byteSize: number }> {
  const { data: pkg, error: pErr } = await supabaseAdmin
    .from("na_packages")
    .select("*, clients(first_name, last_name, email), jurisdiction_profiles(display_name, legal_operator_name, business_address, approved_cancellation_wording, disclosure_text)")
    .eq("id", packageId)
    .maybeSingle();
  if (pErr || !pkg) throw new Error("Package not found");

  const { data: snap } = await supabaseAdmin
    .from("na_snapshots")
    .select("*")
    .eq("package_id", packageId)
    .eq("sealed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) throw new Error("No sealed snapshot");

  const { data: signatures } = await supabaseAdmin.from("na_signatures").select("*").eq("package_id", packageId);

  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([612, 792]);
  let y = 760;
  const margin = 54;
  const lineH = 14;

  const writeLine = (text: string, opts: { size?: number; bold?: boolean } = {}) => {
    const size = opts.size ?? 11;
    const font = opts.bold ? helvBold : helv;
    if (y < margin + lineH) {
      page = doc.addPage([612, 792]);
      y = 760;
    }
    page.drawText(text, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineH + (opts.size ? opts.size * 0.2 : 0);
  };

  const writePara = (text: string, opts: { size?: number; bold?: boolean } = {}) => {
    for (const ln of wrap(text, 90)) writeLine(ln, opts);
    y -= 4;
  };

  const jp: any = (pkg as any).jurisdiction_profiles ?? {};
  const c: any = (pkg as any).clients ?? {};
  const so: any = (pkg as any).service_order ?? {};
  const ft: any = (pkg as any).financial_terms ?? {};

  writeLine(jp.legal_operator_name ?? "JF Effect", { size: 16, bold: true });
  if (jp.business_address) writeLine(jp.business_address, { size: 9 });
  y -= 8;
  writeLine((pkg as any).custom_title ?? "Service Agreement", { size: 14, bold: true });
  y -= 4;
  writeLine(`Client: ${c.first_name ?? ""} ${c.last_name ?? ""} <${c.email ?? ""}>`);
  writeLine(`Jurisdiction: ${jp.display_name ?? ""}`);
  writeLine(`Contract value: ${fmtMoney((pkg as any).contract_value_minor, (pkg as any).currency)}`);
  y -= 6;

  writeLine("Service Order", { size: 12, bold: true });
  if (Object.keys(so).length === 0) writeLine("(none specified)");
  for (const [k, v] of Object.entries(so)) writePara(`• ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);

  writeLine("Financial Terms", { size: 12, bold: true });
  if (Object.keys(ft).length === 0) writeLine("(none specified)");
  for (const [k, v] of Object.entries(ft)) writePara(`• ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);

  if (jp.approved_cancellation_wording) {
    writeLine("Cancellation Policy", { size: 12, bold: true });
    writePara(jp.approved_cancellation_wording);
  }
  if (jp.disclosure_text) {
    writeLine("Statutory Disclosure", { size: 12, bold: true });
    writePara(jp.disclosure_text);
  }

  y -= 8;
  writeLine("Signatures", { size: 12, bold: true });
  for (const sig of (signatures ?? []) as any[]) {
    writeLine(`${sig.signer_role.toUpperCase()}: ${sig.typed_legal_name}`, { bold: true });
    writeLine(`Signed at: ${new Date(sig.signed_at_server).toISOString()}  Method: ${sig.signature_method}`);
    writeLine(`Snapshot hash: ${sig.snapshot_hash.slice(0, 32)}…`);
    writeLine(`Intent: ${sig.intent_wording}`);
    y -= 6;
  }

  // Footer with snapshot hash
  page.drawText(`Snapshot ${(snap as any).snapshot_hash.slice(0, 16)}…  Generated ${new Date().toISOString()}`, {
    x: margin, y: 30, size: 8, font: helv, color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await doc.save();
  const finalPdfHash = createHash("sha256").update(pdfBytes).digest("hex");
  const storagePath = `agreements/${packageId}/v${Date.now()}.pdf`;

  await ensureBucket();
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error("PDF upload failed: " + upErr.message);

  // Find next document_version
  const { data: existing } = await supabaseAdmin
    .from("na_documents")
    .select("document_version")
    .eq("package_id", packageId)
    .eq("kind", "final_agreement")
    .order("document_version", { ascending: false })
    .limit(1);
  const nextVersion = ((existing?.[0] as any)?.document_version ?? 0) + 1;

  const { data: docRow, error: docErr } = await supabaseAdmin.from("na_documents").insert({
    package_id: packageId,
    snapshot_id: (snap as any).id,
    kind: "final_agreement",
    document_version: nextVersion,
    snapshot_hash: (snap as any).snapshot_hash,
    final_pdf_hash: finalPdfHash,
    renderer: RENDERER,
    renderer_version: RENDERER_VERSION,
    storage_bucket: BUCKET,
    storage_path: storagePath,
    byte_size: pdfBytes.byteLength,
    generated_at: new Date().toISOString(),
    drive_sync_status: "pending",
  }).select().single();
  if (docErr) throw new Error(docErr.message);

  await supabaseAdmin.from("na_events").insert({
    package_id: packageId,
    snapshot_id: (snap as any).id,
    event_type: "pdf.generated",
    actor_role: "system",
    details: { final_pdf_hash: finalPdfHash, byte_size: pdfBytes.byteLength, version: nextVersion },
  });

  return { documentId: (docRow as any).id, storagePath, finalPdfHash, byteSize: pdfBytes.byteLength };
}

export async function getSignedPdfUrl(documentId: string, expiresSec: number = 300): Promise<string> {
  const { data: doc } = await supabaseAdmin.from("na_documents").select("storage_bucket, storage_path").eq("id", documentId).maybeSingle();
  if (!doc || !(doc as any).storage_path) throw new Error("Document not found");
  const { data, error } = await supabaseAdmin.storage.from((doc as any).storage_bucket).createSignedUrl((doc as any).storage_path, expiresSec);
  if (error || !data) throw new Error(error?.message ?? "Could not create signed URL");
  return data.signedUrl;
}