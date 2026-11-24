import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizePlan, planPayload, type ProgramPlan } from "@/lib/program-plan";
import type { ProgramDraft } from "@/lib/athlete-programs";
import type { ProgramVersion, VersionSource } from "@/lib/program-versions";

/**
 * The builder's drafts kept on the server and a program's saved versions
 * (20270523090000_program_drafts_versions.sql). Until that migration is
 * applied both read as "not here yet": the builder keeps its draft on the
 * device as before and the history sheet says history starts with the next
 * save, never an error.
 */

const db = supabase as any;

/** A table or function the database doesn't have yet (the migration isn't applied). */
export function notThereYet(error: any): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    /does not exist|schema cache/i.test(msg)
  );
}

/** A request that never reached the server (offline, a dropped connection). */
export function offlineError(error: any): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String(error?.message ?? error ?? "");
  return /failed to fetch|network|load failed|timeout|aborted/i.test(msg);
}

/* ------------------------------------------------------------------ */
/*  Drafts                                                             */
/* ------------------------------------------------------------------ */

export type ServerDraft = {
  id: string;
  program_id: string | null;
  draft: ProgramDraft;
  base: string | null;
  updated_at: string;
};

export type DraftListRow = {
  id: string;
  program_id: string | null;
  title: string;
  updated_at: string;
};

export const draftKeys = {
  all: ["program-drafts"] as const,
  one: (programId: string | null) => ["program-drafts", "one", programId ?? "new"] as const,
  list: ["program-drafts", "list"] as const,
};

/** The caller's server draft of a program (null: a new one), or null when there's none or it can't be read. */
export async function fetchServerDraft(programId: string | null): Promise<ServerDraft | null> {
  let q = db.from("athlete_program_drafts").select("id, program_id, draft, base, updated_at");
  q = programId ? q.eq("program_id", programId) : q.is("program_id", null);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (notThereYet(error)) return null;
    throw error;
  }
  if (!data) return null;
  const plan = normalizePlan(data.draft?.plan);
  if (!plan || typeof data.draft?.title !== "string") return null;
  return {
    id: data.id,
    program_id: data.program_id,
    base: data.base ?? null,
    updated_at: data.updated_at,
    draft: {
      id: programId,
      title: data.draft.title,
      description: typeof data.draft.description === "string" ? data.draft.description : "",
      goal: data.draft.goal ?? null,
      level: data.draft.level ?? null,
      plan,
    },
  };
}

export type PutResult =
  | { ok: true; at: string }
  | { ok: false; offline: boolean; unavailable: boolean };

/** Keeps the draft on the server. Never throws: says whether it's kept, offline, or not possible yet. */
export async function putServerDraft(
  programId: string | null,
  d: ProgramDraft,
  base: string | null,
): Promise<PutResult> {
  try {
    const { data, error } = await db.rpc("athlete_program_draft_put", {
      _program_id: programId,
      _draft: {
        title: d.title,
        description: d.description,
        goal: d.goal,
        level: d.level,
        plan: planPayload(d.plan),
      },
      _base: base,
    });
    if (error) return { ok: false, offline: offlineError(error), unavailable: notThereYet(error) };
    return { ok: true, at: String(data ?? new Date().toISOString()) };
  } catch (e) {
    return { ok: false, offline: offlineError(e), unavailable: false };
  }
}

export async function deleteServerDraft(programId: string | null): Promise<void> {
  try {
    let q = db.from("athlete_program_drafts").delete();
    q = programId ? q.eq("program_id", programId) : q.is("program_id", null);
    await q;
  } catch {
    /* the draft is replaced or cleared on its next save anyway */
  }
}

/** Every unsaved program draft the caller has (newest first). */
export function useMyDrafts(enabled = true) {
  return useQuery({
    queryKey: draftKeys.list,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<DraftListRow[]> => {
      const { data, error } = await db
        .from("athlete_program_drafts")
        .select("id, program_id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) {
        if (notThereYet(error)) return [];
        throw error;
      }
      return (data ?? []) as DraftListRow[];
    },
  });
}

export function useRefreshDrafts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: draftKeys.all });
}

/* ------------------------------------------------------------------ */
/*  Versions                                                           */
/* ------------------------------------------------------------------ */

export const versionKeys = {
  all: ["program-versions"] as const,
  list: (programId: string) => ["program-versions", programId] as const,
};

const VERSION_COLS =
  "id, version_no, title, description, plan, source, restored_from, label, created_by, created_at, updated_at";

export type VersionsPage = { versions: ProgramVersion[]; unavailable: boolean };

/** A program's saved versions, newest first (the newest 40, with their plans for comparing). */
export function useProgramVersions(programId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: versionKeys.list(programId ?? ""),
    enabled: !!programId && enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<VersionsPage> => {
      const { data, error } = await db
        .from("athlete_program_versions")
        .select(VERSION_COLS)
        .eq("program_id", programId)
        .order("version_no", { ascending: false })
        .limit(40);
      if (error) {
        if (notThereYet(error)) return { versions: [], unavailable: true };
        throw error;
      }
      const versions = ((data ?? []) as any[]).map((v) => ({
        ...v,
        plan: (normalizePlan(v.plan) as ProgramPlan | null) ?? null,
      })) as ProgramVersion[];
      return { versions, unavailable: false };
    },
  });
}

/** Says where the newest version came from, right after the save that made it. Best effort. */
export async function tagLatestVersion(
  programId: string,
  source: Exclude<VersionSource, "create" | "save" | "baseline">,
  restoredFrom?: number | null,
) {
  try {
    await db.rpc("athlete_program_version_tag", {
      _program_id: programId,
      _source: source,
      _restored_from: restoredFrom ?? null,
    });
  } catch {
    /* the version is kept either way; only its label is missing */
  }
}

export async function nameVersion(versionId: string, label: string | null): Promise<void> {
  const { error } = await db.rpc("athlete_program_version_name", {
    _version_id: versionId,
    _label: label ?? "",
  });
  if (error) throw error;
}

/** Library names for exercises a version has that the program no longer does. */
export function useExerciseNames(ids: string[], enabled = true) {
  const key = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["exercise-names", key.join(",")],
    enabled: enabled && key.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (let i = 0; i < key.length; i += 150) {
        const { data, error } = await db
          .from("exercises")
          .select("id, name")
          .in("id", key.slice(i, i + 150));
        if (error) throw error;
        for (const r of data ?? []) out[r.id] = r.name;
      }
      return out;
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Template versions (the coach's library builder)                    */
/* ------------------------------------------------------------------ */

export type TemplateVersion = {
  id: string;
  version_no: number;
  name: string | null;
  payload: unknown;
  source: "create" | "save" | "restore" | "cleo" | "baseline";
  restored_from: number | null;
  label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const templateVersionKeys = {
  list: (templateId: string) => ["template-versions", templateId] as const,
};

/** A template's saved versions, newest first (the newest 30, with their payloads for comparing). */
export function useTemplateVersions(templateId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: templateVersionKeys.list(templateId ?? ""),
    enabled: !!templateId && enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<{ versions: TemplateVersion[]; unavailable: boolean }> => {
      const { data, error } = await db
        .from("pl_template_versions")
        .select("id, version_no, name, payload, source, restored_from, label, created_by, created_at, updated_at")
        .eq("template_id", templateId)
        .order("version_no", { ascending: false })
        .limit(30);
      if (error) {
        if (notThereYet(error)) return { versions: [], unavailable: true };
        throw error;
      }
      return { versions: (data ?? []) as TemplateVersion[], unavailable: false };
    },
  });
}

export async function nameTemplateVersion(versionId: string, label: string | null): Promise<void> {
  const { error } = await db.rpc("pl_template_version_name", { _version_id: versionId, _label: label ?? "" });
  if (error) throw error;
}

/** Says the newest template version was a restore, once the editor has saved it. Best effort. */
export async function tagTemplateVersion(templateId: string, restoredFrom: number) {
  try {
    await db.rpc("pl_template_version_tag", { _template_id: templateId, _source: "restore", _restored_from: restoredFrom });
  } catch {
    /* the version is kept either way */
  }
}
