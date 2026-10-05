/**
 * "Nutrition Tools" for the client Nutrition page: an always-visible grid of
 * one-tap tiles (log food, meal plan PDF, calculator, help) so nothing hides
 * behind a collapsed drawer. All read-only entry points.
 */

import { useState, type ComponentType, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Calculator, HelpCircle, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { MacroCalculatorDialog } from "./MacroCalculatorDialog";
import { NutritionHelpSheet } from "./NutritionHelpSheet";

type TileProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  busy?: boolean;
  accent?: boolean;
};

/** One square-ish tool tile: icon, name, one-line "what it does". */
export function ToolTile({ icon: Icon, title, hint, onClick, href, disabled, busy, accent }: TileProps) {
  const className = cn(
    "flex min-h-[92px] w-full flex-col items-start gap-2 rounded-xl border p-3 text-left transition active:scale-[0.98]",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    accent ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/30 hover:border-primary/40",
    disabled && "pointer-events-none opacity-50",
  );
  const body = (
    <>
      <span
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg",
          accent ? "bg-primary text-primary-foreground" : "bg-background text-primary",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold leading-tight">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {body}
    </button>
  );
}

export function NutritionToolsCard({
  viewer,
  hasCoachApprovedTargets,
  tiles,
  footer,
}: {
  viewer: "member" | "client";
  hasCoachApprovedTargets?: boolean;
  /** Page-specific tiles shown first (log food, PDFs). */
  tiles?: ReactNode;
  /** Shown under the grid (e.g. adherence trend). */
  footer?: ReactNode;
}) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <Card className="p-4 md:p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
          <Wrench className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase tracking-widest">Nutrition Tools</div>
          <div className="text-[11px] text-muted-foreground">Everything you need, one tap away</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles}
        <ToolTile
          icon={Calculator}
          title="Macro Calculator"
          hint="Estimate calories & macros"
          onClick={() => setCalcOpen(true)}
        />
        <ToolTile
          icon={HelpCircle}
          title="Nutrition Help"
          hint="Hunger, eating out & logging tips"
          onClick={() => setHelpOpen(true)}
        />
      </div>
      {footer && <div className="mt-3 empty:hidden">{footer}</div>}
      <MacroCalculatorDialog
        open={calcOpen}
        onOpenChange={setCalcOpen}
        viewer={viewer}
        hasCoachApprovedTargets={hasCoachApprovedTargets}
      />
      <NutritionHelpSheet open={helpOpen} onOpenChange={setHelpOpen} viewer={viewer} />
    </Card>
  );
}
