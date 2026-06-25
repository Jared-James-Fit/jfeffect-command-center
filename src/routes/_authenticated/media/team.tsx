import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/team")({
  component: TeamPage,
});

function TeamPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-team-roster"],
    queryFn: async () => {
      const { data: roles } = await (supabase.from("user_roles") as any)
        .select("user_id, role")
        .in("role", ["admin", "media_manager", "coach"]);
      const userIds = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
      if (userIds.length === 0) return [] as any[];
      const { data: profiles } = await (supabase.from("profiles") as any)
        .select("id, full_name, email, avatar_url")
        .in("id", userIds);
      const rolesByUser = new Map<string, string[]>();
      for (const r of roles ?? []) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push(r.role);
        rolesByUser.set(r.user_id, list);
      }
      return (profiles ?? []).map((p: any) => ({
        id: p.id,
        name: p.full_name || p.email || "Unnamed",
        email: p.email,
        roles: rolesByUser.get(p.id) ?? [],
      }));
    },
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <MediaHeader
        title="Team"
        description="People with Media Manager access. Manage invites and role permissions in the next phase."
      />
      <Card className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No team members found yet.</p>
        ) : (
          <ul className="divide-y">
            {data.map((m: any) => (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.name}</div>
                  {m.email && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.roles.map((r: string) => (
                    <Badge key={r} variant="secondary" className="capitalize">{r.replace("_", " ")}</Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}