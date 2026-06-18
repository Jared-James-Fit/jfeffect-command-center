import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Flame, Beef, Wheat, Cookie, Droplets, Moon, ChefHat, HelpCircle } from "lucide-react";
import { RecipeBrowser } from "./RecipeBrowser";

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
}: {
  viewer: "member" | "client";
  userId?: string;
  goals?: string[];
  targets?: NutritionTargets;
  recipesAnchorId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6 p-4 pb-28 md:p-6 md:pb-12">
      <div id="targets" className="scroll-mt-20">
        <TargetsStrip targets={targets} />
      </div>
      <QuickActions viewer={viewer} recipesAnchorId={recipesAnchorId} />
      {children}
      <div id={recipesAnchorId} className="scroll-mt-20">
        <RecipeBrowser viewer={viewer} userId={userId} goals={goals} />
      </div>
    </div>
  );
}

function TargetsStrip({ targets }: { targets?: NutritionTargets }) {
  const items = [
    { icon: Flame, label: "Cal", value: targets?.calories, unit: "" },
    { icon: Beef, label: "Protein", value: targets?.protein, unit: "g" },
    { icon: Wheat, label: "Carbs", value: targets?.carbs, unit: "g" },
    { icon: Cookie, label: "Fats", value: targets?.fats, unit: "g" },
    { icon: Droplets, label: "Water", value: targets?.water, unit: "" },
    { icon: Moon, label: "Sleep", value: targets?.sleep, unit: "" },
  ];
  return (
    <Card className="p-3 sm:p-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-center"
          >
            <it.icon className="mx-auto h-4 w-4 text-primary" />
            <div className="mt-1 text-lg font-black leading-none">
              {it.value ?? "—"}
              {it.value != null && it.unit && (
                <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{it.unit}</span>
              )}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{it.label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function QuickActions({
  viewer,
  recipesAnchorId,
}: {
  viewer: "member" | "client";
  recipesAnchorId: string;
}) {
  const faqTo = viewer === "member" ? "/m/resources" : "/portal/resources";
  return (
    <div className="grid grid-cols-2 gap-3">
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
      <Link
        to={faqTo}
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 active:scale-[0.98]"
      >
        <HelpCircle className="h-6 w-6 text-foreground" />
        <div>
          <div className="text-sm font-bold leading-tight">Nutrition Help</div>
          <div className="text-[11px] text-muted-foreground">FAQ & resources</div>
        </div>
      </Link>
    </div>
  );
}
