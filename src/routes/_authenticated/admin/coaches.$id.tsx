import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, UserPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { assignClientToCoach, setCoachStatus } from "@/lib/coaches.functions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/coaches/$id")({
  component: CoachDetailPage,
});

function CoachDetailPage() {
  const { id } = useParams({ from: "/_authenticated/admin/coaches/$id" });
  const { role } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const assignFn = useServerFn(assignClientToCoach);
  const statusFn = useServerFn(setCoachStatus);

  if (role !== "admin") {
    return <div className="p-8 text-sm text-muted-foreground">Admin only.</div>;
  }

  const { data: coach } = useQuery({
    queryKey: ["coach", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("coaches").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allClients = [] } = useQuery({
    queryKey: ["clients-assignable"],
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, full_name, email, status, assigned_coach_id")
        .eq("archived", false)
        .order("full_name");
      return data ?? [];
    },
  });

  const assigned = allClients.filter((c) => c.assigned_coach_id === id);
  const unassignedOrOther = allClients.filter((c) => c.assigned_coach_id !== id);
  const filteredOther = useMemo(() => {
    if (!search.trim()) return unassignedOrOther.slice(0, 20);
    const q = search.toLowerCase();
    return unassignedOrOther.filter((c) =>
      c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [unassignedOrOther, search]);

  const assign = async (clientId: string) => {
    try {
      await assignFn({ data: { clientId, coachId: id } });
      toast.success("Client assigned");
      qc.invalidateQueries({ queryKey: ["clients-assignable"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const unassign = async (clientId: string) => {
    try {
      await assignFn({ data: { clientId, coachId: null } });
      toast.success("Client unassigned");
      qc.invalidateQueries({ queryKey: ["clients-assignable"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const changeStatus = async (status: string) => {
    try {
      await statusFn({ data: { coachId: id, status: status as any } });
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["coach", id] });
      qc.invalidateQueries({ queryKey: ["coaches"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  if (!coach) return <div className="p-8 text-sm text-muted-foreground">Loading coach…</div>;

  return (
    <>
      <PageHeader
        title={coach.full_name}
        subtitle={coach.email}
        actions={
          <Link to="/admin/coaches"><Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-3 w-3" />All coaches</Button></Link>
        }
      />
      <div className="grid gap-4 p-6 md:grid-cols-3 md:p-8">
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile</h3>
          <div className="mt-3 space-y-2 text-sm">
            <div><span className="text-muted-foreground">Name: </span>{coach.full_name}</div>
            <div><span className="text-muted-foreground">Email: </span>{coach.email}</div>
            {coach.phone ? <div><span className="text-muted-foreground">Phone: </span>{coach.phone}</div> : null}
            <div><span className="text-muted-foreground">Started: </span>{coach.start_date ?? "—"}</div>
            <div><span className="text-muted-foreground">Last login: </span>{coach.last_login_at ? new Date(coach.last_login_at).toLocaleString() : "—"}</div>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Status</h3>
          <div className="mt-3">
            <Badge variant="outline">{coach.status}</Badge>
          </div>
          <div className="mt-3">
            <Select value={coach.status} onValueChange={changeStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Active", "Inactive", "Pending Invite", "Suspended", "Archived"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Workload</h3>
          <div className="mt-3 flex gap-4">
            <div><div className="text-2xl font-black">{assigned.length}</div><div className="text-xs uppercase text-muted-foreground">Clients</div></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 p-6 md:grid-cols-2 md:p-8">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Assigned clients ({assigned.length})</h3>
          {assigned.length === 0 ? (
            <p className="text-xs text-muted-foreground">No clients assigned to this coach yet.</p>
          ) : (
            <ul className="space-y-2">
              {assigned.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-2">
                  <div>
                    <Link to="/admin/clients/$id" params={{ id: c.id }} className="text-sm font-semibold hover:underline">{c.full_name}</Link>
                    <div className="text-[11px] text-muted-foreground">{c.email}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => unassign(c.id)}>
                    <UserMinus className="mr-1 h-3 w-3" />Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Assign clients</h3>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search clients…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="space-y-2 max-h-96 overflow-auto">
            {filteredOther.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-2">
                <div>
                  <div className="text-sm font-semibold">{c.full_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.email}{c.assigned_coach_id ? " · currently assigned to another coach" : ""}
                  </div>
                </div>
                <Button size="sm" onClick={() => assign(c.id)}>
                  <UserPlus className="mr-1 h-3 w-3" />Assign
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}