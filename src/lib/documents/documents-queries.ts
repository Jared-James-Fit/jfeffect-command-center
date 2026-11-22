/**
 * The documents library on the phone: the lists (read with the person's own
 * login, so RLS decides what's in them), the upload (straight to storage, then
 * filed by recordUploadedDocument), the edits, the bin, and handing a file to
 * the share sheet or a download.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveFiles } from "@/lib/file-share";
import {
  DOCUMENTS_BUCKET,
  RECENTLY_DELETED_DAYS,
  checkFile,
  documentPath,
  type DocumentCategory,
  type DocumentRow,
  type DocumentVisibility,
  type LibraryScope,
} from "./documents";
import {
  deleteDocument,
  getDocumentFile,
  recordUploadedDocument,
  restoreDocument,
  updateDocument,
} from "./documents.functions";

const sb = supabase as any;

const COLUMNS =
  "id, owner_user_id, client_id, category, title, tags, file_path, mime, bytes, source, linked_kind, linked_id, visibility, created_at, updated_at, deleted_at";

/**
 * Which library:
 *   self    a member's or client's own: what they filed plus what their coach
 *           shared with them (in View as client, only what the client sees)
 *   client  a coach's view of one client: whatever RLS lets the coach see
 *   staff   a staff member's own (no client)
 */
export type LibraryTarget =
  | { scope: "self"; userId: string; clientId: string | null }
  | { scope: "client"; clientId: string }
  | { scope: "staff"; userId: string };

export const documentsKey = (t: LibraryTarget | null) =>
  [
    "documents",
    t?.scope ?? null,
    t ? (t.scope === "client" ? t.clientId : t.userId) : null,
    t?.scope === "self" ? t.clientId : null,
  ] as const;

function scoped(q: any, t: LibraryTarget) {
  if (t.scope === "client") return q.eq("client_id", t.clientId);
  if (t.scope === "staff") return q.eq("owner_user_id", t.userId).is("client_id", null);
  return t.clientId
    ? q.or(`owner_user_id.eq.${t.userId},and(client_id.eq.${t.clientId},visibility.eq.client)`)
    : q.eq("owner_user_id", t.userId);
}

/** Read every page (a library is small, but never cut one short at the API's 1,000). */
async function readAll(build: (from: number, to: number) => any): Promise<DocumentRow[]> {
  const out: DocumentRow[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as DocumentRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** The library's documents (not deleted), newest first. */
export function useDocuments(target: LibraryTarget | null) {
  return useQuery({
    queryKey: documentsKey(target),
    enabled: !!target,
    staleTime: 30_000,
    queryFn: () =>
      readAll((from, to) =>
        scoped(sb.from("documents").select(COLUMNS).is("deleted_at", null), target!)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
  });
}

/** Recently deleted: what this person deleted in the last 30 days, in this library. */
export function useDeletedDocuments(
  target: LibraryTarget | null,
  viewerId: string | null | undefined,
) {
  return useQuery({
    queryKey: [...documentsKey(target), "deleted", viewerId ?? null],
    enabled: !!target && !!viewerId,
    staleTime: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - RECENTLY_DELETED_DAYS * 86_400_000).toISOString();
      let q = sb
        .from("documents")
        .select(COLUMNS)
        .eq("owner_user_id", viewerId)
        .gt("deleted_at", since);
      if (target!.scope === "client") q = q.eq("client_id", target!.clientId);
      if (target!.scope === "staff") q = q.is("client_id", null);
      const { data, error } = await q.order("deleted_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });
}

export interface UploadInput {
  file: File;
  title: string;
  category: DocumentCategory;
  tags: string[];
  visibility: DocumentVisibility;
  scope: LibraryScope;
  clientId?: string | null;
}

/** Upload, then file it. Every library's list refreshes after a change. */
export function useDocumentWrites() {
  const qc = useQueryClient();
  const record = useServerFn(recordUploadedDocument);
  const update = useServerFn(updateDocument);
  const del = useServerFn(deleteDocument);
  const restore = useServerFn(restoreDocument);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["documents"] }), [qc]);

  const upload = useCallback(
    async (
      userId: string,
      input: UploadInput,
    ): Promise<{ ok: true; document: DocumentRow } | { ok: false; message: string }> => {
      const check = checkFile(input.file);
      if (!check.ok) return check;
      const path = documentPath(userId, crypto.randomUUID(), input.file.name, check.ext);
      const { error: upErr } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, input.file, { contentType: check.mime, upsert: false });
      if (upErr)
        return {
          ok: false,
          message: "Your file didn't upload. Check your connection and try again.",
        };
      try {
        const res = await record({
          data: {
            path,
            title: input.title,
            category: input.category,
            tags: input.tags,
            visibility: input.visibility,
            scope: input.scope,
            clientId: input.clientId ?? null,
            rightsConfirmed: true,
          },
        });
        if (res.ok) void refresh();
        return res;
      } catch {
        void supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
        return { ok: false, message: "Couldn't save your document. Try again." };
      }
    },
    [record, refresh],
  );

  const save = useCallback(
    async (
      id: string,
      patch: {
        title?: string;
        category?: DocumentCategory;
        tags?: string[];
        visibility?: DocumentVisibility;
      },
    ) => {
      const res = await update({ data: { id, ...patch } }).catch(() => ({
        ok: false as const,
        message: "Couldn't save that. Try again.",
      }));
      if (res.ok) void refresh();
      return res;
    },
    [update, refresh],
  );

  /** To Recently deleted, with Undo on the toast. */
  const remove = useCallback(
    async (doc: Pick<DocumentRow, "id" | "title">) => {
      const res = await del({ data: { id: doc.id } }).catch(() => ({
        ok: false as const,
        message: "Couldn't delete it. Try again.",
      }));
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      void refresh();
      toast(`Deleted "${doc.title}"`, {
        description: `In Recently deleted for ${RECENTLY_DELETED_DAYS} days.`,
        action: {
          label: "Undo",
          onClick: async () => {
            const back = await restore({ data: { id: doc.id } }).catch(() => ({
              ok: false as const,
              message: "Couldn't undo. Try again.",
            }));
            if (back.ok) void refresh();
            else toast.error(back.message);
          },
        },
      });
    },
    [del, restore, refresh],
  );

  const bringBack = useCallback(
    async (id: string) => {
      const res = await restore({ data: { id } }).catch(() => ({
        ok: false as const,
        message: "Couldn't restore it. Try again.",
      }));
      if (res.ok) void refresh();
      return res;
    },
    [restore, refresh],
  );

  return { upload, save, remove, restore: bringBack };
}

/** A short-lived link to the file (to show it, or to download it). */
export function useDocumentLink(id: string | null, opts: { enabled?: boolean } = {}) {
  const get = useServerFn(getDocumentFile);
  return useQuery({
    queryKey: ["document-link", id],
    enabled: !!id && opts.enabled !== false,
    // links last ten minutes: ask again well before
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const res = await get({ data: { id: id!, download: false } });
      if (!res.ok) throw new Error(res.message);
      return res;
    },
  });
}

/** Fetch the file itself (for the share sheet, which needs a File). */
export async function fetchDocumentFile(url: string, name: string, mime: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download failed");
  const blob = await res.blob();
  return new File([blob], name, { type: mime || blob.type });
}

/**
 * Hand a document over: the share sheet on a phone (Save to Files, AirDrop),
 * a download on a computer. A file already fetched goes inside the tap; else
 * it's fetched first, and a phone that won't open the sheet after the wait
 * gets a toast whose Save is a fresh tap.
 */
export function useDocumentDownload() {
  const get = useServerFn(getDocumentFile);
  return useCallback(
    async (doc: Pick<DocumentRow, "id">, held?: File | null) => {
      const hand = async (file: File) => {
        const out = await saveFiles([file]);
        if (out === "again") {
          toast("Your file is ready", {
            action: { label: "Save", onClick: () => void saveFiles([file]) },
          });
        } else if (out === "failed") toast.error("Couldn't save the file.");
      };
      if (held) return hand(held);
      try {
        const res = await get({ data: { id: doc.id, download: true } });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        await hand(await fetchDocumentFile(res.url, res.name, res.mime));
      } catch {
        toast.error("Couldn't download it. Check your connection and try again.");
      }
    },
    [get],
  );
}
