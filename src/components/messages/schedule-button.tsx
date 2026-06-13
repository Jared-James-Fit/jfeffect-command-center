/**
 * Schedule button for the message composer. Opens a popover with a
 * datetime-local input (interpreted in the browser's local timezone) and
 * a confirmation button. Calls scheduleMessage with a UTC ISO timestamp
 * and the local IANA timezone label so it can be displayed back to admins.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { scheduleMessage } from "@/lib/scheduled-messages.functions";

function formatLocalForInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function ScheduleButton({
  clientId,
  body,
  disabled,
  onScheduled,
}: {
  clientId: string;
  body: string;
  disabled?: boolean;
  onScheduled?: () => void;
}) {
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    [],
  );
  const defaultValue = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60_000); // +1h
    return formatLocalForInput(d);
  }, []);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const scheduleFn = useServerFn(scheduleMessage);

  const hasBody = body.trim().length > 0;

  const submit = async () => {
    if (!hasBody) {
      toast.error("Enter a message before scheduling");
      return;
    }
    const local = new Date(value);
    if (!Number.isFinite(local.getTime())) {
      toast.error("Pick a valid date and time");
      return;
    }
    if (local.getTime() < Date.now() + 30_000) {
      toast.error("Schedule at least a minute in the future");
      return;
    }
    setBusy(true);
    try {
      await scheduleFn({
        data: {
          clientId,
          body,
          scheduledAtIso: local.toISOString(),
          scheduledTz: tz,
        },
      });
      toast.success(
        `Scheduled for ${local.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` +
          (tz ? ` (${tz})` : ""),
      );
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["pending-messages", clientId] });
      onScheduled?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not schedule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
          disabled={disabled || !hasBody}
          aria-label="Schedule message"
          title="Schedule for later"
        >
          <Calendar className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[60] w-72 p-3">
        <div className="space-y-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Schedule for
            </div>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={value}
              min={formatLocalForInput(new Date(Date.now() + 60_000))}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Times are in {tz ?? "your local timezone"}.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={busy || !hasBody}
              aria-busy={busy || undefined}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Scheduling
                </>
              ) : (
                "Schedule"
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}