import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { draftIssue, programError, programKeys, useProgramActions, type ProgramDraft } from "@/lib/athlete-programs";
import {
  draftBackupKey,
  sameDraft,
  usableBackup,
  type DraftBackup,
} from "@/lib/athlete-program-draft";
import type { Cursor, ProgramPlan } from "@/lib/program-plan";
import { syncRunningProgram } from "@/lib/athlete-programs.functions";
import { savedEditLine } from "@/lib/my-program";
import {
  deleteServerDraft,
  draftKeys,
  putServerDraft,
  tagLatestVersion,
  versionKeys,
  type ServerDraft,
} from "@/lib/program-history-queries";
import { pickDraft, type DraftStatus } from "@/lib/program-draft-status";

export type SaveResult =
  | { ok: true }
  | { ok: false; at: "title" | "plan" | Cursor | null; conflict?: boolean };

export type ProgramEditor = {
  d: ProgramDraft;
  editing: boolean;
  backTo: string;
  saving: boolean;
  dirty: boolean;
  /** Where the work stands, for the header's quiet status line. */
  status: DraftStatus;
  /** Program details (name, about, goal, level). */
  updateMeta: (patch: Partial<Omit<ProgramDraft, "plan" | "id">>) => void;
  /**
   * An edit to the plan, one Undo step. Edits that share `merge` within a
   * moment (typing in one cell) are one step.
   */
  edit: (fn: (plan: ProgramPlan) => ProgramPlan, merge?: string) => void;
  /** The whole draft replaced (a version restored), one Undo step. */
  replace: (next: ProgramDraft) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Throws away every unsaved change (this device and the server's copy) and goes back to the program as saved. */
  discard: () => void;
  /** The next save restores a version: it's recorded as one. */
  markRestore: (versionNo: number) => void;
  /** Checks, saves and opens the program; on a problem says it and returns where it is. `force` saves over a newer version. */
  save: (opts?: { force?: boolean }) => Promise<SaveResult>;
};

const HISTORY_MAX = 80;
const MERGE_MS = 1200;
/** A beat after the last edit, the draft goes to the server. */
const REMOTE_DEBOUNCE_MS = 1500;
/** How long "Draft restored" stays before the usual status. */
const RESTORED_MS = 6000;

function readBackup(key: string | null, base: string | null): { draft: ProgramDraft; at: number } | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const draft = usableBackup(parsed, base, Date.now());
    return draft ? { draft, at: Number(parsed.savedAt) || 0 } : null;
  } catch {
    return null;
  }
}
function writeBackup(key: string, backup: DraftBackup) {
  try {
    localStorage.setItem(key, JSON.stringify(backup));
  } catch {
    /* storage full or blocked: the server copy and the leave warning still stand */
  }
}
function clearBackup(key: string | null) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing kept */
  }
}

/**
 * The builder's state: the draft, Undo / Redo, and the work kept safe while
 * it's being done: on the device a beat after every edit, and on the server a
 * moment later (so it follows the person to another device), picked up again
 * on the next open with a quiet "Draft restored" by the name, never a pop-up.
 * Nothing reaches the program (or a program on the calendar) until Save.
 * Saving checks it, refuses to silently overwrite a version saved from another
 * device after this one opened, writes it, and moves the untouched workouts of
 * a program that's running.
 */
export type ProgramEditorOptions = {
  /** Where the device copy is kept (an import keeps its own, per import, and never a server copy). */
  backupKey?: (userId: string) => string;
  /** The server's draft of this program, read before the builder opened. */
  remote?: ServerDraft | null;
  /** Starts unsaved (an imported program isn't a program until it's saved). */
  startDirty?: boolean;
  /** Runs once a new program is saved, before the program opens. */
  onSaved?: (programId: string) => Promise<void> | void;
  /** What a new program's save says. */
  savedMessage?: string;
  /** Where Back goes for a new program. */
  backTo?: string;
};

export function useProgramEditor(initial: ProgramDraft, base: string | null, opts: ProgramEditorOptions = {}): ProgramEditor {
  const navigate = useNavigate();
  const { save: saveMutation } = useProgramActions();
  const syncRunning = useServerFn(syncRunningProgram);
  const qc = useQueryClient();
  const { user } = useAuth();
  const programId = initial.id ?? null;
  const useServer = !opts.backupKey;
  const key = user?.id ? (opts.backupKey ? opts.backupKey(user.id) : draftBackupKey(user.id, programId)) : null;
  const editing = !!initial.id;

  // the newest of the device's copy and the server's, when it's still for this version of the program
  const [restored] = useState(() =>
    pickDraft({
      initial,
      base,
      local: readBackup(key, base),
      remote: useServer ? opts.remote ?? null : null,
      same: sameDraft,
    }),
  );
  useEffect(() => {
    // a kept copy that says nothing new is cleared once, on open
    if (!restored) {
      const kept = readBackup(key, base);
      if (kept && sameDraft(kept.draft, initial)) clearBackup(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [d, setD] = useState<ProgramDraft>(() => (restored ? { ...restored, id: programId } : initial));
  const [dirty, setDirty] = useState(!!restored || !!opts.startDirty);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // where the server copy stands
  const [remote, setRemote] = useState<"idle" | "pending" | "saved" | "offline" | "device">(restored ? "saved" : "idle");
  const [showRestored, setShowRestored] = useState(!!restored);
  useEffect(() => {
    if (!showRestored) return;
    const t = setTimeout(() => setShowRestored(false), RESTORED_MS);
    return () => clearTimeout(t);
  }, [showRestored]);

  // Undo / Redo: whole drafts, newest last
  const past = useRef<ProgramDraft[]>([]);
  const future = useRef<ProgramDraft[]>([]);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const pendingTag = useRef<{ source: "restore"; from: number } | null>(null);

  // a half-built program shouldn't vanish on a stray back tap or an app update
  useUnsavedWarning(dirty);

  // keep every edit on the device a beat after it's made
  useEffect(() => {
    if (!key || !dirty) return;
    const t = setTimeout(() => {
      if (!dirtyRef.current) return;
      writeBackup(key, { v: 2, base, savedAt: Date.now(), draft: d });
    }, 250);
    return () => clearTimeout(t);
  }, [d, dirty, key, base]);

  // and on the server a moment later (one write at a time, the newest draft wins)
  const inflight = useRef(false);
  const queued = useRef(false);
  const dRef = useRef(d);
  const pushRemote = useCallback(async () => {
    if (!useServer || !user?.id) return;
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    try {
      do {
        queued.current = false;
        if (!dirtyRef.current) break;
        const r = await putServerDraft(programId, dRef.current, base);
        if (!dirtyRef.current) break;
        if (r.ok) setRemote("saved");
        else setRemote(r.offline ? "offline" : "device");
      } while (queued.current);
    } finally {
      inflight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useServer, user?.id, programId, base]);

  useEffect(() => {
    if (!useServer || !dirty) return;
    setRemote((s) => (s === "offline" && typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "pending"));
    const t = setTimeout(() => void pushRemote(), REMOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [d, dirty, useServer, pushRemote]);

  // back online: send what's waiting
  useEffect(() => {
    if (!useServer) return;
    const on = () => {
      if (dirtyRef.current) void pushRemote();
    };
    const off = () => {
      if (dirtyRef.current) setRemote("offline");
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [useServer, pushRemote]);

  // the draft as of the last edit (edits in one tick build on each other, never on a stale render)
  const put = (next: ProgramDraft) => {
    dRef.current = next;
    setD(next);
    dirtyRef.current = true;
    setDirty(true);
    setShowRestored(false);
    bump((n) => n + 1);
  };

  const commit = useCallback((next: (x: ProgramDraft) => ProgramDraft, merge?: string) => {
    const cur = dRef.current;
    const out = next(cur);
    if (out === cur) return;
    const now = Date.now();
    const last = lastMerge.current;
    const merging = !!merge && !!last && last.key === merge && now - last.at < MERGE_MS;
    if (!merging) past.current = [...past.current.slice(-(HISTORY_MAX - 1)), cur];
    future.current = [];
    lastMerge.current = merge ? { key: merge, at: now } : null;
    put(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateMeta = useCallback(
    (patch: Partial<Omit<ProgramDraft, "plan" | "id">>) =>
      commit((x) => ({ ...x, ...patch }), `meta:${Object.keys(patch).join(",")}`),
    [commit],
  );
  const edit = useCallback(
    (fn: (plan: ProgramPlan) => ProgramPlan, merge?: string) =>
      commit((x) => {
        const plan = fn(x.plan);
        return plan === x.plan ? x : { ...x, plan };
      }, merge),
    [commit],
  );
  const replace = useCallback((next: ProgramDraft) => commit(() => ({ ...next, id: programId })), [commit, programId]);

  const undo = useCallback(() => {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, dRef.current];
    lastMerge.current = null;
    put(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const redo = useCallback(() => {
    const next = future.current[future.current.length - 1];
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, dRef.current];
    lastMerge.current = null;
    put(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forget = () => {
    clearBackup(key);
    if (useServer) {
      void deleteServerDraft(programId).then(() => qc.invalidateQueries({ queryKey: draftKeys.all }));
    }
  };

  const discard = useCallback(() => {
    forget();
    past.current = [];
    future.current = [];
    lastMerge.current = null;
    pendingTag.current = null;
    dRef.current = initial;
    setD(initial);
    dirtyRef.current = !!opts.startDirty;
    setDirty(!!opts.startDirty);
    setRemote("idle");
    setShowRestored(false);
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRestore = useCallback((versionNo: number) => {
    pendingTag.current = { source: "restore", from: versionNo };
  }, []);

  /** Whether the program was saved from somewhere else after this draft started. */
  const changedElsewhere = async (): Promise<boolean> => {
    if (!editing || !base || opts.backupKey) return false;
    try {
      const { data } = await (supabase as any).from("athlete_programs").select("updated_at").eq("id", programId).maybeSingle();
      return !!data?.updated_at && data.updated_at !== base;
    } catch {
      return false;
    }
  };

  const save = async ({ force = false }: { force?: boolean } = {}): Promise<SaveResult> => {
    const draft = dRef.current;
    const issue = draftIssue(draft);
    if (issue) {
      toast.error(issue.message);
      return { ok: false, at: issue.at };
    }
    if (!force && (await changedElsewhere())) return { ok: false, at: null, conflict: true };
    try {
      const id = await saveMutation.mutateAsync(draft);
      dirtyRef.current = false;
      setDirty(false);
      forget();
      const tag = pendingTag.current;
      pendingTag.current = null;
      if (tag) void tagLatestVersion(id, tag.source, tag.from);
      void qc.invalidateQueries({ queryKey: versionKeys.list(id) });
      if (!editing && opts.onSaved) {
        try {
          await opts.onSaved(id);
        } catch {
          /* the program is saved; what it was made from catches up on its own */
        }
      }
      // the builder makes way for the program: Back from it never lands in the builder again
      navigate({ to: "/portal/programs/$programId", params: { programId: id }, replace: true });
      if (!editing) {
        toast.success(opts.savedMessage ?? "Program saved to My programs. Start it or share it from here.");
        return { ok: true };
      }
      // a program on their calendar: the workouts they haven't done follow the edit
      try {
        const r = await syncRunning({ data: { programId: id } });
        if (!r.running) {
          toast.success(tag ? `Restored version ${tag.from}` : "Saved");
          return { ok: true };
        }
        void qc.invalidateQueries();
        toast.success(savedEditLine(r));
        if (r.trainingDays > 0 && r.daysPerWeek !== r.trainingDays) {
          toast.warning(
            `It has ${r.daysPerWeek} workouts a week now and you train ${r.trainingDays} days. Pick ${r.daysPerWeek} training days so each one has a day.`,
            {
              duration: 12000,
              action: {
                label: "Set days",
                onClick: () => navigate({ to: "/portal/workouts", search: { days: 1 } } as any),
              },
            },
          );
        }
      } catch (e) {
        toast.warning(programError(e, "Saved, but your calendar didn't update. Save again to retry."));
      }
      void qc.invalidateQueries({ queryKey: programKeys.all });
      return { ok: true };
    } catch (e) {
      toast.error(programError(e, "Couldn't save it. Your changes are still here. Try again."));
      return { ok: false, at: null };
    }
  };

  const status: DraftStatus = showRestored
    ? "restored"
    : !dirty
      ? editing
        ? "saved"
        : "new"
      : !useServer
        ? "device"
        : remote === "pending" || remote === "idle"
          ? "saving"
          : remote === "saved"
            ? "draft"
            : remote === "offline"
              ? "offline"
              : "device";

  return {
    d,
    editing,
    backTo: editing ? `/portal/programs/${initial.id}` : (opts.backTo ?? "/portal/programs"),
    saving: saveMutation.isPending,
    dirty,
    status,
    updateMeta,
    edit,
    replace,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    discard,
    markRestore,
    save,
  };
}
