import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { ProgramAssignmentPlanner } from "@/components/program-planner/ProgramAssignmentPlanner";
import { Card } from "@/components/ui/card";
import { ProgramStatusBadge } from "@/components/programs/program-status-badge";

type Search = { templateId?: string };

export const Route = createFileRoute("/_authenticated/admin/program-assign/$clientId")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    templateId: typeof s.templateId === "string" ? s.templateId : undefined,
  }),
  component: PlannerPage,
});

function PlannerPage() {
  const { clientId } = Route.useParams();
  const { templateId } = useSearch({ from: Route.id }) as Search;

  const { data: templates = [] } = useQuery({
    queryKey: ["pl-templates-assignable-plan"],
    enabled: !templateId,
    queryFn: async () => (await (supabase as any)
      .from("pl_templates")
      .select("id, name, template_type, weeks, training_focus, tags, payload")
      .in("template_type", ["block","full_prep"])
      .eq("archived", false)
      .order("updated_at", { ascending: false })).data ?? [],
  });

  return (
    <>
      <PageHeader title="Program Assignment Planner" subtitle="Pick exactly what to assign, when, and how" />
      <div className="p-4 md:p-6 space-y-4">
        {!templateId ? (
          <Card className="p-3">
            <div className="mb-2 text-sm font-semibold">Pick a template from the Program Library</div>
            <ul className="grid gap-2 md:grid-cols-2">
              {(templates as any[]).map((t) => (
                <li key={t.id}>
                  <Link
                    to="/admin/program-assign/$clientId"
                    params={{ clientId }}
                    search={{ templateId: t.id }}
                    className="block rounded border border-border bg-secondary/20 p-2 hover:bg-secondary/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{t.name}</div>
                      <ProgramStatusBadge template={t} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t.weeks ? `${t.weeks}w · ` : ""}{t.training_focus ?? "—"}{(t.tags ?? []).length ? ` · ${(t.tags ?? []).join(", ")}` : ""}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <ProgramAssignmentPlanner clientId={clientId} templateId={templateId} />
        )}
      </div>
    </>
  );
}