import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listMembers, generateSetupLink } from "@/lib/members.functions";
import { toast } from "sonner";
import { Link2, Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/setup-links")({
  component: SetupLinksPage,
});

function SetupLinksPage() {
  const fetch = useServerFn(listMembers);
  const setup = useServerFn(generateSetupLink);
  const { data } = useQuery({ queryKey: ["jf-members-for-setup"], queryFn: () => fetch({ data: { accountType: "jf_member" } }) });
  const members = (data?.members ?? []).filter((m: any) => !m.user_id);

  const generate = async (m: any) => {
    try {
      const r = await setup({ data: { memberId: m.id } });
      if (r.link) navigator.clipboard.writeText(r.link);
      toast.success("Setup link copied to clipboard");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <MembershipLeaf title="Setup Links" subtitle="Generate setup links for members who haven't created their account yet.">
      <Card className="divide-y divide-border">
        {members.length === 0 && <div className="p-6 text-sm text-muted-foreground">Every JF Member has completed setup. 🎉</div>}
        {members.map((m: any) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="min-w-0 flex-1 truncate hover:underline">
              <span className="font-medium">{m.full_name || m.email}</span>
              <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
            </Link>
            <Button size="sm" variant="outline" onClick={() => generate(m)}>
              <Link2 className="mr-1 h-3 w-3" />Generate & copy
            </Button>
          </div>
        ))}
      </Card>
    </MembershipLeaf>
  );
}