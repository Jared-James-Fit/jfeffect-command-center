/**
 * Download training report: pick the blocks (or all of them), get one PDF.
 *
 * The coach's ⋯ on a client (Clients list, the client's Training tab) and the
 * athlete's own Workouts ⋯ open the same sheet. Everything the report needs
 * is read when it opens (`loadTrainingReportSource`, paged and chunked), and
 * the PDF for what's ticked is made while the person looks at the list, so
 * the tap only hands it over: the share sheet on a phone (Save to Files,
 * Mail, Messages, Print; iOS opens it only from inside the tap), a download
 * on a computer (`saveFiles`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, Loader2, Minus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { todayLocalISO } from "@/lib/today";
import { saveFiles } from "@/lib/file-share";
import { reloadForUpdate } from "@/lib/lazy-chunk";
import {
  blockRangeLabel,
  buildTrainingReport,
  defaultReportSelection,
  loadTrainingReportSource,
  reportBlockOptions,
  trainingReportFileName,
  trainingReportSourceKey,
  type ReportAudience,
  type ReportBlockOption,
} from "@/lib/workouts/training-report-data";

type PdfModule = typeof import("@/lib/workouts/workout-pdf");

/** The PDF maker (jsPDF) is only loaded once someone opens the sheet; one retry for a chunk lost to a publish. */
function loadPdfModule(): Promise<PdfModule> {
  return import("@/lib/workouts/workout-pdf").catch(() => import("@/lib/workouts/workout-pdf"));
}

export function TrainingReportSheet({
  open,
  onOpenChange,
  clientId,
  clientName,
  audience,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string | null | undefined;
  clientName?: string | null;
  audience: ReportAudience;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="flex max-h-[90dvh] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-lg"
        data-training-report-sheet
      >
        <SheetHeader className="min-h-0 space-y-1 px-5 pb-3 pt-5 pl-5">
          <SheetTitle>Training report</SheetTitle>
          <SheetDescription>
            {audience === "coach" && clientName ? `${clientName} · pick` : "Pick"} the blocks to include, or all of them.
          </SheetDescription>
        </SheetHeader>
        {open && clientId && (
          <ReportPicker clientId={clientId} clientName={clientName ?? null} audience={audience} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReportPicker({
  clientId,
  clientName,
  audience,
  onDone,
}: {
  clientId: string;
  clientName: string | null;
  audience: ReportAudience;
  onDone: () => void;
}) {
  const today = todayLocalISO();
  const source = useQuery({
    queryKey: trainingReportSourceKey(clientId),
    queryFn: () => loadTrainingReportSource(supabase, clientId),
    staleTime: 30_000,
    // Coming back from the share sheet mustn't reload it (and remake the PDF).
    refetchOnWindowFocus: false,
  });
  const [pdf, setPdf] = useState<PdfModule | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadPdfModule().then(
      (m) => live && setPdf(() => m),
      () => live && setPdfFailed(true),
    );
    return () => { live = false; };
  }, []);

  const options = useMemo(() => (source.data ? reportBlockOptions(source.data, today) : []), [source.data, today]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (source.data && picked === null) setPicked(new Set(defaultReportSelection(options)));
  }, [source.data, options, picked]);
  const selected = useMemo(() => options.filter((o) => picked?.has(o.id)), [options, picked]);

  // The file for exactly what's ticked, made ahead so the tap only hands it over.
  const selectionKey = `${source.dataUpdatedAt}:${selected.map((o) => o.id).join(",")}`;
  const prepared = useRef<{ key: string; file: File } | null>(null);
  const makeFile = (): File | null => {
    if (!pdf || !source.data || !selected.length) return null;
    if (prepared.current?.key === selectionKey) return prepared.current.file;
    const data = buildTrainingReport(source.data, selected.map((o) => o.id), { clientName, audience });
    const names = data.blocks.map((b) => b.block_name ?? "");
    const file = pdf.trainingReportPdfFile(data, trainingReportFileName(clientName, names));
    prepared.current = { key: selectionKey, file };
    return file;
  };
  useEffect(() => {
    if (!pdf || !source.data || !selected.length || prepared.current?.key === selectionKey) return;
    const t = window.setTimeout(() => {
      try { makeFile(); } catch { /* the tap tries again and reports it */ }
    }, 350);
    return () => window.clearTimeout(t);
    // makeFile reads the same values the key is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, source.data, selectionKey]);

  const [again, setAgain] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setAgain(false), [selectionKey]);

  const download = async () => {
    let file: File | null = null;
    try {
      file = makeFile();
    } catch (e) {
      console.error("Training report PDF failed", e);
      toast.error("Couldn't make the PDF. Try fewer blocks, or try again.");
      return;
    }
    if (!file) return;
    setSaving(true);
    // Straight from the tap: the share sheet is the first thing awaited.
    const outcome = await saveFiles([file]);
    setSaving(false);
    if (outcome === "again") {
      setAgain(true);
      return;
    }
    setAgain(false);
    if (outcome === "cancelled") return;
    if (outcome === "failed") {
      toast.error("Couldn't save the PDF.");
      return;
    }
    toast.success(outcome === "shared" ? "Training report ready" : "Training report downloaded");
    onDone();
  };

  const allState: boolean | "mixed" = !selected.length ? false : selected.length === options.length ? true : "mixed";
  const toggleAll = () => setPicked(allState === true ? new Set() : new Set(options.map((o) => o.id)));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const workouts = selected.reduce((n, o) => n + o.workouts, 0);
  const done = selected.reduce((n, o) => n + o.done, 0);
  const missing = source.data?.missing ?? [];

  let body: React.ReactNode;
  if (source.isLoading) {
    body = (
      <div className="space-y-2 px-5 pb-4" aria-label="Loading blocks">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
      </div>
    );
  } else if (source.isError) {
    body = (
      <div className="px-5 pb-4 text-sm">
        <p className="text-muted-foreground">Couldn't load the training.</p>
        <Button variant="outline" className="mt-3 h-10" onClick={() => void source.refetch()}>Try again</Button>
      </div>
    );
  } else if (!options.length) {
    body = <p className="px-5 pb-4 text-sm text-muted-foreground">No training blocks yet.</p>;
  } else {
    body = (
      <div className="px-3 pb-2" role="group" aria-label="Blocks in the report">
        <PickRow checked={allState} onToggle={toggleAll} title="All blocks" meta={`${options.length} block${options.length === 1 ? "" : "s"}`} strong />
        <div className="mx-2 my-1 h-px bg-border" />
        {options.map((o) => (
          <PickRow
            key={o.id}
            checked={!!picked?.has(o.id)}
            onToggle={() => toggle(o.id)}
            title={o.name}
            meta={optionMeta(o, today)}
            tag={o.current ? "Now" : o.archived ? "Archived" : o.upcoming ? "Not started" : null}
          />
        ))}
      </div>
    );
  }

  const ready = !!pdf && !!source.data && selected.length > 0;
  const label = !selected.length && source.data
    ? "Pick a block"
    : again
      ? "Tap to save the PDF"
      : `Download PDF${selected.length > 1 ? ` · ${selected.length} blocks` : ""}`;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body}</div>
      <div className="border-t border-border px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        {source.data && selected.length > 0 && (
          <p className="mb-2 text-center text-xs text-muted-foreground" data-report-summary>
            {done} of {workouts} workout{workouts === 1 ? "" : "s"} done
            {missing.length ? ` · ${missing.join(", ")} couldn't be read` : ""}
          </p>
        )}
        {pdfFailed && !pdf ? (
          <Button variant="outline" className="h-12 w-full" onClick={reloadForUpdate}>
            Update the app to download
          </Button>
        ) : (
          <Button className="h-12 w-full" disabled={!ready || saving} onClick={() => void download()} data-report-download>
            {saving || (source.data && !pdf) || source.isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {source.isLoading ? "Loading training…" : label}
          </Button>
        )}
      </div>
    </>
  );
}

function optionMeta(o: ReportBlockOption, today: string): string {
  const range = blockRangeLabel(o.start_date, o.end_date, today);
  const count = o.upcoming ? `${o.workouts} workout${o.workouts === 1 ? "" : "s"}` : `${o.done} of ${o.workouts} done`;
  return [range, count].filter(Boolean).join(" · ");
}

function PickRow({
  checked,
  onToggle,
  title,
  meta,
  tag,
  strong,
}: {
  checked: boolean | "mixed";
  onToggle: () => void;
  title: string;
  meta?: string | null;
  tag?: string | null;
  strong?: boolean;
}) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-secondary active:bg-secondary"
    >
      <span
        aria-hidden
        className={cn(
          "grid h-6 w-6 shrink-0 place-content-center rounded-md border transition",
          on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50",
        )}
      >
        {checked === "mixed" ? <Minus className="h-4 w-4" /> : checked ? <Check className="h-4 w-4" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px]", strong ? "font-semibold" : "font-medium")}>{title}</span>
        {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
      {tag && (
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{tag}</span>
      )}
    </button>
  );
}
