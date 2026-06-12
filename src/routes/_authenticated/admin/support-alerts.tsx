import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import { formatDistanceToNow } from "date-fns";
import { ActionButton } from "@/components/action-button";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { AlertCircle, Clock, CheckCircle2, Hammer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/support-alerts")({
  component: SupportAlertsPage,
});

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

function SupportAlertsPage() {
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
      <PageHeader
        title="Support Alerts"
        subtitle="Technical issues and workout logger failures reported by clients."
      />
      
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
  if (alerts.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center p-12 text-center opacity-60">
        <CheckCircle2 className="h-12 w-12 text-success mb-4" />
        <h3 className="text-lg font-semibold">{emptyMessage}</h3>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {alerts.map((alert) => (
        <AlertCard 
          key={alert.id} 
          alert={alert} 
          onUpdateStatus={onUpdateStatus} 
          onAddNote={onAddNote}
        />
      ))}
    </div>
  );
}

function AlertCard({ alert, onUpdateStatus, onAddNote }: { 
  alert: any, 
  onUpdateStatus: (id: string, status: string) => Promise<void>,
  onAddNote: (alert: any, note: string) => Promise<void>
}) {
  const client = alert.clients;
  const coach = alert.coaches;
  const isWorkoutFailure = alert.error_type === 'workout_load_failure';

  return (
    <Card className={cn(
      "overflow-hidden border-l-4",
      alert.status === 'open' ? "border-l-destructive" : 
      alert.status === 'in_progress' ? "border-l-warning" : "border-l-success"
    )}>
      <div className="p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
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
                {isWorkoutFailure ? "Workout Logger" : alert.error_type}
              </div>
              <div className="text-xs font-mono bg-background/50 p-2 rounded border border-border/50 break-all">
                {alert.error_message || "No error message provided"}
              </div>
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
    </div>
  );
}
