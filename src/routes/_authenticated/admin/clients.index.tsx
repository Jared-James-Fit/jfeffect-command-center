import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, MoreHorizontal, Mail, Archive, Trash2, KeyRound, Dumbbell, Apple, HeartPulse, Folder, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteClient, archiveClient, deleteClient, sendPasswordReset } from "@/lib/clients.functions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import { deriveTarget } from "@/lib/nutrition-cardio";
import { format, parseISO } from "date-fns";
import type { ConversationState, Message } from "@/lib/messages";
function AddCell({ id, tab, label }: { id: string; tab: "training" | "nutrition" | "cardio"; label: string }) {
  return (
    <Link to="/admin/clients/$id" params={{ id }} search={{ tab }} className="text-xs font-semibold text-primary hover:underline">
      + {label}
    </Link>
  );
}


export const Route = createFileRoute("/_authenticated/admin/clients/")({
  component: ClientsPage,
});

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Archived", "High Priority"];
const TYPES = ["Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting", "Bodybuilding", "Fat Loss", "Muscle Gain", "Lifestyle"];

function ClientsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{ id: string; name: string; step: 1 | 2 } | null>(null);

  const inviteFn = useServerFn(inviteClient);
  const archiveFn = useServerFn(archiveClient);
  const deleteFn = useServerFn(deleteClient);
  const resetFn = useServerFn(sendPasswordReset);

  const sendSetup = async (id: string) => {
    const t = toast.loading("Sending setup link…");
    try {
      const redirectTo = `${window.location.origin}/setup`;
      await inviteFn({ data: { clientId: id, redirectTo } });
      toast.success("Setup link sent", { id: t });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send setup link", { id: t });
    }
  };

  const sendReset = async (id: string) => {
    const t = toast.loading("Sending reset link…");
    try {
      await resetFn({ data: { clientId: id, redirectTo: `${window.location.origin}/reset-password` } });
      toast.success("Password reset email sent", { id: t });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    }
  };

  const toggleArchive = async (id: string, archived: boolean) => {
    try {
      await archiveFn({ data: { clientId: id, archived: !archived } });
      toast.success(archived ? "Restored" : "Archived");
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    try {
      await deleteFn({ data: { clientId: deleteState.id, deleteAuthUser: true } });
      toast.success("Client deleted");
      setDeleteState(null);
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: phases = [] } = useQuery({
    queryKey: ["training-phases", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_phases").select("*").order("start_date", { ascending: false });
      if (error) throw error;
      return data as TrainingPhase[];
    },
  });

  const { data: nutTargets = [] } = useQuery({
    queryKey: ["nutrition-targets", "all-status"],
    queryFn: async () => {
      const { data } = await supabase.from("nutrition_targets").select("id, client_id, start_date, end_date, status, ending_soon_days").neq("status", "Archived");
      return data ?? [];
    },
  });

  const { data: cardTargets = [] } = useQuery({
    queryKey: ["cardio-targets", "all-status"],
    queryFn: async () => {
      const { data } = await supabase.from("cardio_targets").select("id, client_id, start_date, end_date, status, ending_soon_days").neq("status", "Archived");
      return data ?? [];
    },
  });

  const { data: convStates = [] } = useQuery({
    queryKey: ["conversation-states"],
    queryFn: async () => {
      const { data } = await (supabase.from("conversation_state") as any).select("*");
      return (data ?? []) as ConversationState[];
    },
  });

  const { data: recentMsgs = [] } = useQuery({
    queryKey: ["recent-client-messages"],
    queryFn: async () => {
      const { data } = await (supabase.from("messages") as any)
        .select("client_id, created_at, sender_role, is_internal_note")
        .eq("is_internal_note", false)
        .order("created_at", { ascending: false })
        .limit(500);
      return (data ?? []) as Message[];
    },
  });

  const phaseByClient = useMemo(() => {
    const map = new Map<string, { current?: TrainingPhase; next?: TrainingPhase }>();
    for (const p of phases) {
      const d = derivePhase(p);
      const entry = map.get(p.client_id) ?? {};
      if (!entry.current && ["active", "ending-soon", "due-today", "past-due"].includes(d.state)) entry.current = p;
      else if (!entry.next && d.state === "upcoming") entry.next = p;
      map.set(p.client_id, entry);
    }
    return map;
  }, [phases]);

  const nutByClient = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of nutTargets) if (!m.has(t.client_id)) m.set(t.client_id, t);
    return m;
  }, [nutTargets]);

  const cardByClient = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of cardTargets) if (!m.has(t.client_id)) m.set(t.client_id, t);
    return m;
  }, [cardTargets]);

  const msgInfoByClient = useMemo(() => {
    const stateMap = new Map(convStates.map((s) => [s.client_id, s]));
    const last = new Map<string, Message>();
    const unread = new Map<string, number>();
    for (const m of recentMsgs) {
      if (!last.has(m.client_id)) last.set(m.client_id, m);
      if (m.sender_role === "client") {
        const s = stateMap.get(m.client_id);
        const lr = s?.admin_last_read_at ? new Date(s.admin_last_read_at).getTime() : 0;
        if (new Date(m.created_at).getTime() > lr) unread.set(m.client_id, (unread.get(m.client_id) ?? 0) + 1);
      }
    }
    return { stateMap, last, unread };
  }, [convStates, recentMsgs]);

  const filtered = clients.filter((c) => {
    const matchesSearch = !search || c.full_name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} total · ${clients.filter((c) => !c.archived).length} active`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> Add Client
              </Button>
            </DialogTrigger>
            <NewClientDialog
              onClose={() => setOpen(false)}
              onCreated={(newId, email, sendInvite) => {
                qc.invalidateQueries({ queryKey: ["clients"] });
                if (email && sendInvite) sendSetup(newId);
              }}
            />
          </Dialog>
        }
      />
      <div className="space-y-4 p-6 md:p-8">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border bg-card">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No clients match your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 min-w-[260px]">Current Phase</th>
                    <th className="px-4 py-3">Next Phase</th>
                    <th className="px-4 py-3">Nutrition</th>
                    <th className="px-4 py-3">Cardio</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Messages</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const ph = phaseByClient.get(c.id);
                    const current = ph?.current;
                    const next = ph?.next;
                    const dCur = current ? derivePhase(current) : null;
                    const nut = nutByClient.get(c.id);
                    const card = cardByClient.get(c.id);
                    const dNut = nut ? deriveTarget(nut) : null;
                    const dCard = card ? deriveTarget(card) : null;
                    return (
                    <tr key={c.id} className="border-b border-border/50 transition hover:bg-secondary/30 align-top">
                      <td className="px-4 py-3">
                        <Link to="/admin/clients/$id" params={{ id: c.id }} className="font-semibold hover:text-primary">{c.full_name}</Link>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.coaching_type ?? "—"}</td>
                      <td className="px-4 py-3">
                        {current && dCur ? (
                          <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "training" }} className="block space-y-1.5 min-w-[240px] hover:opacity-80">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold truncate max-w-[160px]">{displayTitle(current)}</span>
                              <Badge variant="outline" className={toneClasses(dCur.tone)}>{dCur.label}</Badge>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {format(parseISO(current.start_date), "MMM d")} → {format(parseISO(current.end_date), "MMM d")}
                              {" · "}
                              {dCur.daysRemaining < 0 ? `${Math.abs(dCur.daysRemaining)}d over` : `${dCur.daysRemaining}d left`}
                              {" · "}{dCur.percentComplete}%
                            </div>
                            <Progress value={dCur.percentComplete} className="h-1" />
                          </Link>
                        ) : <AddCell id={c.id} tab="training" label="Add Training Phase" />}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {next ? (
                          <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "training" }} className="block hover:opacity-80">
                            <div className="font-medium truncate max-w-[140px]">{displayTitle(next)}</div>
                            <div className="text-[10px] text-muted-foreground">{format(parseISO(next.start_date), "MMM d")}</div>
                          </Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {dNut ? (
                          <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "nutrition" }}>
                            <Badge variant="outline" className={`${dNut.tone} cursor-pointer hover:opacity-80`}>{dNut.label}</Badge>
                          </Link>
                        ) : <AddCell id={c.id} tab="nutrition" label="Add Nutrition Targets" />}
                      </td>
                      <td className="px-4 py-3">
                        {dCard ? (
                          <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "cardio" }}>
                            <Badge variant="outline" className={`${dCard.tone} cursor-pointer hover:opacity-80`}>{dCard.label}</Badge>
                          </Link>
                        ) : <AddCell id={c.id} tab="cardio" label="Add Cardio Targets" />}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.payment_status ?? "—"}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const u = msgInfoByClient.unread.get(c.id) ?? 0;
                          const last = msgInfoByClient.last.get(c.id);
                          const s = msgInfoByClient.stateMap.get(c.id);
                          return (
                            <Link to="/admin/messages" search={{ client: c.id }} className="block space-y-0.5 hover:opacity-80">
                              <div className="flex items-center gap-1.5">
                                <MessageCircle className="h-3 w-3 text-muted-foreground" />
                                {u > 0 ? (
                                  <Badge className="h-4 min-w-4 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{u} unread</Badge>
                                ) : last ? (
                                  <span className="text-[10px] text-muted-foreground">{format(parseISO(last.created_at), "MMM d")}</span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
                              </div>
                              {s?.status === "needs_response" && (
                                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[9px]">Needs Response</Badge>
                              )}
                            </Link>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3"><Badge variant="outline">{c.status}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Manage</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "training" }}>
                                <Dumbbell className="mr-2 h-4 w-4" /> Manage Training
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "nutrition" }}>
                                <Apple className="mr-2 h-4 w-4" /> Manage Nutrition Targets
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "cardio" }}>
                                <HeartPulse className="mr-2 h-4 w-4" /> Manage Cardio Targets
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "documents" }}>
                                <Folder className="mr-2 h-4 w-4" /> Manage Documents
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => sendSetup(c.id)} disabled={!c.email}>
                              <Mail className="mr-2 h-4 w-4" /> Send setup link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => sendReset(c.id)} disabled={!c.email}>
                              <KeyRound className="mr-2 h-4 w-4" /> Send password reset
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleArchive(c.id, c.archived)}>
                              <Archive className="mr-2 h-4 w-4" /> {c.archived ? "Restore" : "Archive"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteState({ id: c.id, name: c.full_name, step: 1 })}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete account
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <AlertDialog open={!!deleteState} onOpenChange={(o) => !o && setDeleteState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteState?.step === 1 ? `Delete ${deleteState?.name}?` : "Are you absolutely sure?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteState?.step === 1
                ? "This will permanently remove the client record and their login. You'll be asked to confirm one more time."
                : "This action cannot be undone. The client's account, login, and all associated records will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleteState?.step === 1 ? (
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); setDeleteState((s) => s ? { ...s, step: 2 } : s); }}
              >
                Continue
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              >
                Yes, delete permanently
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NewClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, email: string, sendInvite: boolean) => void }) {
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", instagram: "",
    coaching_type: TYPES[0], status: "New Client", coaching_package: "",
  });
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.from("clients").insert(form).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Client created");
    onCreated(data!.id, form.email, sendInvite);
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Full name *</Label>
            <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>Instagram</Label><Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} /></div>
          <div>
            <Label>Coaching type</Label>
            <Select value={form.coaching_type} onValueChange={(v) => setForm({ ...form, coaching_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>Coaching package</Label><Input value={form.coaching_package} onChange={(e) => setForm({ ...form, coaching_package: e.target.value })} /></div>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-sm">
          <Checkbox checked={sendInvite} onCheckedChange={(v) => setSendInvite(v === true)} />
          <span className="font-medium">Send account setup email now</span>
          <span className="ml-auto text-xs text-muted-foreground">Requires email</span>
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} className="bg-gradient-primary font-bold uppercase">{busy ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}