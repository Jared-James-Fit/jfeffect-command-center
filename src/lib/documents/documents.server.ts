/**
 * Documents on the server (service role only; never import this from a
 * screen). Three jobs:
 *
 *   recordDocument            file an original for someone after an import
 *                             or an export: copies the file into their folder
 *                             in the documents bucket and records it, linked
 *                             to the record it came with (idempotent by link)
 *   purgeDeletedDocuments     day 30 of Recently deleted: the files, then the
 *                             rows (the documents-purge hook, daily)
 *   purgeDocumentsForAccount  an account deleted for good: everything filed
 *                             by them or for them
 *
 * The database still checks every row (documents_guard: the path inside the
 * owner's folder, the file present, its size and type read from storage).
 */
import {
  DOCUMENTS_BUCKET,
  RECENTLY_DELETED_DAYS,
  checkFile,
  cleanTags,
  cleanTitle,
  documentPath,
  isDocumentCategory,
  type DocumentCategory,
  type DocumentRow,
  type DocumentVisibility,
} from "./documents";

type Admin = any;

export const DOCUMENT_COLUMNS =
  "id, owner_user_id, client_id, category, title, tags, file_path, mime, bytes, source, linked_kind, linked_id, visibility, created_at, updated_at, deleted_at";

export type RecordDocumentFile =
  /** a file already in storage (an import's upload): copied, never moved */
  | { bucket: string; path: string; name?: string }
  /** bytes made on the server (an export, a converted original) */
  | { data: Blob | ArrayBuffer | Uint8Array; name: string; mime?: string };

export interface RecordDocumentInput {
  /** Whose library it goes in: the person who imported it, or the coach who filed it for a client. */
  ownerUserId: string;
  /** Whose document it is (null: a staff member's own, always private). */
  clientId?: string | null;
  category: DocumentCategory;
  title: string;
  tags?: string[];
  /**
   * Who sees it besides its owner. Default 'private'. Pass 'coach' for a
   * coaching client's own import their coach should see, 'client' for what a
   * coach files for a client to see. With no client it's always private.
   */
  visibility?: DocumentVisibility;
  source: "import" | "export";
  /** What it's the original of, e.g. 'nutrition_import' / 'athlete_program' / 'nutrition_target'. */
  linkedKind?: string | null;
  linkedId?: string | null;
  /** The rights record the import already took, carried onto the document. */
  rights?: { confirmedAt: string; text: string } | null;
  file: RecordDocumentFile;
}

export type RecordDocumentResult =
  | { ok: true; document: DocumentRow; existing: boolean }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readFile(
  admin: Admin,
  file: RecordDocumentFile,
): Promise<{ blob: Blob; name: string } | { error: string }> {
  if ("bucket" in file) {
    const { data, error } = await admin.storage.from(file.bucket).download(file.path);
    if (error || !data)
      return { error: `Couldn't read ${file.bucket}/${file.path}: ${error?.message ?? "missing"}` };
    return { blob: data as Blob, name: file.name || file.path.split("/").pop() || "document" };
  }
  const blob =
    file.data instanceof Blob
      ? file.data
      : new Blob([file.data as BlobPart], { type: file.mime ?? "" });
  return { blob, name: file.name };
}

/**
 * File an original in someone's documents. Call it with the service role
 * (supabaseAdmin) after the caller's own checks; a retry with the same link
 * returns the document already filed instead of a second copy. Never throws
 * for a bad file: it says why in `error`.
 */
export async function recordDocument(
  admin: Admin,
  input: RecordDocumentInput,
): Promise<RecordDocumentResult> {
  if (!UUID_RE.test(input.ownerUserId))
    return { ok: false, error: "ownerUserId isn't a login id." };
  if (!isDocumentCategory(input.category))
    return { ok: false, error: `Unknown category ${input.category}.` };
  const clientId = input.clientId ?? null;
  const visibility: DocumentVisibility = clientId ? (input.visibility ?? "private") : "private";
  const linkedKind = input.linkedKind ?? null;
  const linkedId = input.linkedId ?? null;
  if ((linkedKind === null) !== (linkedId === null))
    return { ok: false, error: "linkedKind and linkedId go together." };

  if (linkedKind && linkedId) {
    const { data: existing } = await admin
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("owner_user_id", input.ownerUserId)
      .eq("linked_kind", linkedKind)
      .eq("linked_id", linkedId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) return { ok: true, document: existing as DocumentRow, existing: true };
  }

  const read = await readFile(admin, input.file);
  if ("error" in read) return { ok: false, error: read.error };
  const check = checkFile({
    name: read.name,
    size: read.blob.size,
    type: read.blob.type || ("mime" in input.file ? input.file.mime : null),
  });
  if (!check.ok) return { ok: false, error: check.message };

  const path = documentPath(input.ownerUserId, crypto.randomUUID(), read.name, check.ext);
  const body =
    read.blob.type === check.mime
      ? read.blob
      : new Blob([await read.blob.arrayBuffer()], { type: check.mime });
  const up = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, body, { contentType: check.mime, upsert: false });
  if (up.error) return { ok: false, error: `Couldn't store the file: ${up.error.message}` };

  const { data, error } = await admin
    .from("documents")
    .insert({
      owner_user_id: input.ownerUserId,
      client_id: clientId,
      category: input.category,
      title: cleanTitle(input.title) || "Document",
      tags: cleanTags(input.tags ?? []),
      file_path: path,
      mime: check.mime,
      bytes: read.blob.size,
      source: input.source,
      linked_kind: linkedKind,
      linked_id: linkedId,
      visibility,
      rights_confirmed_at: input.rights?.confirmedAt ?? null,
      rights_text: input.rights?.text ?? null,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { ok: false, error: `Couldn't file it: ${error?.message ?? "no row"}` };
  }
  return { ok: true, document: data as DocumentRow, existing: false };
}

async function removeRows(
  admin: Admin,
  rows: { id: string; file_path: string }[],
): Promise<{ files: number; rows: number; failed: number }> {
  let files = 0;
  let removedRows = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error: rmErr } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .remove(chunk.map((r) => r.file_path));
    if (rmErr) {
      // keep the rows: tomorrow's run tries again, never a row pointing nowhere
      failed += chunk.length;
      continue;
    }
    files += chunk.length;
    const { error, count } = await admin
      .from("documents")
      .delete({ count: "exact" })
      .in(
        "id",
        chunk.map((r) => r.id),
      );
    if (error) failed += chunk.length;
    else removedRows += count ?? chunk.length;
  }
  return { files, rows: removedRows, failed };
}

/** Day 30 of Recently deleted: gone for good (files first, then rows). */
export async function purgeDeletedDocuments(admin: Admin, opts: { limit?: number } = {}) {
  const cutoff = new Date(Date.now() - RECENTLY_DELETED_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("documents")
    .select("id, file_path")
    .lt("deleted_at", cutoff)
    .order("deleted_at", { ascending: true })
    .limit(opts.limit ?? 500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; file_path: string }[];
  return { due: rows.length, ...(await removeRows(admin, rows)) };
}

/** An account deleted for good: every document filed by them or for them, files and rows. */
export async function purgeDocumentsForAccount(
  admin: Admin,
  who: { userId?: string | null; clientId?: string | null },
) {
  const ors = [
    who.userId && UUID_RE.test(who.userId) ? `owner_user_id.eq.${who.userId}` : null,
    who.clientId && UUID_RE.test(who.clientId) ? `client_id.eq.${who.clientId}` : null,
  ].filter(Boolean) as string[];
  if (!ors.length) return { files: 0, rows: 0, failed: 0 };
  const rows: { id: string; file_path: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("documents")
      .select("id, file_path")
      .or(ors.join(","))
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { id: string; file_path: string }[]));
    if (!data || data.length < 1000) break;
  }
  return removeRows(admin, rows);
}
