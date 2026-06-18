import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { usePortalUserId } from "@/lib/client-impersonation";
import { RecipeBrowser } from "@/components/nutrition/RecipeBrowser";

export const Route = createFileRoute("/_authenticated/portal/recipes")({ component: PortalRecipes });

function PortalRecipes() {
  const userId = usePortalUserId();
  return (
    <>
      <PageHeader title="Recipes" subtitle="Fast, simple, coach-approved meals." />
      <div className="space-y-4 p-4 pb-28 md:p-6 md:pb-12">
        <RecipeBrowser viewer="client" userId={userId} />
      </div>
    </>
  );
}
