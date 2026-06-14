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
  const [emailOn, setEmailOn] = useState(false);
  const [smsOn, setSmsOn] = useState(false);
  const [savingKey, setSavingKey] = useState<null | "email" | "sms">(null);
  useEffect(() => {
    if (me?.member) {
      setEmailOn(!!me.member.email_marketing_opt_in);
      setSmsOn(!me.member.sms_opt_out);
    }
  }, [me?.member?.id, me?.member?.email_marketing_opt_in, me?.member?.sms_opt_out]);
  const onToggleEmail = async (next: boolean) => {
    setEmailOn(next);
    setSavingKey("email");
    try {
      await saveMarketing({ data: { email_marketing_opt_in: next } });
      qc.invalidateQueries({ queryKey: ["m-me"] });
      toast.success(next ? "Email updates turned on" : "Email updates turned off");
    } catch (e: any) {
      setEmailOn(!next);
      toast.error(e?.message ?? "Couldn't save preference");
    } finally {
      setSavingKey(null);
    }
  };
  const onToggleSms = async (next: boolean) => {
    setSmsOn(next);
    setSavingKey("sms");
    try {
      await saveMarketing({ data: { sms_marketing_on: next } });
      qc.invalidateQueries({ queryKey: ["m-me"] });
      toast.success(next ? "Text updates turned on" : "Text updates turned off");
    } catch (e: any) {
      setSmsOn(!next);
      toast.error(e?.message ?? "Couldn't save preference");
    } finally {
      setSavingKey(null);
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
        <div className="mt-3 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="email-marketing-toggle" className="text-sm font-semibold">
                Email me occasional coaching updates and offers.
              </Label>
            </div>
            <Switch
              id="email-marketing-toggle"
              checked={emailOn}
              onCheckedChange={onToggleEmail}
              disabled={savingKey !== null || !me?.member}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="sms-marketing-toggle" className="text-sm font-semibold">
                Text me occasional coaching updates and offers.
              </Label>
            </div>
            <Switch
              id="sms-marketing-toggle"
              checked={smsOn}
              onCheckedChange={onToggleSms}
              disabled={savingKey !== null || !me?.member}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Optional. You can change these preferences or unsubscribe at any time.
          </p>
        </div>
      </Card>
      <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
    </div>
  );
}