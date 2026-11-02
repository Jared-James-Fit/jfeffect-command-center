/**
 * Program Intelligence (coach / admin): what a client was supposed to do vs
 * what they did, how each lift and muscle group progressed, how they responded
 * to each block, and what that means for the next cycle. Every number comes
 * from the deterministic report built on the phone from the client's records;
 * the AI only interprets it or drafts the next program, and only when asked.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ClipboardCopy, Download, FileJson, FileSpreadsheet, FileText, ListTree, Loader2, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { copyText } from "@/lib/instagram-export";
import { BRAIN_SUMMARY } from "@/lib/program-intel/brains";
import { buildAiPrompt, exportFileName, privacySafeRecords, reportToCsv, reportToJson, reportToMarkdown } from "@/lib/program-intel/export";
import { queueIntelJobFn } from "@/lib/program-intel/intel.functions";
import { buildIntelReport } from "@/lib/program-intel/report";
import { BRAIN_LABEL, BRAINS, type Brain, type Finding, type IntelScopeRequest } from "@/lib/program-intel/types";
import { DetailedData } from "./detailed-data";
import { MemorySection } from "./memory";
import { NextProgramLink } from "./next-program-link";
import { BlocksSection, ExercisesSection, FindingsSummary, LiftsSection, MusclesSection, RecoveryCard, WeeksSection } from "./sections";
import { logIntelExport, newId, useBrainOverride, useIntelJobs, useIntelRecords, useIntelReport, useObservations, useSaveObservation } from "./use-program-intel";

export type IntelSearch = { scope: "program" | "dates" | "history"; from: string; to: string; tab: string };

const TABS: Array<[string, string]> = [
  ["summary", "Summary"],
  ["lifts", "Lifts"],
  ["muscles", "Muscles"],
  ["weeks", "Weeks"],
  ["blocks", "Blocks"],
  ["exercises", "Exercises"],
  ["memory", "Memory"],
  ["data", "Detailed data"],
];

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ProgramIntelligencePage({ clientId, search: initial }: { clientId: string; search: IntelSearch }) {
  const navigate = useNavigate();
  const { viewOnly } = useAuth();
  const qc = useQueryClient();
  // The period and tab answer at once on screen; the address keeps them (back, a shared link).
  const [search, setLocal] = useState<IntelSearch>(initial);
  const setSearch = (patch: Partial<IntelSearch>) => {
    const next = { ...search, ...patch };
    setLocal(next);
    void navigate({ to: "/admin/client-programs/$clientId/intelligence", params: { clientId }, search: next as any, replace: true });
  };

  const scope: IntelScopeRequest = search.scope === "dates" ? { kind: "dates", from: search.from, to: search.to } : { kind: search.scope };
  const records = useIntelRecords(clientId, scope);
  const brain = useBrainOverride(clientId);
  const report = useIntelReport(records.data, brain.override);
  const observations = useObservations(clientId);
  const jobs = useIntelJobs(clientId);
  const save = useSaveObservation(clientId);
  const queue = useServerFn(queueIntelJobFn);
  const [privacySafe, setPrivacySafe] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const savedKeys = useMemo(() => new Set((observations.data ?? []).filter((o) => o.source === "analysis" && o.status !== "rejected").map((o) => o.finding_key ?? "").filter(Boolean)), [observations.data]);
  const latestGenerate = (jobs.data ?? []).find((j) => (j.kind === "generate" || j.kind === "strategy") && j.status !== "discarded") ?? null;
  const latestInterpret = (jobs.data ?? []).find((j) => j.kind === "interpret") ?? null;
  // A run that just finished wrote observations or decisions: read the memory again.
  const finished = (jobs.data ?? []).filter((j) => j.status !== "pending" && j.status !== "running").map((j) => `${j.id}:${j.status}`).join(",");
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
  }, [finished, clientId, qc]);

  if (viewOnly)
    return (
      <>
        <PageHeader title="Program Intelligence" backTo={`/admin/client-programs/${clientId}`} backLabel="Training Program" />
        <div className="p-4 text-sm text-muted-foreground">Program Intelligence is for coaches. It isn't available in a view-only login.</div>
      </>
    );

  /** The export as the coach chose it: the full records, or a privacy-safe copy (re-measured from the safe copy). */
  const exportInputs = (action: string) => {
    if (!records.data || !report) return null;
    const rec = privacySafe ? privacySafeRecords(records.data) : records.data;
    const rep = privacySafe ? buildIntelReport(rec, { brainOverride: brain.override, generatedAt: report.generatedAt }) : report;
    const id = newId();
    logIntelExport({ id, clientId, action, privacySafe, scope, brain: rep.brain, dataHash: rep.dataHash });
    return { rec, rep, meta: { privacySafe, reportId: id } };
  };

  const copyPrompt = () => {
    const x = exportInputs("copy_prompt");
    if (!x) return;
    // built and copied inside the tap (iPhones refuse a copy after a wait)
    const text = buildAiPrompt(x.rep, x.rec, x.meta);
    void copyText(text).then((ok) => (ok ? toast.success(`AI coaching prompt copied (${Math.round(text.length / 1000)}k characters, every record included)`) : toast.error("Couldn't copy. Download the Markdown instead.")));
  };

  const doDownload = async (kind: "pdf" | "md" | "json" | "csv") => {
    const x = exportInputs(kind === "pdf" ? "download_pdf" : kind === "md" ? "download_markdown" : kind === "json" ? "download_json" : "download_csv");
    if (!x) return;
    try {
      if (kind === "md") download(exportFileName(x.rep, "md", privacySafe), reportToMarkdown(x.rep, x.rec, x.meta), "text/markdown;charset=utf-8");
      else if (kind === "json") download(exportFileName(x.rep, "json", privacySafe), reportToJson(x.rep, x.rec, x.meta), "application/json");
      else if (kind === "csv") download(exportFileName(x.rep, "csv", privacySafe), reportToCsv(x.rep), "text/csv;charset=utf-8");
      else {
        const { downloadIntelPdf } = await import("@/lib/program-intel/pdf");
        downloadIntelPdf(x.rep, x.rec, x.meta);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't make the file");
    }
  };

  const interpret = async () => {
    if (!report) return;
    setInterpreting(true);
    try {
      const r = await queue({ data: { clientId, kind: "interpret", scope, brain: report.brain, options: {}, privacySafe } });
      toast.success(r.alreadyRunning ? "Already reading this report." : "The AI is reading the report. Its proposals will appear here to review.");
      void qc.invalidateQueries({ queryKey: ["program-intel-jobs", clientId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start");
    } finally {
      setInterpreting(false);
    }
  };

  const keep = (f: Finding) =>
    save.mutate({ finding: f, dataHash: report?.dataHash ?? null }, { onSuccess: () => toast.success("Kept in the athlete's memory"), onError: (e: any) => toast.error(e?.message ?? "Couldn't save") });

  const c = report?.coverage;
  const name = records.data?.client.full_name ?? "";

  return (
    <>
      <PageHeader title="Program Intelligence" subtitle={name || undefined} backTo={`/admin/client-programs/${clientId}`} backLabel="Training Program" />
      <div className="mx-auto w-full max-w-3xl space-y-4 p-3 pb-28 sm:p-6" data-testid="program-intelligence">
        {/* What the report covers */}
        <div className="space-y-2">
          <div className="inline-flex rounded-full bg-secondary p-1" role="tablist" aria-label="What the report covers">
            {(
              [
                ["program", "Current program"],
                ["dates", "Dates"],
                ["history", "Full history"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={search.scope === k}
                onClick={() => setSearch({ scope: k })}
                className={`h-8 rounded-full px-3 text-xs font-bold transition ${search.scope === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {search.scope === "dates" && (
            <div className="flex items-center gap-2">
              <Input type="date" value={search.from} onChange={(e) => setSearch({ from: e.target.value })} className="h-10" aria-label="From" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={search.to} onChange={(e) => setSearch({ to: e.target.value })} className="h-10" aria-label="To" />
            </div>
          )}
        </div>

        {records.isLoading || (!report && !records.isError) ? (
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : records.isError ? (
          <Card className="space-y-2 p-4 text-sm">
            <div className="font-semibold text-destructive">Couldn't read this client's records</div>
            <div className="text-xs text-muted-foreground">{(records.error as Error)?.message}</div>
            <Button size="sm" variant="outline" onClick={() => records.refetch()}>Try again</Button>
          </Card>
        ) : report && c ? (
          <>
            <Card className="space-y-2 p-3.5" data-testid="intel-coverage">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="line-clamp-2 text-sm font-bold leading-snug">{report.scope.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.firstDate ?? "—"} → {c.lastDate ?? "—"} · {c.blocks} block{c.blocks === 1 ? "" : "s"}, {c.weeks} weeks</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  <Select value={brain.override ?? "auto"} onValueChange={(v) => brain.set.mutate(v === "auto" ? null : (v as Brain), { onError: (e: any) => toast.error(e?.message ?? "Couldn't save") })}>
                    <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Coaching brain">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto · {BRAIN_LABEL[report.classification.auto]}</SelectItem>
                      {BRAINS.map((b) => (
                        <SelectItem key={b} value={b}>{BRAIN_LABEL[b]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                {[
                  [`${c.completedDays + c.partialDays}/${c.dueDays}`, "workouts done"],
                  [`${c.completedSets}/${c.prescribedSetsDue}`, "sets done/due"],
                  [String(c.loggedSets), "set records"],
                  [c.setsWithRpePct != null ? `${c.setsWithRpePct}%` : "—", "RPE logged"],
                ].map(([v, l]) => (
                  <div key={l} className="rounded-xl bg-secondary/50 px-1 py-1.5">
                    <div className="text-sm font-black tabular-nums">{v}</div>
                    <div className="text-[10px] text-muted-foreground">{l}</div>
                  </div>
                ))}
              </div>
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none font-semibold text-foreground/70">Why {BRAIN_LABEL[report.brain]} · data coverage</summary>
                <p className="mt-1">{BRAIN_SUMMARY[report.brain]}</p>
                <p className="mt-1 font-semibold">Auto-classification ({BRAIN_LABEL[report.classification.auto]}):</p>
                <ul className="pl-4">{report.classification.reasons.map((r, i) => <li key={i} className="list-disc">{r}</li>)}</ul>
                <p className="mt-1" data-testid="intel-set-definitions">
                  <b>How sets are counted:</b> {c.prescribedSetsDue} prescribed on due workouts; {c.completedSets} completed (a set logged with reps or a time, not flagged warm-up, counted up to what each exercise prescribed, whatever its RPE); {c.skippedSets} skipped (exercise not logged), {c.incompleteSets} short on exercises cut short; {c.extraSets} extra beyond the prescription; {c.modifiedSets} done outside the prescribed rep range. {c.loggedSets} set records in all, {c.nonCountedRecords} not counted (warm-up flag or no reps). {c.workingSets} working sets for volume (at or above RPE {records.data?.settings.workingRpeMin ?? 6} when an RPE was logged). RPE or RIR logged on {c.setsWithRpePct ?? 0}% of completed sets{c.setsWithVelocity ? `; bar velocity on ${c.setsWithVelocity}` : ""}.
                </p>
                <p className="mt-1">
                  {c.plannedDays} workouts planned ({c.missedDays} missed, {c.upcomingDays} upcoming, {c.unscheduledDays} undated) · {c.prescribedRows} prescribed exercises · {c.warmupSets} warm-up sets · {c.feedbackEntries} check-outs · {c.exerciseNotes} exercise notes · {c.coachNotes} coach notes · {c.bodyweightEntries} bodyweight entries · {c.maxesOnFile} maxes · {c.meetResults} meets
                  {c.unmappedRows ? ` · ${c.unmappedRows} exercises not in the library` : ""}
                  {c.unreadable.length ? ` · couldn't read: ${c.unreadable.join(", ")}` : ""}. Every record in this period is included; nothing is cut off.
                </p>
                <p className="mt-1">Data fingerprint {report.dataHash}</p>
              </details>
            </Card>

            {/* The four actions */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-auto min-h-12 flex-col gap-0.5 py-2" onClick={copyPrompt} data-testid="intel-copy-prompt">
                <ClipboardCopy className="h-4 w-4" />
                <span className="text-xs font-bold">Copy AI coaching prompt</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-auto min-h-12 flex-col gap-0.5 py-2" data-testid="intel-download">
                    <Download className="h-4 w-4" />
                    <span className="text-xs font-bold">Download full report</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => void doDownload("pdf")}><FileText className="mr-2 h-4 w-4" /> PDF · for reading</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void doDownload("md")}><FileText className="mr-2 h-4 w-4" /> Markdown · for AI uploads</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void doDownload("json")}><FileJson className="mr-2 h-4 w-4" /> JSON · complete records</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void doDownload("csv")}><FileSpreadsheet className="mr-2 h-4 w-4" /> CSV · raw training log</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="h-auto min-h-12 flex-col gap-0.5 py-2" onClick={() => void navigate({ to: "/admin/client-programs/$clientId/next-program", params: { clientId } })} data-testid="intel-generate">
                <Wand2 className="h-4 w-4" />
                <span className="text-xs font-bold">Generate next program</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-12 flex-col gap-0.5 py-2"
                onClick={() => {
                  setSearch({ tab: "data" });
                  requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
                data-testid="intel-view-data"
              >
                <ListTree className="h-4 w-4" />
                <span className="text-xs font-bold">View detailed data</span>
              </Button>
            </div>
            <label className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
              <Switch checked={privacySafe} onCheckedChange={setPrivacySafe} aria-label="Privacy-safe exports" />
              <ShieldCheck className="h-3.5 w-3.5" />
              Privacy-safe copies and downloads: no name or personal notes (training data kept)
            </label>

            {latestGenerate && <NextProgramLink job={latestGenerate} clientId={clientId} />}

            <div ref={tabsRef} className="scroll-mt-16">
              <Tabs value={TABS.some(([k]) => k === search.tab) ? search.tab : "summary"} onValueChange={(v) => setSearch({ tab: v })}>
                <TabsList className="h-auto w-full justify-start overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
                  {TABS.map(([k, label]) => (
                    <TabsTrigger key={k} value={k} className="text-xs">
                      {label}
                      {k === "memory" && (observations.data ?? []).some((o) => o.status === "proposed") ? <span className="ml-1 h-1.5 w-1.5 rounded-full bg-destructive" aria-label="waiting for review" /> : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="summary" className="space-y-3">
                  <FindingsSummary report={report} savedKeys={savedKeys} onSave={keep} saving={save.isPending} />
                  <RecoveryCard report={report} />
                </TabsContent>
                <TabsContent value="lifts"><LiftsSection report={report} /></TabsContent>
                <TabsContent value="muscles"><MusclesSection report={report} /></TabsContent>
                <TabsContent value="weeks"><WeeksSection report={report} /></TabsContent>
                <TabsContent value="blocks"><BlocksSection report={report} /></TabsContent>
                <TabsContent value="exercises"><ExercisesSection report={report} /></TabsContent>
                <TabsContent value="memory">
                  {observations.isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <MemorySection clientId={clientId} observations={observations.data ?? []} interpretJob={latestInterpret} onInterpret={interpret} interpreting={interpreting} />
                  )}
                </TabsContent>
                <TabsContent value="data"><DetailedData report={report} records={records.data!} /></TabsContent>
              </Tabs>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
