import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, FileText, Info, Loader2, Lightbulb, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AiCreditsSheet, useSetCreditState } from "@/components/ai-credits/ai-credits";
import { useExerciseLibraryLite, type ExerciseLite } from "@/components/workout-day/workout-add-exercise";
import { BuilderSheet } from "@/components/program-editor/builder-sheet";
import { ImportSteps } from "./import-steps";
import type { ExerciseAlias } from "@/lib/exercise-library";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import type { ProgramDraft } from "@/lib/athlete-programs";
import { matchExerciseNames, nameKey } from "@/lib/program-import/match";
import { importNames, repeatWeeks, resolveName, toDraft, type ImportDraft } from "@/lib/program-import/review";
import { reviewGroups, weekRun, type NeedItem } from "@/lib/program-import/review-groups";
import {
  discardProgramImport,
  markProgramImportSaved,
  rereadProgramImport,
  retryProgramImport,
} from "@/lib/program-import/import.functions";
import { importKeys, importLabel, useProgramImport, type ImportRow } from "@/lib/program-import/queries";
import type { ImportFlag } from "@/lib/program-import/types";
import { useProgramEditor } from "@/components/athlete-programs/use-program-editor";
import { tagLatestVersion } from "@/lib/program-history-queries";
import { ProgramWorkbench, type WorkbenchReviewApi } from "@/components/athlete-programs/workbench/program-workbench";
import { isAiConsentDismissed, useAiConsentInline } from "@/components/ai-consent/ai-consent";

const COST = FEATURE_COSTS.program_import;

/** The exercise library's aliases (the same query the library control center reads). */
function useAliases() {
  return useQuery({
    queryKey: ["exercise-aliases"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("exercise_aliases")
        .select("alias_key, alias_name, exercise_id, source")
        .order("alias_name");
      if (error) throw error;
      return (data ?? []) as ExerciseAlias[];
    },
  });
}

/** One import, whatever stage it's at: being read, couldn't be read, ready to review, saved. */
export function ImportFlow({ id }: { id: string }) {
  const q = useProgramImport(id);
  const row = q.data;
  if (q.isLoading)
    return (
      <Shell>
        <div className="space-y-3 px-4 py-3 md:px-8" aria-hidden>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </Shell>
    );
  if (!row)
    return (
      <Shell>
        <Notice
          title="This import isn't here anymore"
          body="Imports that weren't saved are cleared after 30 days."
          action={<Link to="/portal/programs/import" className="font-medium underline">Start a new import</Link>}
        />
      </Shell>
    );
  if (row.status === "pending" || row.status === "reading") return <Reading row={row} />;
  if (row.status === "failed") return <Failed row={row} />;
  if (row.status === "discarded")
    return (
      <Shell>
        <Notice
          title="This import was discarded"
          body="Its file was deleted."
          action={<Link to="/portal/programs/import" className="font-medium underline">Start a new import</Link>}
        />
      </Shell>
    );
  if (row.status === "saved")
    return (
      <Shell>
        <Notice
          title="Saved to your programs"
          body={`${importLabel(row)} is a program in My programs now.`}
          action={
            row.program_id ? (
              <Link to="/portal/programs/$programId" params={{ programId: row.program_id }} className="font-medium underline">
                Open the program
              </Link>
            ) : (
              <Link to="/portal/programs" className="font-medium underline">My programs</Link>
            )
          }
        />
      </Shell>
    );
  // a re-read with AI gives the import a new read: a fresh review (and a fresh device copy)
  return <Review key={`${row.id}:${row.method}:${row.updated_at}`} row={row} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader title="Import a program" backTo="/portal/programs" />
      {children}
    </div>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-14 text-center" data-import-notice>
      <div className="text-[17px] font-semibold">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-[15px] text-muted-foreground">{body}</p>
      {action && <div className="mt-4 text-[15px]">{action}</div>}
    </div>
  );
}

function useDiscard(id: string) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const discard = useServerFn(discardProgramImport);
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async () => {
      setBusy(true);
      try {
        await discard({ data: { id } });
        void qc.invalidateQueries({ queryKey: importKeys.recent });
        navigate({ to: "/portal/programs", replace: true });
        toast("Import discarded. Its file was deleted.");
      } catch {
        toast.error("Couldn't discard it. Try again.");
      } finally {
        setBusy(false);
      }
    },
  };
}

function Reading({ row }: { row: ImportRow }) {
  const discard = useDiscard(row.id);
  const [confirm, setConfirm] = useState(false);
  return (
    <Shell>
      <div className="px-4 pt-2 md:px-8">
        <ImportSteps at={2} busy />
      </div>
      <div className="flex flex-col items-center px-6 py-14 text-center" data-import-reading aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <div className="mt-4 text-[17px] font-semibold">Reading your program…</div>
        <p className="mt-1 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          {importLabel(row)}. A long program can take a few minutes. You can leave this screen: you'll get a notification when
          it's ready, and it waits for you under Import a program.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/portal/programs">Go to programs</Link>
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(true)} disabled={discard.busy}>
            Cancel import
          </Button>
        </div>
      </div>
      <DiscardDialog open={confirm} onOpenChange={setConfirm} onConfirm={discard.run} running />
    </Shell>
  );
}

function Failed({ row }: { row: ImportRow }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [retry, consentAsk] = useAiConsentInline(useServerFn(retryProgramImport), "reads your program");
  const setCredits = useSetCreditState();
  const discard = useDiscard(row.id);
  const [busy, setBusy] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const canRetry = !row.files_deleted_at || !!row.source_text;
  const again = async () => {
    setBusy(true);
    try {
      const r = await retry({ data: { id: row.id } });
      if (!r.ok) {
        if ("outOfCredits" in r && r.outOfCredits) {
          setCredits((r as any).credits);
          setCreditsOpen(true);
        } else toast.error(r.message);
        return;
      }
      void qc.invalidateQueries({ queryKey: importKeys.one(row.id) });
    } catch (e) {
      if (!isAiConsentDismissed(e)) toast.error("Couldn't start it again. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <div className="px-6 py-12 text-center" data-import-failed>
        <AlertTriangle className="mx-auto h-7 w-7 text-warning" aria-hidden />
        <div className="mt-3 text-[17px] font-semibold">This program couldn't be read</div>
        <p className="mx-auto mt-1 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          {row.error ?? "Something went wrong reading it."} Your credits were given back.
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
          {canRetry && (
            <Button onClick={again} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Try again ({COST} credits)
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate({ to: "/portal/programs/import", search: { paste: 1 } })}>
            Paste it as text instead
          </Button>
          {consentAsk}
          <Button variant="ghost" onClick={discard.run} disabled={discard.busy}>
            Discard
          </Button>
        </div>
      </div>
      <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out feature="program_import" />
    </Shell>
  );
}

function DiscardDialog({
  open,
  onOpenChange,
  onConfirm,
  running = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  running?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{running ? "Cancel this import?" : "Discard this import?"}</AlertDialogTitle>
          <AlertDialogDescription>
            Its file is deleted now and nothing is saved.{running ? " Any credits it took are given back." : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {running ? "Cancel import" : "Discard"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The read, matched to the library and opened in the builder with its checks above the day. */
function Review({ row }: { row: ImportRow }) {
  const library = useExerciseLibraryLite(true);
  const aliases = useAliases();
  const ready = !!library.data && (aliases.isSuccess || aliases.isError);

  const read = useMemo<{ draft: ImportDraft; matches: Matches } | null>(() => {
    if (!ready || !row.result) return null;
    const matches = matchExerciseNames(library.data!, importNames(row.result), aliases.data ?? []);
    return { matches, draft: toDraft(row.result, { matches, source: row.source_text, method: row.method ?? "parsed", fileName: row.file_name }) };
    // the read is made once: a refetch of the library while reviewing never resets the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, row.id]);
  const draft = read?.draft ?? null;

  if (library.isError)
    return (
      <Shell>
        <Notice
          title="The exercise library didn't load"
          body="Your import is safe. Check your connection, then try again."
          action={
            <button type="button" className="font-medium underline" onClick={() => void library.refetch()}>
              Try again
            </button>
          }
        />
      </Shell>
    );
  if (!draft)
    return (
      <Shell>
        <div className="flex flex-col items-center px-6 py-14 text-center" aria-live="polite">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
          <div className="mt-3 text-[15px] text-muted-foreground">Matching exercises to the library…</div>
        </div>
      </Shell>
    );
  if (!draft.plan.blocks.length) return <NothingFound row={row} />;
  return <ReviewEditor row={row} draft={draft} matches={read!.matches} />;
}

function NothingFound({ row }: { row: ImportRow }) {
  const navigate = useNavigate();
  const discard = useDiscard(row.id);
  const reread = useReread(row);
  return (
    <Shell>
      <div className="px-6 py-12 text-center" data-import-empty>
        <div className="text-[17px] font-semibold">No exercises were found in it</div>
        <p className="mx-auto mt-1 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          {row.method === "parsed"
            ? `It isn't laid out in a way that could be read instantly. Do a full read (${COST} credits), or paste it with one exercise per line.`
            : "Check that the file has the program's exercises in it, or paste the program as text."}
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
          {row.method === "parsed" && (
            <Button onClick={reread.run} disabled={reread.busy}>
              {reread.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Do a full read
            </Button>
          )}
          {reread.ask}
          <Button variant="outline" onClick={() => navigate({ to: "/portal/programs/import", search: { paste: 1 } })}>
            Paste it as text
          </Button>
          <Button variant="ghost" onClick={discard.run} disabled={discard.busy}>
            Discard
          </Button>
        </div>
      </div>
      {reread.sheet}
    </Shell>
  );
}

function useReread(row: ImportRow) {
  const qc = useQueryClient();
  const [reread, consentAsk] = useAiConsentInline(useServerFn(rereadProgramImport), "reads your program");
  const setCredits = useSetCreditState();
  const [busy, setBusy] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  return {
    busy,
    run: async () => {
      setBusy(true);
      try {
        const r = await reread({ data: { id: row.id } });
        if (!r.ok) {
          if ("outOfCredits" in r && r.outOfCredits) {
            setCredits((r as any).credits);
            setCreditsOpen(true);
          } else toast.error(r.message);
          return;
        }
        void qc.invalidateQueries({ queryKey: importKeys.one(row.id) });
      } catch (e) {
        if (!isAiConsentDismissed(e)) toast.error("Couldn't start it. Try again.");
      } finally {
        setBusy(false);
      }
    },
    sheet: <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out feature="program_import" />,
    ask: consentAsk,
  };
}

function ReviewEditor({ row, draft, matches }: { row: ImportRow; draft: ImportDraft; matches: Matches }) {
  const qc = useQueryClient();
  const markSaved = useServerFn(markProgramImportSaved);
  const [start] = useState<ProgramDraft>(() => ({
    id: null,
    title: draft.title,
    description: draft.description,
    goal: null,
    level: null,
    plan: draft.plan,
  }));
  const editor = useProgramEditor(start, `${row.method}:${row.updated_at}`, {
    backupKey: (uid) => `jf.program-import.v1:${uid}:${row.id}`,
    startDirty: true,
    savedMessage: "Imported to My programs. Start it from here.",
    onSaved: async (programId) => {
      void tagLatestVersion(programId, "import");
      await markSaved({ data: { id: row.id, programId } });
      void qc.invalidateQueries({ queryKey: importKeys.recent });
    },
  });
  // step 3: Save asks once, with what's going in, before it's saved
  const [confirm, setConfirm] = useState(false);
  const answer = useRef<((go: boolean) => void) | null>(null);
  const groups = useMemo(() => reviewGroups(editor.d.plan, draft.flags, { oneWeek: draft.oneWeek }), [editor.d.plan, draft.flags, draft.oneWeek]);
  const settle = (go: boolean) => {
    answer.current?.(go);
    answer.current = null;
    setConfirm(false);
  };
  return (
    <>
      <ProgramWorkbench
        editor={editor}
        review={(api) => <ReviewPanel api={api} row={row} draft={draft} matches={matches} />}
        beforeSave={() =>
          // something still blocking: Save goes straight to it (the builder's own check)
          groups.blocking > 0
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
                answer.current = resolve;
                setConfirm(true);
              })
        }
      />
      <ConfirmSave
        open={confirm}
        onOpenChange={(o) => !o && settle(false)}
        title={editor.d.title}
        groups={groups}
        onSave={() => settle(true)}
      />
    </>
  );
}

type Matches = ReturnType<typeof matchExerciseNames<ExerciseLite>>;

/**
 * Step 2, the review (Nov 24 2026): one compact card above the program, never
 * a wall of warnings. The program's shape in four numbers, then what's waiting
 * in three groups: Needs your review (names to match and missing numbers stop
 * Save; checks worth a look can be marked looked at), Ready (what came in as
 * written) and Optional (names matched under another library name, running a
 * one-week program longer, notes about the read). A clean import is one line
 * that says so. The same problem across weeks is one item, and a name is
 * matched everywhere it's used with one tap.
 */
function ReviewPanel({
  api,
  row,
  draft,
  matches,
}: {
  api: WorkbenchReviewApi;
  row: ImportRow;
  draft: ImportDraft;
  matches: Matches;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(
    () => reviewGroups(api.plan, draft.flags, { oneWeek: draft.oneWeek, dismissed }),
    [api.plan, draft.flags, draft.oneWeek, dismissed],
  );
  const needs = groups.needs.length;
  const [open, setOpen] = useState<"needs" | "matched" | "ready" | "optional" | null>(needs ? "needs" : null);
  // names the file wrote one way and the library another (shorthand, plurals): confirmed or changed in one tap
  const matched = groups.optional.filter((i) => i.kind === "matched_as");
  const optional = groups.optional.filter((i) => i.kind !== "matched_as");
  const [allNeeds, setAllNeeds] = useState(false);
  const [source, setSource] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const discard = useDiscard(row.id);
  const reread = useReread(row);
  const s = groups.summary;
  const shownNeeds = allNeeds ? groups.needs : groups.needs.slice(0, 4);
  const toggle = (g: "needs" | "matched" | "ready" | "optional") => setOpen((o) => (o === g ? null : g));

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Review your import" data-import-review>
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <ImportSteps at={2} />
      </div>
      <div className="grid grid-cols-4 gap-1 px-2 pb-1 pt-3 text-center" data-import-summary>
        {[
          [s.weeks, s.weeks === 1 ? "week" : "weeks"],
          [s.daysPerWeek, "days / wk"],
          [s.blocks, s.blocks === 1 ? "block" : "blocks"],
          [s.exercises, "exercises"],
        ].map(([n, label]) => (
          <div key={String(label)} className="min-w-0 px-1">
            <div className="text-[20px] font-semibold leading-tight tabular-nums">{n}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* the three groups, one line each until opened */}
      <div className="divide-y divide-border/60 border-t border-border/60">
        <GroupRow
          tone={needs ? "warn" : "good"}
          label={needs ? "Needs your review" : "Nothing needs your review"}
          count={needs}
          open={open === "needs"}
          onToggle={needs ? () => toggle("needs") : undefined}
          testid="needs"
        >
          <div className="space-y-1 pb-2" data-import-fix-list>
            {shownNeeds.map((item) => (
              <NeedRow
                key={item.id}
                item={item}
                matches={matches}
                onPick={(name, ex) => {
                  api.edit((p) => resolveName(p, name, ex));
                  toast(`"${name}" is now ${ex.name} everywhere`, { action: { label: "Undo", onClick: () => api.undo() } });
                }}
                onSearch={(name) => api.resolve(name)}
                onGo={(at) => api.goTo(at)}
                onDismiss={(id) => setDismissed((d) => new Set(d).add(id))}
              />
            ))}
            {groups.needs.length > shownNeeds.length && (
              <button type="button" onClick={() => setAllNeeds(true)} className="px-1 text-[13px] font-medium underline">
                Show {groups.needs.length - shownNeeds.length} more
              </button>
            )}
          </div>
        </GroupRow>
        {matched.length > 0 && (
          <GroupRow tone="good" label="Matched for you" count={matched.length} open={open === "matched"} onToggle={() => toggle("matched")} testid="matched">
            <div className="space-y-1 pb-2" data-import-matched>
              {matched.map((item) =>
                item.kind === "matched_as" ? (
                  <div key={item.id} className="flex min-h-11 items-center gap-2.5 px-1" data-import-matched-as>
                    <span className="min-w-0 flex-1 text-[14px] leading-snug">
                      <span className="text-muted-foreground">"{item.fileName}" →</span>{" "}
                      <span className="font-medium">{item.libraryName}</span>
                      {item.count > 1 && <span className="text-muted-foreground"> · {item.count} uses</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => api.resolve(item.fileName)}
                      className="h-9 shrink-0 rounded-lg px-2.5 text-[13px] font-semibold hover:bg-secondary"
                    >
                      Change
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          </GroupRow>
        )}
        <GroupRow tone="good" label="Ready to import" count={groups.ready.length} open={open === "ready"} onToggle={() => toggle("ready")} testid="ready">
          <ul className="space-y-1.5 pb-2" data-import-ready>
            {groups.ready.map((t) => (
              <li key={t} className="flex items-start gap-2 text-[14px] leading-snug">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </GroupRow>
        {(optional.length > 0 || row.method === "parsed") && (
          <GroupRow
            tone="quiet"
            label="Optional improvements"
            count={optional.length}
            open={open === "optional"}
            onToggle={() => toggle("optional")}
            testid="optional"
          >
            <div className="space-y-1 pb-2" data-import-checks>
              {optional.map((item) =>
                item.kind === "one_week" ? (
                  <div key={item.id} className="px-1 py-1.5" data-import-one-week>
                    <div className="text-[14px]">Run this one-week program for longer</div>
                    <div className="mt-1.5 flex gap-2">
                      {[4, 8, 12].map((n) => (
                        <Button key={n} variant="outline" size="sm" className="h-9" onClick={() => api.edit((p) => repeatWeeks(p, n))}>
                          {n} weeks
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <FlagRow
                    key={item.id}
                    flag={{ level: "info", code: "note", text: item.text }}
                    onGo={item.at ? () => api.goTo(item.at as any) : undefined}
                  />
                ),
              )}
              {row.method === "parsed" && (
                <button
                  type="button"
                  onClick={reread.run}
                  disabled={reread.busy}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-1 text-left text-[14px] hover:bg-muted/50"
                  data-import-reread
                >
                  {reread.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0 flex-1">Doesn't look right? Do a full read</span>
                  <span className="shrink-0 text-[13px] text-muted-foreground">{COST} credits</span>
                </button>
              )}
              {reread.ask}
            </div>
          </GroupRow>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 px-4 py-2.5 text-[13px]">
        <button type="button" onClick={() => setSource(true)} className="inline-flex items-center gap-1.5 font-medium">
          <FileText className="h-3.5 w-3.5" aria-hidden /> See your file
        </button>
        <button type="button" onClick={() => setConfirm(true)} className="ml-auto font-medium text-muted-foreground" data-import-discard>
          Discard import
        </button>
      </div>
      <SourceSheet open={source} onOpenChange={setSource} row={row} />
      <DiscardDialog open={confirm} onOpenChange={setConfirm} onConfirm={discard.run} />
      {reread.sheet}
    </section>
  );
}

function GroupRow({
  tone,
  label,
  count,
  open,
  onToggle,
  testid,
  children,
}: {
  tone: "warn" | "good" | "quiet";
  label: string;
  count: number;
  open: boolean;
  onToggle?: () => void;
  testid: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "good" ? Check : Lightbulb;
  return (
    <div data-import-group={testid}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={onToggle ? open : undefined}
        className="flex min-h-12 w-full items-center gap-2.5 px-4 text-left disabled:cursor-default"
      >
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            tone === "warn" ? "bg-warning/15 text-warning" : tone === "good" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[14.5px] font-medium">{label}</span>
        {count > 0 && <span className="text-[13px] tabular-nums text-muted-foreground">{count}</span>}
        {onToggle && <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", open && "rotate-180")} aria-hidden />}
      </button>
      {open && <div className="px-3">{children}</div>}
    </div>
  );
}

function NeedRow({
  item,
  matches,
  onPick,
  onSearch,
  onGo,
  onDismiss,
}: {
  item: NeedItem;
  matches: Matches;
  onPick: (name: string, ex: ExerciseLite) => void;
  onSearch: (name: string) => void;
  onGo: (at: { b: number; w: number; d: number; e?: number }) => void;
  onDismiss: (id: string) => void;
}) {
  if (item.kind === "unmatched") {
    const options = (matches.get(nameKey(item.name))?.options ?? []).slice(0, 2);
    return (
      <div className="rounded-xl bg-muted/40 px-3 py-2.5" data-import-unmatched>
        <div className="text-[14px] leading-snug">
          Which exercise is <span className="font-semibold">"{item.name}"</span>?
          {item.count > 1 && <span className="text-muted-foreground"> · {item.count} uses</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(item.name, o)}
              className="inline-flex h-9 max-w-full items-center truncate rounded-full border border-border bg-background px-3 text-[13px] font-medium hover:bg-secondary"
              data-import-suggestion
            >
              {o.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSearch(item.name)}
            className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold hover:bg-secondary"
          >
            <Search className="h-3.5 w-3.5" aria-hidden /> {options.length ? "Other" : "Find it"}
          </button>
        </div>
      </div>
    );
  }
  if (item.kind === "numbers") {
    return (
      <button
        type="button"
        onClick={() => onGo(item.at)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-1 text-left hover:bg-muted/50"
        data-import-missing
      >
        <span className="min-w-0 flex-1 text-[14px] leading-snug">
          <span className="font-medium">{item.name}</span> needs {item.what}
          <span className="text-muted-foreground"> · {item.day}{item.weeks.length > 1 || item.weeks[0] > 1 ? `, ${weekRun(item.weeks)}` : ""}</span>
        </span>
        <span className="shrink-0 text-[13px] font-semibold">Fill in</span>
      </button>
    );
  }
  return (
    <div className="flex min-h-11 items-start gap-2.5 px-1 py-1.5" data-import-check>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1 text-[14px] leading-snug">{item.text}</span>
      {item.at && (
        <button type="button" onClick={() => onGo(item.at!)} className="h-8 shrink-0 rounded-lg px-2 text-[13px] font-semibold hover:bg-secondary">
          Look
        </button>
      )}
      <button type="button" onClick={() => onDismiss(item.id)} className="h-8 shrink-0 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-secondary">
        OK
      </button>
    </div>
  );
}

function FlagRow({ flag, onGo }: { flag: ImportFlag; onGo?: () => void }) {
  const Icon = flag.level === "info" ? Info : AlertTriangle;
  const body = (
    <>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", flag.level === "info" ? "text-muted-foreground" : "text-warning")} aria-hidden />
      <span className="min-w-0 flex-1 text-[14px] leading-snug">{flag.text}</span>
    </>
  );
  return onGo ? (
    <button type="button" onClick={onGo} className="flex w-full items-start gap-2.5 rounded-lg px-1 py-2 text-left hover:bg-muted/50">
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-2.5 px-1 py-2">{body}</div>
  );
}

/**
 * Step 3, confirm and save: what goes into My programs, said once before it's
 * saved (private to them; started or shared from its page after).
 */
function ConfirmSave({
  open,
  onOpenChange,
  title,
  groups,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  groups: ReturnType<typeof reviewGroups>;
  onSave: () => void;
}) {
  const s = groups.summary;
  return (
    <BuilderSheet open={open} onOpenChange={onOpenChange} title="Save to My programs" description={<ImportSteps at={3} className="mt-1.5" />}>
      <div className="space-y-4" data-import-confirm>
        <div className="rounded-2xl border border-border p-4">
          <div className="text-[17px] font-semibold leading-snug">{title || "Imported program"}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {s.weeks} {s.weeks === 1 ? "week" : "weeks"} · {s.daysPerWeek} {s.daysPerWeek === 1 ? "day" : "days"} a week
            {s.blocks > 1 ? ` · ${s.blocks} blocks` : ""} · {s.exercises} exercises
          </div>
          <ul className="mt-3 space-y-1.5">
            {groups.ready.slice(0, 4).map((t) => (
              <li key={t} className="flex items-start gap-2 text-[14px] leading-snug">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] leading-snug text-muted-foreground">
          It's private to you. Start it or share it from its page, and edit anything any time. Nothing about your
          program was changed on the way in.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-12 flex-1" onClick={() => onOpenChange(false)}>
            Keep reviewing
          </Button>
          <Button className="h-12 flex-1 text-[15px]" onClick={onSave} data-import-confirm-save>
            Save program
          </Button>
        </div>
      </div>
    </BuilderSheet>
  );
}

/** What the program was read from: the text, or the uploaded file while it's still kept. */
function SourceSheet({ open, onOpenChange, row }: { open: boolean; onOpenChange: (o: boolean) => void; row: ImportRow }) {
  const links = useQuery({
    queryKey: ["program-import", "links", row.id],
    enabled: open && !row.source_text && !row.files_deleted_at && row.file_paths.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("program-imports").createSignedUrls(row.file_paths, 600);
      if (error) throw error;
      return (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        swipeToClose
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:mx-auto sm:max-w-2xl"
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-start gap-3 pb-3">
          <SheetHeader className="min-w-0 flex-1 space-y-0.5 p-0 text-left">
            <SheetTitle className="break-words text-[18px] font-semibold leading-tight">{importLabel(row)}</SheetTitle>
            <SheetDescription className="text-[13px]">
              {row.source_text ? "What was read from it, to check the program against." : "The file you uploaded."}
            </SheetDescription>
          </SheetHeader>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold transition hover:bg-secondary"
          >
            Done
          </button>
        </div>
        {row.source_text ? (
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 font-mono text-[13px] leading-relaxed">
            {row.source_text}
          </pre>
        ) : row.files_deleted_at ? (
          <p className="text-[14px] text-muted-foreground">The file was deleted from our servers.</p>
        ) : links.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex flex-col gap-2">
            {(links.data ?? []).map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[15px] font-medium underline">
                {row.source_kind === "pdf" ? "Open the PDF" : `Open photo ${i + 1}`}
              </a>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
