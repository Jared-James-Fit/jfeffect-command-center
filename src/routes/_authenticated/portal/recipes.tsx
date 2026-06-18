import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { RecipeBrowser } from "@/components/nutrition/RecipeBrowser";

export const Route = createFileRoute("/_authenticated/portal/recipes")({
  component: PortalRecipes,
});

function PortalRecipes() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client-recipes", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("goals").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const goals = (client as any)?.goals ? [String((client as any).goals)] : [];
  return (
    <>
      <PageHeader title="Recipes" subtitle="Browse the full recipe library." />
      <div className="p-4 pb-28 md:p-6 md:pb-12">
        <RecipeBrowser viewer="client" userId={portalUserId ?? undefined} goals={goals} />
      </div>
    </>
  );
}
