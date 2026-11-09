import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { aiCheckNowFn, aiStatusFn } from "@/lib/ai/ai-status.functions";

export const Route = createFileRoute("/_authenticated/admin/settings_/ai")({ component: AiSettingsPage });

const TASK_LABEL: Record<string, string> = {
  strategy: "Program strategy (coaching decisions)",
  review: "Coaching review of a built program",
  interpret: "Reading an athlete's training",
  construct: "Writing the workouts from the strategy",
  repair: "Targeted fixes",
  edit: "Edit with AI",
  nutrition: "Nutrition targets (coaching decisions)",
  nutrition_write: "Writing meal plans and plan updates",
};

/** Admin only: which models run the coaching AI, whether they're reachable, and how the calls have gone. Nothing here changes a program. */
function AiSettingsPage() {
  const status = useServerFn(aiStatusFn);
  const checkNow = useServerFn(aiCheckNowFn);
  const q = useQuery({ queryKey: ["ai-status"], queryFn: () => status() });
  const [checking, setChecking] = useState(false);
  const run = async () => {
    setChecking(true);
    try {
      await checkNow();
      await q.refetch();
      toast.success("Models checked");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't check the models");
    } finally {
      setChecking(false);
    }
  };
  const d = q.data as any;
  const probes: any[] = d?.check?.probes ?? [];
  const reach = (m: string) => {
    const [via, id] = [m.split(":")[0], m.split(":").slice(1).join(":")];
    const p = probes.find((x) => (via === "openai" ? x.provider === "openai" && x.model === id : x.provider === "gateway" && x.model === id && !x.note));
    return p ? (p.ok ? `reachable (${(p.ms / 1000).toFixed(1)}s)` : "not reachable") : "not checked";
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title="AI models" />
      <p className="text-[13px] text-muted-foreground">Which models write and review programs. Coaching decisions only ever go to the top tier; if none answers, the run stops and says so. This page only reports: nothing here changes a program.</p>
      {q.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : q.error ? (
        <Card className="p-4 text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</Card>
      ) : (
        <>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Who answers what</h2>
              <Button size="sm" variant="outline" className="h-9" onClick={run} disabled={checking}>
                {checking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />} Check now
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Last checked: {d?.check?.at ? new Date(d.check.at).toLocaleString() : "never"}</p>
            <ul className="divide-y divide-border/60">
              {(d?.routes ?? []).map((r: any) => (
                <li key={r.task} className="py-2 text-[13px]">
                  <div className="font-semibold">{TASK_LABEL[r.task] ?? r.task}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {r.models.map((m: string, i: number) => `${i ? "then " : ""}${m} (${reach(m)})`).join(" · ")} · effort {r.effort}
                    {r.strongOnly ? " · top tier only" : ""}
                    {r.overridden ? " · overridden in app settings" : ""}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="text-base font-semibold">Last 30 days</h2>
            {(d?.stats ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No calls yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-1 pr-2">Model</th><th className="pr-2">Task</th><th className="pr-2">Calls</th><th className="pr-2">Failed</th><th className="pr-2">Avg / max s</th><th className="pr-2">Tokens in / out</th><th>Est. $</th></tr>
                  </thead>
                  <tbody>
                    {d.stats.map((s: any) => (
                      <tr key={`${s.source}${s.model}${s.task}`} className="border-t border-border/50">
                        <td className="py-1 pr-2">{s.model}</td>
                        <td className="pr-2">{s.source === "edit" ? "edit" : s.task}</td>
                        <td className="pr-2 tabular-nums">{s.calls}</td>
                        <td className="pr-2 tabular-nums">{s.failed}</td>
                        <td className="pr-2 tabular-nums">{s.avgSeconds ?? "—"} / {s.maxSeconds ?? "—"}</td>
                        <td className="pr-2 tabular-nums">{Math.round(s.inputTokens / 1000)}k / {Math.round(s.outputTokens / 1000)}k</td>
                        <td className="tabular-nums">{s.estCost != null ? s.estCost.toFixed(2) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Cost is estimated only where the model has a published price on file; gateway calls bill in Lovable credits.</p>
          </Card>
          {(d?.errors ?? []).length > 0 && (
            <Card className="space-y-2 p-4">
              <h2 className="text-base font-semibold">Recent errors</h2>
              <ul className="space-y-1 text-[12px]">
                {d.errors.map((e: any, i: number) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{new Date(e.at).toLocaleString()} · {e.source} · {e.task} · {e.model}:</span> {e.error}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
