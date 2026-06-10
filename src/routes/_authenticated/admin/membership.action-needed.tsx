import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMembershipActionNeeded } from "@/lib/membership-admin.functions";
import { generateSetupLink, generatePasswordResetLink } from "@/lib/members.functions";
import { toast } from "sonner";
import { Link2, KeyRound, ExternalLink, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/action-needed")({
  component: ActionNeededPage,
});

const BUCKET_LABELS: Record<string, string> = {
  incomplete_setup: "Incomplete setup",
  missing_pfp: "Missing profile picture",
  missing_phone: "Missing phone number",
  missing_sms: "SMS consent missing",
  payment_failed: "Payment failed",
  trial_ending: "Trial ending soon",
  cancelled_recent: "Recently cancelled",
  setup_link_not_opened: "Setup link not opened",
};

function MemberRow({ m }: { m: any }) {
  const setup = useServerFn(generateSetupLink);
  const reset = useServerFn(generatePasswordResetLink);
  const sendSetup = async () => {
    try {
      const r = await setup({ data: { memberId: m.id } });
      if (r.link) navigator.clipboard.writeText(r.link);
      toast.success("Setup link generated & copied");
    } catch (e: any) { toast.error(e.message); }
  };
  const sendReset = async () => {
    try {
      const r = await reset({ data: { memberId: m.id } });
      if (r.link) navigator.clipboard.writeText(r.link);
      toast.success("Reset link generated & copied");
    } catch (e: any) { toast.error(e.message); }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="min-w-0 flex-1 truncate hover:underline">
        <span className="font-medium">{m.full_name || m.email}</span>
        <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={sendSetup}><Link2 className="mr-1 h-3 w-3" />Setup link</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={sendReset}><KeyRound className="mr-1 h-3 w-3" />Reset</Button>
        <Link to="/admin/members/$memberId" params={{ memberId: m.id }}>
          <Button size="sm" variant="ghost" className="h-7 text-xs"><ExternalLink className="mr-1 h-3 w-3" />Open</Button>
        </Link>
      </div>
    </li>
  );
}

function ActionNeededPage() {
  const fetch = useServerFn(getMembershipActionNeeded);
  const { data, isLoading } = useQuery({ queryKey: ["jf-action-needed"], queryFn: () => fetch(), refetchInterval: 60_000 });

  const buckets = data?.buckets ?? {};

  return (
    <div className="space-y-5">
      <PageHeader title="Action Needed" subtitle="Members who need follow-up to finish setup, billing, or consent." />
      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>}
      {!isLoading && Object.entries(buckets).map(([key, list]: any) => (
        <Card key={key} className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <AlertCircle className="h-4 w-4 text-amber-300" />{BUCKET_LABELS[key]}
            </h3>
            <Badge variant="outline">{list.length}</Badge>
          </div>
          {list.length === 0 ? (
            <div className="text-xs text-muted-foreground">Nothing here. 🎉</div>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {list.slice(0, 20).map((m: any) => <MemberRow key={m.id} m={m} />)}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}