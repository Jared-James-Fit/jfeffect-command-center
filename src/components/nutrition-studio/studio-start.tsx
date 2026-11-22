/** Import a plan / Create with Cleo: the two ways into the Studio that start from a draft (built next). */
import { PageHeader } from "@/components/app-shell";

export function NutritionStudioStart({ mode }: { mode: "import" | "cleo" }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title={mode === "import" ? "Import a plan" : "Create with Cleo"} backTo="/portal/nutrition-targets" />
    </div>
  );
}
