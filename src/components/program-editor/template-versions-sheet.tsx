import { useMemo, useState } from "react";
import { ArrowLeft, Bookmark, ChevronRight, History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BuilderSheet } from "./builder-sheet";
import {
  nameTemplateVersion,
  templateVersionKeys,
  useTemplateVersions,
  type TemplateVersion,
} from "@/lib/program-history-queries";
import { versionWhen } from "@/lib/program-versions";
import {
  readPayload,
  restoreTemplatePart,
  templateChanges,
  type TemplateChange,
  type TemplateRestoreTarget,
} from "@/lib/template-versions";
import { serializeTemplatePayload } from "@/lib/pl-template-blocks";

const SOURCE: Record<TemplateVersion["source"], string> = {
  create: "Created",
  save: "Saved",
  restore: "Restored",
  cleo: "Changed by Cleo",
  baseline: "Saved",
};
const headline = (v: TemplateVersion) => (v.source === "restore" && v.restored_from ? `Restored version ${v.restored_from}` : SOURCE[v.source]);

/**
 * Version history for a program template (Nov 24 2026): every save the
 * editor made (a burst of edits is one checkpoint), what changed in a coach's
 * words, and restoring the whole program, one block or the week on screen.
 * A restore is an edit (Undo takes it back) and the editor's save makes it a
 * new version; nothing later is lost. Programs already assigned to athletes
 * are their own copies and never change.
 */
export function TemplateVersionsSheet({
  open,
  onOpenChange,
  templateId,
  current,
  exercises,
  here,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templateId: string;
  current: unknown;
  exercises: Array<{ id: string; name: string }>;
  /** The block and week on screen (their restore choices). */
  here: { blockId: string | null; blockName: string | null; week: number | null } | null;
  onRestore: (nextPayload: unknown, versionNo: number, what: string) => void;
}) {
  const q = useTemplateVersions(templateId, open);
  const versions = q.data?.versions ?? [];
  const [openNo, setOpenNo] = useState<number | null>(null);
  const picked = openNo != null ? versions.find((v) => v.version_no === openNo) ?? null : null;
  const names = useMemo(() => new Map(exercises.map((e) => [e.id, e.name])), [exercises]);
  const nameOf = (id: string) => names.get(id) ?? null;
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
            <button type="button" onClick={() => setOpenNo(null)} aria-label="All versions" className="-ml-2 grid h-9 w-9 place-items-center rounded-full hover:bg-secondary">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="min-w-0 truncate">{picked.label || `Version ${picked.version_no}`}</span>
          </span>
        ) : (
          "Version history"
        )
      }
      description={
        picked
          ? `${headline(picked)} · ${versionWhen(picked.updated_at)}`
          : "Each stretch of editing is kept as a version. Open one to see what changed or bring part of it back. Programs already assigned to athletes never change."
      }
    >
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading versions…
        </div>
      ) : q.isError ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Couldn't load the history.{" "}
          <button type="button" className="font-medium text-foreground underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : q.data?.unavailable || !versions.length ? (
        <div className="flex flex-col items-center px-4 py-10 text-center" data-template-versions-empty>
          <History className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div className="mt-2 text-[15px] font-semibold">History starts with your next change</div>
          <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">Every stretch of editing is kept here to compare or bring back.</p>
        </div>
      ) : picked ? (
        <TemplateVersionDetail
          key={picked.id}
          templateId={templateId}
          version={picked}
          previous={versions.find((v) => v.version_no < picked.version_no) ?? null}
          current={current}
          here={here}
          nameOf={nameOf}
          onRestore={(next, what) => {
            onRestore(next, picked.version_no, what);
            close(false);
          }}
        />
      ) : (
        <ol className="-mx-1 space-y-1" data-template-versions>
          {versions.map((v, i) => {
            const prev = versions[i + 1] ?? null;
            const changes = prev ? templateChanges(prev.payload, v.payload, nameOf) : [];
            return (
              <li key={v.id}>
                <button type="button" onClick={() => setOpenNo(v.version_no)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-muted/60">
                  {v.label && i > 0 ? (
                    <Bookmark className="mt-1 h-3.5 w-3.5 shrink-0" aria-label="Named version" />
                  ) : (
                    <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", i === 0 ? "bg-foreground" : "bg-muted-foreground/40")} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-semibold">{v.label || `Version ${v.version_no}`}</span>
                      {i === 0 && <span className="text-xs font-medium text-muted-foreground">Latest</span>}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {headline(v)} · {versionWhen(v.updated_at)}
                    </span>
                    {!prev ? (
                      <span className="mt-1 block text-[13px] text-muted-foreground">{v.source === "baseline" ? "The program when history started being kept." : "First version."}</span>
                    ) : changes.length ? (
                      <span className="mt-1 block space-y-0.5">
                        {changes.slice(0, 3).map((c) => (
                          <Line key={c.id} c={c} />
                        ))}
                        {changes.length > 3 && <span className="block text-[12.5px] text-muted-foreground">+{changes.length - 3} more</span>}
                      </span>
                    ) : (
                      <span className="mt-1 block text-[13px] text-muted-foreground">Details only (names, notes or settings).</span>
                    )}
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </BuilderSheet>
  );
}

function Line({ c }: { c: TemplateChange }) {
  return (
    <span className="block text-[13px] leading-snug">
      <span className="font-medium">{c.where}</span>
      <span className="text-muted-foreground"> — </span>
      {c.text}
    </span>
  );
}

function TemplateVersionDetail({
  templateId,
  version,
  previous,
  current,
  here,
  nameOf,
  onRestore,
}: {
  templateId: string;
  version: TemplateVersion;
  previous: TemplateVersion | null;
  current: unknown;
  here: { blockId: string | null; blockName: string | null; week: number | null } | null;
  nameOf: (id: string) => string | null;
  onRestore: (next: unknown, what: string) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(version.label ?? "");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { target: TemplateRestoreTarget; title: string; lines: TemplateChange[] }>(null);
  const inThis = useMemo(() => (previous ? templateChanges(previous.payload, version.payload, nameOf) : []), [previous, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const vsNow = useMemo(() => templateChanges(current, version.payload, nameOf), [current, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const oldV2 = readPayload(version.payload);
  const choices: { target: TemplateRestoreTarget; title: string }[] = [{ target: { kind: "program" }, title: "The whole program" }];
  if (here?.blockId && oldV2?.blocks.some((b) => b.id === here.blockId)) {
    choices.push({ target: { kind: "block", blockId: here.blockId }, title: `Only "${here.blockName ?? "this block"}"` });
    if (here.week != null) choices.push({ target: { kind: "week", blockId: here.blockId, weekIndex: here.week }, title: `Only week ${here.week}` });
  }
  const nextFor = (t: TemplateRestoreTarget): unknown => {
    if (t.kind === "program") return version.payload;
    const v2 = restoreTemplatePart(current, version.payload, t);
    return v2 ? serializeTemplatePayload(v2) : null;
  };
  const ask = (target: TemplateRestoreTarget, title: string) => {
    const next = nextFor(target);
    setConfirm({ target, title, lines: next ? templateChanges(current, next, nameOf) : [] });
  };
  const save = async () => {
    setBusy(true);
    try {
      await nameTemplateVersion(version.id, label.trim() || null);
      await qc.invalidateQueries({ queryKey: templateVersionKeys.list(templateId) });
      toast.success(label.trim() ? "Named" : "Name removed");
    } catch {
      toast.error("Couldn't name it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (confirm) {
    return (
      <div className="space-y-4" data-template-restore-confirm>
        <div className="text-[16px] font-semibold">Restore {confirm.title.replace(/^Only /, "").toLowerCase()}?</div>
        {confirm.lines.length ? (
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-muted/50 p-3">
            {confirm.lines.map((c) => (
              <Line key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">The program already matches this version there.</p>
        )}
        <p className="text-[12.5px] text-muted-foreground">
          It's an edit you can undo, and later versions stay in history. Programs already assigned to athletes are their own copies and don't change.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-11 flex-1" onClick={() => setConfirm(null)}>
            Back
          </Button>
          <Button
            className="h-11 flex-1"
            disabled={!confirm.lines.length}
            onClick={() => {
              const next = nextFor(confirm.target);
              if (next) onRestore(next, confirm.target.kind === "program" ? `version ${version.version_no}` : `${confirm.title.replace(/^Only /, "")} from version ${version.version_no}`);
            }}
            data-template-restore-apply
          >
            Restore
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 80))} placeholder="Name this version" aria-label="Version name" className="h-10" />
        <Button variant="secondary" className="h-10 shrink-0" onClick={save} disabled={busy || label.trim() === (version.label ?? "")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save name"}
        </Button>
      </div>
      <section className="space-y-1.5">
        <h3 className="text-[13px] font-semibold text-muted-foreground">{previous ? `What changed from version ${previous.version_no}` : "What's in it"}</h3>
        {!previous ? (
          <p className="text-[13px] text-muted-foreground">The first version kept.</p>
        ) : inThis.length ? (
          inThis.map((c) => <Line key={c.id} c={c} />)
        ) : (
          <p className="text-[13px] text-muted-foreground">Details only (names, notes or settings).</p>
        )}
      </section>
      <section className="space-y-1.5">
        <h3 className="text-[13px] font-semibold text-muted-foreground">What restoring it changes in the program now</h3>
        {vsNow.length ? vsNow.slice(0, 12).map((c) => <Line key={c.id} c={c} />) : <p className="text-[13px] text-muted-foreground">The program is the same as this version.</p>}
        {vsNow.length > 12 && <p className="text-[12.5px] text-muted-foreground">+{vsNow.length - 12} more</p>}
      </section>
      {vsNow.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-muted-foreground">Restore from this version</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {choices.map((c) => (
              <Button key={c.title} variant="outline" className="h-11 justify-start gap-2" onClick={() => ask(c.target, c.title)} data-template-restore-choice={c.target.kind}>
                <RotateCcw className="h-4 w-4" aria-hidden /> <span className="truncate">{c.title}</span>
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
