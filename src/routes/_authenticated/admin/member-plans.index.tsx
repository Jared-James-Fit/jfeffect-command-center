import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/member-plans/")({ component: MemberPlansAdmin });

function MemberPlansAdmin() {
  const [tab, setTab] = useState("all");
  const { data: plans = [] } = useQuery({
    queryKey: ["admin-member-plans"],
    queryFn: async () => (await supabase.from("member_plans").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const list = (plans as any[]).filter((p) => tab === "all" ? true : p.status === tab);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Plan Library"
        subtitle="Member-facing workout plans. Publish from coaching templates or build from scratch."
        actions={<Link to="/admin/member-plans/new"><Button><Plus className="mr-2 h-4 w-4" />New Plan</Button></Link>}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="Draft">Drafts</TabsTrigger>
          <TabsTrigger value="Published">Published</TabsTrigger>
          <TabsTrigger value="Archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <Card className="mt-3 divide-y">
            {list.length === 0 && <div className="p-6 text-sm text-muted-foreground">Nothing here yet.</div>}
            {list.map((p: any) => (
              <Link key={p.id} to="/admin/member-plans/$planId" params={{ planId: p.id }} className="block p-4 hover:bg-muted/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.training_style} · {p.difficulty} · {p.weeks}w/{p.days_per_week}d · access: {p.required_access_level}</div>
                  </div>
                  <Badge variant={p.status === "Published" ? "default" : "secondary"}>{p.status}</Badge>
                </div>
              </Link>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}