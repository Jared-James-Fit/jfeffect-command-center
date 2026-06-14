import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentMember, updateMyMarketingPrefs } from "@/lib/members.functions";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/m/account")({ component: AccountPage });

function AccountPage() {
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const fetchMe = useServerFn(getCurrentMember);
  const saveMarketing = useServerFn(updateMyMarketingPrefs);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const [marketingOn, setMarketingOn] = useState(false);
  const [savingMarketing, setSavingMarketing] = useState(false);
  useEffect(() => {
    if (me?.member) setMarketingOn(!me.member.sms_opt_out);
  }, [me?.member?.id, me?.member?.sms_opt_out]);
  const onToggleMarketing = async (next: boolean) => {
    setMarketingOn(next);
    setSavingMarketing(true);
    try {
      await saveMarketing({ data: { sms_opt_out: !next } });
      qc.invalidateQueries({ queryKey: ["m-me"] });
      toast.success(next ? "Subscribed to coaching updates" : "Marketing messages turned off");
    } catch (e: any) {
      setMarketingOn(!next);
      toast.error(e?.message ?? "Couldn't save preference");
    } finally {
      setSavingMarketing(false);
    }
  };
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
      <Card className="p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Notifications &amp; marketing</div>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="marketing-toggle" className="text-sm font-semibold">
              Coaching updates &amp; offers
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Send me occasional coaching updates and offers by email or SMS. Optional — you can unsubscribe anytime from here or any message.
            </p>
          </div>
          <Switch
            id="marketing-toggle"
            checked={marketingOn}
            onCheckedChange={onToggleMarketing}
            disabled={savingMarketing || !me?.member}
          />
        </div>
      </Card>
      <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
    </div>
  );
}