import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import { formatDistanceToNow } from "date-fns";
import { ActionButton } from "@/components/action-button";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { AlertCircle, Clock, CheckCircle2, Hammer, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

const ERROR_TYPE_LABELS: Record<string, string> = {
  workout_load_failure: "Workout Logger",
  progress_submission: "Progress Check-In",
  missing_maxes: "Missing Maxes",
  workout_sync_failure: "Workout Sync",
};

export const Route = createFileRoute("/_authenticated/admin/support-alerts")({
  component: SupportAlertsRedirect,
});

function SupportAlertsRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    nav({ to: "/admin/communication", search: { tab: "support-alerts" } as any, replace: true });
  }, [nav]);
  return null;
}

const alertsQueryOptions = {
  queryKey: ["support_alerts"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("support_alerts")
      .select(`
        *,
        clients:client_id(id, full_name, profile_picture_url),
        coaches:coach_id(id, full_name)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  },
};

export function SupportAlertsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: alerts } = useSuspenseQuery(alertsQueryOptions);
  const qc = useQueryClient();

  const updateStatus = async (id: string, status: string) => {
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === "resolved") {
      const { data: { user } } = await supabase.auth.getUser();
      update.resolved_by = user?.id;
      update.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("support_alerts")
      .update(update)
      .eq("id", id);

    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["support_alerts"] });
    qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
  };

  const addNote = async (alert: any, note: string) => {
    if (!note.trim()) return;
    
    const details = (alert.details as any) || {};
    const notes = details.notes || [];
    const newNotes = [...notes, { note: note.trim(), at: new Date().toISOString() }];
    
    const { error } = await supabase
      .from("support_alerts")
      .update({ details: { ...details, notes: newNotes } })
      .eq("id", alert.id);

    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["support_alerts"] });
  };

  const openAlerts = alerts.filter(a => a.status === "open");
  const inProgressAlerts = alerts.filter(a => a.status === "in_progress");
  const resolvedAlerts = alerts.filter(a => a.status === "resolved");

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {!embedded && (
        <PageHeader
          title="Support Alerts"
          subtitle="Technical issues and workout logger failures reported by clients."
        />
      )}
      
      <div className="p-4 md:p-6 space-y-6">
        <Tabs defaultValue="open" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-4">
            <TabsTrigger value="open" className="relative">
              Open
              {openAlerts.length > 0 && (
                <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                  {openAlerts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="in_progress">In Progress</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="mt-6 space-y-4">
            <AlertList 
              alerts={openAlerts} 
              onUpdateStatus={updateStatus} 
              onAddNote={addNote}
              emptyMessage="No open alerts. All systems go!" 
            />
          </TabsContent>

          <TabsContent value="in_progress" className="mt-6 space-y-4">
            <AlertList 
              alerts={inProgressAlerts} 
              onUpdateStatus={updateStatus} 
              onAddNote={addNote}
              emptyMessage="No alerts currently in progress." 
            />
          </TabsContent>

          <TabsContent value="resolved" className="mt-6 space-y-4">
            <AlertList 
              alerts={resolvedAlerts} 
              onUpdateStatus={updateStatus} 
              onAddNote={addNote}
              emptyMessage="No resolved alerts yet." 
            />
          </TabsContent>

          <TabsContent value="all" className="mt-6 space-y-4">
            <AlertList 
              alerts={alerts} 
              onUpdateStatus={updateStatus} 
              onAddNote={addNote}
              emptyMessage="No support alerts found." 
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AlertList({ alerts, onUpdateStatus, onAddNote, emptyMessage }: { 
  alerts: any[], 
  onUpdateStatus: (id: string, status: string) => Promise<void>,
  onAddNote: (alert: any, note: string) => Promise<void>,
  emptyMessage: string 
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ status: "resolved" | "in_progress"; ids: string[] } | null>(null);

  // Prune selection to alerts still visible in this filtered view (e.g. after
  // an alert moves to another tab via a status change).
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(alerts.map((a) => a.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [alerts]);

  if (alerts.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center p-12 text-center opacity-60">
        <CheckCircle2 className="h-12 w-12 text-success mb-4" />
        <h3 className="text-lg font-semibold">{emptyMessage}</h3>
      </Card>
    );
  }

  const visibleIds = alerts.map((a) => a.id as string);
  const selectedCount = selected.size;
  const allSelected = visibleIds.every((id) => selected.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selected.has(id));

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkUpdateStatus = async (status: "resolved" | "in_progress", ids: string[]) => {
    setBulkBusy(true);
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === "resolved") {
      const { data: { user } } = await supabase.auth.getUser();
      update.resolved_by = user?.id ?? null;
      update.resolved_at = new Date().toISOString();
    }
    try {
      // Preferred path: one safe batch update by selected IDs (RLS-scoped).
      const { error } = await supabase.from("support_alerts").update(update).in("id", ids);
      let okCount = ids.length;
      let failedIds: string[] = [];
      if (error) {
        // Fallback: per-row updates so partial failures are reported honestly.
        okCount = 0;
        for (const id of ids) {
          const { error: rowErr } = await supabase.from("support_alerts").update(update).eq("id", id);
          if (rowErr) failedIds.push(id);
          else okCount++;
        }
      }
      qc.invalidateQueries({ queryKey: ["support_alerts"] });
      qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
      const label = status === "resolved" ? "resolved" : "in progress";
      if (failedIds.length === 0) {
        toast.success(`${okCount} alert${okCount === 1 ? "" : "s"} marked ${label}`);
        setSelected(new Set());
      } else {
        toast.error(`${okCount} alert${okCount === 1 ? "" : "s"} updated. ${failedIds.length} failed. Try again.`);
        // Leave failed alerts selected so the admin can retry them.
        setSelected(new Set(failedIds));
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const requestBulk = (status: "resolved" | "in_progress") => {
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0 || bulkBusy) return;
    if (ids.length > 5) setConfirm({ status, ids });
    else void bulkUpdateStatus(status, ids);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleSelectAll}
            disabled={bulkBusy}
            aria-label="Select all visible alerts"
            className="h-5 w-5"
          />
          Select All
        </label>
        <span className="text-xs text-muted-foreground">
          {selectedCount} selected
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={selectedCount === 0 || bulkBusy}
            onClick={() => requestBulk("in_progress")}
          >
            Mark In Progress
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={selectedCount === 0 || bulkBusy}
            onClick={() => requestBulk("resolved")}
          >
            Mark Resolved
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={selectedCount === 0 || bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onUpdateStatus={onUpdateStatus}
            onAddNote={onAddNote}
            selected={selected.has(alert.id)}
            onToggleSelected={toggleOne}
            selectionDisabled={bulkBusy}
          />
        ))}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o && !bulkBusy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {confirm?.ids.length} alerts as {confirm?.status === "resolved" ? "resolved" : "in progress"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will update the status of all {confirm?.ids.length} selected alerts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={(e) => {
                e.preventDefault();
                const c = confirm;
                setConfirm(null);
                if (c) void bulkUpdateStatus(c.status, c.ids);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AlertCard({ alert, onUpdateStatus, onAddNote, selected, onToggleSelected, selectionDisabled }: {
  alert: any,
  onUpdateStatus: (id: string, status: string) => Promise<void>,
  onAddNote: (alert: any, note: string) => Promise<void>,
  selected: boolean,
  onToggleSelected: (id: string) => void,
  selectionDisabled: boolean,
}) {
  const client = alert.clients;
  const coach = alert.coaches;
  const isWorkoutFailure = alert.error_type === 'workout_load_failure';
  const isProgress = alert.error_type === 'progress_submission';
  const friendlyType = ERROR_TYPE_LABELS[alert.error_type] ?? alert.error_type;

  return (
    <Card className={cn(
      "overflow-hidden border-l-4",
      alert.status === 'open' ? "border-l-destructive" : 
      alert.status === 'in_progress' ? "border-l-warning" : "border-l-success"
    )}>
      <div className="p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelected(alert.id)}
              disabled={selectionDisabled}
              aria-label={`Select alert for ${client?.full_name || "client"}`}
              className="mt-2.5 h-5 w-5 shrink-0"
            />
            <UserAvatar 
              src={client?.profile_picture_url} 
              name={client?.full_name || "Unknown Client"} 
              size={40} 
            />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm md:text-base truncate">
                  {client?.full_name || "Unknown Client"}
                </span>
                <Badge variant="outline" className="text-[10px] py-0 h-4 uppercase tracking-wider">
                  {alert.status.replace('_', ' ')}
                </Badge>
                {alert.notified_via?.map((via: string) => (
                  <Badge key={via} variant="secondary" className="text-[10px] py-0 h-4 opacity-70">
                    {via}
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <Hammer className="h-3 w-3" />
                  Coach: {coach?.full_name || "Unassigned"}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 shrink-0 self-end md:self-start">
            {alert.status === 'open' && (
              <ActionButton
                size="sm"
                variant="outline"
                onAction={() => onUpdateStatus(alert.id, 'in_progress')}
                jobLabel="Updating alert status"
                loadingLabel="Processing..."
              >
                Mark in progress
              </ActionButton>
            )}
            {alert.status !== 'resolved' && (
              <ActionButton
                size="sm"
                onAction={() => onUpdateStatus(alert.id, 'resolved')}
                jobLabel="Resolving support alert"
                loadingLabel="Resolving..."
                successLabel="Resolved"
              >
                Resolve
              </ActionButton>
            )}
          </div>
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Issue Details</div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                {friendlyType}
              </div>
              <div className="text-xs font-mono bg-background/50 p-2 rounded border border-border/50 break-all">
                {alert.error_message || "No error message provided"}
              </div>
              {isProgress && client?.id && (
                <Link
                  to="/admin/clients/$id/progress"
                  params={{ id: client.id }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  Open submission <ExternalLink className="h-3 w-3" />
                </Link>
              )}
              {alert.page_route && (
                <div className="text-[10px] text-muted-foreground truncate">
                  Route: {alert.page_route}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Notes</div>
            <div className="space-y-2 max-h-[120px] overflow-y-auto">
              {(alert.details as any)?.notes?.map((note: any, i: number) => (
                <div key={i} className="text-[11px] bg-accent/30 p-2 rounded">
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <span className="font-semibold">Note</span>
                    <span className="text-[9px] opacity-60">
                      {formatDistanceToNow(new Date(note.at), { addSuffix: true })}
                    </span>
                  </div>
                  {note.note}
                </div>
              )) || (
                <div className="text-[11px] text-muted-foreground italic">No notes yet</div>
              )}
            </div>
            {alert.status !== 'resolved' && (
              <Textarea 
                placeholder="Add a note..." 
                className="text-xs min-h-[60px] resize-none"
                onBlur={(e) => {
                  onAddNote(alert, e.target.value);
                  e.target.value = '';
                }}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
