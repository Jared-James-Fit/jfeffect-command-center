import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, FileText, Info, Loader2, Sparkles } from "lucide-react";
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
import { useExerciseLibraryLite } from "@/components/workout-day/workout-add-exercise";
import type { ExerciseAlias } from "@/lib/exercise-library";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import { totalWeeks, type ProgramPlan } from "@/lib/program-plan";
import type { ProgramDraft } from "@/lib/athlete-programs";
import { matchExerciseNames } from "@/lib/program-import/match";
import { importNames, repeatWeeks, toDraft, unmatchedNames, type ImportDraft } from "@/lib/program-import/review";
import {
  discardProgramImport,
  markProgramImportSaved,
  rereadProgramImport,
  retryProgramImport,
} from "@/lib/program-import/import.functions";
import { importKeys, importLabel, useProgramImport, type ImportRow } from "@/lib/program-import/queries";
import type { ImportFlag } from "@/lib/program-import/types";
import { useProgramEditor } from "@/components/athlete-programs/use-program-editor";
import { ProgramWorkbench, type WorkbenchReviewApi } from "@/components/athlete-programs/workbench/program-workbench";

const COST = FEATURE_COSTS.program_import;
/** Fixed live from the plan as it is now, so they're never listed from the read. */
const LIVE_CODES = new Set(["unmatched", "no_sets", "no_reps", "too_many_sets"]);

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
  const retry = useServerFn(retryProgramImport);
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
    } catch {
      toast.error("Couldn't start it again. Try again.");
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
          {row.error ?? "Something went wrong reading it."} Your AI credits were given back.
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
          {canRetry && (
            <Button onClick={again} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Try again ({COST} AI credits)
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate({ to: "/portal/programs/import", search: { paste: 1 } })}>
            Paste it as text instead
          </Button>
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
            Its file is deleted now and nothing is saved.{running ? " Any AI credits it took are given back." : ""}
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

  const draft = useMemo<ImportDraft | null>(() => {
    if (!ready || !row.result) return null;
    const matches = matchExerciseNames(library.data!, importNames(row.result), aliases.data ?? []);
    return toDraft(row.result, { matches, source: row.source_text, method: row.method ?? "parsed", fileName: row.file_name });
    // the read is made once: a refetch of the library while reviewing never resets the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, row.id]);

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
  return <ReviewEditor row={row} draft={draft} />;
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
            ? `It isn't laid out in a way that could be read instantly. Have AI read it (${COST} credits), or paste it with one exercise per line.`
            : "Check that the file has the program's exercises in it, or paste the program as text."}
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
          {row.method === "parsed" && (
            <Button onClick={reread.run} disabled={reread.busy}>
              {reread.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Read it with AI
            </Button>
          )}
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
  const reread = useServerFn(rereadProgramImport);
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
      } catch {
        toast.error("Couldn't start it. Try again.");
      } finally {
        setBusy(false);
      }
    },
    sheet: <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out feature="program_import" />,
  };
}

function ReviewEditor({ row, draft }: { row: ImportRow; draft: ImportDraft }) {
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
      await markSaved({ data: { id: row.id, programId } });
      void qc.invalidateQueries({ queryKey: importKeys.recent });
    },
  });
  return <ProgramWorkbench editor={editor} review={(api) => <ReviewPanel api={api} row={row} draft={draft} />} />;
}

/** Exercises still missing sets or reps, where they are (from the plan as it is now). */
function missingNumbers(plan: ProgramPlan) {
  const out: Array<{ text: string; at: { b: number; w: number; d: number; e: number } }> = [];
  let g = 0;
  const many = totalWeeks(plan) > 1;
  plan.blocks.forEach((b, bi) =>
    b.weeks.forEach((w, wi) => {
      g++;
      w.days.forEach((d, di) =>
        d.exercises.forEach((e, ei) => {
          if (!e.exercise_id) return;
          const noSets = !(Number(e.sets) >= 1 && Number(e.sets) <= 20);
          const noReps = !String(e.reps ?? "").trim();
          if (!noSets && !noReps) return;
          const what = noSets && noReps ? "sets and reps" : noSets ? "sets" : "reps";
          out.push({ text: `${e.name ?? "Exercise"} needs ${what} (${d.title}${many ? `, week ${g}` : ""})`, at: { b: bi, w: wi, d: di, e: ei } });
        }),
      );
    }),
  );
  return out;
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

function ReviewPanel({ api, row, draft }: { api: WorkbenchReviewApi; row: ImportRow; draft: ImportDraft }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const [source, setSource] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const discard = useDiscard(row.id);
  const reread = useReread(row);

  const unmatched = unmatchedNames(api.plan);
  const missing = missingNumbers(api.plan);
  const toFix = unmatched.length + missing.length;
  const notes = draft.flags.filter((f) => !LIVE_CODES.has(f.code));
  const checks = notes.filter((f) => f.level !== "info");
  const shownNotes = all ? notes : checks.slice(0, 3);
  const weeks = totalWeeks(api.plan);
  const days = Math.max(0, ...api.plan.blocks.flatMap((b) => b.weeks.map((w) => w.days.length)));
  const exercises = api.plan.blocks.reduce(
    (n, b) => n + b.weeks.reduce((m, w) => m + w.days.reduce((k, d) => k + d.exercises.length, 0), 0),
    0,
  );

  return (
    <section className="rounded-2xl border border-border bg-card" aria-label="Check your import" data-import-review>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">Check your import</span>
          <span className="block text-[13px] leading-snug text-muted-foreground" data-import-summary>
            {[
              row.method === "ai" ? "Read with AI" : "Read instantly",
              `${weeks} ${weeks === 1 ? "week" : "weeks"}`,
              `${days} ${days === 1 ? "day" : "days"} a week`,
              `${exercises} exercises`,
            ].join(" · ")}
          </span>
        </span>
        {toFix > 0 ? (
          <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-[12px] font-semibold text-warning" data-import-to-fix>
            {toFix} to fix
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-success">
            <Check className="h-3.5 w-3.5" aria-hidden /> Ready
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 pb-4 pt-2">
          {toFix === 0 ? (
            <p className="flex items-start gap-2 py-2 text-[14px] leading-snug" data-import-all-set>
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              Every exercise is matched to the library and has its sets and reps. Look it over, change anything you want, then Save.
            </p>
          ) : (
            <div className="py-1" data-import-fix-list>
              <div className="pb-1 text-[13px] font-medium text-muted-foreground">To fix before saving</div>
              {unmatched.map((u) => (
                <button
                  key={u.name}
                  type="button"
                  onClick={() => api.resolve(u.name)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-1 text-left hover:bg-muted/50"
                  data-import-unmatched
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span className="min-w-0 flex-1 text-[14px] leading-snug">
                    Pick the exercise for <span className="font-medium">"{u.name}"</span>
                    {u.count > 1 && <span className="text-muted-foreground"> · used {u.count} times</span>}
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold">Pick</span>
                </button>
              ))}
              {missing.slice(0, all ? missing.length : 3).map((m) => (
                <FlagRow key={`${m.at.b}:${m.at.w}:${m.at.d}:${m.at.e}`} flag={{ level: "fix", code: "numbers", text: m.text }} onGo={() => api.goTo(m.at)} />
              ))}
              {!all && missing.length > 3 && (
                <div className="px-1 pt-1 text-[13px] text-muted-foreground">+{missing.length - 3} more without sets or reps</div>
              )}
            </div>
          )}

          {draft.oneWeek && weeks === 1 && (
            <div className="mt-2 rounded-xl bg-muted/50 p-3" data-import-one-week>
              <div className="text-[14px] font-medium">Your program is one week</div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Run it for longer: every week starts the same and you can change any of them.</p>
              <div className="mt-2 flex gap-2">
                {[4, 8, 12].map((n) => (
                  <Button key={n} variant="outline" size="sm" className="h-9" onClick={() => api.edit((p) => repeatWeeks(p, n))}>
                    {n} weeks
                  </Button>
                ))}
              </div>
            </div>
          )}

          {shownNotes.length > 0 && (
            <div className="mt-2" data-import-checks>
              <div className="pb-1 text-[13px] font-medium text-muted-foreground">{all ? "Everything noted" : "Worth a look"}</div>
              {shownNotes.map((f, i) => (
                <FlagRow key={`${f.code}:${i}`} flag={f} onGo={f.at ? () => api.goTo(f.at!) : undefined} />
              ))}
            </div>
          )}
          {(notes.length > shownNotes.length || (!all && missing.length > 3)) && (
            <button type="button" onClick={() => setAll(true)} className="mt-1 px-1 text-[13px] font-medium underline">
              Show all{notes.length > shownNotes.length ? ` ${notes.length} notes` : ""}
            </button>
          )}

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[13px]">
            <button type="button" onClick={() => setSource(true)} className="inline-flex items-center gap-1.5 font-medium">
              <FileText className="h-3.5 w-3.5" aria-hidden /> See your file
            </button>
            {row.method === "parsed" && (
              <button type="button" onClick={reread.run} disabled={reread.busy} className="inline-flex items-center gap-1.5 font-medium" data-import-reread>
                {reread.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                Doesn't look right? Read it with AI ({COST} credits)
              </button>
            )}
            <button type="button" onClick={() => setConfirm(true)} className="font-medium text-muted-foreground" data-import-discard>
              Discard import
            </button>
          </div>
        </div>
      )}
      <SourceSheet open={source} onOpenChange={setSource} row={row} />
      <DiscardDialog open={confirm} onOpenChange={setConfirm} onConfirm={discard.run} />
      {reread.sheet}
    </section>
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
      <SheetContent side="bottom" swipeToClose className="max-h-[85svh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="mb-3 text-left">
          <SheetTitle>{importLabel(row)}</SheetTitle>
          <SheetDescription>
            {row.source_text ? "What was read from it, to check the program against." : "The file you uploaded."}
          </SheetDescription>
        </SheetHeader>
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
