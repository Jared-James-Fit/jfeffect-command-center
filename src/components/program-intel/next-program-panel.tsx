/**
 * Generate Next Program: the coaching brain writes the next program from this
 * report (in the background), as hidden draft blocks. The coach reads why
 * each change was made, previews and edits the whole plan in the program
 * editor, and only then assigns it (or discards it). Nothing reaches the
 * client until Assign.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Loader2, Pencil, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { assignIntelDraftFn, discardIntelDraftFn, queueIntelJobFn, retryIntelJobFn } from "@/lib/program-intel/intel.functions";
import { weekRx, type ProgramReply } from "@/lib/program-intel/next-program";
import { BRAIN_LABEL, type IntelRecords, type IntelReport, type IntelScopeRequest } from "@/lib/program-intel/types";
import { KindChip } from "./sections";
import type { IntelJob } from "./use-program-intel";

function addDaysIso(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function GenerateSheet({
  open,
  onOpenChange,
  clientId,
  report,
  records,
  scope,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  report: IntelReport;
  records: IntelRecords;
  scope: IntelScopeRequest;
}) {
  const qc = useQueryClient();
  const queue = useServerFn(queueIntelJobFn);
  const [days, setDays] = useState<string>(String(records.goals?.training_days_per_week ?? ""));
  const [weeks, setWeeks] = useState<string>("8");
  const [minutes, setMinutes] = useState<string>(String(records.goals?.workout_length_minutes ?? ""));
  const [instructions, setInstructions] = useState("");
  const [privacySafe, setPrivacySafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Math.round(Number(s)) : null);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await queue({ data: { clientId, kind: "generate", scope, brain: report.brain, instructions: instructions.trim() || null, options: { daysPerWeek: num(days), weeks: num(weeks), sessionMinutes: num(minutes) }, privacySafe } });
      toast.success(r.alreadyRunning ? "A program is already being written for this client." : "Writing the next program. You can leave this screen; it keeps going.");
      void qc.invalidateQueries({ queryKey: ["program-intel-jobs", clientId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Generate the next program</SheetTitle>
          <SheetDescription>
            The {BRAIN_LABEL[report.brain].toLowerCase()} brain writes it from this report ({report.scope.label}). It becomes a hidden draft you preview and edit before anything is assigned.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Days / week</Label>
              <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="from goals" className="h-11" />
            </div>
            <div>
              <Label className="text-xs">Weeks</Label>
              <Input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} className="h-11" />
            </div>
            <div>
              <Label className="text-xs">Minutes</Label>
              <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="any" className="h-11" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Your instructions (optional)</Label>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} maxLength={2000} placeholder="e.g. Meet on March 14; keep deadlift once a week; more upper back; no barbell lunges (knee)" />
          </div>
          <label className="flex items-start gap-2 text-xs">
            <Switch checked={privacySafe} onCheckedChange={setPrivacySafe} />
            <span>Privacy-safe: send the AI the training data without the athlete's name or personal notes.</span>
          </label>
          <Button className="h-11 w-full" onClick={submit} disabled={busy} data-testid="intel-generate-submit">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />} Generate draft
          </Button>
          <p className="text-[11px] text-muted-foreground">Exercises come from your library (their demo videos included); any the AI names that aren't in it are flagged for you to pick. It never assigns anything.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProgramPreview({ program }: { program: ProgramReply }) {
  return (
    <div className="space-y-2">
      {program.blocks.map((b, bi) => (
        <details key={bi} className="rounded-xl bg-secondary/40 p-2.5" open={bi === 0}>
          <summary className="cursor-pointer select-none text-[13px] font-bold">
            {b.name} · {b.weeks} wk · {b.days.length} days/wk
            {b.focus && <span className="block text-[11px] font-normal text-muted-foreground">{b.focus}</span>}
          </summary>
          {(b.week_phases?.length ?? 0) > 0 && <div className="mt-1 text-[11px] text-muted-foreground">{b.week_phases!.map((p) => `W${p.week} ${p.phase}`).join(" · ")}</div>}
          <div className="mt-2 space-y-1.5">
            {b.days.map((d, di) => (
              <div key={di} className="rounded-lg bg-background p-2 text-[11px]">
                <div className="font-semibold">Day {di + 1}: {d.title}{d.focus ? ` · ${d.focus}` : ""}</div>
                <ul className="mt-0.5 space-y-0.5">
                  {d.exercises.map((e, ei) => {
                    const w1 = weekRx(e, 1);
                    return (
                      <li key={ei}>
                        <span className={e.exercise_id ? "" : "font-semibold text-amber-600"}>{e.exercise_name}</span>
                        <span className="text-muted-foreground"> · {w1.sets}×{w1.reps}{w1.rpe ? ` @${w1.rpe}` : w1.rir ? ` ${w1.rir} RIR` : ""}{w1.percentage ? ` ${w1.percentage}%` : ""}{e.weeks?.length ? ` · ${e.weeks.length} weekly change${e.weeks.length === 1 ? "" : "s"}` : ""}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export function DraftCard({ job, clientId, today }: { job: IntelJob; clientId: string; today: string }) {
  const qc = useQueryClient();
  const assign = useServerFn(assignIntelDraftFn);
  const discard = useServerFn(discardIntelDraftFn);
  const retry = useServerFn(retryIntelJobFn);
  const [start, setStart] = useState(addDaysIso(today, ((8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7) || 7));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["program-intel-jobs", clientId] });
    void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const program: ProgramReply | null = job.result?.program ?? null;
  const blockIds: string[] = job.result?.blockIds ?? [];
  const unmatched: string[] = job.result?.unmatched ?? [];

  if (job.status === "pending" || job.status === "running")
    return (
      <Card className="flex items-center gap-3 p-4 text-sm" data-testid="intel-draft-running">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <div className="font-semibold">Writing the next program…</div>
          <div className="text-xs text-muted-foreground">Usually a minute or two. It keeps going if you leave.</div>
        </div>
      </Card>
    );
  if (job.status === "error")
    return (
      <Card className="space-y-2 p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> The program couldn't be written</div>
        <div className="text-xs text-muted-foreground">{job.error}</div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => retry({ data: { jobId: job.id } }), "Trying again")}><RotateCcw className="mr-1.5 h-4 w-4" /> Try again</Button>
      </Card>
    );
  if (!program) return null;
  return (
    <Card className="space-y-3 p-3.5" data-testid="intel-draft" data-status={job.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{job.status === "assigned" ? "Assigned" : job.status === "discarded" ? "Discarded draft" : "Draft · hidden from the client"}</div>
          <div className="text-base font-black leading-tight">{program.program_name}</div>
          <div className="text-[11px] text-muted-foreground">{BRAIN_LABEL[job.brain]} brain · {job.created_at.slice(0, 10)}{job.model ? ` · ${job.model}` : ""}</div>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed">{program.summary}</p>
      {unmatched.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
          <b>{unmatched.length} exercise{unmatched.length === 1 ? "" : "s"} not found in your library:</b> {unmatched.join(", ")}. They're in the draft by name only; pick the library exercise for each in the editor (no new exercises were created).
        </div>
      )}
      <ProgramPreview program={program} />
      <details className="text-xs" open>
        <summary className="cursor-pointer select-none text-[13px] font-bold">Changes and why ({program.changes.length})</summary>
        <ul className="mt-1.5 space-y-2">
          {program.changes.map((c, i) => (
            <li key={i} className="space-y-0.5">
              <div className="flex items-start gap-1.5"><KindChip kind={c.basis === "fact" ? "fact" : "hypothesis"} /><span className="font-semibold">{c.change}</span></div>
              <div className="text-muted-foreground">{c.why}</div>
              {c.evidence.length > 0 && <div className="text-[11px] text-muted-foreground">Evidence: {c.evidence.join(" · ")}</div>}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Each change is also waiting in the athlete's memory as a proposed decision: approve the ones you agree with so later reports can track what came of them.</p>
      </details>
      <details className="text-xs">
        <summary className="cursor-pointer select-none text-[13px] font-bold">Progression, recovery and what to watch</summary>
        <p className="mt-1"><b>Progression:</b> {program.progression}</p>
        <p className="mt-1"><b>Recovery:</b> {program.recovery}</p>
        {program.watch.length > 0 && <ul className="mt-1 space-y-0.5 pl-4">{program.watch.map((w, i) => <li key={i} className="list-disc">{w}</li>)}</ul>}
      </details>
      {job.status === "ready" && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {blockIds.map((id, i) => (
              <Button key={id} asChild size="sm" variant="outline" className="h-9">
                <Link to="/admin/blocks/$blockId" params={{ blockId: id }}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Preview & edit{blockIds.length > 1 ? ` block ${i + 1}` : ""}</Link>
              </Button>
            ))}
          </div>
          {confirming ? (
            <div className="space-y-2 rounded-xl bg-secondary/50 p-2.5">
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-11" />
              <p className="text-[11px] text-muted-foreground">Assigning makes it visible to the client and places the workouts on their training days. Make sure you've previewed and edited it first.</p>
              <div className="flex gap-1.5">
                <Button size="sm" className="h-10 flex-1" disabled={busy || !start} onClick={() => run(() => assign({ data: { jobId: job.id, startDate: start } }), "Assigned to the client")} data-testid="intel-assign-confirm">
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1.5 h-4 w-4" />} Assign from {start}
                </Button>
                <Button size="sm" variant="ghost" className="h-10" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Button size="sm" className="h-10 flex-1" onClick={() => setConfirming(true)} data-testid="intel-assign"><CalendarCheck className="mr-1.5 h-4 w-4" /> Assign to client…</Button>
              <Button size="sm" variant="ghost" className="h-10 text-destructive" disabled={busy} onClick={() => run(() => discard({ data: { jobId: job.id } }), "Draft discarded")}><Trash2 className="mr-1.5 h-4 w-4" /> Discard</Button>
            </div>
          )}
        </div>
      )}
      {job.status === "assigned" && blockIds[0] && (
        <Button asChild size="sm" variant="outline" className="h-9"><Link to="/admin/blocks/$blockId" params={{ blockId: blockIds[0] }}>Open the program</Link></Button>
      )}
    </Card>
  );
}
