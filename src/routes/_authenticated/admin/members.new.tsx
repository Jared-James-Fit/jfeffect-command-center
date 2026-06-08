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

export const Route = createFileRoute("/_authenticated/admin/members/new")({ component: NewMember });

function NewMember() {
  const navigate = useNavigate();
  const create = useServerFn(createAppMember);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<"app_member" | "program_only">("app_member");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: levels = [] } = useQuery({
    queryKey: ["access-levels"],
    queryFn: async () => (await supabase.from("access_levels").select("*").order("sort_order")).data ?? [],
  });

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await create({ data: { email, full_name: name, account_type: accountType, initial_access_keys: Array.from(selected) } });
      toast.success("Member created");
      navigate({ to: "/admin/members/$memberId", params: { memberId: res.member.id } });
    } catch (e: any) { toast.error(e?.message ?? "Couldn't create"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="New App Member" subtitle="Create a member manually. You can send the setup link after." />
      <form onSubmit={onSubmit}>
        <Card className="space-y-4 p-6">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div>
            <Label>Account type</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={accountType} onChange={(e) => setAccountType(e.target.value as any)}>
              <option value="app_member">App Member</option>
              <option value="program_only">Program-Only</option>
            </select>
          </div>
          <div>
            <Label>Initial access</Label>
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
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create member"}</Button>
            <Link to="/admin/members"><Button type="button" variant="ghost">Cancel</Button></Link>
          </div>
        </Card>
      </form>
    </div>
  );
}