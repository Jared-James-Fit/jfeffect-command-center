/**
 * The athlete's memory across programs: observations (kept from a report,
 * proposed by the AI, or written by the coach) and programming decisions.
 * Nothing the AI proposes counts until the coach approves or corrects it;
 * rejected ones are kept out of every later report and prompt.
 */
import { useState } from "react";
import { Check, Pencil, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { RawObservation } from "@/lib/program-intel/types";
import { KindChip } from "./sections";
import { useReviewObservation, useSaveObservation, type IntelJob } from "./use-program-intel";

const SOURCE: Record<RawObservation["source"], string> = { analysis: "From a report", ai: "AI proposal", coach: "Coach" };

function ObservationRow({ o, clientId }: { o: RawObservation; clientId: string }) {
  const review = useReviewObservation(clientId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(o.corrected_statement ?? o.statement);
  const ev = Array.isArray(o.evidence) ? (o.evidence as unknown[]).map(String) : [];
  const act = (status: RawObservation["status"], corrected?: string) =>
    review.mutate(
      { id: o.id, status, corrected },
      { onSuccess: () => { setEditing(false); toast.success(status === "rejected" ? "Rejected: it won't be used" : status === "corrected" ? "Corrected" : "Approved"); }, onError: (e: any) => toast.error(e?.message ?? "Couldn't save") },
    );
  return (
    <div className={cn("space-y-1.5 p-3", o.status === "rejected" && "opacity-60")} data-observation={o.id} data-status={o.status}>
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip kind={o.confidence === "fact" ? "fact" : "hypothesis"} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{o.kind === "decision" ? "Decision" : o.kind === "outcome" ? "Outcome" : "Observation"} · {SOURCE[o.source]} · {o.created_at.slice(0, 10)}</span>
        {o.status !== "proposed" && <span className={cn("text-[10px] font-bold uppercase", o.status === "rejected" ? "text-destructive" : "text-emerald-600")}>{o.status}</span>}
      </div>
      {editing ? (
        <div className="space-y-1.5">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="text-[13px]" maxLength={1000} aria-label="Corrected observation" />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-8" disabled={!text.trim() || review.isPending} onClick={() => act("corrected", text.trim())}>Save correction</Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-[13px] leading-snug">{o.corrected_statement ?? o.statement}</div>
          {o.corrected_statement && <div className="text-[11px] text-muted-foreground line-through">{o.statement}</div>}
        </>
      )}
      {ev.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none font-semibold text-foreground/70">Evidence ({ev.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-3">{ev.map((e, i) => <li key={i} className="list-disc">{e}</li>)}</ul>
        </details>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-1.5">
          {o.status !== "approved" && o.status !== "corrected" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={review.isPending} onClick={() => act("approved")}><Check className="mr-1 h-3.5 w-3.5" /> Approve</Button>
          )}
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={review.isPending} onClick={() => setEditing(true)}><Pencil className="mr-1 h-3.5 w-3.5" /> Correct</Button>
          {o.status !== "rejected" && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-destructive" disabled={review.isPending} onClick={() => act("rejected")}><X className="mr-1 h-3.5 w-3.5" /> Reject</Button>
          )}
        </div>
      )}
    </div>
  );
}

export function MemorySection({
  clientId,
  observations,
  interpretJob,
  onInterpret,
  interpreting,
}: {
  clientId: string;
  observations: RawObservation[];
  interpretJob: IntelJob | null;
  onInterpret: () => void;
  interpreting: boolean;
}) {
  const save = useSaveObservation(clientId);
  const [note, setNote] = useState("");
  const [isFact, setIsFact] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const proposed = observations.filter((o) => o.status === "proposed");
  const kept = observations.filter((o) => o.status === "approved" || o.status === "corrected");
  const rejected = observations.filter((o) => o.status === "rejected");
  const running = interpretJob && (interpretJob.status === "pending" || interpretJob.status === "running");

  return (
    <div className="space-y-4" data-testid="intel-memory">
      <Card className="space-y-2 p-3.5">
        <div className="text-sm font-bold">AI interpretation</div>
        <p className="text-xs text-muted-foreground">The AI reads this report (only the measured numbers) and proposes hypotheses about how this athlete responds. Each one waits here for you to approve, correct or reject; nothing it says counts as proven.</p>
        <Button size="sm" className="h-9" onClick={onInterpret} disabled={interpreting || !!running} data-testid="intel-interpret">
          <Sparkles className="mr-1.5 h-4 w-4" /> {running ? "Reading the report…" : "Ask AI to interpret this report"}
        </Button>
        {interpretJob?.status === "error" && <div className="text-xs text-destructive">Last run failed: {interpretJob.error}</div>}
        {interpretJob?.status === "ready" && interpretJob.result?.questions?.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold">Questions it had about missing information:</div>
            <ul className="mt-0.5 space-y-0.5 pl-4 text-muted-foreground">{interpretJob.result.questions.map((q: string, i: number) => <li key={i} className="list-disc">{q}</li>)}</ul>
          </div>
        )}
      </Card>

      {proposed.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Waiting for your review ({proposed.length})</h3>
          <Card className="divide-y divide-border/60 p-0">{proposed.map((o) => <ObservationRow key={o.id} o={o} clientId={clientId} />)}</Card>
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">What we know about this athlete ({kept.length})</h3>
        {kept.length ? <Card className="divide-y divide-border/60 p-0">{kept.map((o) => <ObservationRow key={o.id} o={o} clientId={clientId} />)}</Card> : <Card className="p-3 text-xs text-muted-foreground">Nothing kept yet. Keep a finding from the summary, approve an AI proposal or add your own note below. Kept observations go into every later report, prompt and generated program.</Card>}
      </section>
      <Card className="space-y-2 p-3.5">
        <div className="text-sm font-bold">Add your own observation</div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Responds well to 2× squat frequency; elbows flare up above 3 bench days" maxLength={1000} className="text-[13px]" />
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={isFact} onCheckedChange={setIsFact} /> {isFact ? "A fact I've measured" : "My interpretation (hypothesis)"}
        </label>
        <Button size="sm" className="h-9" disabled={!note.trim() || save.isPending} onClick={() => save.mutate({ statement: note, confidence: isFact ? "fact" : "hypothesis" }, { onSuccess: () => { setNote(""); toast.success("Added to the athlete's memory"); }, onError: (e: any) => toast.error(e?.message ?? "Couldn't save") })}>
          Add
        </Button>
      </Card>
      {rejected.length > 0 && (
        <section>
          <button type="button" className="text-[11px] font-semibold text-muted-foreground underline" onClick={() => setShowRejected((v) => !v)}>
            {showRejected ? "Hide" : "Show"} rejected ({rejected.length})
          </button>
          {showRejected && <Card className="mt-1.5 divide-y divide-border/60 p-0">{rejected.map((o) => <ObservationRow key={o.id} o={o} clientId={clientId} />)}</Card>}
        </section>
      )}
    </div>
  );
}
