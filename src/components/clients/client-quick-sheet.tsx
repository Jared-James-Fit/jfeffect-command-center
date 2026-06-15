import { lazy, Suspense } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { AssignProgramDialog } from "./assign-program-dialog";

const AssignedProgramsCard = lazy(() =>
  import("@/components/assigned-programs-card").then((m) => ({ default: m.AssignedProgramsCard })),
);
const NutritionTargetsPanel = lazy(() =>
  import("@/components/nutrition-targets-panel").then((m) => ({ default: m.NutritionTargetsPanel })),
);
const CardioTargetsPanel = lazy(() =>
  import("@/components/cardio-targets-panel").then((m) => ({ default: m.CardioTargetsPanel })),
);

export type QuickPanelKind = "program-view" | "nutrition" | "cardio";

type Props = {
  kind: QuickPanelKind | null;
  clientId: string;
  clientName?: string | null;
  onClose: () => void;
};

const TITLES: Record<QuickPanelKind, { title: string; description: string }> = {
  "program-view": { title: "Assigned Program", description: "Open phases, swap blocks, or view what's live." },
  nutrition: { title: "Nutrition Targets", description: "Add, edit, or review nutrition targets." },
  cardio: { title: "Cardio Targets", description: "Add, edit, or review cardio targets." },
};

export function ClientQuickSheet({ kind, clientId, clientName, onClose }: Props) {
  const open = !!kind;
  const meta = kind ? TITLES[kind] : null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {meta && (
          <SheetHeader>
            <SheetTitle>{meta.title}</SheetTitle>
            <SheetDescription>
              {clientName ? `${meta.description} — ${clientName}` : meta.description}
            </SheetDescription>
          </SheetHeader>
        )}
        <div className="mt-4">
          <Suspense
            fallback={
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            }
          >
            {kind === "program-view" && <AssignedProgramsCard clientId={clientId} mode="admin" />}
            {kind === "nutrition" && <NutritionTargetsPanel clientId={clientId} />}
            {kind === "cardio" && <CardioTargetsPanel clientId={clientId} />}
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export { AssignProgramDialog };