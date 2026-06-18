import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Flame, Beef, Wheat, Cookie, Droplets, Moon, Target, HeartPulse, ChefHat, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
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
      <TargetsStrip targets={targets} />
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

type Tile = {
  label: string;
  icon: any;
  emphasis?: boolean;
  to?: string;
  anchor?: string;
  hint?: string;
};

function QuickActions({
  viewer,
  recipesAnchorId,
}: {
  viewer: "member" | "client";
  recipesAnchorId: string;
}) {
  const tiles: Tile[] = [
    {
      label: "My Targets",
      icon: Target,
      emphasis: true,
      anchor: "targets",
      hint: "Calories, protein, carbs, fats",
    },
    {
      label: "Water & Recovery",
      icon: HeartPulse,
      anchor: "targets",
      hint: "Water and sleep targets",
    },
    {
      label: "Recipes",
      icon: ChefHat,
      anchor: recipesAnchorId,
      hint: "Browse the recipe library",
    },
    {
      label: "Nutrition FAQ",
      icon: HelpCircle,
      to: viewer === "member" ? "/m/resources" : "/portal/resources",
      hint: "Help center articles",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        const inner = (
          <div
            className={cn(
              "flex min-h-[112px] flex-col items-start justify-between gap-2 rounded-2xl border bg-card p-4 transition active:scale-[0.98]",
              t.emphasis
                ? "border-primary/40 bg-gradient-to-br from-primary/10 to-card hover:border-primary"
                : "border-border hover:border-primary/40 hover:bg-card/80",
            )}
          >
            <Icon className={cn("h-7 w-7", t.emphasis ? "text-primary" : "text-foreground")} />
            <div>
              <div className="text-sm font-bold leading-tight">{t.label}</div>
              {t.hint && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">{t.hint}</div>
              )}
            </div>
          </div>
        );
        if (t.anchor) {
          return (
            <a key={t.label} href={`#${t.anchor}`}>
              {inner}
            </a>
          );
        }
        return (
          <Link key={t.label} to={t.to!}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
