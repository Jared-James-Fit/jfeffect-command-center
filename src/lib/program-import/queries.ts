/**
 * The import screen's reads (Nov 21 2026): the person's own imports, through
 * their own login (RLS: own rows only). Never kept on the phone's disk
 * ("program-import" in query-persister's DO_NOT_PERSIST_PREFIXES): a file's
 * text can be large and an import's status moves on the server.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ImportedProgram, ImportMethod, ImportSourceKind } from "./types";

export type ImportStatus = "pending" | "reading" | "ready" | "failed" | "saved" | "discarded";

export type ImportRow = {
  id: string;
  status: ImportStatus;
  method: ImportMethod | null;
  source_kind: ImportSourceKind;
  file_name: string | null;
  file_paths: string[];
  files_deleted_at: string | null;
  source_text: string | null;
  result: ImportedProgram | null;
  error: string | null;
  program_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ImportListRow = Pick<
  ImportRow,
  "id" | "status" | "method" | "source_kind" | "file_name" | "program_id" | "created_at" | "updated_at"
>;

export const importKeys = {
  one: (id: string) => ["program-import", id] as const,
  recent: ["program-import", "recent"] as const,
};

const running = (s: ImportStatus | undefined) => s === "pending" || s === "reading";

/** One import, read again every few seconds while the AI is reading it. */
export function useProgramImport(id: string | null) {
  return useQuery({
    queryKey: importKeys.one(id ?? "none"),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_imports")
        .select(
          "id, status, method, source_kind, file_name, file_paths, files_deleted_at, source_text, result, error, program_id, created_at, updated_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ImportRow | null;
    },
    refetchInterval: (q) => (running((q.state.data as ImportRow | null | undefined)?.status) ? 3000 : false),
    refetchOnWindowFocus: true,
  });
}

/** Imports still open (being read, ready to review, or failed), newest first. */
export function useOpenImports(enabled = true) {
  return useQuery({
    queryKey: importKeys.recent,
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await (supabase as any)
        .from("program_imports")
        .select("id, status, method, source_kind, file_name, program_id, created_at, updated_at")
        .in("status", ["pending", "reading", "ready", "failed"])
        .gt("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as ImportListRow[];
    },
    refetchInterval: (q) =>
      ((q.state.data as ImportListRow[] | undefined) ?? []).some((r) => running(r.status)) ? 5000 : false,
  });
}

/** Whether a saved program came from an import (Share reminds them about permission). */
export function useImportedFrom(programId: string | null) {
  return useQuery({
    queryKey: ["program-import", "of", programId ?? "none"],
    enabled: !!programId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_imports")
        .select("id")
        .eq("program_id", programId)
        .limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },
  });
}

/** "Program.xlsx" or what kind of thing it was. */
export function importLabel(r: Pick<ImportRow, "file_name" | "source_kind">): string {
  if (r.file_name) return r.file_name;
  return r.source_kind === "text" ? "Pasted program" : r.source_kind === "image" ? "Photos" : "Your file";
}
