import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createAppMember } from "@/lib/members.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { DefaultAccessChecklist } from "@/components/admin/jf-default-access-checklist";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/membership";
import { normalizePhoneToE164 } from "@/lib/phone-e164";
import { SetupSentPanel, type SetupOutcome } from "@/components/clients/setup-sent-panel";

export const Route = createFileRoute("/_authenticated/admin/members/new")({ component: NewMember });

function NewMember() {
  const navigate = useNavigate();
  const create = useServerFn(createAppMember);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState<{
    memberId: string; firstName: string; email: string; phone: string;
    emailed: SetupOutcome; texted: SetupOutcome; url: string;
  } | null>(null);
  const [accountType, setAccountType] = useState<AccountType>("jf_member");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: levels = [] } = useQuery({
    queryKey: ["access-levels"],
    queryFn: async () => (await supabase.from("access_levels").select("*").order("sort_order")).data ?? [],
  });

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleOverride = (k: string) => setOverrides((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = normalizePhoneToE164(phone);
    if (!cleanPhone) return toast.error("Enter a valid mobile number");
    setBusy(true);
    try {
      // initial_access_keys = explicit extras the admin checked, minus any defaults the admin overrode.
      const extras = Array.from(selected).filter((k) => !overrides.has(k));
      const res = await create({ data: {
        email, full_name: name, phone: cleanPhone, account_type: accountType,
        initial_access_keys: extras,
        apply_defaults: true,
      } });
      // If the admin unchecked any default rows, revoke them right after creation.
      if (overrides.size > 0) {
        const memberId = res.member.id;
        await supabase.from("member_access")
          .update({ active: false })
          .eq("member_id", memberId)
          .in("access_level_key", Array.from(overrides));
      }
      // Same onboarding as a coaching client: show how the setup link went out, with a
      // message ready to copy or text from the coach's own phone.
      setSent({
        memberId: res.member.id,
        firstName: name.trim().split(/\s+/)[0] || "there",
        email: res.member.email,
        phone: cleanPhone,
        emailed: res.emailed,
        texted: res.texted,
        url: res.setupUrl,
      });
    } catch (e: any) { toast.error(e?.message ?? "Couldn't create"); }
    finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="space-y-5">
        <PageHeader title={`Send ${sent.firstName}'s setup`} subtitle="Their account is ready. Here's how the setup link went out." />
        <Card className="max-w-xl space-y-4 p-6">
          <SetupSentPanel
            firstName={sent.firstName}
            email={sent.email}
            phone={sent.phone}
            emailed={sent.emailed}
            texted={sent.texted}
            url={sent.url}
            continueStep={false}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate({ to: "/admin/members/$memberId", params: { memberId: sent.memberId } })}>Open member</Button>
            <Link to="/admin/members"><Button variant="ghost">Done</Button></Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="New App Member" subtitle="They get their setup link by email and text straight away." />
      <form onSubmit={onSubmit}>
        <Card className="space-y-4 p-6">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><Label htmlFor="member-phone">Mobile number</Label><Input id="member-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(204) 555-0123" required /></div>
          <div>
            <Label>Account type</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={accountType} onChange={(e) => setAccountType(e.target.value as any)}>
              {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => (
                <option key={k} value={k}>{ACCOUNT_TYPES[k].label}</option>
              ))}
            </select>
          </div>

          <DefaultAccessChecklist
            accountType={accountType}
            overrides={overrides}
            onToggleOverride={toggleOverride}
          />

          <div>
            <Label>Extra access (optional)</Label>
            <div className="text-xs text-muted-foreground mb-2">
              Anything you check here is granted in addition to the defaults above.
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(levels as any[]).map((lv) => (
                <label key={lv.key} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <Checkbox checked={selected.has(lv.key)} onCheckedChange={() => toggle(lv.key)} />
                  <span>{lv.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Creating & sending…" : "Create & send setup"}</Button>
            <Link to="/admin/members"><Button type="button" variant="ghost">Cancel</Button></Link>
          </div>
        </Card>
      </form>
    </div>
  );
}