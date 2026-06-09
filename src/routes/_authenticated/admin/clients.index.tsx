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
import { PowerlifterBadge } from "@/components/powerlifter-badge";
import { UserAvatar } from "@/components/user-avatar";
import { format, parseISO, differenceInDays } from "date-fns";
import type { ConversationState, Message } from "@/lib/messages";
import { QuickAssignTemplateDialog } from "@/components/quick-assign-template-dialog";
import { ClientMobileCard } from "@/components/clients-mobile-card";
import { PriceCardPickerDialog } from "@/components/price-card-picker-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SlidersHorizontal } from "lucide-react";

function summarizeCardio(list: any[]): string {
  if (!list || list.length === 0) return "";
  const dayTypes = Array.from(new Set(list.map((t) => t.day_type).filter((d) => d && d !== "General")));
  if (dayTypes.length > 0) {
    return dayTypes.map((d) => (d === "Custom" ? "Custom" : `${d}`)).join(" + ") + " Cardio";
  }
  const t = list[0];
  const parts: string[] = [];
  if (t.frequency_per_week) parts.push(`${t.frequency_per_week}x/wk`);
  if (t.intensity) parts.push(t.intensity);
  return parts.join(" · ");
}

function daysSinceUpdated(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return differenceInDays(new Date(), new Date(dateStr));
}

function nutritionUpdateTone(days: number | null): { tone: string; label: string } | null {
  if (days === null) return null;
  if (days >= 30) return { tone: "border-destructive/40 bg-destructive/10 text-destructive", label: `${days}d overdue` };
  if (days >= 20) return { tone: "border-orange-400/40 bg-orange-400/10 text-orange-500", label: `${days}d due` };
  if (days >= 14) return { tone: "border-warning/40 bg-warning/10 text-warning", label: `${days}d due` };
  return null;
}

type BlockDerived = {
  state: "completed" | "archived" | "past-due" | "due-today" | "ending-soon" | "active" | "upcoming" | "unscheduled";
  label: string;
  tone: "green" | "yellow" | "red" | "grey" | "blue";
  daysRemaining: number | null;
  daysUntilStart: number | null;
  percentComplete: number;
};

function deriveBlock(b: any, today = new Date()): BlockDerived {
  const status = (b?.status ?? "").toLowerCase();
  const start = b?.start_date ? parseISO(b.start_date) : null;
  const end = b?.end_date ? parseISO(b.end_date) : null;
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  if (status === "completed" || status === "manually completed")
    return { state: "completed", label: "Completed", tone: "grey", daysRemaining: null, daysUntilStart: null, percentComplete: 100 };
  if (status === "archived")
    return { state: "archived", label: "Archived", tone: "grey", daysRemaining: null, daysUntilStart: null, percentComplete: 0 };
  if (!start || !end)
    return { state: "unscheduled", label: status === "active" ? "Active · No dates" : "Unscheduled", tone: "grey", daysRemaining: null, daysUntilStart: null, percentComplete: 0 };
  const totalDays = Math.max(1, differenceInDays(end, start) + 1);
  const elapsed = differenceInDays(t, start) + 1;
  const daysRemaining = differenceInDays(end, t);
  const daysUntilStart = differenceInDays(start, t);
  const percentComplete = Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));
  if (daysUntilStart > 0)
    return { state: "upcoming", label: daysUntilStart === 1 ? "Starts Tomorrow" : `Starts in ${daysUntilStart}d`, tone: "blue", daysRemaining, daysUntilStart, percentComplete: 0 };
  if (daysRemaining < 0)
    return { state: "past-due", label: `Past Due · ${Math.abs(daysRemaining)}d over`, tone: "red", daysRemaining, daysUntilStart, percentComplete: 100 };
  if (daysRemaining === 0)
    return { state: "due-today", label: "Due Today", tone: "red", daysRemaining, daysUntilStart, percentComplete };
  if (daysRemaining <= 7)
    return { state: "ending-soon", label: `Ending Soon · ${daysRemaining}d`, tone: "yellow", daysRemaining, daysUntilStart, percentComplete };
  return { state: "active", label: "Active", tone: "green", daysRemaining, daysUntilStart, percentComplete };
}

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

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Deactivated", "Archived", "High Priority"];
const TYPES = ["Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting", "Bodybuilding", "Fat Loss", "Muscle Gain", "Lifestyle"];

function ClientsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sellTo, setSellTo] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{ id: string; name: string; step: 1 | 2 } | null>(null);
  const [assignTo, setAssignTo] = useState<{ id: string; name: string } | null>(null);

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
      const { data } = await supabase.from("nutrition_targets").select("id, client_id, start_date, end_date, status, ending_soon_days, updated_at").neq("status", "Archived");
      return data ?? [];
    },
  });

  const { data: cardTargets = [] } = useQuery({
    queryKey: ["cardio-targets", "all-status"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cardio_targets")
        .select("id, client_id, start_date, end_date, status, ending_soon_days, day_type, cardio_type, frequency_per_week, intensity, enabled")
        .neq("status", "Archived");
      return data ?? [];
    },
  });

  const { data: blocksAll = [] } = useQuery({
    queryKey: ["pl-blocks", "all-clients"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_blocks")
        .select("id, client_id, name, status, start_date, end_date, weeks, sort_order, archived, training_focus")
        .eq("archived", false)
        .neq("status", "Archived")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
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

  const { data: activePurchases = [] } = useQuery({
    queryKey: ["active-purchases-by-client"],
    queryFn: async () => (await supabase
      .from("purchase_records")
      .select("client_id, status")
      .eq("status", "Active")).data ?? [],
  });
  const activeProductSet = useMemo(() => new Set((activePurchases as any[]).map((p) => p.client_id)), [activePurchases]);

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
    const m = new Map<string, any[]>();
    for (const t of cardTargets) {
      if (t.enabled === false) continue;
      const list = m.get(t.client_id) ?? [];
      list.push(t);
      m.set(t.client_id, list);
    }
    return m;
  }, [cardTargets]);

  const blocksByClient = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map<string, { current?: any; next?: any }>();
    const byClient = new Map<string, any[]>();
    for (const b of blocksAll as any[]) {
      const list = byClient.get(b.client_id) ?? [];
      list.push(b);
      byClient.set(b.client_id, list);
    }
    for (const [cid, list] of byClient.entries()) {
      const current = list.find((b) => b.status === "Active")
        ?? list.find((b) => {
          if (!b.start_date || !b.end_date) return false;
          const s = new Date(b.start_date); const e = new Date(b.end_date);
          return s <= today && today <= e;
        });
      const next = list
        .filter((b) => b !== current)
        .filter((b) => b.status === "Planned" || b.status === "Draft" || (b.start_date && new Date(b.start_date) > today))
        .sort((a, b) => {
          const ad = a.start_date ? new Date(a.start_date).getTime() : Number.POSITIVE_INFINITY;
          const bd = b.start_date ? new Date(b.start_date).getTime() : Number.POSITIVE_INFINITY;
          if (ad !== bd) return ad - bd;
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        })[0];
      map.set(cid, { current, next });
    }
    return map;
  }, [blocksAll]);

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

  const setupNeededFn = (c: any) =>
    !c.account_created_at && (c.invite_sent_at || c.needs_admin_help || (c.invite_expires_at && new Date(c.invite_expires_at).getTime() < Date.now()));

  const programEndingFn = (c: any) => {
    const ph = phaseByClient.get(c.id);
    if (!ph?.current) return false;
    const d = derivePhase(ph.current);
    return ["past-due", "due-today", "ending-soon"].includes(d.state);
  };

  const needsReviewFn = (c: any) => (msgInfoByClient.unread.get(c.id) ?? 0) > 0 || msgInfoByClient.stateMap.get(c.id)?.status === "needs_response";
  const paymentIssueFn = (c: any) =>
    ["Overdue", "Failed", "Manual Payment Needed"].includes(c.payment_status ?? "") || c.status === "Payment Overdue";

  const filtered = clients.filter((c) => {
    const matchesSearch = !search || c.full_name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesType = typeFilter === "all" || c.coaching_type === typeFilter;
    let matchesPriority = true;
    if (priorityFilter === "needs-setup") matchesPriority = !!setupNeededFn(c);
    else if (priorityFilter === "needs-review") matchesPriority = needsReviewFn(c);
    else if (priorityFilter === "program-ending") matchesPriority = programEndingFn(c);
    else if (priorityFilter === "payment-issues") matchesPriority = paymentIssueFn(c);
    else if (priorityFilter === "new-clients") matchesPriority = c.status === "New Client";
    return matchesSearch && matchesStatus && matchesType && matchesPriority;
  });

  const PRIORITY_CHIPS = [
    { key: "all", label: "All" },
    { key: "needs-setup", label: "Needs Setup" },
    { key: "needs-review", label: "Needs Review" },
    { key: "program-ending", label: "Program Ending" },
    { key: "payment-issues", label: "Payment Issues" },
    { key: "new-clients", label: "New Clients" },
  ];

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
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="hidden md:block">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="md:hidden">
                <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Filters
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
              <SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">Client Type</Label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={() => setFiltersOpen(false)}>Apply</Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Priority chips */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {PRIORITY_CHIPS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPriorityFilter(p.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                priorityFilter === p.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Mobile/tablet client cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:hidden pb-24">
          {isLoading ? (
            <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">Loading…</Card>
          ) : filtered.length === 0 ? (
            <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">No clients match your filters.</Card>
          ) : filtered.map((c) => {
            const ph = phaseByClient.get(c.id);
            const current = ph?.current;
            const dCur = current ? derivePhase(current) : null;
            const nut = nutByClient.get(c.id);
            const cardList = cardByClient.get(c.id) ?? [];
            const card = cardList[0];
            const dNut = nut ? deriveTarget(nut) : null;
            const dCard = card ? deriveTarget(card) : null;
            return (
              <ClientMobileCard
                key={c.id}
                c={c}
                trainingLabel={dCur?.label}
                trainingTone={dCur ? toneClasses(dCur.tone) : null}
                nutritionLabel={dNut?.label}
                nutritionTone={dNut?.tone ?? null}
                cardioLabel={dCard?.label}
                cardioTone={dCard?.tone ?? null}
                unreadCount={msgInfoByClient.unread.get(c.id) ?? 0}
                needsResponse={msgInfoByClient.stateMap.get(c.id)?.status === "needs_response"}
                hasActiveProduct={activeProductSet.has(c.id)}
                setupNeeded={!!setupNeededFn(c)}
                onAssign={() => setAssignTo({ id: c.id, name: c.full_name })}
                onSell={() => setSellTo({ id: c.id, name: c.full_name })}
                onSendSetup={() => sendSetup(c.id)}
                onSendReset={() => sendReset(c.id)}
                onToggleArchive={() => toggleArchive(c.id, c.archived)}
                onDelete={() => setDeleteState({ id: c.id, name: c.full_name, step: 1 })}
              />
            );
          })}
        </div>

        <Card className="hidden lg:block border-border bg-card">
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
                    <th className="px-4 py-3 min-w-[180px]">Assigned Training</th>
                    <th className="px-4 py-3 min-w-[160px]">Next Assigned Training</th>
                    <th className="px-4 py-3">Nutrition</th>
                    <th className="px-4 py-3">Cardio</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Messages</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Activity</th>
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
                    const cardList = cardByClient.get(c.id) ?? [];
                    const card = cardList[0];
                    const dNut = nut ? deriveTarget(nut) : null;
                    const dCard = card ? deriveTarget(card) : null;
                    return (
                    <tr key={c.id} className="border-b border-border/50 transition hover:bg-secondary/30 align-top">
                      <td className="px-4 py-3">
                        <Link
                          to="/admin/clients/$id"
                          params={{ id: c.id }}
                          className="flex items-start gap-3 hover:text-primary"
                        >
                          <UserAvatar
                            src={c.profile_picture_url}
                            name={c.full_name}
                            size={36}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{c.full_name}</div>
                            <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                            {c.is_powerlifter && (
                              <div className="mt-1"><PowerlifterBadge label={c.powerlifter_badge_label} size="xs" /></div>
                            )}
                          </div>
                        </Link>
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
                      {(() => {
                        const bs = blocksByClient.get(c.id);
                        const cur = bs?.current;
                        const nxt = bs?.next;
                        return (
                          <>
                            <td className="px-4 py-3 text-xs">
                              {cur ? (
                                <div className="space-y-1 min-w-[200px]">
                                  <Link
                                    to="/admin/blocks/$blockId"
                                    params={{ blockId: cur.id }}
                                    className="block hover:opacity-80"
                                  >
                                    {(() => {
                                      const dBlk = deriveBlock(cur);
                                      return (
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <Dumbbell className="h-3 w-3 text-primary shrink-0" />
                                            <span className="font-semibold truncate max-w-[140px]">{cur.name}</span>
                                            <Badge variant="outline" className={toneClasses(dBlk.tone)}>{dBlk.label}</Badge>
                                          </div>
                                          <div className="text-[10px] text-muted-foreground truncate">
                                            {cur.training_focus ? `${cur.training_focus} · ` : ""}
                                            {cur.weeks}w
                                            {cur.start_date && cur.end_date ? ` · ${format(parseISO(cur.start_date), "MMM d")} → ${format(parseISO(cur.end_date), "MMM d")}` : ""}
                                            {dBlk.daysRemaining !== null ? (
                                              <> · {dBlk.daysRemaining < 0 ? `${Math.abs(dBlk.daysRemaining)}d over` : `${dBlk.daysRemaining}d left`} · {dBlk.percentComplete}%</>
                                            ) : null}
                                          </div>
                                          {dBlk.daysRemaining !== null && (
                                            <Progress value={dBlk.percentComplete} className="h-1" />
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => setAssignTo({ id: c.id, name: c.full_name })}
                                    className="inline-flex items-center text-[10px] font-semibold text-primary hover:underline"
                                  >
                                    + Assign from Library
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setAssignTo({ id: c.id, name: c.full_name })}
                                  className="text-xs font-semibold text-primary hover:underline"
                                >
                                  + Assign from Library
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {nxt ? (
                                <Link
                                  to="/admin/blocks/$blockId"
                                  params={{ blockId: nxt.id }}
                                  className="block hover:opacity-80"
                                >
                                  {(() => {
                                    const dNxt = deriveBlock(nxt);
                                    return (
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-medium truncate max-w-[140px]">{nxt.name}</span>
                                          <Badge variant="outline" className={toneClasses(dNxt.tone)}>{dNxt.label}</Badge>
                                        </div>
                                        <div className="text-[10px] text-muted-foreground truncate">
                                          {nxt.start_date ? format(parseISO(nxt.start_date), "MMM d") : nxt.status}
                                          {" · "}{nxt.weeks}w
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </Link>
                              ) : cur ? (
                                <button
                                  type="button"
                                  onClick={() => setAssignTo({ id: c.id, name: c.full_name })}
                                  className="text-[11px] font-semibold text-primary hover:underline"
                                >
                                  + Queue from Library
                                </button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-4 py-3">
                        {dNut ? (
                          <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "nutrition" }}>
                            <div className="space-y-1">
                              <Badge variant="outline" className={`${dNut.tone} cursor-pointer hover:opacity-80`}>{dNut.label}</Badge>
                              {(() => {
                                const days = daysSinceUpdated(nut.updated_at);
                                const freshness = nutritionUpdateTone(days);
                                return freshness ? (
                                  <Badge variant="outline" className={`${freshness.tone} text-[10px]`}>{freshness.label}</Badge>
                                ) : null;
                              })()}
                            </div>
                          </Link>
                        ) : <AddCell id={c.id} tab="nutrition" label="Add Nutrition Targets" />}
                      </td>
                      <td className="px-4 py-3">
                        {dCard && card ? (
                          <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "cardio" }}>
                            <div className="space-y-1">
                              <Badge variant="outline" className={`${dCard.tone} cursor-pointer hover:opacity-80`}>{dCard.label}</Badge>
                              <div className="text-[10px] text-muted-foreground">{summarizeCardio(cardList)}</div>
                            </div>
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
                      <td className="px-4 py-3">{activityCell(c.last_active_at, c.last_signed_in_at)}</td>
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
      {assignTo && (
        <QuickAssignTemplateDialog
          open={!!assignTo}
          onOpenChange={(o) => { if (!o) setAssignTo(null); }}
          clientId={assignTo.id}
          clientName={assignTo.name}
        />
      )}
      <PriceCardPickerDialog
        open={!!sellTo}
        fixedClientId={sellTo?.id}
        onClose={() => setSellTo(null)}
      />
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

function activityCell(lastActiveAt: string | null | undefined, lastSignedInAt: string | null | undefined) {
  if (!lastSignedInAt && !lastActiveAt) {
    return <span className="text-[10px] text-muted-foreground">Never signed in</span>;
  }
  if (!lastActiveAt) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const min = (Date.now() - new Date(lastActiveAt).getTime()) / 60000;
  if (min < 5) {
    return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-[10px]">Online</Badge>;
  }
  if (min < 60 * 24) {
    return <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-400 text-[10px]">Active today</Badge>;
  }
  const days = Math.floor(min / (60 * 24));
  if (days < 7) {
    return <span className="text-[10px] text-muted-foreground">{days}d ago</span>;
  }
  if (days < 14) {
    return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px]">Inactive {days}d</Badge>;
  }
  return <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-[10px]">Inactive {days}d</Badge>;
}