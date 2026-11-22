/**
 * The documents library's server calls. Every one runs as the signed-in
 * person (requireSupabaseAuth) and writes through their own login, so the
 * table's RLS and documents_guard decide; each write is .select()ed and
 * checked. Only a file's link is signed with the service role, and only after
 * the person's own read of the row found it.
 *
 *   recordUploadedDocument  file what the phone just uploaded (its own folder only)
 *   updateDocument          name, category, tags, who can see it (the owner)
 *   deleteDocument          to Recently deleted (30 days)
 *   restoreDocument         back out of it
 *   getDocumentFile         a short-lived link to open or download it
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DOCUMENTS_BUCKET,
  RIGHTS_TEXT,
  cleanTags,
  cleanTitle,
  downloadName,
  fileTypeOf,
  isOwnDocumentPath,
  visibilityOptions,
  type DocumentRow,
  type DocumentVisibility,
  type LibraryScope,
} from "./documents";

const COLUMNS =
  "id, owner_user_id, client_id, category, title, tags, file_path, mime, bytes, source, linked_kind, linked_id, visibility, created_at, updated_at, deleted_at";

const Category = z.enum([
  "training_program",
  "nutrition_plan",
  "recipe",
  "checkin_report",
  "client_document",
  "template",
  "other",
]);
const Visibility = z.enum(["private", "coach", "client"]);
const Title = z
  .string()
  .max(400)
  .transform((s) => cleanTitle(s))
  .pipe(z.string().min(1, "Give it a name."));
const Tags = z
  .array(z.string().max(100))
  .max(40)
  .transform((t) => cleanTags(t));

export type DocumentResult = { ok: true; document: DocumentRow } | { ok: false; message: string };

function friendly(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  // the guard's own words are written for people; anything else isn't
  if (/^(Only|Confirm|Upload the file|That (file|document)|A document)/.test(m)) return m;
  if (/row-level security/i.test(m)) return "You can't do that with this document.";
  return fallback;
}

type ClientInfo = {
  id: string;
  user_id: string | null;
  service_tier: string | null;
  full_name: string | null;
};

async function readClient(supabase: any, id: string): Promise<ClientInfo | null> {
  const { data } = await supabase
    .from("clients")
    .select("id, user_id, service_tier, full_name")
    .eq("id", id)
    .maybeSingle();
  return (data as ClientInfo | null) ?? null;
}

async function canFileFor(supabase: any, userId: string, clientId: string): Promise<boolean> {
  const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_assigned_coach", { _client_id: clientId }),
  ]);
  return !!isAdmin || !!isCoach;
}

/** Which library a row sits in, from where the viewer stands, and what may be picked there. */
function allowedVisibility(scope: LibraryScope, client: ClientInfo | null): DocumentVisibility[] {
  const first = client?.full_name?.split(" ")[0] ?? null;
  return visibilityOptions(scope, {
    hasCoach: client?.service_tier === "coaching",
    clientFirstName: first,
  }).map((o) => o.value);
}

const RecordInput = z.object({
  path: z.string().max(300),
  title: Title,
  category: Category,
  tags: Tags.optional(),
  visibility: Visibility,
  /** self: the person's own library; client: a coach's upload for a client; staff: a staff member's own. */
  scope: z.enum(["self", "client", "staff"]),
  clientId: z.string().uuid().nullish(),
  rightsConfirmed: z.literal(true),
});

/** File the upload that just finished (the file is already in the caller's own folder). */
export const recordUploadedDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RecordInput.parse(i))
  .handler(async ({ data, context }): Promise<DocumentResult> => {
    const { supabase, userId } = context as any;
    const removeUpload = async () => {
      // nothing points at it yet, so the uploader may remove it (storage policy)
      await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([data.path])
        .catch(() => undefined);
    };
    if (!isOwnDocumentPath(data.path, userId))
      return { ok: false, message: "That file isn't yours." };
    const type = fileTypeOf(data.path);
    if (!type) {
      await removeUpload();
      return { ok: false, message: "That kind of file can't go in documents." };
    }

    let clientId: string | null = null;
    let client: ClientInfo | null = null;
    if (data.scope === "client") {
      if (!data.clientId || !(await canFileFor(supabase, userId, data.clientId))) {
        await removeUpload();
        return { ok: false, message: "You can't add documents for this client." };
      }
      clientId = data.clientId;
      client = await readClient(supabase, clientId);
    } else if (data.scope === "self") {
      const { data: own } = await supabase
        .from("clients")
        .select("id, user_id, service_tier, full_name")
        .eq("user_id", userId)
        .maybeSingle();
      client = (own as ClientInfo | null) ?? null;
      clientId = client?.id ?? null;
    }
    const scope: LibraryScope = clientId ? data.scope : "staff";
    if (!allowedVisibility(scope, client).includes(data.visibility)) {
      await removeUpload();
      return { ok: false, message: "Pick who can see it again." };
    }

    const { data: row, error } = await supabase
      .from("documents")
      .insert({
        owner_user_id: userId,
        client_id: clientId,
        category: data.category,
        title: data.title,
        tags: data.tags ?? [],
        file_path: data.path,
        // the database reads the real size and type from storage; these only stand in
        mime: type.mime,
        bytes: 0,
        visibility: data.visibility,
        source: "upload",
        rights_confirmed_at: new Date().toISOString(),
        rights_text: RIGHTS_TEXT,
      })
      .select(COLUMNS)
      .single();
    if (error || !row) {
      await removeUpload();
      return {
        ok: false,
        message: friendly(error?.message, "Couldn't save your document. Try again."),
      };
    }
    return { ok: true, document: row as DocumentRow };
  });

/** The row as the caller may see it (RLS), or null. */
async function readOwn(supabase: any, id: string): Promise<DocumentRow | null> {
  const { data } = await supabase.from("documents").select(COLUMNS).eq("id", id).maybeSingle();
  return (data as DocumentRow | null) ?? null;
}

const UpdateInput = z.object({
  id: z.string().uuid(),
  title: Title.optional(),
  category: Category.optional(),
  tags: Tags.optional(),
  visibility: Visibility.optional(),
});

export const updateDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }): Promise<DocumentResult> => {
    const { supabase, userId } = context as any;
    const doc = await readOwn(supabase, data.id);
    if (!doc || doc.owner_user_id !== userId)
      return { ok: false, message: "Only whoever added a document can change it." };
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.category !== undefined) patch.category = data.category;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.visibility !== undefined && data.visibility !== doc.visibility) {
      const client = doc.client_id ? await readClient(supabase, doc.client_id) : null;
      const scope: LibraryScope = !doc.client_id
        ? "staff"
        : client?.user_id === userId
          ? "self"
          : "client";
      if (!allowedVisibility(scope, client).includes(data.visibility))
        return { ok: false, message: "That isn't a choice for this document." };
      patch.visibility = data.visibility;
    }
    if (!Object.keys(patch).length) return { ok: true, document: doc };
    const { data: row, error } = await supabase
      .from("documents")
      .update(patch)
      .eq("id", data.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error || !row)
      return { ok: false, message: friendly(error?.message, "Couldn't save that. Try again.") };
    return { ok: true, document: row as DocumentRow };
  });

const IdInput = z.object({ id: z.string().uuid() });

async function setDeleted(
  supabase: any,
  userId: string,
  id: string,
  deleted: boolean,
): Promise<DocumentResult> {
  const doc = await readOwn(supabase, id);
  if (!doc || doc.owner_user_id !== userId)
    return { ok: false, message: "Only whoever added a document can delete it." };
  const { data: row, error } = await supabase
    .from("documents")
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error || !row)
    return {
      ok: false,
      message: friendly(
        error?.message,
        deleted ? "Couldn't delete it. Try again." : "Couldn't restore it. Try again.",
      ),
    };
  return { ok: true, document: row as DocumentRow };
}

/** To Recently deleted: gone for everyone else at once, back with Restore for 30 days. */
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    return setDeleted(supabase, userId, data.id, true);
  });

export const restoreDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    return setDeleted(supabase, userId, data.id, false);
  });

const FileInput = z.object({ id: z.string().uuid(), download: z.boolean().optional() });

export type DocumentFileResult =
  | { ok: true; url: string; mime: string; name: string }
  | { ok: false; message: string };

/** A link to the file for ten minutes, only for a document the caller can read (and not in the bin). */
export const getDocumentFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => FileInput.parse(i))
  .handler(async ({ data, context }): Promise<DocumentFileResult> => {
    const { supabase } = context as any;
    const doc = await readOwn(supabase, data.id);
    if (!doc || doc.deleted_at)
      return { ok: false, message: "That document isn't there any more." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const name = downloadName(doc);
    const { data: signed, error } = await (supabaseAdmin as any).storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.file_path, 600, data.download ? { download: name } : undefined);
    if (error || !signed?.signedUrl)
      return { ok: false, message: "Couldn't open the file. Try again." };
    return { ok: true, url: signed.signedUrl as string, mime: doc.mime, name };
  });
