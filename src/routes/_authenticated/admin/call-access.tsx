import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, ExternalLink, Search, Plus, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/call-access")({ component: CallAccessPage });

function CallAccessPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled" | "no_phone">("all");
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addCoachOpen, setAddCoachOpen] = useState(false);

  const { data: clients, isLoading } = useQuery({
    queryKey: ["call-access-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, first_name, last_name, email, phone, call_access_enabled, sms_opt_out, assigned_coach_id, coach:assigned_coach_id(full_name)")
        .eq("archived", false)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: coaches } = useQuery({
    queryKey: ["call-access-coaches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coaches")
        .select("id, full_name, first_name, last_name, email, phone, status, archived")
        .eq("archived", false)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateClient = async (id: string, patch: Record<string, any>) => {
    const { error } = await supabase.from("clients").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["call-access-clients"] });
  };

  const updateCoach = async (id: string, patch: Record<string, any>) => {
    const { error } = await supabase.from("coaches").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["call-access-coaches"] });
  };

  const archiveCoach = async (id: string) => {
    if (!confirm("Archive this coach?")) return;
    const { error } = await supabase.from("coaches").update({ archived: true, archived_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Coach archived");
    qc.invalidateQueries({ queryKey: ["call-access-coaches"] });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients ?? []).filter((c: any) => {
      if (q && !(`${c.full_name ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase().includes(q))) return false;
      if (filter === "enabled" && !c.call_access_enabled) return false;
      if (filter === "disabled" && c.call_access_enabled) return false;
      if (filter === "no_phone" && c.phone) return false;
      return true;
    });
  }, [clients, search, filter]);

  const stats = useMemo(() => {
    const list = clients ?? [];
    return {
      total: list.length,
      enabled: list.filter((c: any) => c.call_access_enabled).length,
      callable: list.filter((c: any) => c.call_access_enabled && c.phone).length,
      noPhone: list.filter((c: any) => !c.phone).length,
    };
  }, [clients]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <PageHeader
        title="Call Access"
        subtitle="Manage who admins/coaches can dial straight from chat — plus contact info for clients, coaches, and admins."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Active clients</div><div className="text-2xl font-black">{stats.total}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Access enabled</div><div className="text-2xl font-black text-emerald-600">{stats.enabled}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Callable now</div><div className="text-2xl font-black">{stats.callable}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Missing phone</div><div className="text-2xl font-black text-amber-600">{stats.noPhone}</div></Card>
      </div>

      <Tabs defaultValue="clients" className="space-y-4">
        <TabsList>
          <TabsTrigger value="clients">Clients ({clients?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="coaches">Coaches &amp; Admins ({coaches?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search by name, email, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {(["all", "enabled", "disabled", "no_phone"] as const).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "enabled" ? "Enabled" : f === "disabled" ? "Disabled" : "No phone"}
                </Button>
              ))}
              <Button size="sm" onClick={() => setAddClientOpen(true)}><UserPlus className="mr-1 h-4 w-4" />Add contact</Button>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Name / Email</th>
                    <th className="px-3 py-2 text-left">Coach</th>
                    <th className="px-3 py-2 text-left">Phone</th>
                    <th className="px-3 py-2 text-left">Call</th>
                    <th className="px-3 py-2 text-left">SMS opt-out</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                  {!isLoading && filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No matching clients.</td></tr>}
                  {filtered.map((c: any) => {
                    const tel = c.phone ? String(c.phone).replace(/[^+\d]/g, "") : "";
                    return (
                      <tr key={c.id} className="border-t border-border align-middle">
                        <td className="px-3 py-2 min-w-[220px]">
                          <Input defaultValue={c.full_name ?? ""} className="h-8 text-sm font-semibold" placeholder="Full name"
                            onBlur={(e) => { if (e.target.value !== (c.full_name ?? "")) updateClient(c.id, { full_name: e.target.value }); }} />
                          <Input defaultValue={c.email ?? ""} className="h-7 text-[11px] mt-1" placeholder="email@example.com"
                            onBlur={(e) => { if (e.target.value !== (c.email ?? "")) updateClient(c.id, { email: e.target.value }); }} />
                        </td>
                        <td className="px-3 py-2 min-w-[160px]">
                          <Select value={c.assigned_coach_id ?? "none"} onValueChange={(v) => updateClient(c.id, { assigned_coach_id: v === "none" ? null : v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Unassigned</SelectItem>
                              {(coaches ?? []).map((co: any) => <SelectItem key={co.id} value={co.id}>{co.full_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <div className="flex items-center gap-1">
                            <Input defaultValue={c.phone ?? ""} placeholder="+15551234567" className="h-8 text-sm"
                              onBlur={(e) => { if (e.target.value !== (c.phone ?? "")) updateClient(c.id, { phone: e.target.value || null }); }} />
                            {tel && (
                              <Button asChild size="icon" variant="outline" className="h-8 w-8 shrink-0 border-emerald-500/40 text-emerald-600">
                                <a href={`tel:${tel}`} title={`Call ${c.full_name}`}><Phone className="h-4 w-4" /></a>
                              </Button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Switch checked={!!c.call_access_enabled} onCheckedChange={(v) => updateClient(c.id, { call_access_enabled: v })} />
                            {c.call_access_enabled && !c.phone && <Badge variant="outline" className="border-amber-500/40 text-amber-600">Add phone</Badge>}
                            {c.call_access_enabled && c.phone && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Live</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Switch checked={!!c.sms_opt_out} onCheckedChange={(v) => updateClient(c.id, { sms_opt_out: v })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            {c.call_access_enabled && tel && (
                              <Button asChild size="icon" variant="outline" className="h-8 w-8 border-emerald-500/40 text-emerald-600">
                                <a href={`tel:${tel}`} title={`Call ${c.full_name}`}><Phone className="h-4 w-4" /></a>
                              </Button>
                            )}
                            <Button asChild size="icon" variant="ghost" className="h-8 w-8">
                              <Link to="/admin/clients/$id" params={{ id: c.id }} title="Open profile">
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="coaches" className="space-y-4">
          <Card className="p-4 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm text-muted-foreground">Edit coach &amp; admin contact info. Phone numbers here power direct dialing for the team directory.</div>
            <Button size="sm" onClick={() => setAddCoachOpen(true)}><Plus className="mr-1 h-4 w-4" />Add coach</Button>
          </Card>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Phone</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(coaches ?? []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No coaches yet.</td></tr>}
                  {(coaches ?? []).map((co: any) => {
                    const tel = co.phone ? String(co.phone).replace(/[^+\d]/g, "") : "";
                    return (
                      <tr key={co.id} className="border-t border-border align-middle">
                        <td className="px-3 py-2 min-w-[200px]">
                          <Input defaultValue={co.full_name ?? ""} className="h-8 text-sm font-semibold"
                            onBlur={(e) => { if (e.target.value !== (co.full_name ?? "")) updateCoach(co.id, { full_name: e.target.value }); }} />
                        </td>
                        <td className="px-3 py-2 min-w-[200px]">
                          <Input defaultValue={co.email ?? ""} className="h-8 text-sm"
                            onBlur={(e) => { if (e.target.value !== (co.email ?? "")) updateCoach(co.id, { email: e.target.value }); }} />
                        </td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <Input required defaultValue={co.phone ?? ""} placeholder="+15551234567 (required)"
                            className={`h-8 text-sm ${!co.phone ? "border-destructive" : ""}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (!v) { toast.error("Coach phone is required"); e.target.value = co.phone ?? ""; return; }
                              if (v !== (co.phone ?? "")) updateCoach(co.id, { phone: v });
                            }} />
                        </td>
                        <td className="px-3 py-2 min-w-[140px]">
                          <Select value={co.status ?? "Active"} onValueChange={(v) => updateCoach(co.id, { status: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {["Active", "Pending Invite", "Paused", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            {tel && (
                              <Button asChild size="icon" variant="outline" className="h-8 w-8 border-emerald-500/40 text-emerald-600">
                                <a href={`tel:${tel}`} title={`Call ${co.full_name}`}><Phone className="h-4 w-4" /></a>
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => archiveCoach(co.id)}>Archive</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <AddClientDialog open={addClientOpen} onOpenChange={setAddClientOpen} coaches={coaches ?? []} onCreated={() => qc.invalidateQueries({ queryKey: ["call-access-clients"] })} />
      <AddCoachDialog open={addCoachOpen} onOpenChange={setAddCoachOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["call-access-coaches"] })} />
    </div>
  );
}

function AddClientDialog({ open, onOpenChange, coaches, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; coaches: any[]; onCreated: () => void; }) {
  const empty = { first_name: "", last_name: "", email: "", phone: "", assigned_coach_id: "none", call_access_enabled: true };
  const [f, setF] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.first_name || !f.email) return toast.error("First name and email required");
    setBusy(true);
    const full_name = `${f.first_name} ${f.last_name}`.trim();
    const { error } = await supabase.from("clients").insert({
      first_name: f.first_name, last_name: f.last_name || null, full_name,
      email: f.email.toLowerCase().trim(), phone: f.phone || null,
      assigned_coach_id: f.assigned_coach_id === "none" ? null : f.assigned_coach_id,
      call_access_enabled: !!f.call_access_enabled, status: "Active",
    } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Contact added");
    onOpenChange(false); onCreated();
    setF(empty);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add client contact</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>First name *</Label><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
            <div><Label>Last name</Label><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
          </div>
          <div><Label>Email *</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={f.phone} placeholder="+15551234567" onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><Label>Assigned coach</Label>
            <Select value={f.assigned_coach_id} onValueChange={(v) => setF({ ...f, assigned_coach_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {coaches.map((co) => <SelectItem key={co.id} value={co.id}>{co.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded border border-border p-2">
            <Label>Enable call access</Label>
            <Switch checked={!!f.call_access_enabled} onCheckedChange={(v) => setF({ ...f, call_access_enabled: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add contact"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCoachDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void; }) {
  const empty = { first_name: "", last_name: "", email: "", phone: "", status: "Active" };
  const [f, setF] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.first_name || !f.email || !f.phone) return toast.error("First name, email, and phone are required");
    setBusy(true);
    const full_name = `${f.first_name} ${f.last_name}`.trim();
    const { error } = await supabase.from("coaches").insert({
      first_name: f.first_name, last_name: f.last_name || null, full_name,
      email: f.email.toLowerCase().trim(), phone: f.phone.trim(), status: f.status,
    } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Coach added");
    onOpenChange(false); onCreated();
    setF(empty);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add coach</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>First name *</Label><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
            <div><Label>Last name</Label><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
          </div>
          <div><Label>Email *</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Phone *</Label><Input required value={f.phone} placeholder="+15551234567" onChange={(e) => setF({ ...f, phone: e.target.value })} /><p className="text-[11px] text-muted-foreground mt-1">Required — powers the team directory dial buttons.</p></div>
          <div><Label>Status</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Active", "Pending Invite", "Paused", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add coach"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}