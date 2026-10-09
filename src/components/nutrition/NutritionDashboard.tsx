import { type ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { HelpCircle, Calculator, AlertTriangle } from "lucide-react";
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
            <TargetsStrip targets={targets} userId={userId} />
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
  const hasSuggestion = Boolean(
    targets && [targets.calories, targets.protein, targets.carbs, targets.fats].some((v) => v != null),
  );

  return (
    <div className="space-y-3">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black">
              <Calculator className="h-4 w-4 text-primary" />
              Suggested Nutrition Targets
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              A simple membership estimate you can use as a starting point and adjust based on your results.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg border border-primary/30 bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90"
          >
            {hasSuggestion ? "Recalculate" : "Get suggestion"}
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/70 bg-background/70 p-3 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p>
            Suggested targets are general educational estimates for Membership users, not medical advice,
            a prescription, or individualized nutrition care. Health conditions, medications, pregnancy,
            training load, recovery, and eating history can change your needs.
          </p>
        </div>
      </Card>

      {hasSuggestion && <TargetsStrip targets={targets} userId={userId} />}

      <MacroCalculatorDialog
        open={open}
        onOpenChange={setOpen}
        viewer="member"
        hasCoachApprovedTargets={false}
      />
    </div>
  );
}

function TargetsStrip({ targets, userId }: { targets?: NutritionTargets; userId?: string }) {
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
    <Card className="space-y-4 p-4 md:p-5">
      <div className="text-sm font-black uppercase tracking-widest">Daily Targets</div>
      <MacroTargetsChart
        calories={targets?.calories}
        protein={targets?.protein}
        carbs={targets?.carbs}
        fats={targets?.fats}
        extras={extras}
      />
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
