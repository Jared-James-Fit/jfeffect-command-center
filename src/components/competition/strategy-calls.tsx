/**
 * Cleo's strategic calls inside an assessment (the coach's view): what Cleo
 * thinks of each part of the engines' baseline, every call that passed its
 * checks (the engine's number against Cleo's, why, and the evidence it cites,
 * a tap away), and the calls the checks set aside with their reasons. Before
 * release the coach keeps a call or puts it back to the engine's number; the
 * plan the athlete gets is rebuilt from what's kept (proposals.ts).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideProposalFn } from "@/lib/competition/competition.functions";
import { splitRefs } from "@/lib/competition/refs";
import { cn } from "@/lib/utils";

type Check = {
  proposal: {
    id: string;
    type: string;
    lift: string | null;
    scenario: string | null;
    attempt: number | null;
    kg: number | null;
    competitor: string | null;
    days_out: number | null;
    severity: string | null;
    text: string;
    reason: string;
    evidence: string[];
    confidence: string;
  };
  ok: boolean;
  reasons: string[];
  before: number | null;
  after: number | null;
};

const TYPE_WORD: Record<string, string> = {
  forecast: "Forecast",
  competitor: "Competitor",
  attempt: "Attempt",
  last_warmup: "Last warm-up",
  warmup_sets: "Warm-ups",
  taper: "Taper",
  strategy: "Strategy",
  risk: "Risk",
};
const VERDICT: Record<string, { word: string; cls: string }> = {
  agree: { word: "Agrees", cls: "border-success/40 text-success" },
  challenge: { word: "Challenges", cls: "border-warning/50 text-warning" },
  insufficient: { word: "Not enough to say", cls: "border-border text-muted-foreground" },
};
const ATTEMPT = ["", "opener", "second", "third"];

function RefTags({ refs, byId }: { refs: string[]; byId: Map<string, string> }) {
  if (!refs.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {refs.map((r) => (
        <span
          key={r}
          title={byId.get(r)}
          className="rounded bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground"
        >
          {r}
        </span>
      ))}
    </span>
  );
}

function label(p: Check["proposal"]) {
  const lift = p.lift ? `${p.lift[0].toUpperCase()}${p.lift.slice(1)}` : "";
  if (p.type === "forecast") return `${lift} ${p.scenario ?? "expected"}`;
  if (p.type === "attempt") return `${lift} ${ATTEMPT[p.attempt ?? 0] ?? "attempt"}`;
  if (p.type === "last_warmup") return `${lift} last warm-up`;
  if (p.type === "warmup_sets") return `${lift} warm-up ladder`;
  if (p.type === "competitor") return p.competitor ?? "Competitor";
  if (p.type === "risk") return `Risk · ${p.severity ?? "watch"}`;
  if (p.type === "taper") return p.days_out ? `Taper · ${p.days_out} days out` : "Taper";
  return TYPE_WORD[p.type] ?? p.type;
}

export function StrategyCalls({
  assessmentId,
  clientId,
  review,
  checks,
  declined,
  evidence,
  locked,
}: {
  assessmentId: string;
  clientId: string;
  review: Array<{ area: string; verdict: string; note: string }>;
  checks: Check[];
  declined: string[];
  evidence: Array<{ id: string; text: string }>;
  locked: boolean;
}) {
  const decide = useServerFn(decideProposalFn);
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(evidence.map((e) => [e.id, e.text]));
  const known = new Set(byId.keys());
  const passed = checks.filter((c) => c.ok);
  const setAside = checks.filter((c) => !c.ok);
  const m = useMutation({
    mutationFn: (x: { proposalId: string; use: "cleo" | "engine" }) =>
      decide({ data: { assessmentId, ...x } }),
    onSuccess: (_r, x) => {
      void qc.invalidateQueries({ queryKey: ["competition-assessment", assessmentId] });
      void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
      toast.success(x.use === "engine" ? "Original value restored" : "Using suggested adjustment");
    },
    onError: (e: any) => toast.error(e?.message ?? "That didn't work"),
  });

  if (!review.length && !checks.length) return null;
  return (
    <div className="space-y-4" data-strategy-calls>
      {review.length ? (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-[14px] font-medium">How Cleo reviewed the data</summary>
          <ul className="mt-1.5 space-y-1.5 text-[14px]">
            {review.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className={cn(
                    "mt-0.5 h-fit shrink-0 rounded-full border px-2 text-[11px]",
                    (VERDICT[r.verdict] ?? VERDICT.insufficient).cls,
                  )}
                >
                  {(VERDICT[r.verdict] ?? VERDICT.insufficient).word}
                </span>
                <span>
                  <span className="font-medium capitalize">{r.area}</span>:{" "}
                  {(() => {
                    const x = splitRefs(r.note, known);
                    return (
                      <>
                        {x.text}
                        <RefTags refs={x.refs} byId={byId} />
                      </>
                    );
                  })()}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {passed.length ? (
        <section>
          <h4 className="text-[14px] font-semibold">Suggested adjustments</h4>
          <p className="text-[12px] text-muted-foreground">
            Compare the original and suggested values. Keep or revert changes before release.
          </p>
          <ul className="mt-2 space-y-2">
            {passed.map((c) => {
              const p = c.proposal;
              const kept = !declined.includes(p.id);
              const numeric = c.before != null && p.kg != null;
              return (
                <li
                  key={p.id}
                  className={cn(
                    "rounded-xl border p-3 text-[14px]",
                    kept ? "border-border" : "border-dashed border-border opacity-70",
                  )}
                  data-call={p.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
                      {TYPE_WORD[p.type] ?? p.type}
                    </span>
                    <span className="font-medium">{label(p)}</span>
                    {numeric ? (
                      <span className="tabular-nums text-[13px]">
                        <span className={kept ? "text-muted-foreground line-through" : ""}>
                          {c.before} kg
                        </span>
                        {" → "}
                        <span className={kept ? "font-semibold" : "text-muted-foreground"}>
                          {p.kg} kg
                        </span>
                      </span>
                    ) : null}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {p.confidence} confidence
                    </span>
                  </div>
                  <p className="mt-1">{splitRefs(p.text, known).text}</p>

                  <button
                    type="button"
                    className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-muted-foreground"
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                    aria-expanded={open === p.id}
                  >
                    Reason and supporting evidence
                    <ChevronDown
                      className={cn("h-3 w-3 transition-transform", open === p.id && "rotate-180")}
                    />
                  </button>
                  {open === p.id ? (
                    <ul className="mt-1 space-y-1 rounded-lg bg-muted/50 p-2 text-[12px]">
                      <li className="text-[13px]">{splitRefs(p.reason, known).text}</li>
                      {p.evidence.map((id) => (
                        <li key={id}>
                          <span className="font-mono text-muted-foreground">{id}</span>{" "}
                          {byId.get(id) ?? "—"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!locked && numeric ? (
                    <div className="mt-2">
                      {kept ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={m.isPending}
                          onClick={() => m.mutate({ proposalId: p.id, use: "engine" })}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Keep original {c.before} kg
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={m.isPending}
                          onClick={() => m.mutate({ proposalId: p.id, use: "cleo" })}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Use Cleo's {p.kg} kg
                        </Button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {setAside.length ? (
        <details className="rounded-xl border border-border p-3 text-[13px]">
          <summary className="cursor-pointer font-medium">
            {setAside.length} alternative{setAside.length === 1 ? "" : "s"} not recommended
          </summary>
          <ul className="mt-2 space-y-2">
            {setAside.map((c) => (
              <li key={c.proposal.id}>
                <span className="font-medium">{label(c.proposal)}</span>
                {c.proposal.kg != null ? ` ${c.proposal.kg} kg` : ""}: {c.proposal.text}
                <span className="block text-muted-foreground">{c.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
