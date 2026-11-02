/**
 * What the AI actually received, for debugging a poor decision: the model
 * configuration, the records it was built from (data fingerprint, whether
 * they changed since the coach looked), every part of the brief with its size
 * and whether it was complete or summarized (and why), every model call with
 * its size, time and result, and the exact text of any call on demand.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { fetchJobCallText, useJobCalls, useJobContext, type IntelJob } from "../use-program-intel";

const k = (n: number | null | undefined) => (n == null ? "—" : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

export function ContextInspector({ open, onOpenChange, job }: { open: boolean; onOpenChange: (v: boolean) => void; job: IntelJob | null }) {
  const ids = job ? [job.id, ...(job.strategy_job_id ? [job.strategy_job_id] : [])] : [];
  const ctx = useJobContext(open && job ? job.id : null);
  const calls = useJobCalls(open ? ids : []);
  const [text, setText] = useState<{ id: string; system: string; prompt: string; response: string | null } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const c = ctx.data;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl" data-testid="gen-inspector">
        <SheetHeader className="text-left">
          <SheetTitle>Context the AI received</SheetTitle>
          <SheetDescription>Everything this run used, so a decision can be traced to its inputs.</SheetDescription>
        </SheetHeader>
        {ctx.isLoading ? (
          <Loader2 className="mt-4 h-5 w-5 animate-spin" />
        ) : !c ? (
          <p className="mt-4 text-sm text-muted-foreground">No context recorded for this run yet.</p>
        ) : (
          <div className="mt-3 space-y-4 text-[12px]">
            <section>
              <div className="font-black">Model</div>
              <div className="text-muted-foreground">
                {c.model?.primary} (falls back to {c.model?.fallback}) · temperature {c.model?.temperature} · {Math.round((c.model?.timeout_ms ?? 0) / 1000)}s per call · prompts v{c.prompt_version}
              </div>
            </section>
            <section>
              <div className="font-black">Records</div>
              <div className="text-muted-foreground">
                Fingerprint {c.data_hash}
                {c.records_changed === true ? " · the records changed after you opened the page (new logs were included)" : c.records_changed === false ? " · same records you saw" : ""}
              </div>
              <div className="text-muted-foreground">
                {c.sources?.blocks} blocks · {c.sources?.workouts} workouts · {c.sources?.set_records} set records in all · previous program "{c.sources?.previous_program ?? "—"}" with {c.sources?.previous_set_records} set records · {c.sources?.checkins} check-ins · {c.sources?.coach_notes} coach notes · {c.sources?.memory} confirmed memory items
                {c.sources?.unreadable?.length ? ` · couldn't read: ${c.sources.unreadable.join(", ")}` : ""}
              </div>
              {c.quality_summary && <div className="text-muted-foreground">Data quality: {c.quality_summary}</div>}
            </section>
            <section>
              <div className="font-black">Brief ({k(c.brief?.chars)} characters, ~{k(c.brief?.est_tokens)} tokens)</div>
              <table className="mt-1 w-full">
                <tbody>
                  {(c.brief?.sections ?? []).map((s: any) => (
                    <tr key={s.key} className="border-t border-border/40 align-top">
                      <td className="py-1 pr-2 font-semibold">{s.title}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{k(s.chars)}</td>
                      <td className={cn("py-1 text-[11px]", s.detail === "summary" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{s.detail === "summary" ? `summarized: ${s.note ?? ""}` : "complete"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(c.brief?.warnings ?? []).length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-amber-700 dark:text-amber-300">{c.brief.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>
              ) : (
                <div className="mt-1 text-muted-foreground">Nothing was cut for size.</div>
              )}
              {c.construct_brief && (
                <div className="mt-1 text-muted-foreground">
                  Building and repair read a compact brief ({k(c.construct_brief.chars)} characters): the same, without {(c.construct_brief.left_out ?? []).includes("earlier") ? "the set-by-set logs" : "the full log"} (the strategy already read them; measured exercises, load references and the last program's layout stay).
                </div>
              )}
              {c.model?.design_model_max_prompt_chars ? <div className="mt-1 text-muted-foreground">The design model takes prompts up to {k(c.model.design_model_max_prompt_chars)} characters; larger ones go to {c.model.fallback}.</div> : null}
              <Button size="sm" variant="outline" className="mt-2 h-8" onClick={() => setShowBrief(!showBrief)}>{showBrief ? "Hide" : "Show"} the full brief</Button>
              {showBrief && <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-2 text-[10px] leading-snug">{c.brief_text}</pre>}
            </section>
            <section>
              <div className="font-black">Setup used</div>
              <div className="text-muted-foreground">{(c.edited ?? []).length ? `You changed: ${c.edited.join(", ")}` : "Recommended setup, unchanged"}{(c.conflicts ?? []).length ? ` · ${c.conflicts.length} conflict${c.conflicts.length === 1 ? "" : "s"} sent to the AI` : ""}</div>
            </section>
            <section>
              <div className="font-black">Model calls</div>
              {calls.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ul className="mt-1 space-y-1">
                  {(calls.data ?? []).map((x) => (
                    <li key={x.id} className="rounded-lg bg-secondary/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{x.stage}</span>
                        <span className={cn("text-[11px] font-bold", x.ok ? "text-emerald-600" : "text-destructive")}>{x.ok ? "ok" : "failed"}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {x.model} · in {k(x.prompt_chars)} chars (~{k(x.input_tokens ?? x.est_input_tokens)} tokens) · out {k(x.response_chars)} chars{x.output_tokens ? ` (${k(x.output_tokens)} tokens)` : ""} · {x.duration_ms ? `${Math.round(x.duration_ms / 1000)}s` : "—"}
                        {x.error ? <div className="text-destructive">{x.error}</div> : null}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-7 px-2 text-[11px]"
                        disabled={loading === x.id}
                        onClick={async () => {
                          if (text?.id === x.id) return setText(null);
                          setLoading(x.id);
                          const t = await fetchJobCallText(x.id);
                          setLoading(null);
                          if (t) setText({ id: x.id, system: t.system_prompt, prompt: t.prompt, response: t.response });
                        }}
                      >
                        {loading === x.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                        {text?.id === x.id ? "Hide text" : "Show exact prompt and reply"}
                      </Button>
                      {text?.id === x.id && (
                        <div className="mt-1 space-y-1">
                          <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[10px]">{text.system}</pre>
                          <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[10px]">{text.prompt}</pre>
                          <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[10px]">{text.response ?? "(no reply)"}</pre>
                        </div>
                      )}
                    </li>
                  ))}
                  {!(calls.data ?? []).length && <li className="text-muted-foreground">No model calls yet.</li>}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
