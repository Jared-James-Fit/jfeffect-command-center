import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { getCleoAccessSettingsFn, setCleoAccessFn, type CleoAccessSettings } from "@/lib/cleo-access.functions";
import { CleoAvatar, CLEO_ROLE_LINE } from "@/components/summer/cleo-avatar";
import { aiCheckNowFn, aiStatusFn } from "@/lib/ai/ai-status.functions";
import { AiCreditsAdminCard } from "@/components/ai-credits/ai-credits-admin";

export const Route = createFileRoute("/_authenticated/admin/settings_/ai")({ component: AiSettingsPage });

/**
 * Every place AI runs, by the name people see it under and who sees it. Only
 * Cleo is ever presented as an AI; everything else is named for what it does
 * (AGENTS.md: AI is the engine, not the product).
 */
const TASK_LABEL: Record<string, string> = {
  strategy: "Generate Next Program: the strategy (coaches)",
  review: "Generate Next Program: the coaching review of a built program (coaches)",
  interpret: "Program Intelligence: Interpret this report (coaches)",
  construct: "Generate Next Program: writing the workouts (coaches)",
  repair: "Generate Next Program: targeted fixes (coaches)",
  edit: "Adjust program (coaches: Training tab, program and template editors)",
  nutrition: "Nutrition Update: the draft targets (coaches review before publishing)",
  nutrition_write: "Nutrition Update: draft meal plans, Adjust plan (coaches); Create with Cleo: a member's meal plan draft (metered by credits)",
  roadmap: "Athlete roadmap words: block purpose, weekly focus (athletes read them)",
  meal_estimate: "Food log: meal estimates from a description (members and clients, metered by credits)",
  form_draft: "Forms: Draft from a description (coaches)",
  coach_write: "Check-in recaps, reply drafts, lead texts, the inbox Brief (coaches)",
  assistant: "Cleo, the AI assistant: chat and voice with live look-ups (whoever has Cleo, below)",
  exercise_identify: "Exercise search: finding an exercise someone described (everyone)",
  post_write: "Crew's lesson and tip posts: slides and captions (the crew reads them)",
  program_import: "Import a program: reading a PDF, photos or a messy file (members and clients, metered by credits)",
  nutrition_roadmap: "Nutrition roadmap words (the engine decides the numbers)",
  nutrition_import: "Import a meal plan: reading a PDF, photos or a file (members metered by credits; coaches in the plan editor)",
};

/** Admin only: who has Cleo. The admin always; the finance login and coaches by switch. Clients and members have no Cleo. */
function CleoAccessCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCleoAccessSettingsFn);
  const setFn = useServerFn(setCleoAccessFn);
  const q = useQuery({ queryKey: ["cleo-access-settings"], queryFn: () => getFn() });
  const save = useMutation({
    mutationFn: (next: CleoAccessSettings) => setFn({ data: next }),
    onSuccess: (saved) => {
      qc.setQueryData(["cleo-access-settings"], saved);
      void qc.invalidateQueries({ queryKey: ["cleo-access"] });
      toast.success("Saved. It applies right away; their app catches up within a few minutes.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save who has Cleo"),
  });
  const s = q.data;
  const row = (key: keyof CleoAccessSettings, title: string, hint: string) => (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[15px]">{title}</div>
        <div className="text-[12px] text-muted-foreground">{hint}</div>
      </div>
      <Switch
        checked={!!s?.[key]}
        disabled={!s || save.isPending}
        onCheckedChange={(v) => s && save.mutate({ ...s, [key]: v })}
        aria-label={`Cleo for ${title.toLowerCase()}`}
      />
    </div>
  );
  return (
    <Card className="space-y-1 p-4" data-cleo-access>
      <div className="flex items-center gap-3">
        <CleoAvatar />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Who has Cleo</h2>
          <p className="text-[12px] text-muted-foreground">Cleo is the app's {CLEO_ROLE_LINE.toLowerCase()}, and the only place AI is named to anyone. Switched off, every way in is gone and the server refuses it.</p>
        </div>
      </div>
      {q.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : q.error ? (
        <p className="text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</p>
      ) : (
        <div className="divide-y divide-border/60">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[15px]">Admins</div>
              <div className="text-[12px] text-muted-foreground">Always on.</div>
            </div>
            <Switch checked disabled aria-label="Cleo for admins" />
          </div>
          {row("finance", "Finance login", "Its own Cleo for the books and payments, read-only like the rest of its access.")}
          {row("coach", "Coaches", "Their own Cleo, limited to what their login sees: their clients, never money. Changes go to you for approval.")}
        </div>
      )}
      <p className="pt-1 text-[12px] text-muted-foreground">Clients and members: no Cleo. A version for them would need its own data limits, safety rules and credits before it could be released.</p>
    </Card>
  );
}

/** Admin only: which models run the coaching AI, whether they're reachable, and how the calls have gone. Nothing here changes a program. */
function AiSettingsPage() {
  const { accountRole, loading } = useAuth();
  if (loading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  if (accountRole !== "admin") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <PageHeader title="AI & Cleo" />
        <Card className="p-4 text-[13px] text-muted-foreground">Only an admin can see this page.</Card>
      </div>
    );
  }
  return <AiSettingsBody />;
}

function AiSettingsBody() {
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
      <PageHeader title="AI & Cleo" />
      <p className="text-[13px] text-muted-foreground">Who has Cleo, where AI runs in the app and which models answer, and the credits members and clients use. Every default runs on the OpenAI key, never Lovable credits. Coaching decisions only ever go to the top tier; if none answers, the run stops and says so. Nothing here changes a program.</p>
      <CleoAccessCard />
      <AiCreditsAdminCard />
      {q.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : q.error ? (
        <Card className="p-4 text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</Card>
      ) : (
        <>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Where AI runs, and who answers</h2>
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
