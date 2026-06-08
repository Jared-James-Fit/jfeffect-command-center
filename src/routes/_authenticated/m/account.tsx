import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/m/account")({ component: AccountPage });

function AccountPage() {
  const { signOut } = useAuth();
  const fetchMe = useServerFn(getCurrentMember);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  return (
    <div className="space-y-6">
      <PageHeader title="My Account" subtitle="Your membership and access." />
      <Card className="p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Profile</div>
        <div className="mt-2 font-semibold">{me?.member?.full_name ?? "—"}</div>
        <div className="text-sm text-muted-foreground">{me?.member?.email ?? "—"}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">{me?.member?.account_type ?? "—"}</Badge>
          <Badge>{me?.member?.status ?? "—"}</Badge>
        </div>
      </Card>
      <Card className="p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Active access</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(me?.access ?? []).length === 0 && <div className="text-sm text-muted-foreground">No active access.</div>}
          {(me?.access ?? []).map((a: any) => <Badge key={a.id} variant="secondary">{a.access_level_key}</Badge>)}
        </div>
      </Card>
      <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
    </div>
  );
}