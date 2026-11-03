/**
 * "Nutrition Tools" for the client Nutrition page: an always-visible grid of
 * compact one-tap tiles (icon + name: log food, meal plan PDF, cookbook,
 * calculator, help) so nothing hides behind a collapsed drawer. All read-only entry points, and
 * each appears once on the page (no second Log Food or PDF button elsewhere).
 */

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Calculator, HelpCircle, Wrench } from "lucide-react";
import { MacroCalculatorDialog } from "./MacroCalculatorDialog";
import { NutritionHelpSheet } from "./NutritionHelpSheet";
import { ToolTile } from "./tool-tile";

export { ToolTile, ToolRow } from "./tool-tile";

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
      <div className="mb-3 flex items-center gap-2">
        <Wrench className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="text-base font-semibold">Nutrition tools</div>
      </div>
      {/* an odd tile out on a phone takes the whole row instead of leaving a hole */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
        {tiles}
        <ToolTile icon={Calculator} title="Macro Calculator" onClick={() => setCalcOpen(true)} />
        <ToolTile icon={HelpCircle} title="Nutrition Help" onClick={() => setHelpOpen(true)} />
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
