import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Users, MessageCircle, Video, ClipboardCheck, Mail } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteCoach, getCoachSetupLink } from "@/lib/coaches.functions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/coaches/")({
  component: CoachesRedirect,
});

function CoachesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/team", search: { tab: "people" } as any, replace: true });
  }, [navigate]);
  return null;
}

function statusTone(s: string) {
  switch (s) {
    case "Active": return "bg-success/15 text-success border-success/30";
    case "Pending Invite": return "bg-warning/15 text-warning border-warning/30";
    case "Suspended": return "bg-destructive/15 text-destructive border-destructive/30";
    case "Inactive": return "bg-muted text-muted-foreground border-border";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export function CoachesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);

  const inviteFn = useServerFn(inviteCoach);
  const linkFn = useServerFn(getCoachSetupLink);

  if (role !== "admin") {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        This section is only available to the owner / full admin.
      </div>
    );
  }

  const { data: coaches = [], isLoading } = useQuery({
    queryKey: ["coaches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coaches").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-coach-workload"],
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, assigned_coach_id, status, archived")
        .eq("archived", false);
      return data ?? [];
    },
  });

  const workloadFor = (coachId: string) => {
    const assigned = clients.filter((c) => c.assigned_coach_id === coachId);
    return {
      total: assigned.length,
      active: assigned.filter((c) => c.status === "Active" || c.status === "New Client").length,
      attention: assigned.filter((c) => c.status === "Needs Attention" || c.status === "Check-In Overdue").length,
    };
  };

  const createCoach = async () => {
    if (!firstName.trim() || !email.trim()) {
      toast.error("First name and email are required");
      return;
    }
    setCreating(true);
    try {
      const full = `${firstName.trim()} ${lastName.trim()}`.trim();
      const { data: row, error } = await supabase.from("coaches").insert({
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        full_name: full,
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        status: "Pending Invite",
      }).select().single();
      if (error) throw error;

      // Try to send the email invite. Falls back gracefully if no email domain is set up.
      try {
        await inviteFn({ data: { coachId: row.id, redirectTo: `${window.location.origin}/setup` } });
        toast.success("Coach created and invite sent");
      } catch (e: any) {
        toast.success("Coach created", {
          description: "Couldn't send email invite — use 'Copy setup link' from the coach row.",
        });
      }
      setOpen(false);
      setFirstName(""); setLastName(""); setEmail(""); setPhone("");
      qc.invalidateQueries({ queryKey: ["coaches"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create coach");
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (coachId: string) => {
    const t = toast.loading("Generating setup link…");
    try {
      const { url } = await linkFn({ data: { coachId, redirectTo: `${window.location.origin}/setup` } });
      await navigator.clipboard.writeText(url);
      toast.success("Setup link copied to clipboard", { id: t });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    }
  };

  const resendInvite = async (coachId: string) => {
    const t = toast.loading("Sending invite…");
    try {
      await inviteFn({ data: { coachId, redirectTo: `${window.location.origin}/setup` } });
      toast.success("Invite sent", { id: t });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send invite", { id: t });
    }
  };

  return (
    <>
      {!embedded && <PageHeader
        title="Coaches"
        subtitle="Manage your coaching team. Only the owner can access this section."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary"><Plus className="mr-2 h-4 w-4" />Add coach</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a new coach</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
                <div><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
                <div className="col-span-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="col-span-2"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
              <p className="text-xs text-muted-foreground">
                An invite email will be sent automatically. If your email domain isn't set up yet,
                you can copy a setup link from the coach row instead.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={creating} onClick={createCoach} className="bg-gradient-primary">
                  {creating ? "Creating…" : "Create & invite"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />}
      <div className="space-y-3 p-6 md:p-8">
        {isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading coaches…</Card>
        ) : coaches.length === 0 ? (
          <Card className="p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">No coaches yet</p>
            <p className="text-xs text-muted-foreground">Add your first coach to start delegating client work.</p>
          </Card>
        ) : coaches.map((c) => {
          const w = workloadFor(c.id);
          return (
            <Card key={c.id} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-primary text-sm font-black text-primary-foreground">
                  {c.full_name?.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Link to="/admin/coaches/$id" params={{ id: c.id }} className="text-sm font-bold hover:underline">{c.full_name}</Link>
                    <Badge variant="outline" className={statusTone(c.status)}>{c.status}</Badge>
                    {c.archived ? <Badge variant="outline">Archived</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.email}{c.phone ? ` · ${c.phone}` : ""}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="text-center">
                  <div className="text-lg font-black">{w.total}</div>
                  <div className="uppercase tracking-wider text-muted-foreground">Clients</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-black text-success">{w.active}</div>
                  <div className="uppercase tracking-wider text-muted-foreground">Active</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-black text-warning">{w.attention}</div>
                  <div className="uppercase tracking-wider text-muted-foreground">Attention</div>
                </div>
                <div className="flex gap-2">
                  {c.status === "Pending Invite" || !c.user_id ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => resendInvite(c.id)}>
                        <Mail className="mr-2 h-3 w-3" />Send invite
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => copyLink(c.id)}>Copy link</Button>
                    </>
                  ) : null}
                  <Link to="/admin/coaches/$id" params={{ id: c.id }}>
                    <Button size="sm">Manage</Button>
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}