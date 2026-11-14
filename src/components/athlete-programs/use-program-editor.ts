import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import {
  draftIssue,
  programError,
  useProgramActions,
  type ProgramDay,
  type ProgramDraft,
} from "@/lib/athlete-programs";
import {
  draftBackupKey,
  sameDraft,
  usableBackup,
  type DraftBackup,
} from "@/lib/athlete-program-draft";
import { syncRunningProgram } from "@/lib/athlete-programs.functions";
import { savedEditLine } from "@/lib/my-program";

export type SaveResult = { ok: true } | { ok: false; at: "title" | "days" | number | null };

export type ProgramEditor = {
  d: ProgramDraft;
  editing: boolean;
  backTo: string;
  saving: boolean;
  update: (fn: (x: ProgramDraft) => ProgramDraft) => void;
  setDay: (i: number, fn: (day: ProgramDay) => ProgramDay) => void;
  /** Checks, saves and opens the program; on a problem says it and returns where it is. */
  save: () => Promise<SaveResult>;
};

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
    /* storage full or blocked: the beforeunload warning still stands */
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
 * The builder's state, shared by the phone and desktop layouts (so turning a
 * tablet or resizing a window keeps every edit). Unsaved edits are kept on
 * the device as they're made and picked up again on the next open.
 */
export function useProgramEditor(initial: ProgramDraft, base: string | null): ProgramEditor {
  const navigate = useNavigate();
  const { save: saveMutation } = useProgramActions();
  const syncRunning = useServerFn(syncRunningProgram);
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = user?.id ? draftBackupKey(user.id, initial.id ?? null) : null;
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
  const [dirty, setDirty] = useState(!!restored);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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
          setD(initial);
          setDirty(false);
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
      writeBackup(key, { v: 1, base, savedAt: Date.now(), draft: d });
    }, 250);
    return () => clearTimeout(t);
  }, [d, dirty, key, base]);

  const update = useCallback((fn: (x: ProgramDraft) => ProgramDraft) => {
    setD(fn);
    dirtyRef.current = true;
    setDirty(true);
  }, []);
  const setDay = useCallback(
    (i: number, fn: (day: ProgramDay) => ProgramDay) =>
      update((x) => ({ ...x, days: x.days.map((day, j) => (j === i ? fn(day) : day)) })),
    [update],
  );

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
      // the builder makes way for the program: Back from it never lands in the builder again
      navigate({ to: "/portal/programs/$programId", params: { programId: id }, replace: true });
      if (!editing) {
        toast.success("Program saved to My programs. Start it or share it from here.");
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
    backTo: editing ? `/portal/programs/${initial.id}` : "/portal/programs",
    saving: saveMutation.isPending,
    update,
    setDay,
    save,
  };
}
