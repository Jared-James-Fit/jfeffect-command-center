import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { JfMembershipSettingsCard } from "@/components/admin/jf-membership-settings-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/membership/sales-page")({
  component: SalesPage,
});

function SalesPage() {
  const url = (typeof window !== "undefined" ? window.location.origin : "") + "/signup/jf";
  const copy = () => { navigator.clipboard.writeText(url); toast.success("Public signup link copied"); };
  return (
    <MembershipLeaf title="Sales Page" subtitle="Manage the public JF Membership signup page and pricing.">
      <Card className="p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Public link</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-xs">{url}</code>
          <Button size="sm" variant="outline" onClick={copy}><Copy className="mr-1 h-3 w-3" />Copy</Button>
          <a href="/signup/jf" target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3 w-3" />Open live page</Button></a>
          <a href={`mailto:?subject=Join%20JF%20Membership&body=${encodeURIComponent(url)}`}><Button size="sm" variant="outline"><Mail className="mr-1 h-3 w-3" />Email</Button></a>
          <a href={`sms:?&body=${encodeURIComponent("Join JF Membership: " + url)}`}><Button size="sm" variant="outline"><MessageCircle className="mr-1 h-3 w-3" />SMS</Button></a>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <JfMembershipSettingsCard />
      </div>
    </MembershipLeaf>
  );
}