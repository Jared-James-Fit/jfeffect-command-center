/**
 * The coach's Gameplan: the plan as the athlete will read it, what it is right
 * now (Cleo's draft, the coach's draft, approved and whether the athlete
 * confirmed), the athlete's suggested change waiting to be accepted, the
 * editor, the PDF, and every version a tap away (compare, restore as a draft).
 * Approving makes a new version; nothing here overwrites an approved one.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileDown, History, Pencil, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { gameplanActionFn, shareWithCoachFn } from "@/lib/competition/handling.functions";
import { diffGameplans, readGameplan, type GameplanDoc } from "@/lib/competition/gameplan";
import { readRules } from "@/lib/competition/rules";
import { zoneLabel } from "@/lib/competition/event-timeline";
import { GameplanView } from "./gameplan-view";
import { GameplanEditor } from "./gameplan-editor";
import { dayWords } from "./prep-ui";

const SOURCE: Record<string, string> = { cleo: "Cleo", coach: "You", athlete: "The athlete" };
const STATUS: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  suggested: "Suggested",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Replaced",
};

export function GameplanSection({ prep, onChanged }: { prep: any; onChanged: () => void }) {
  const act = useServerFn(gameplanActionFn);
  const share = useServerFn(shareWithCoachFn);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const comp = prep.competition;
  const rules = readRules(comp.rules, comp.federation);
  const approved = prep.plans.approved;
  const draft = prep.plans.draft;
  const suggestion = prep.plans.suggestion;
  const plan: GameplanDoc = prep.plan;

  const run = useMutation({
    mutationFn: (d: { action: string; plan?: GameplanDoc; versionId?: string; summary?: string | null; note?: string | null }) =>
      act({ data: { competitionId: comp.id, ...d } as any }),
    onSuccess: (_r, d) => {
      onChanged();
      setEditing(false);
      toast.success(
        d.action === "approve" || d.action === "approve_draft"
          ? `Approved. ${prep.client.first} gets a push to look it over.`
          : d.action === "accept_suggestion"
            ? "Their change is in the approved plan"
            : d.action === "decline_suggestion"
              ? "Kept the approved plan"
              : d.action === "restore"
                ? "Restored as a draft"
                : "Draft saved",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
  });
  const shareRun = useMutation({
    mutationFn: (send: boolean) => share({ data: { competitionId: comp.id, send } }),
    onSuccess: async (r) => {
      if (r.sent) toast.success("Sent to their coach");
      else {
        try {
          await navigator.clipboard.writeText(r.text);
          toast.success("Copied: paste it to their coach");
        } catch {
          toast.error("Couldn't copy it");
        }
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't share it"),
  });

  /** the plan as a PDF; an older version says which one replaced it */
  const pdf = async (v?: any) => {
    const { makeAndDeliverPdf } = await import("@/lib/pdf/deliver");
    const { buildGameplanPdf } = await import("@/lib/competition/gameplan-pdf");
    const old = v && v.id !== approved?.id;
    await makeAndDeliverPdf("Gameplan", () =>
      buildGameplanPdf({
        athlete: prep.client.name,
        meet: comp.name,
        date: String(comp.meet_date),
        location: comp.location ?? null,
        zone: zoneLabel(prep.tz, new Date(`${comp.meet_date}T12:00:00Z`)),
        version: v ? v.version : (approved?.version ?? draft?.version ?? null),
        status: v ? (v.status === "approved" || v.approved_at ? "approved" : "draft") : approved ? "approved" : draft ? "draft" : "cleo",
        approvedAt: v ? (v.approved_at ?? null) : (approved?.approved_at ?? null),
        updatedAt: v ? (v.created_at ?? null) : (approved?.created_at ?? null),
        outdatedBy: old && approved ? approved.version : null,
        plan: v?.plan ? readGameplan(v.plan) : plan,
        timeline: prep.timeline,
        checklist: prep.checklist,
      }),
    );
  };

  if (editing)
    return (
      <GameplanEditor
        initial={plan}
        rules={rules}
        who="coach"
        saving={run.isPending}
        onCancel={() => setEditing(false)}
        onSave={(p, mode) => run.mutate({ action: mode === "approve" ? "approve" : "save_draft", plan: p })}
      />
    );

  const canShare = prep.handling?.shareWithCoach === "yes" && !!approved;
  const state = approved
    ? approved.athlete_confirmed_at
      ? `Version ${approved.version} · approved · ${prep.client.first} confirmed it`
      : `Version ${approved.version} · approved · waiting for ${prep.client.first} to confirm`
    : draft
      ? `${SOURCE[draft.source] ?? "A"} draft · version ${draft.version} · not shown to ${prep.client.first} yet`
      : `Cleo's draft from what's on file · not saved yet`;

  return (
    <div className="space-y-3" data-gameplan-section>
      {suggestion ? (
        <section className="rounded-2xl border border-warning/40 bg-warning/5 p-4" data-gameplan-suggestion>
          <h3 className="text-[15px] font-semibold">{prep.client.first} suggested a change</h3>
          <p className="text-[12.5px] text-muted-foreground">
            The approved plan stays as it is until you accept it. {dayWords(suggestion.created_at?.slice(0, 10))}
          </p>
          <ul className="mt-2 space-y-1 text-[14px]">
            {(suggestion.changes ?? []).map((c: any, i: number) => (
              <li key={i}>· {c.text}</li>
            ))}
          </ul>
          {suggestion.summary ? <p className="mt-1 text-[13px] text-muted-foreground">“{suggestion.summary}”</p> : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ action: "accept_suggestion", versionId: suggestion.id })} data-accept-suggestion>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "decline_suggestion", versionId: suggestion.id })}>
              Keep the approved plan
            </Button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3">
        {!approved ? <CleoAvatar size="sm" /> : null}
        <p className="min-w-0 flex-1 text-[13.5px]" data-gameplan-state>
          {state}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {!approved && draft ? (
            <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ action: "approve_draft", versionId: draft.id })} data-approve-draft>
              Approve
            </Button>
          ) : null}
          {!approved && !draft ? (
            <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ action: "approve", plan })} data-approve-cleo>
              Approve as is
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-edit-plan>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void pdf()} aria-label="Gameplan PDF" data-plan-pdf>
            <FileDown className="h-4 w-4" />
          </Button>
          {prep.plans.versions.length ? (
            <Button size="sm" variant="ghost" onClick={() => setHistory(true)} aria-label="Versions" data-plan-history>
              <History className="h-4 w-4" />
            </Button>
          ) : null}
          {canShare ? (
            <Button size="sm" variant="ghost" onClick={() => shareRun.mutate(!!prep.handling?.existingCoach?.clientId)} aria-label="Share with their coach" data-share-coach>
              <Share2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </section>

      {prep.problems.filter((p: any) => p.severity === "error").length ? (
        <ul className="space-y-1 rounded-2xl border border-destructive/30 p-3 text-[13px] text-destructive">
          {prep.problems
            .filter((p: any) => p.severity === "error")
            .map((p: any, i: number) => (
              <li key={i}>{p.text}</li>
            ))}
        </ul>
      ) : null}

      <GameplanView plan={plan} />

      <Sheet open={history} onOpenChange={setHistory}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-plan-versions>
          <SheetHeader className="text-left">
            <SheetTitle>Gameplan versions</SheetTitle>
            <SheetDescription>Every version is kept. Restoring one makes it a new draft to review.</SheetDescription>
          </SheetHeader>
          <Versions prep={prep} onRestore={(id) => run.mutate({ action: "restore", versionId: id })} onPdf={(v) => void pdf(v)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Versions({ prep, onRestore, onPdf }: { prep: any; onRestore: (id: string) => void; onPdf: (v: any) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = prep.plans.approved?.plan ? readGameplan(prep.plans.approved.plan) : null;
  return (
    <ul className="mt-4 divide-y divide-border">
      {(prep.plans.versions as any[]).map((v) => {
        const changes = current && v.plan ? diffGameplans(current, readGameplan(v.plan)) : [];
        return (
          <li key={v.id} className="py-3">
            <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(open === v.id ? null : v.id)}>
              <span className="min-w-0">
                <span className="text-[14px] font-medium">
                  Version {v.version} · {STATUS[v.status] ?? v.status}
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {SOURCE[v.source] ?? v.source} · {dayWords(String(v.created_at).slice(0, 10))}
                  {v.athlete_confirmed_at ? " · confirmed by the athlete" : ""}
                </span>
                {v.summary ? <span className="block truncate text-[12.5px] text-muted-foreground">{v.summary}</span> : null}
              </span>
            </button>
            {open === v.id ? (
              <div className="mt-2 space-y-2">
                {current && v.status !== "approved" ? (
                  changes.length ? (
                    <ul className="text-[13px]">
                      <li className="text-muted-foreground">Against the approved plan:</li>
                      {changes.map((c, i) => (
                        <li key={i}>· {c.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">The same as the approved plan.</p>
                  )
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {v.status !== "approved" ? (
                    <Button size="sm" variant="outline" onClick={() => onRestore(v.id)} data-restore-version>
                      Restore as a draft
                    </Button>
                  ) : null}
                  {v.plan ? (
                    <Button size="sm" variant="ghost" onClick={() => onPdf(v)}>
                      <FileDown className="h-4 w-4" /> PDF
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
