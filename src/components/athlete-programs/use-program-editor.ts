import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { draftIssue, programError, useProgramActions, type ProgramDraft } from "@/lib/athlete-programs";
import {
  draftBackupKey,
  sameDraft,
  usableBackup,
  type DraftBackup,
} from "@/lib/athlete-program-draft";
import type { Cursor, ProgramPlan } from "@/lib/program-plan";
import { syncRunningProgram } from "@/lib/athlete-programs.functions";
import { savedEditLine } from "@/lib/my-program";

export type SaveResult = { ok: true } | { ok: false; at: "title" | "plan" | Cursor | null };

export type ProgramEditor = {
  d: ProgramDraft;
  editing: boolean;
  backTo: string;
  saving: boolean;
  dirty: boolean;
  /** Program details (name, about, goal, level). */
  updateMeta: (patch: Partial<Omit<ProgramDraft, "plan" | "id">>) => void;
  /**
   * An edit to the plan, one Undo step. Edits that share `merge` within a
   * moment (typing in one cell) are one step.
   */
  edit: (fn: (plan: ProgramPlan) => ProgramPlan, merge?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Checks, saves and opens the program; on a problem says it and returns where it is. */
  save: () => Promise<SaveResult>;
};

const HISTORY_MAX = 80;
const MERGE_MS = 1200;

function readBackup(key: string | null, base: string | null): ProgramDraft | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? usableBackup(JSON.parse(raw), base, Date.now()) : null;
  } catch {
    return null;
  }
}
function writeBackup(key: string, backup: DraftBackup) {
  try {
    localStorage.setItem(key, JSON.stringify(backup));
  } catch {
    /* storage full or blocked: the leave warning still stands */
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
 * The builder's state: the draft, Undo / Redo, and the copy kept on the
 * device a beat after every edit (picked up again on the next open, so
 * nothing half-built is ever lost). Saving checks it, writes it, and moves the
 * untouched workouts of a program that's running.
 */
export type ProgramEditorOptions = {
  /** Where the device copy is kept (an import keeps its own, per import). */
  backupKey?: (userId: string) => string;
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
  const key = user?.id ? (opts.backupKey ? opts.backupKey(user.id) : draftBackupKey(user.id, initial.id ?? null)) : null;
  const editing = !!initial.id;

  const [restored] = useState(() => {
    const kept = readBackup(key, base);
    if (kept && sameDraft(kept, initial)) {
      clearBackup(key);
      return null;
    }
    return kept;
  });
  const [d, setD] = useState<ProgramDraft>(() =>
    restored ? { ...restored, id: initial.id ?? null } : initial,
  );
  const [dirty, setDirty] = useState(!!restored || !!opts.startDirty);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Undo / Redo: whole drafts, newest last
  const past = useRef<ProgramDraft[]>([]);
  const future = useRef<ProgramDraft[]>([]);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);

  // a half-built program shouldn't vanish on a stray back tap or an app update
  useUnsavedWarning(dirty);

  useEffect(() => {
    if (!restored) return;
    toast("Picked up where you left off", {
      description: "Your unsaved changes were kept on this device.",
      duration: 8000,
      action: {
        label: "Start over",
        onClick: () => {
          clearBackup(key);
          past.current = [];
          future.current = [];
          dRef.current = initial;
          setD(initial);
          setDirty(!!opts.startDirty);
          bump((n) => n + 1);
        },
      },
    });
    // once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep every edit on the device a beat after it's made
  useEffect(() => {
    if (!key || !dirty) return;
    const t = setTimeout(() => {
      if (!dirtyRef.current) return;
      writeBackup(key, { v: 2, base, savedAt: Date.now(), draft: d });
    }, 250);
    return () => clearTimeout(t);
  }, [d, dirty, key, base]);

  // the draft as of the last edit (edits in one tick build on each other, never on a stale render)
  const dRef = useRef(d);
  const put = (next: ProgramDraft) => {
    dRef.current = next;
    setD(next);
    dirtyRef.current = true;
    setDirty(true);
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

  const save = async (): Promise<SaveResult> => {
    const issue = draftIssue(d);
    if (issue) {
      toast.error(issue.message);
      return { ok: false, at: issue.at };
    }
    try {
      const id = await saveMutation.mutateAsync(d);
      dirtyRef.current = false;
      clearBackup(key);
      setDirty(false);
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
          toast.success("Saved");
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
      return { ok: true };
    } catch (e) {
      toast.error(programError(e, "Couldn't save it. Try again."));
      return { ok: false, at: null };
    }
  };

  return {
    d,
    editing,
    backTo: editing ? `/portal/programs/${initial.id}` : (opts.backTo ?? "/portal/programs"),
    saving: saveMutation.isPending,
    dirty,
    updateMeta,
    edit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    save,
  };
}
