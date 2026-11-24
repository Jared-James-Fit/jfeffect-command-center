import { useMemo, useState } from "react";
import { ArrowLeft, Bookmark, ChevronRight, Eye, History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BuilderSheet } from "@/components/program-editor/builder-sheet";
import type { ProgramDraft } from "@/lib/athlete-programs";
import type { Cursor, ProgramPlan } from "@/lib/program-plan";
import {
  allWeekRefs,
  planChanges,
  restoreFrom,
  restoreWords,
  versionHeadline,
  versionWhen,
  type PlanChange,
  type ProgramVersion,
  type RestoreTarget,
} from "@/lib/program-versions";
import {
  nameVersion,
  useExerciseNames,
  useProgramVersions,
  versionKeys,
} from "@/lib/program-history-queries";
import { PlanView } from "../plan-view";

const SHOWN_CHANGES = 3;

/**
 * Version history (Nov 24 2026), a document editor's: every save of the
 * program newest first, each with when, what made it (saved, imported,
 * restored) and what changed in plain words. A version opens to everything it
 * changed, a preview of the program as it was, how it compares with the
 * program now, and restoring: the whole program, the block, week or day on
 * screen, or any one change. A restore edits the draft (one Undo step);
 * saving it makes a new version, so nothing later is ever lost. A checkpoint
 * can be named so it's easy to find again.
 */
export function VersionsSheet({
  open,
  onOpenChange,
  programId,
  current,
  cursor,
  running,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  programId: string;
  /** The draft as it is now (what a restore changes). */
  current: ProgramDraft;
  /** The block, week and day on screen (the restore choices name them). */
  cursor: Cursor;
  /** The program is on their calendar: a restore reaches untouched workouts only, once saved. */
  running: boolean;
  onRestore: (next: ProgramDraft, versionNo: number, what: string) => void;
}) {
  const q = useProgramVersions(programId, open);
  const versions = q.data?.versions ?? [];
  const [openNo, setOpenNo] = useState<number | null>(null);
  const picked = openNo != null ? (versions.find((v) => v.version_no === openNo) ?? null) : null;

  // names for exercises an older version had that the program no longer does
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const b of current.plan.blocks)
      for (const w of b.weeks)
        for (const d of w.days)
          for (const e of d.exercises) if (e.name) out[e.exercise_id] = e.name;
    return out;
  }, [current.plan]);
  const missing = useMemo(() => {
    const ids = new Set<string>();
    for (const v of versions)
      for (const b of v.plan?.blocks ?? [])
        for (const w of b.weeks)
          for (const d of w.days)
            for (const e of d.exercises) if (!names[e.exercise_id]) ids.add(e.exercise_id);
    return [...ids];
  }, [versions, names]);
  const extra = useExerciseNames(missing, open);
  const nameOf = (id: string) => names[id] ?? extra.data?.[id] ?? null;

  const close = (o: boolean) => {
    if (!o) setOpenNo(null);
    onOpenChange(o);
  };

  return (
    <BuilderSheet
      open={open}
      onOpenChange={close}
      wide
      title={
        picked ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenNo(null)}
              aria-label="All versions"
              className="-ml-2 grid h-9 w-9 place-items-center rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="min-w-0 truncate">
              {picked.label || `Version ${picked.version_no}`}
            </span>
          </span>
        ) : (
          "Version history"
        )
      }
      description={
        picked
          ? `${versionHeadline(picked)} · ${versionWhen(picked.updated_at)}`
          : "Every save is kept. Open one to see what changed or bring any part of it back."
      }
    >
      {q.isLoading ? (
        <div
          className="flex items-center gap-2 py-8 text-[14px] text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading versions…
        </div>
      ) : q.isError ? (
        <div className="py-8 text-center text-[14px] text-muted-foreground">
          Couldn't load the history.{" "}
          <button
            type="button"
            className="font-medium text-foreground underline"
            onClick={() => void q.refetch()}
          >
            Try again
          </button>
        </div>
      ) : q.data?.unavailable || !versions.length ? (
        <div className="flex flex-col items-center px-4 py-10 text-center" data-versions-empty>
          <History className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div className="mt-2 text-[15px] font-semibold">History starts with your next save</div>
          <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">
            Each time you save, that version is kept here so you can compare it or bring it back.
          </p>
        </div>
      ) : picked ? (
        <VersionDetail
          key={picked.id}
          programId={programId}
          version={picked}
          previous={versions.find((v) => v.version_no < picked.version_no) ?? null}
          current={current}
          cursor={cursor}
          running={running}
          nameOf={nameOf}
          onRestore={(next, what) => {
            onRestore(next, picked.version_no, what);
            close(false);
          }}
        />
      ) : (
        <ol className="-mx-1 space-y-1" data-versions-list>
          {versions.map((v, i) => {
            const prev = versions[i + 1] ?? null;
            const changes = prev ? planChanges(prev, v, nameOf) : [];
            const latest = i === 0;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setOpenNo(v.version_no)}
                  className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-muted/60"
                  data-version-row={v.version_no}
                >
                  {v.label && !latest ? (
                    <Bookmark className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground" aria-label="Named version" />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                        latest ? "bg-foreground" : "bg-muted-foreground/40",
                      )}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-semibold">
                        {v.label || `Version ${v.version_no}`}
                      </span>
                      {latest && (
                        <span className="text-[12px] font-medium text-muted-foreground">
                          Last saved
                        </span>
                      )}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {versionHeadline(v)} · {versionWhen(v.updated_at)}
                    </span>
                    {v.source === "baseline" && !prev ? (
                      <span className="mt-1 block text-[13px] text-muted-foreground">
                        The program as it was when history started being kept.
                      </span>
                    ) : !prev ? (
                      <span className="mt-1 block text-[13px] text-muted-foreground">
                        First version.
                      </span>
                    ) : changes.length ? (
                      <span className="mt-1 block space-y-0.5">
                        {changes.slice(0, SHOWN_CHANGES).map((c) => (
                          <ChangeLine key={c.id} c={c} />
                        ))}
                        {changes.length > SHOWN_CHANGES && (
                          <span className="block text-[12.5px] text-muted-foreground">
                            +{changes.length - SHOWN_CHANGES} more{" "}
                            {changes.length - SHOWN_CHANGES === 1 ? "change" : "changes"}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="mt-1 block text-[13px] text-muted-foreground">
                        No changes to the training.
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </BuilderSheet>
  );
}

function ChangeLine({ c, onRestore }: { c: PlanChange; onRestore?: () => void }) {
  return (
    <span className="flex items-start gap-2 text-[13px] leading-snug" data-change-line>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{c.where}</span>
        <span className="text-muted-foreground"> — </span>
        <span className="text-foreground/90">{c.text}</span>
      </span>
      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          className="-my-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold hover:bg-secondary"
          data-restore-change
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
        </button>
      )}
    </span>
  );
}

function VersionDetail({
  programId,
  version,
  previous,
  current,
  cursor,
  running,
  nameOf,
  onRestore,
}: {
  programId: string;
  version: ProgramVersion;
  previous: ProgramVersion | null;
  current: ProgramDraft;
  cursor: Cursor;
  running: boolean;
  nameOf: (id: string) => string | null;
  onRestore: (next: ProgramDraft, what: string) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(version.label ?? "");
  const [savingName, setSavingName] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<null | {
    target: RestoreTarget;
    title: string;
    lines: PlanChange[];
  }>(null);
  const old = version.plan;

  const inThis = useMemo(
    () => (previous ? planChanges(previous, version, nameOf) : []),
    [previous, version],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  // what restoring would change: the program now → this version
  const vsNow = useMemo(
    () =>
      old
        ? planChanges(
            { title: current.title, plan: current.plan },
            { title: version.title, plan: old },
            nameOf,
          )
        : [],
    [old, current, version.title], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!old)
    return (
      <p className="py-6 text-[14px] text-muted-foreground">
        This version has no training saved with it.
      </p>
    );

  const block = current.plan.blocks[cursor.b];
  const week = block?.weeks[cursor.w];
  const day = week?.days[cursor.d];
  const choices: { target: RestoreTarget; title: string }[] = [
    { target: { kind: "program" }, title: "The whole program" },
  ];
  if (current.plan.blocks.length > 1 && block && old.blocks.some((b) => b.key === block.key)) {
    choices.push({ target: { kind: "block", blockKey: block.key }, title: `Only "${block.name}"` });
  }
  if (block && week)
    choices.push({
      target: { kind: "week", blockKey: block.key, weekKey: week.key },
      title: "Only the week on screen",
    });
  if (day)
    choices.push({
      target: { kind: "day", weeks: allWeekRefs(current.plan), dayKey: day.key },
      title: `Only ${day.title}, every week`,
    });

  const linesFor = (target: RestoreTarget): PlanChange[] => {
    const next = target.kind === "program" ? old : restoreFrom(current.plan, old, target);
    return planChanges(
      { title: current.title, plan: current.plan },
      { title: target.kind === "program" ? version.title : current.title, plan: next },
      nameOf,
    );
  };
  const ask = (target: RestoreTarget, title: string) =>
    setConfirm({ target, title, lines: linesFor(target) });
  const apply = () => {
    if (!confirm) return;
    const t = confirm.target;
    // a saved version holds library ids only: the names come back from the program and the library
    const plan: ProgramPlan = withNames(
      t.kind === "program" ? old : restoreFrom(current.plan, old, t),
      nameOf,
    );
    onRestore(
      t.kind === "program"
        ? { ...current, title: version.title, description: version.description ?? "", plan }
        : { ...current, plan },
      t.kind === "program"
        ? `version ${version.version_no}`
        : `${restoreWords(t, current.plan)} from version ${version.version_no}`,
    );
  };

  const saveName = async () => {
    setSavingName(true);
    try {
      await nameVersion(version.id, label.trim() || null);
      await qc.invalidateQueries({ queryKey: versionKeys.list(programId) });
      toast.success(label.trim() ? "Named" : "Name removed");
    } catch {
      toast.error("Couldn't name it. Try again.");
    } finally {
      setSavingName(false);
    }
  };

  if (confirm) {
    return (
      <div className="space-y-4" data-restore-confirm>
        <div>
          <div className="text-[16px] font-semibold">
            Restore {confirm.title.replace(/^Only /, "").toLowerCase()}?
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {confirm.lines.length
              ? "This is what changes in your program:"
              : "Your program already matches this version there. Nothing would change."}
          </p>
        </div>
        {confirm.lines.length > 0 && (
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-muted/50 p-3">
            {confirm.lines.map((c) => (
              <ChangeLine key={c.id} c={c} />
            ))}
          </div>
        )}
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          Nothing is saved until you tap Save, and every later version stays in history.
          {running
            ? " If it's on your calendar, workouts you've already done or started keep exactly what you logged; only upcoming ones follow."
            : ""}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-11 flex-1" onClick={() => setConfirm(null)}>
            Back
          </Button>
          <Button
            className="h-11 flex-1"
            onClick={apply}
            disabled={!confirm.lines.length}
            data-restore-apply
          >
            Restore
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-version-detail={version.version_no}>
      <div className="flex items-center gap-2">
        <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 80))}
          placeholder="Name this version (e.g. Before deload changes)"
          aria-label="Version name"
          className="h-10 text-[15px]"
        />
        <Button
          variant="secondary"
          className="h-10 shrink-0"
          onClick={saveName}
          disabled={savingName || label.trim() === (version.label ?? "")}
        >
          {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save name"}
        </Button>
      </div>

      <section className="space-y-1.5" aria-label="What changed">
        <h3 className="text-[13px] font-semibold text-muted-foreground">
          {previous ? `What changed from version ${previous.version_no}` : "What's in it"}
        </h3>
        {!previous ? (
          <p className="text-[13px] text-muted-foreground">
            {version.source === "baseline"
              ? "The program as it was when history started being kept."
              : "The first saved version."}
          </p>
        ) : inThis.length ? (
          inThis.map((c) => <ChangeLine key={c.id} c={c} />)
        ) : (
          <p className="text-[13px] text-muted-foreground">No changes to the training.</p>
        )}
      </section>

      <section className="space-y-1.5" aria-label="What restoring it changes">
        <h3 className="text-[13px] font-semibold text-muted-foreground">
          What restoring it changes in your program now
        </h3>
        {vsNow.length ? (
          vsNow.map((c) => (
            <ChangeLine
              key={c.id}
              c={c}
              onRestore={c.restore ? () => ask(c.restore!, `this change (${c.where})`) : undefined}
            />
          ))
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Your program is the same as this version.
          </p>
        )}
      </section>

      {vsNow.length > 0 && (
        <section className="space-y-2" aria-label="Restore">
          <h3 className="text-[13px] font-semibold text-muted-foreground">
            Restore from this version
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map((c) => (
              <Button
                key={c.title}
                variant="outline"
                className="h-11 justify-start gap-2 text-[14px]"
                onClick={() => ask(c.target, c.title)}
                data-restore-choice={c.target.kind}
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> {c.title}
              </Button>
            ))}
          </div>
        </section>
      )}

      <section>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="flex items-center gap-2 text-[14px] font-semibold"
          aria-expanded={preview}
        >
          <Eye className="h-4 w-4" aria-hidden />{" "}
          {preview ? "Hide preview" : "Preview this version"}
        </button>
        {preview && (
          <div className="mt-3 rounded-2xl border border-border p-3">
            <PlanView plan={withNames(old, nameOf)} />
          </div>
        )}
      </section>
    </div>
  );
}

function withNames(plan: ProgramPlan, nameOf: (id: string) => string | null): ProgramPlan {
  return {
    ...plan,
    blocks: plan.blocks.map((b) => ({
      ...b,
      weeks: b.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => ({
          ...d,
          exercises: d.exercises.map((e) => ({ ...e, name: e.name ?? nameOf(e.exercise_id) })),
        })),
      })),
    })),
  };
}
