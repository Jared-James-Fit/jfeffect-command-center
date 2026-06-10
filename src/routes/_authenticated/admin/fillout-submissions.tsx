import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ClipboardList, ExternalLink, UserCheck, Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/fillout-submissions")({
  component: FilloutSubmissionsPage,
});

type Sub = {
  id: string;
  form_id: string | null;
  client_id: string | null;
  fillout_submission_id: string | null;
  fillout_form_id: string | null;
  form_name: string | null;
  form_type: string | null;
  response_json: any;
  submitted_at: string | null;
  unread: boolean;
  unmatched: boolean;
  unmatch_reason: string | null;
  created_at: string;
};

function FilloutSubmissionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"unmatched" | "all">("unmatched");
  const [viewing, setViewing] = useState<Sub | null>(null);
  const [assigning, setAssigning] = useState<Sub | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fillout-submissions", tab],
    queryFn: async () => {
      let q = (supabase as any)
        .from("fillout_submissions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (tab === "unmatched") q = q.eq("unmatched", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Sub[];
    },
  });

  const clientIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client_id).filter(Boolean))) as string[],
    [rows],
  );
  const { data: clientsById = {} } = useQuery({
    queryKey: ["fillout-clients", clientIds.join(",")],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, email").in("id", clientIds);
      const m: Record<string, { full_name: string | null; email: string | null }> = {};
      for (const c of (data ?? []) as any[]) m[c.id] = { full_name: c.full_name, email: c.email };
      return m;
    },
  });

  async function markRead(s: Sub) {
    if (!s.unread) return;
    await (supabase as any).from("fillout_submissions").update({ unread: false }).eq("id", s.id);
    qc.invalidateQueries({ queryKey: ["fillout-submissions"] });
  }

  const unmatchedCount = useMemo(() => rows.filter((r) => r.unmatched).length, [rows]);

  return (
    <>
      <PageHeader
        title="Fillout Submissions"
        subtitle="External form responses received from Fillout. Unmatched submissions need a client assigned."
      />
      <div className="space-y-4 p-4 md:p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="unmatched">
              <Inbox className="mr-2 h-4 w-4" />
              Needs Review {tab === "unmatched" && unmatchedCount > 0 && (
                <Badge variant="destructive" className="ml-2">{unmatchedCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all">All Submissions</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {isLoading ? (
              <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
            ) : rows.length === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                <ClipboardList className="mx-auto mb-3 h-8 w-8 opacity-40" />
                No submissions yet.
              </Card>
            ) : (
              <div className="space-y-2">
                {rows.map((s) => {
                  const client = s.client_id ? clientsById[s.client_id] : null;
                  return (
                    <Card key={s.id} className="flex flex-wrap items-center gap-3 border-border bg-card p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{s.form_name || "Untitled form"}</span>
                          {s.form_type && <Badge variant="outline" className="text-[10px]">{s.form_type}</Badge>}
                          {s.unread && <Badge className="text-[10px]">Unread</Badge>}
                          {s.unmatched && <Badge variant="destructive" className="text-[10px]">Unmatched</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {s.unmatched ? (
                            <span>Reason: {s.unmatch_reason ?? "unknown"}</span>
                          ) : client ? (
                            <Link
                              to="/admin/clients/$id"
                              params={{ id: s.client_id! }}
                              className="hover:underline"
                            >
                              {client.full_name ?? client.email ?? s.client_id}
                            </Link>
                          ) : (
                            <span>{s.client_id}</span>
                          )}
                          {s.submitted_at && (
                            <span className="ml-2">· {new Date(s.submitted_at).toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setViewing(s); markRead(s); }}>
                          View
                        </Button>
                        {s.unmatched && (
                          <Button size="sm" onClick={() => setAssigning(s)}>
                            <UserCheck className="mr-1 h-3.5 w-3.5" /> Assign to client
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <ViewDialog sub={viewing} onClose={() => setViewing(null)} />
      <AssignDialog
        sub={assigning}
        onClose={() => setAssigning(null)}
        onAssigned={() => qc.invalidateQueries({ queryKey: ["fillout-submissions"] })}
      />
    </>
  );
}

function ViewDialog({ sub, onClose }: { sub: Sub | null; onClose: () => void }) {
  const open = !!sub;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{sub?.form_name || "Submission"}</DialogTitle></DialogHeader>
        {sub && (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-muted-foreground">
              Submitted: {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "—"}
            </div>
            {Array.isArray(sub.response_json?.questions) ? (
              <div className="space-y-2">
                {sub.response_json.questions.map((q: any, i: number) => (
                  <div key={q.id ?? i} className="rounded border border-border p-2">
                    <div className="text-xs font-semibold">{q.name}</div>
                    <div className="whitespace-pre-wrap text-sm">{String(q.value ?? "")}</div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(sub.response_json, null, 2)}
              </pre>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ sub, onClose, onAssigned }: { sub: Sub | null; onClose: () => void; onAssigned: () => void }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["fillout-client-search", search],
    enabled: !!sub,
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name, email").eq("archived", false).limit(50);
      if (search.trim()) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
      const { data } = await q;
      return (data ?? []) as any[];
    },
  });

  async function assign() {
    if (!sub || !selected) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("fillout_submissions")
        .update({
          client_id: selected,
          unmatched: false,
          unmatch_reason: null,
          assigned_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
      if (error) throw error;
      toast.success("Assigned to client");
      onAssigned();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not assign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!sub} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Assign submission to client</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger><SelectValue placeholder="Pick a client" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name ?? "(no name)"} {c.email ? `· ${c.email}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={assign} disabled={!selected || saving}>
            {saving ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}