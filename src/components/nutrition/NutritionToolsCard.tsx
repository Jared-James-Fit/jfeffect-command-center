/**
 * Compact "Nutrition Tools" drawer for the client Nutrition page.
 * Everything secondary (calculator, help, grocery list, trends, downloads)
 * lives here so the main page stays short. All read-only entry points.
 */

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calculator, ChevronDown, HelpCircle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { MacroCalculatorDialog } from "./MacroCalculatorDialog";
import { NutritionHelpSheet } from "./NutritionHelpSheet";

export function NutritionToolsCard({
  viewer,
  hasCoachApprovedTargets,
  extras,
}: {
  viewer: "member" | "client";
  hasCoachApprovedTargets?: boolean;
  /** Additional tool entries (grocery list, downloads, trends). */
  extras?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <Card className="p-4 md:p-5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-3 text-left">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <Wrench className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black uppercase tracking-widest">Nutrition Tools</div>
            <div className="text-[11px] text-muted-foreground">Calculator, help, grocery list and downloads</div>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-2">
          <Button variant="outline" className="h-11 w-full justify-start" onClick={() => setCalcOpen(true)}>
            <Calculator className="mr-2 h-4 w-4 text-primary" /> Macro Calculator
          </Button>
          <Button variant="outline" className="h-11 w-full justify-start" onClick={() => setHelpOpen(true)}>
            <HelpCircle className="mr-2 h-4 w-4" /> Nutrition Help
          </Button>
          {extras}
        </CollapsibleContent>
      </Collapsible>
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
