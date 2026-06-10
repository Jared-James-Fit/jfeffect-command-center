import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listMembers, generatePasswordResetLink } from "@/lib/members.functions";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/reset-links")({
  component: ResetLinksPage,
});

function ResetLinksPage() {
  const fetch = useServerFn(listMembers);
  const reset = useServerFn(generatePasswordResetLink);
  const { data } = useQuery({ queryKey: ["jf-members-for-reset"], queryFn: () => fetch({ data: { accountType: "jf_member" } }) });
  const members = (data?.members ?? []).filter((m: any) => !!m.user_id);

  const send = async (m: any) => {
    try {
      const r = await reset({ data: { memberId: m.id } });
      if (r.link) navigator.clipboard.writeText(r.link);
      toast.success("Password reset link copied");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <MembershipLeaf title="Password Reset Links" subtitle="Generate password reset links for members with active accounts.">
      <Card className="divide-y divide-border">
        {members.length === 0 && <div className="p-6 text-sm text-muted-foreground">No members yet.</div>}
        {members.map((m: any) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="min-w-0 flex-1 truncate hover:underline">
              <span className="font-medium">{m.full_name || m.email}</span>
              <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
            </Link>
            <Button size="sm" variant="outline" onClick={() => send(m)}>
              <KeyRound className="mr-1 h-3 w-3" />Generate & copy
            </Button>
          </div>
        ))}
      </Card>
    </MembershipLeaf>
  );
}