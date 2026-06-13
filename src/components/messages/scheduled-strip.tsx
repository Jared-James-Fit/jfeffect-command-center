/**
 * Admin-side strip of pending (scheduled / failed / cancelled) 1:1 messages
 * for one conversation. Rendered above the composer in MessageThread.
 *
 * Surfaces:
 *  - Scheduled rows with countdown + Cancel.
 *  - Failed rows with a safe explanation + Retry.
 * Never shows raw stack traces; long errors are truncated and labelled.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Loader2, Clock, AlertTriangle, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listPendingMessages, type Message } from "@/lib/messages";
import {
  cancelScheduledMessage,
  retryFailedMessage,
} from "@/lib/scheduled-messages.functions";

function safeErrorLabel(err?: string | null): string {
  if (!err) return "Delivery failed";
  const trimmed = err.trim();
  if (trimmed.length === 0) return "Delivery failed";
  // Strip anything that looks like a stack trace / SQL detail.
  const cleaned = trimmed.split(/\n|Error:|at /)[0].slice(0, 140);
  // Common backend messages → friendlier copy
  if (/empty_body/i.test(cleaned)) return "Message body was empty when sending.";
  if (/recipient_not_in_allowlist/i.test(cleaned)) return "Recipient is not on the test allowlist.";
  if (/no_client/i.test(cleaned)) return "Recipient information is missing.";
  return cleaned;
}

export function ScheduledStrip({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelScheduledMessage);
  const retryFn = useServerFn(retryFailedMessage);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["pending-messages", clientId],
    enabled: !!clientId,
    queryFn: () => listPendingMessages(clientId),
    refetchInterval: 30_000,
  });

  const { scheduled, failed } = useMemo(() => {
    const s: Message[] = [];
    const f: Message[] = [];
    for (const r of rows as Message[]) {
      if (r.delivery_status === "scheduled") s.push(r);
      else if (r.delivery_status === "failed") f.push(r);
    }
    return { scheduled: s, failed: f };
  }, [rows]);

  if (scheduled.length === 0 && failed.length === 0) return null;

  const onCancel = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await cancelFn({ data: { messageId: id } });
      toast.success("Scheduled message cancelled");
      qc.invalidateQueries({ queryKey: ["pending-messages", clientId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not cancel");
    } finally {
      setBusyId(null);
    }
  };

  const onRetry = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await retryFn({ data: { messageId: id } });
      toast.success("Message resent");
      qc.invalidateQueries({ queryKey: ["pending-messages", clientId] });
      qc.invalidateQueries({ queryKey: ["messages", clientId, "admin"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Retry failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2 border-t border-border bg-secondary/30 px-3 py-2 md:px-4">
      {scheduled.map((m) => {
        const when = m.scheduled_at ? new Date(m.scheduled_at) : null;
        const tz = (m as any).scheduled_tz as string | undefined;
        return (
          <div
            key={m.id}
            className="flex items-start gap-2 rounded-lg border border-border bg-card/60 p-2.5 shadow-sm"
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">
                  Scheduled
                </Badge>
                {when && (
                  <>
                    <span className="text-foreground">
                      {format(when, "EEE, MMM d · h:mm a")}
                    </span>
                    <span className="font-normal lowercase text-muted-foreground">
                      ({formatDistanceToNowStrict(when, { addSuffix: true })})
                    </span>
                    {tz && <span className="font-normal lowercase text-muted-foreground">· {tz}</span>}
                  </>
                )}
              </div>
              <div className="mt-1 line-clamp-2 break-words text-sm text-foreground">
                {m.body || "(empty)"}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 text-xs"
              onClick={() => onCancel(m.id)}
              disabled={busyId === m.id}
              aria-busy={busyId === m.id || undefined}
            >
              {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Cancel
            </Button>
          </div>
        );
      })}
      {failed.map((m) => (
        <div
          key={m.id}
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 shadow-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
                Failed
              </Badge>
              <span className="text-destructive">{safeErrorLabel(m.delivery_error)}</span>
              {m.attempt_count > 0 && (
                <span className="font-normal lowercase text-muted-foreground">
                  · {m.attempt_count} attempt{m.attempt_count === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="mt-1 line-clamp-2 break-words text-sm text-foreground/90">
              {m.body || "(empty)"}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1 text-xs"
            onClick={() => onRetry(m.id)}
            disabled={busyId === m.id}
            aria-busy={busyId === m.id || undefined}
          >
            {busyId === m.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Retry
          </Button>
        </div>
      ))}
    </div>
  );
}