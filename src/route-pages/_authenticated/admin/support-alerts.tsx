import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { formatDistanceToNow } from "date-fns";
import { ActionButton } from "@/components/action-button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  ListChecks,
  Loader2,
  MoreHorizontal,
  ServerCog,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { getRouteApi as __getRouteApi } from "@tanstack/react-router";
const Route = __getRouteApi("/_authenticated/admin/support-alerts");

const ERROR_TYPE_LABELS: Record<string, string> = {
  workout_load_failure: "Workout logger failed to load",
  workout_sync_failure: "Workout didn't sync",
  workout_sync_stuck: "Workout sync stuck",
  empty_workout: "Empty workout",
  progress_submission: "Progress check-in problem",
  missing_maxes: "Missing maxes",
  missing_client_maxes: "Missing maxes",
  scheduled_jobs_failing: "Scheduled jobs failing",
};

type Status = "open" | "in_progress" | "resolved";
type Filter = Status | "all";

const STATUS_META: Record<Status, { label: string; dot: string; text: string }> = {
  open: { label: "Open", dot: "bg-destructive", text: "text-destructive" },
  in_progress: { label: "In progress", dot: "bg-warning", text: "text-warning" },
  resolved: { label: "Resolved", dot: "bg-success", text: "text-success" },
};

const STATUS_BREAKDOWN_LABELS: Record<string, string> = {
  "404": "not found",
  "401": "unauthorized",
  "403": "forbidden",
  "500": "server error",
  "502": "bad gateway",
  "503": "unavailable",
  "no response": "no response",
};

function titleFor(alert: any): string {
  return ERROR_TYPE_LABELS[alert.error_type] ?? String(alert.error_type ?? "Alert").replace(/_/g, " ");
}

/** One plain-English line for the list; the raw message lives under Details. */
function summaryFor(alert: any): string {
  const d = (alert.details ?? {}) as any;
  if (alert.error_type === "scheduled_jobs_failing" && typeof d.http_failed === "number") {
    const parts = Object.entries((d.status_breakdown ?? {}) as Record<string, number>)
      .map(([code, n]) => `${n} ${STATUS_BREAKDOWN_LABELS[code] ?? `HTTP ${code}`}`);
    const cron = Number(d.cron_failed_runs) > 0 ? `${d.cron_failed_runs} cron run(s) errored` : null;
    return [
      `${d.http_failed} of ${d.http_total} calls failed in the last hour`,
      parts.length ? parts.join(", ") : null,
      cron,
    ].filter(Boolean).join(" · ");
  }
  const msg = String(alert.error_message ?? "").split("\n")[0].trim();
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg || "No details provided";
}

export function SupportAlertsRedirect() {
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
  const [filter, setFilter] = useState<Filter>("open");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["support_alerts"] });
    qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
  };

  const updateStatus = async (id: string, status: Status) => {
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === "resolved") {
      const { data: { user } } = await supabase.auth.getUser();
      update.resolved_by = user?.id;
      update.resolved_at = new Date().toISOString();
    } else {
      update.resolved_by = null;
      update.resolved_at = null;
    }
    const { error } = await supabase.from("support_alerts").update(update).eq("id", id);
    if (error) throw error;
    refresh();
  };

  const addNote = async (alert: any, note: string) => {
    if (!note.trim()) return;
    const details = (alert.details as any) || {};
    const notes = details.notes || [];
    const { error } = await supabase
      .from("support_alerts")
      .update({ details: { ...details, notes: [...notes, { note: note.trim(), at: new Date().toISOString() }] } })
      .eq("id", alert.id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["support_alerts"] });
  };

  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, resolved: 0, all: alerts.length };
    for (const a of alerts) if (a.status in c) c[a.status as Status] += 1;
    return c;
  }, [alerts]);
  const visible = filter === "all" ? alerts : alerts.filter((a) => a.status === filter);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "resolved", label: "Resolved" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {!embedded && (
        <PageHeader
          title="Support Alerts"
          subtitle="Problems clients hit in the app, plus system checks."
        />
      )}

      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        <div role="tablist" aria-label="Filter alerts" className="flex gap-1 overflow-x-auto rounded-xl bg-muted/40 p-1">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            const n = counts[f.value];
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums",
                    f.value === "open" && n > 0
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <AlertList
          alerts={visible}
          filter={filter}
          onUpdateStatus={updateStatus}
          onAddNote={addNote}
          onBulkDone={refresh}
        />
      </div>
    </div>
  );
}

const EMPTY_COPY: Record<Filter, string> = {
  open: "No open alerts. All systems go.",
  in_progress: "Nothing in progress.",
  resolved: "No resolved alerts yet.",
  all: "No support alerts.",
};

function AlertList({ alerts, filter, onUpdateStatus, onAddNote, onBulkDone }: {
  alerts: any[];
  filter: Filter;
  onUpdateStatus: (id: string, status: Status) => Promise<void>;
  onAddNote: (alert: any, note: string) => Promise<void>;
  onBulkDone: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ status: Status; ids: string[] } | null>(null);

  // Keep the selection to alerts still in this view; leave select mode when the view changes.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(alerts.map((a) => a.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [alerts]);
  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
  }, [filter]);

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <CheckCircle2 className="mb-3 h-10 w-10 text-success" />
        <p className="text-sm font-medium text-muted-foreground">{EMPTY_COPY[filter]}</p>
      </div>
    );
  }

  const ids = alerts.map((a) => a.id as string);
  const allSelected = ids.every((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkUpdate = async (status: Status, targetIds: string[]) => {
    setBulkBusy(true);
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === "resolved") {
      const { data: { user } } = await supabase.auth.getUser();
      update.resolved_by = user?.id ?? null;
      update.resolved_at = new Date().toISOString();
    }
    try {
      const { error } = await supabase.from("support_alerts").update(update).in("id", targetIds);
      let ok = targetIds.length;
      const failed: string[] = [];
      if (error) {
        // Per-row fallback so a partial failure is reported honestly.
        ok = 0;
        for (const id of targetIds) {
          const { error: rowErr } = await supabase.from("support_alerts").update(update).eq("id", id);
          if (rowErr) failed.push(id);
          else ok++;
        }
      }
      onBulkDone();
      const label = status === "resolved" ? "resolved" : "in progress";
      if (failed.length === 0) {
        toast.success(`${ok} alert${ok === 1 ? "" : "s"} marked ${label}`);
        setSelected(new Set());
        setSelecting(false);
      } else {
        toast.error(`${ok} updated, ${failed.length} failed. Try again.`);
        setSelected(new Set(failed));
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const requestBulk = (status: Status) => {
    const target = ids.filter((id) => selected.has(id));
    if (target.length === 0 || bulkBusy) return;
    if (target.length > 5) setConfirm({ status, ids: target });
    else void bulkUpdate(status, target);
  };

  return (
    <>
      {alerts.length > 1 && (
        <div className="flex min-h-9 items-center gap-2">
          {selecting ? (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                  onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
                  disabled={bulkBusy}
                  aria-label="Select all alerts in this view"
                />
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </label>
              <div className="ml-auto flex items-center gap-2">
                {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {filter !== "in_progress" && filter !== "resolved" && (
                  <Button size="sm" variant="outline" disabled={!selected.size || bulkBusy} onClick={() => requestBulk("in_progress")}>
                    In progress
                  </Button>
                )}
                {filter !== "resolved" && (
                  <Button size="sm" disabled={!selected.size || bulkBusy} onClick={() => requestBulk("resolved")}>
                    Resolve
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => { setSelecting(false); setSelected(new Set()); }}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setSelecting(true)}>
              <ListChecks className="mr-1.5 h-4 w-4" /> Select
            </Button>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <AlertRow
              alert={alert}
              onUpdateStatus={onUpdateStatus}
              onAddNote={onAddNote}
              selecting={selecting}
              selected={selected.has(alert.id)}
              onToggleSelected={toggleOne}
              selectionDisabled={bulkBusy}
            />
          </li>
        ))}
      </ul>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o && !bulkBusy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {confirm?.ids.length} alerts as {confirm?.status === "resolved" ? "resolved" : "in progress"}?
            </AlertDialogTitle>
            <AlertDialogDescription>This updates all {confirm?.ids.length} selected alerts.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={(e) => {
                e.preventDefault();
                const c = confirm;
                setConfirm(null);
                if (c) void bulkUpdate(c.status, c.ids);
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

function AlertRow({ alert, onUpdateStatus, onAddNote, selecting, selected, onToggleSelected, selectionDisabled }: {
  alert: any;
  onUpdateStatus: (id: string, status: Status) => Promise<void>;
  onAddNote: (alert: any, note: string) => Promise<void>;
  selecting: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  selectionDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const client = alert.clients;
  const coach = alert.coaches;
  const isSystem = !alert.client_id;
  const status = (alert.status in STATUS_META ? alert.status : "open") as Status;
  const meta = STATUS_META[status];
  const notes: { note: string; at: string }[] = (alert.details as any)?.notes ?? [];
  const subject = isSystem ? "System check" : client?.full_name || "Unknown client";

  const saveNote = async () => {
    if (!draft.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await onAddNote(alert, draft);
      setDraft("");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the note");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        selected ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-3 p-3 md:p-4">
        {selecting && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected(alert.id)}
            disabled={selectionDisabled}
            aria-label={`Select alert: ${titleFor(alert)}`}
            className="mt-2.5 shrink-0"
          />
        )}

        {isSystem ? (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <ServerCog className="h-5 w-5" />
          </div>
        ) : (
          <UserAvatar src={client?.profile_picture_url} name={subject} size={40} />
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold leading-tight">{titleFor(alert)}</span>
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium", meta.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{summaryFor(alert)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground/80">
            <span>{subject}</span>
            {!isSystem && <><span aria-hidden>·</span><span>Coach: {coach?.full_name || "Unassigned"}</span></>}
            <span aria-hidden>·</span>
            <span>{formatDistanceToNow(new Date(alert.updated_at ?? alert.created_at), { addSuffix: true })}</span>
            {notes.length > 0 && <><span aria-hidden>·</span><span>{notes.length} note{notes.length === 1 ? "" : "s"}</span></>}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {status !== "resolved" ? (
            <ActionButton
              size="sm"
              onAction={() => onUpdateStatus(alert.id, "resolved")}
              jobLabel="Resolving support alert"
              loadingLabel="Resolving…"
              successLabel="Resolved"
            >
              Resolve
            </ActionButton>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {status === "open" && (
                <DropdownMenuItem onSelect={() => void onUpdateStatus(alert.id, "in_progress").catch((e) => toast.error(e?.message ?? "Couldn't update"))}>
                  Mark in progress
                </DropdownMenuItem>
              )}
              {status !== "open" && (
                <DropdownMenuItem onSelect={() => void onUpdateStatus(alert.id, "open").catch((e) => toast.error(e?.message ?? "Couldn't update"))}>
                  Reopen
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setExpanded((v) => !v)}>
                {expanded ? "Hide details" : "Show details"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Hide details" : "Show details"}
            className="hidden h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted sm:grid"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-3 py-3 md:px-4">
          <section className="space-y-1.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Details</h4>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-2.5 font-mono text-xs leading-relaxed">
              {alert.error_message || "No error message provided"}
            </pre>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {alert.page_route && alert.page_route !== "/admin" && <span>Page: {alert.page_route}</span>}
              {alert.notified_via?.length > 0 && <span>Notified via {alert.notified_via.join(", ")}</span>}
              <span>Opened {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}</span>
              {!isSystem && client?.id && (
                <Link
                  to={alert.error_type === "progress_submission" ? "/admin/clients/$id/progress" : "/admin/clients/$id"}
                  params={{ id: client.id }}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  {alert.error_type === "progress_submission" ? "Open submission" : "Open client"}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</h4>
            {notes.length > 0 ? (
              <ul className="space-y-1.5">
                {notes.map((n, i) => (
                  <li key={i} className="rounded-lg bg-muted/40 px-2.5 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{n.note}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.at), { addSuffix: true })}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No notes yet.</p>
            )}
            {status !== "resolved" && (
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void saveNote();
                    }
                  }}
                  placeholder="Add a note…"
                  rows={1}
                  className="min-h-9 resize-none text-sm"
                />
                <Button size="sm" variant="outline" disabled={!draft.trim() || savingNote} onClick={() => void saveNote()}>
                  {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
