/**
 * Import a plan / Create with Cleo: the two ways into a JF member's Studio
 * that start from a draft (/portal/nutrition-studio?start=import|cleo).
 *
 *   import  their own plan, pasted or from a file (plan-source-picker.tsx):
 *           read by the app for free when it's laid out as a plan, else in
 *           full by AI in the background (credits)
 *   cleo    a few questions, then Cleo drafts a plan to their own saved
 *           targets in the background (credits), after the safety screen
 *
 * Either way it lands on the same preview (the days, what's worth a look,
 * the text it was read from), then "Edit in your plan" opens the Studio on
 * it (MemberPlanStudio seed). Nothing is saved until they Save there; then
 * an import's original is filed in their documents. An import still open
 * (being read, ready, or failed) is picked up again on the next visit, which
 * is where its push notification lands.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { AiCreditsSheet, useAiCredits, useSetCreditState } from "@/components/ai-credits/ai-credits";
import { MemberPlanStudio, useMyStudioPlan, type StudioPlanDay } from "@/components/nutrition-studio/member-plan-studio";
import { PlanSourcePicker } from "@/components/nutrition-studio/plan-source-picker";
import { PlanPreview } from "@/components/nutrition-studio/plan-preview";
import { CleoQuestions } from "@/components/nutrition-studio/cleo-questions";
import { useMealImport, useOpenMealImport, type MealImportRow } from "@/components/nutrition-studio/use-meal-import";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import {
  discardMealPlanImport,
  markMealPlanImportSaved,
  rereadMealPlanImport,
  retryMealPlanImport,
  startMealPlanCreate,
} from "@/lib/nutrition-import/import.functions";
import { usableTargets, type CreateAnswers } from "@/lib/nutrition-import/create";
import { seedFromPlan, type StudioSeed } from "@/lib/nutrition-import/seed";

type Mode = "import" | "cleo";

const TITLE: Record<Mode, string> = { import: "Import a plan", cleo: "Create with Cleo" };

function Shell({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl pb-32" data-studio-start={mode}>
      <PageHeader title={TITLE[mode]} backTo="/portal/nutrition-targets" />
      <div className="px-4 pt-2 md:px-6">{children}</div>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="px-2 py-12 text-center">
      <div className="text-[17px] font-semibold">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      {children && <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">{children}</div>}
    </div>
  );
}

export function NutritionStudioStart({ mode }: { mode: Mode }) {
  // one flow per mode: switching between them starts fresh
  return <StudioStart key={mode} mode={mode} />;
}

function StudioStart({ mode }: { mode: Mode }) {
  const planQ = useMyStudioPlan();
  const selfServe = planQ.data?.selfServe;
  const open = useOpenMealImport(mode === "cleo" ? "create" : "import", selfServe === true);
  const [id, setId] = useState<string | null>(null);
  const resumed = useRef(false);
  const [editing, setEditing] = useState<{ seed: StudioSeed; importId: string } | null>(null);
  const markSaved = useServerFn(markMealPlanImportSaved);

  // an import still open from before is picked up once (never again after it's discarded)
  useEffect(() => {
    if (resumed.current || selfServe !== true || open.loading) return;
    resumed.current = true;
    if (open.id) setId(open.id);
  }, [selfServe, open.loading, open.id]);

  if (editing)
    return (
      <MemberPlanStudio
        seed={{ days: editing.seed.days as StudioPlanDay[], phase: editing.seed.phase, weighing: editing.seed.weighing }}
        onSaved={async (planId) => {
          try {
            const r = await markSaved({ data: { id: editing.importId, targetId: planId } });
            if (r?.documents) toast("The original is in your documents.");
          } catch {
            // the plan is saved either way; the import's files are cleared within the week
          }
        }}
      />
    );

  // (and the one frame before an open import from before is picked up)
  if (planQ.isLoading || (selfServe && open.loading) || (!id && !resumed.current && open.id))
    return (
      <Shell mode={mode}>
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </Shell>
    );
  if (planQ.data && !selfServe)
    return (
      <Shell mode={mode}>
        <Notice title="Your coach writes your meal plan" body="You'll find it on your Nutrition page." />
      </Shell>
    );

  if (!id)
    return (
      <Shell mode={mode}>
        {mode === "import" ? (
          <>
            <p className="mb-4 text-[15px] leading-relaxed text-muted-foreground">
              Bring a meal plan you already follow. It comes in with its days, meals and amounts, ready to check and edit like any plan in
              the app.
            </p>
            <PlanSourcePicker audience="member" onStarted={(r) => setId(r.id)} goLabel="Import plan" />
            <p className="mt-2 text-center text-[13px] text-muted-foreground">You'll check everything before it's saved. Your plan stays private to you.</p>
          </>
        ) : (
          <CleoStart onStarted={setId} />
        )}
      </Shell>
    );

  return (
    <Shell mode={mode}>
      <ImportState id={id} mode={mode} hasOwnPlan={!!planQ.data?.plan && !planQ.data.plan.assigned_coach_id} onReset={() => setId(null)} onEdit={(seed) => setEditing({ seed, importId: id })} />
    </Shell>
  );
}

/** Create with Cleo's first step: the questions, then the draft is queued. */
function CleoStart({ onStarted }: { onStarted: (id: string) => void }) {
  const targetsFn = useServerFn(getActiveMemberTargets);
  const targetsQ = useQuery({ queryKey: ["m-nutrition-targets-studio"], queryFn: () => targetsFn({}), retry: false });
  const start = useServerFn(startMealPlanCreate);
  const credits = useAiCredits();
  const setCredits = useSetCreditState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const targets = usableTargets(targetsQ.data as any);

  const submit = async (answers: CreateAnswers) => {
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const r = await start({ data: { answers: answers as unknown as Record<string, unknown> } });
      if (r.ok) {
        void credits.refetch();
        onStarted(r.id);
        return;
      }
      if (r.reason === "out_of_credits") {
        setCredits(r.credits);
        setOutOfCredits(true);
        return;
      }
      setError(r.message);
    } catch (e: any) {
      setError(String(e?.message ?? "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return <CleoQuestions targets={targets} targetsLoading={targetsQ.isLoading} busy={busy} error={error} outOfCredits={outOfCredits} onSubmit={submit} />;
}

/** One import or draft, whatever stage it's at. */
function ImportState({
  id,
  mode,
  hasOwnPlan,
  onReset,
  onEdit,
}: {
  id: string;
  mode: Mode;
  hasOwnPlan: boolean;
  onReset: () => void;
  onEdit: (seed: StudioSeed) => void;
}) {
  const { row, loading, error, reload } = useMealImport(id);
  const discardFn = useServerFn(discardMealPlanImport);
  const [discarding, setDiscarding] = useState(false);
  const discard = async (say = true) => {
    setDiscarding(true);
    try {
      await discardFn({ data: { id } });
      if (say) toast(mode === "cleo" ? "Draft discarded." : "Import discarded. Its file was deleted.");
      onReset();
    } catch {
      toast.error("Couldn't discard it. Try again.");
    } finally {
      setDiscarding(false);
    }
  };

  if (loading)
    return (
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  if (error)
    return (
      <Notice title="It didn't load" body="Check your connection, then try again.">
        <Button variant="outline" onClick={() => void reload()}>
          Try again
        </Button>
      </Notice>
    );
  if (!row || row.status === "discarded")
    return (
      <Notice title="This isn't here anymore" body="Imports and drafts that weren't saved are cleared after 30 days.">
        <Button onClick={onReset}>Start again</Button>
      </Notice>
    );
  if (row.status === "saved")
    return (
      <Notice title="Saved to your meal plan" body="It's on your Nutrition page now.">
        <Button asChild>
          <Link to="/portal/nutrition-targets">Open Nutrition</Link>
        </Button>
        <Button variant="ghost" onClick={onReset}>
          {mode === "cleo" ? "Start a new draft" : "Import another plan"}
        </Button>
      </Notice>
    );
  if (row.status === "pending" || row.status === "reading")
    return (
      <div className="flex flex-col items-center px-2 py-12 text-center" aria-live="polite" data-meal-import-reading>
        {mode === "cleo" ? <CleoAvatar size="lg" /> : <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />}
        <div className="mt-4 text-[17px] font-semibold">{mode === "cleo" ? "Cleo is writing your draft…" : "Reading your plan…"}</div>
        <p className="mt-1 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          This can take a minute or two. You can leave this screen: you'll get a notification when it's ready, and it waits for you here.
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => void discard()} disabled={discarding}>
          Cancel
        </Button>
      </div>
    );
  if (row.status === "failed") return <Failed row={row} mode={mode} onReset={() => void discard(false)} reload={reload} />;
  return <Ready row={row} mode={mode} hasOwnPlan={hasOwnPlan} onEdit={onEdit} onDiscard={() => void discard()} discarding={discarding} reload={reload} />;
}

function Failed({ row, mode, onReset, reload }: { row: MealImportRow; mode: Mode; onReset: () => void; reload: () => Promise<void> }) {
  const retry = useServerFn(retryMealPlanImport);
  const setCredits = useSetCreditState();
  const [busy, setBusy] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const fileKind = row.source_kind === "pdf" || row.source_kind === "image";
  const canRetry = !fileKind || !row.files_deleted_at;
  const cost = mode === "cleo" ? FEATURE_COSTS.nutrition_create : FEATURE_COSTS.nutrition_import;
  const again = async () => {
    setBusy(true);
    try {
      const r: any = await retry({ data: { id: row.id } });
      if (!r.ok) {
        if (r.outOfCredits) {
          setCredits(r.credits);
          setCreditsOpen(true);
        } else toast.error(r.message);
        return;
      }
      await reload();
    } catch {
      toast.error("Couldn't start it again. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-2 py-12 text-center" data-meal-import-failed>
      <AlertTriangle className="mx-auto h-7 w-7 text-warning" aria-hidden />
      <div className="mt-3 text-[17px] font-semibold">{mode === "cleo" ? "Your draft couldn't be written" : "Your plan couldn't be read"}</div>
      <p className="mx-auto mt-1 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
        {row.error ?? "Something went wrong."} Your credits were given back.
      </p>
      <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
        {canRetry && (
          <Button onClick={again} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Try again ({cost} credits)
          </Button>
        )}
        <Button variant="ghost" onClick={onReset}>
          Start over
        </Button>
      </div>
      <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out feature={mode === "cleo" ? "nutrition_create" : "nutrition_import"} />
    </div>
  );
}

function Ready({
  row,
  mode,
  hasOwnPlan,
  onEdit,
  onDiscard,
  discarding,
  reload,
}: {
  row: MealImportRow;
  mode: Mode;
  hasOwnPlan: boolean;
  onEdit: (seed: StudioSeed) => void;
  onDiscard: () => void;
  discarding: boolean;
  reload: () => Promise<void>;
}) {
  const reread = useServerFn(rereadMealPlanImport);
  const setCredits = useSetCreditState();
  const [busy, setBusy] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const draft = row.kind === "create";
  const seed = row.result ? seedFromPlan(row.result.text, { targets: draft ? usableTargets(row.answers?.targets) : null }) : null;

  if (!seed)
    return (
      <Notice title="No meals were found in it" body="Check that it has the plan's meals and foods in it, or paste the plan as text.">
        <Button variant="ghost" onClick={onDiscard} disabled={discarding}>
          Start over
        </Button>
      </Notice>
    );

  const readInFull = async () => {
    setBusy(true);
    try {
      const r: any = await reread({ data: { id: row.id } });
      if (!r.ok) {
        if (r.outOfCredits) {
          setCredits(r.credits);
          setCreditsOpen(true);
        } else toast.error(r.message);
        return;
      }
      await reload();
    } catch {
      toast.error("Couldn't start the full read. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const source = row.source_text ?? row.result?.transcript ?? null;
  return (
    <>
      <PlanPreview
        days={seed.days.map((d) => ({ label: d.day_label, calories: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats, notes: d.notes }))}
        flags={row.result?.flags ?? []}
        sourceText={draft ? null : source}
        sourceLabel={row.source_kind === "text" ? "Your pasted text" : "What was read from your file"}
        note={
          <>
            {draft ? (
              <div className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3" data-cleo-draft-note>
                <CleoAvatar size="sm" />
                <p className="text-[14px] leading-relaxed">
                  <span className="font-semibold">A draft to check.</span> Cleo wrote it from your answers, to your own targets. It isn't advice
                  from a coach or a dietitian: check every food and amount before you save it.
                </p>
              </div>
            ) : row.method === "parsed" ? (
              <p className="text-[14px] text-muted-foreground">Read straight from your plan, nothing changed.</p>
            ) : null}
            {hasOwnPlan && <p className="text-[14px] text-muted-foreground">Saving it starts a new plan. The one you have now is archived, never deleted.</p>}
          </>
        }
        actions={
          <div className="space-y-2 pt-1">
            <Button className="h-12 w-full text-[16px]" onClick={() => onEdit(seed)} data-meal-import-edit>
              Edit in your plan
            </Button>
            {!draft && row.method === "parsed" && (
              <Button variant="outline" className="h-11 w-full" onClick={readInFull} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Something's missing? Read it in full ({FEATURE_COSTS.nutrition_import} credits)
              </Button>
            )}
            <Button variant="ghost" className="h-11 w-full" onClick={onDiscard} disabled={discarding}>
              Discard
            </Button>
          </div>
        }
      />
      <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out feature="nutrition_import" />
    </>
  );
}
