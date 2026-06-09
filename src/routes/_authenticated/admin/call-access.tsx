import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, ExternalLink, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/call-access")({ component: CallAccessPage });

function CallAccessPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled" | "no_phone">("all");

  const { data: clients, isLoading } = useQuery({
    queryKey: ["call-access-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, phone, call_access_enabled, sms_opt_out, assigned_coach_id, coaches:assigned_coach_id(name)")
        .eq("archived", false)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = async (id: string, v: boolean) => {
    const { error } = await supabase.from("clients").update({ call_access_enabled: v }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(v ? "Call access enabled" : "Call access disabled");
    qc.invalidateQueries({ queryKey: ["call-access-clients"] });
  };

  const updatePhone = async (id: string, phone: string) => {
    const { error } = await supabase.from("clients").update({ phone: phone || null }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["call-access-clients"] });
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
        subtitle="Decide which clients can be dialed straight from the chat. The Call button only appears in chat when access is on AND a phone number is on file."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Active clients</div><div className="text-2xl font-black">{stats.total}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Access enabled</div><div className="text-2xl font-black text-emerald-600">{stats.enabled}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Callable now</div><div className="text-2xl font-black">{stats.callable}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Missing phone</div><div className="text-2xl font-black text-amber-600">{stats.noPhone}</div></Card>
      </div>

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
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Coach</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Call access</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No matching clients.</td></tr>}
              {filtered.map((c: any) => {
                const tel = c.phone ? String(c.phone).replace(/[^+\d]/g, "") : "";
                return (
                  <tr key={c.id} className="border-t border-border align-middle">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{c.full_name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{c.email}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.coaches?.name ?? <span className="italic">unassigned</span>}</td>
                    <td className="px-3 py-2 min-w-[180px]">
                      <Input
                        defaultValue={c.phone ?? ""}
                        placeholder="+15551234567"
                        className="h-8 text-sm"
                        onBlur={(e) => { if (e.target.value !== (c.phone ?? "")) updatePhone(c.id, e.target.value); }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Switch checked={!!c.call_access_enabled} onCheckedChange={(v) => toggle(c.id, v)} />
                        {c.call_access_enabled && !c.phone && <Badge variant="outline" className="border-amber-500/40 text-amber-600">Add phone</Badge>}
                        {c.call_access_enabled && c.phone && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Live</Badge>}
                      </div>
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
    </div>
  );
}