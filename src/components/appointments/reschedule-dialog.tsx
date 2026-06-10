import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { rescheduleAppointment } from "@/lib/appointments.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { SlotPicker } from "./slot-picker";
import { tzWallToUtcISO } from "@/lib/tz";

export function RescheduleDialog({
  open, onOpenChange, appointment, onChanged,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  appointment: { id: string; starts_at: string; ends_at: string; title: string; timezone?: string; host_coach_id?: string } | null;
  onChanged?: () => void;
}) {
  const fn = useServerFn(rescheduleAppointment);
  const initial = appointment ? new Date(appointment.starts_at) : new Date();
  const durMin = appointment ? Math.round((new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60000) : 30;
  const [date, setDate] = useState(initial.toISOString().slice(0, 10));
  const [time, setTime] = useState(initial.toTimeString().slice(0, 5));
  const [tz, setTz] = useState<string>(appointment?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [duration, setDuration] = useState<number>(durMin);

  const mut = useMutation({
    mutationFn: async () => {
      if (!appointment) return;
      const startISO = tzWallToUtcISO(date, time, tz);
      const endISO = new Date(Date.parse(startISO) + duration * 60_000).toISOString();
      return fn({ data: { id: appointment.id, starts_at: startISO, ends_at: endISO } });
    },
    onSuccess: () => { toast.success("Rescheduled"); onChanged?.(); onOpenChange(false); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Reschedule appointment</DialogTitle></DialogHeader>
        {appointment && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {appointment.title} · current start {new Date(appointment.starts_at).toLocaleString()}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><Label>Start</Label><Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></div>
            </div>
            <SlotPicker
              date={date}
              tz={tz}
              durationMin={duration}
              coachId={appointment.host_coach_id}
              selectedTime={time}
              customTime={time}
              onPick={setTime}
              onCustomTimeChange={setTime}
              onTzChange={setTz}
              onDurationChange={setDuration}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="bg-gradient-primary">
            {mut.isPending ? "Saving…" : "Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}