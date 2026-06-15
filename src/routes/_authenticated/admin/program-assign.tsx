import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Search = { templateId?: string };

export const Route = createFileRoute("/_authenticated/admin/program-assign")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    templateId: typeof s.templateId === "string" ? s.templateId : undefined,
  }),
  component: ClientPicker,
});

function ClientPicker() {
  const { templateId } = useSearch({ from: Route.id }) as Search;
  const [q, setQ] = useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["planner-client-pick"],
    queryFn: async () => (await (supabase as any)
      .from("clients").select("id, full_name, email").order("full_name", { ascending: true }).limit(500)).data ?? [],
  });

  const filtered = (clients as any[]).filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (c.full_name ?? "").toLowerCase().includes(s) || (c.email ?? "").toLowerCase().includes(s);
  });

  return (
    <>
      <PageHeader title="Assign Program" subtitle="Pick a client to open the planner" />
      <div className="p-4 md:p-6 space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" />
        <Card className="p-2">
          <ul className="max-h-[60vh] overflow-y-auto">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  to="/admin/program-assign/$clientId"
                  params={{ clientId: c.id }}
                  search={templateId ? { templateId } : {}}
                  className="flex items-center justify-between rounded px-2 py-2 text-sm hover:bg-secondary/40"
                >
                  <span>{c.full_name ?? "—"}</span>
                  <span className="text-[10px] text-muted-foreground">{c.email}</span>
                </Link>
              </li>
            ))}
            {!filtered.length && <li className="p-2 text-xs text-muted-foreground">No matches.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}