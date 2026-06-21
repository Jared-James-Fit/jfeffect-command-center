import { type ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Flame, Beef, Wheat, Cookie, Droplets, Moon, ChefHat, HelpCircle, Calculator, Sparkles } from "lucide-react";
import { RecipeBrowser } from "./RecipeBrowser";
import type { RecipeProfile } from "./RecipeBrowser";
import { ensureWaterTarget, formatWater } from "@/lib/water";
import { WaterTargetDialog } from "@/components/progress/water-target-dialog";
import { useAuth } from "@/lib/auth";
import { MacroBreakdown } from "./MacroBreakdown";
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
          <TargetsStrip targets={targets} userId={userId} />
        </SectionErrorBoundary>
      </div>
      <SectionErrorBoundary label="Macro breakdown">
        <MacroBreakdown targets={targets} />
      </SectionErrorBoundary>
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
      <QuickActions viewer={viewer} recipesAnchorId={recipesAnchorId} hasCoachApprovedTargets={hasCoachApprovedTargets} />
      {children}
      <SectionErrorBoundary label="Daily nutrition">
        <DailyNutritionPanel />
      </SectionErrorBoundary>
      <div id={recipesAnchorId} className="scroll-mt-20">
        <SectionErrorBoundary label="Recipes">
          <RecipeBrowser
            viewer={viewer}
            userId={userId}
            goals={goals}
            profile={profile ?? {
              goals,
              // Build a basic profile from targets when no explicit profile is passed
              proteinTarget: targets?.protein != null ? Number(targets.protein) : null,
              calorieTarget: targets?.calories != null ? Number(targets.calories) : null,
            }}
          />
        </SectionErrorBoundary>
      </div>
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

  const items = [
    { icon: Flame, label: "Cal", value: targets?.calories, unit: "" },
    { icon: Beef, label: "Protein", value: targets?.protein, unit: "g" },
    { icon: Wheat, label: "Carbs", value: targets?.carbs, unit: "g" },
    { icon: Cookie, label: "Fats", value: targets?.fats, unit: "g" },
    { icon: Droplets, label: "Water", value: syncedWaterValue ?? targets?.water, unit: "", isWater: true as const },
    { icon: Moon, label: "Sleep", value: targets?.sleep, unit: "" },
  ];
  return (
    <Card className="p-3 sm:p-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((it) => {
          const isWater = "isWater" in it && it.isWater;
          const clickable = isWater && !!userId;
          const content = (
            <>
              <it.icon className="mx-auto h-4 w-4 text-primary" />
              <div className="mt-1 text-lg font-black leading-none">
                {it.value ?? "—"}
                {it.value != null && it.unit && (
                  <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{it.unit}</span>
                )}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {isWater && syncedWaterValue ? waterSourceLabel : it.label}
              </div>
            </>
          );
          if (clickable) {
            return (
              <button
                key={it.label}
                type="button"
                onClick={() => setWaterOpen(true)}
                className="rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-center transition hover:border-primary/50 active:scale-[0.98]"
              >
                {content}
              </button>
            );
          }
          return (
            <div
              key={it.label}
              className="rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-center"
            >
              {content}
            </div>
          );
        })}
      </div>
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
  recipesAnchorId,
  hasCoachApprovedTargets,
}: {
  viewer: "member" | "client";
  recipesAnchorId: string;
  hasCoachApprovedTargets?: boolean;
}) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <a
        href={`#${recipesAnchorId}`}
        className="flex items-center gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4 transition hover:border-primary active:scale-[0.98]"
      >
        <ChefHat className="h-6 w-6 text-primary" />
        <div>
          <div className="text-sm font-bold leading-tight">Browse Recipes</div>
          <div className="text-[11px] text-muted-foreground">Jump to the recipe library</div>
        </div>
      </a>
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
      <ComingSoonTile icon={Sparkles} title="Meal Builder" />
      <MacroCalculatorDialog
        open={calcOpen}
        onOpenChange={setCalcOpen}
        viewer={viewer}
        hasCoachApprovedTargets={hasCoachApprovedTargets}
      />
      <NutritionHelpSheet open={helpOpen} onOpenChange={setHelpOpen} viewer={viewer} />
    </div>
  );
}

function ComingSoonTile({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div
      className="relative flex items-center gap-3 rounded-xl border border-dashed border-border bg-secondary/20 p-4 opacity-80"
      aria-disabled="true"
    >
      <Icon className="h-6 w-6 text-muted-foreground" />
      <div>
        <div className="text-sm font-bold leading-tight text-foreground/80">{title}</div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Coming soon</div>
      </div>
    </div>
  );
}
