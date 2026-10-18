import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { HelpCircle, Calculator, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecipeProfile } from "./RecipeBrowser";
import { CookbookEntryCard } from "./CookbookSheet";
import { ensureWaterTarget, formatWater } from "@/lib/water";
import { WaterTargetDialog } from "@/components/progress/water-target-dialog";
import { useAuth } from "@/lib/auth";
import { MacroTargetsChart, type TargetExtra } from "./MacroTargetsChart";
import { TargetsHistorySparkline } from "./TargetsHistorySparkline";
import { CoachTargetChangeBanner } from "./CoachTargetChangeBanner";
import { RecentAdherenceWidget } from "./RecentAdherenceWidget";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { MacroCalculatorDialog } from "./MacroCalculatorDialog";
import { NutritionHelpSheet } from "./NutritionHelpSheet";
import { DailyNutritionPanel } from "./DailyNutritionPanel";

/**
 * Shared nutrition dashboard surface used by members and coaching clients.
 * Top: targets strip (always visible — Phase 3). Then quick actions
 * (Phase 7). Then any viewer-specific blocks (day tabs, cardio, PDF) via
 * `children`. Finally the unified recipe browser.
 */

export type NutritionTargets = {
  calories?: number | string | null;
  protein?: number | string | null;
  carbs?: number | string | null;
  fats?: number | string | null;
  water?: number | string | null;
  sleep?: number | string | null;
};

export function NutritionDashboard({
  viewer,
  userId,
  goals,
  targets,
  recipesAnchorId = "recipes",
  children,
  profile,
  hasCoachApprovedTargets,
}: {
  viewer: "member" | "client";
  userId?: string;
  goals?: string[];
  targets?: NutritionTargets;
  recipesAnchorId?: string;
  children?: ReactNode;
  profile?: RecipeProfile;
  hasCoachApprovedTargets?: boolean;
}) {
  return (
    <div className="space-y-6 p-4 pb-28 md:p-6 md:pb-12">
      {viewer === "member" && (
        <SectionErrorBoundary label="Coach updates">
          <CoachTargetChangeBanner />
        </SectionErrorBoundary>
      )}
      <div id="targets" className="scroll-mt-20">
        <SectionErrorBoundary label="Targets">
          {viewer === "member" && !hasCoachApprovedTargets ? (
            <SuggestedTargetsSection targets={targets} userId={userId} />
          ) : (
            <TargetsStrip
              targets={targets}
              userId={userId}
              badge={viewer === "member" ? <TargetBadge>Set by coach</TargetBadge> : undefined}
            />
          )}
        </SectionErrorBoundary>
      </div>
      {viewer === "member" && (
        <SectionErrorBoundary label="Target history">
          <TargetsHistorySparkline />
        </SectionErrorBoundary>
      )}
      {viewer === "client" && (
        <SectionErrorBoundary label="Adherence">
          <RecentAdherenceWidget />
        </SectionErrorBoundary>
      )}
      <QuickActions viewer={viewer} hasCoachApprovedTargets={hasCoachApprovedTargets} />
      {children}
      <SectionErrorBoundary label="Daily nutrition">
        <DailyNutritionPanel />
      </SectionErrorBoundary>
      <div id={recipesAnchorId} className="scroll-mt-20">
        <SectionErrorBoundary label="Cookbook">
          {/* Recipes now load lazily behind the Cookbook entry card. */}
          <CookbookEntryCard viewer={viewer} />
        </SectionErrorBoundary>
      </div>
    </div>
  );
}

function SuggestedTargetsSection({
  targets,
  userId,
}: {
  targets?: NutritionTargets;
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const hasSuggestion = Boolean(
    targets && [targets.calories, targets.protein, targets.carbs, targets.fats].some((v) => v != null),
  );

  // after a save the new numbers are what they look at
  useEffect(() => {
    if (!justSaved) return;
    document.getElementById("targets")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = window.setTimeout(() => setJustSaved(false), 1800);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  const calculator = (
    <MacroCalculatorDialog
      open={open}
      onOpenChange={setOpen}
      viewer="member"
      hasCoachApprovedTargets={false}
      onSaved={() => setJustSaved(true)}
    />
  );

  if (!hasSuggestion) {
    return (
      <>
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Suggested Nutrition Targets</div>
          <div className="mt-1 text-base font-black leading-tight">Get your daily calories and macros</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Six quick answers about you and your goal. We fill in what we already know.
          </p>
          <Button onClick={() => setOpen(true)} className="mt-3 h-11 w-full font-bold">
            <Calculator className="mr-2 h-4 w-4" /> Get my targets
          </Button>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            These are general educational estimates, not medical advice.
          </p>
        </Card>
        {calculator}
      </>
    );
  }

  return (
    <>
      <TargetsStrip
        targets={targets}
        userId={userId}
        highlight={justSaved}
        badge={<TargetBadge>Suggested</TargetBadge>}
        action={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:border-primary/50 active:scale-[0.97]"
          >
            <RefreshCw className="h-3 w-3" /> Recalculate
          </button>
        }
        footnote="From your body data and goal: general educational estimates, not medical advice."
      />
      {calculator}
    </>
  );
}

function TargetBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function TargetsStrip({
  targets,
  userId,
  badge,
  action,
  footnote,
  highlight,
}: {
  targets?: NutritionTargets;
  userId?: string;
  badge?: ReactNode;
  action?: ReactNode;
  footnote?: string;
  highlight?: boolean;
}) {
  const { user, role } = useAuth();
  const [waterOpen, setWaterOpen] = useState(false);

  // Single source of truth for water target: progress_water_targets.active_ml.
  // Falls back to the legacy nutrition_targets.water string only if we
  // have no synced user id (rare — viewing a target preview without auth).
  const waterQ = useQuery({
    queryKey: ["water-target", userId],
    enabled: !!userId,
    queryFn: () => ensureWaterTarget(userId!),
    staleTime: 30_000,
  });

  const syncedWaterValue = waterQ.data ? formatWater(waterQ.data.active_ml, "L") : null;
  const waterSourceLabel =
    waterQ.data?.target_source === "coach" ? "Set by coach"
    : waterQ.data?.target_source === "admin" ? "Set by admin"
    : waterQ.data?.target_source === "user" ? "Custom"
    : "Daily target";

  const viewerRole: "owner" | "admin" | "coach" =
    role === "admin" ? "admin" : role === "coach" ? "coach" : "owner";

  const waterValue = syncedWaterValue ?? (targets?.water != null ? String(targets.water) : null);
  const extras: TargetExtra[] = [];
  if (waterValue || userId) {
    extras.push({
      label: "Water",
      value: waterValue ?? "—",
      note: syncedWaterValue ? waterSourceLabel : undefined,
      onClick: userId ? () => setWaterOpen(true) : undefined,
    });
  }
  if (targets?.sleep != null) extras.push({ label: "Sleep", value: String(targets.sleep) });

  return (
    <Card className={cn("space-y-4 p-4 transition-shadow duration-500 md:p-5", highlight && "ring-2 ring-primary")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="text-sm font-black uppercase tracking-widest">Daily Targets</div>
          {badge}
        </div>
        {action}
      </div>
      <MacroTargetsChart
        calories={targets?.calories}
        protein={targets?.protein}
        carbs={targets?.carbs}
        fats={targets?.fats}
        extras={extras}
      />
      {footnote && <p className="text-[10px] leading-snug text-muted-foreground">{footnote}</p>}
      {userId && user?.id && (
        <WaterTargetDialog
          open={waterOpen}
          onOpenChange={setWaterOpen}
          userId={userId}
          currentUserId={user.id}
          viewerRole={viewerRole}
        />
      )}
    </Card>
  );
}

function QuickActions({
  viewer,
  hasCoachApprovedTargets,
}: {
  viewer: "member" | "client";
  hasCoachApprovedTargets?: boolean;
}) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className={viewer === "member" ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 active:scale-[0.98]"
      >
        <HelpCircle className="h-6 w-6 text-foreground" />
        <div>
          <div className="text-sm font-bold leading-tight">Nutrition Help</div>
          <div className="text-[11px] text-muted-foreground">FAQ & resources</div>
        </div>
      </button>
      {viewer === "client" && (
        <>
          <button
            type="button"
            onClick={() => setCalcOpen(true)}
            className="flex items-center gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4 text-left transition hover:border-primary active:scale-[0.98]"
          >
            <Calculator className="h-6 w-6 text-primary" />
            <div>
              <div className="text-sm font-bold leading-tight">Macro Calculator</div>
              <div className="text-[11px] text-muted-foreground">Calculate your targets</div>
            </div>
          </button>
          <MacroCalculatorDialog
            open={calcOpen}
            onOpenChange={setCalcOpen}
            viewer={viewer}
            hasCoachApprovedTargets={hasCoachApprovedTargets}
          />
        </>
      )}
      <NutritionHelpSheet open={helpOpen} onOpenChange={setHelpOpen} viewer={viewer} />
    </div>
  );
}
