import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGoogleBusy } from "@/lib/google-cal.functions";
import { tzWallToUtcMs, DAYPARTS, type DaypartKey, COMMON_TIMEZONES } from "@/lib/tz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const SLOT_MIN = 15;

export function SlotPicker({
  date, tz, durationMin, coachId,
  selectedTime, customTime, onPick, onTzChange, onCustomTimeChange, onDurationChange,
}: {
  date: string;
  tz: string;
  durationMin: number;
  coachId?: string;
  selectedTime: string;
  customTime: string;
  onPick: (time: string) => void;
  onTzChange: (tz: string) => void;
  onCustomTimeChange: (t: string) => void;
  onDurationChange: (m: number) => void;
}) {
  const [part, setPart] = useState<DaypartKey>("all");
  const busyFn = useServerFn(getGoogleBusy);

  // Range covering the chosen day in the chosen TZ
  const dayStartMs = useMemo(() => tzWallToUtcMs(date, "00:00", tz), [date, tz]);
  const dayEndMs = dayStartMs + 24 * 3600 * 1000;

  const { data: busy = [] } = useQuery({
    queryKey: ["gcal-busy-day", coachId || "me", date, tz],
    enabled: !!date && !Number.isNaN(dayStartMs),
    queryFn: () => busyFn({ data: {
      timeMin: new Date(dayStartMs).toISOString(),
      timeMax: new Date(dayEndMs).toISOString(),
      coach_id: coachId || undefined,
    } }),
    staleTime: 30_000,
  });

  const slots = useMemo(() => {
    const { from, to } = DAYPARTS[part];
    const out: { time: string; ms: number; busy: boolean; label: string }[] = [];
    for (let h = from; h < to; h++) {
      for (let m = 0; m < 60; m += SLOT_MIN) {
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        const wall = `${hh}:${mm}`;
        const startMs = tzWallToUtcMs(date, wall, tz);
        const endMs = startMs + durationMin * 60_000;
        const conflict = (busy as any[]).some((b) => {
          const bs = Date.parse(b.start); const be = Date.parse(b.end);
          return startMs < be && endMs > bs;
        });
        const label = new Intl.DateTimeFormat(undefined, {
          hour: "numeric", minute: "2-digit", timeZone: tz,
        }).format(startMs);
        out.push({ time: wall, ms: startMs, busy: conflict, label });
      }
    }
    return out;
  }, [date, tz, part, durationMin, busy]);

  return (
    <div className="md:col-span-2 space-y-3 rounded-md border border-border p-3 bg-background/40">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs">Timezone</Label>
          <Select value={tz} onValueChange={onTzChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {COMMON_TIMEZONES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label} ({t.value})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-28">
          <Label className="text-xs">Duration</Label>
          <Select value={String(durationMin)} onValueChange={(v) => onDurationChange(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[15,30,45,60,75,90,120].map((m) => <SelectItem key={m} value={String(m)}>{m} min</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs">Custom time</Label>
          <Input
            type="time"
            step={900}
            value={customTime}
            onChange={(e) => { onCustomTimeChange(e.target.value); if (e.target.value) onPick(e.target.value); }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(DAYPARTS) as DaypartKey[]).map((k) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={part === k ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setPart(k)}
          >
            {DAYPARTS[k].label}
          </Button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          15-min increments · grey = busy on Google Calendar
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 max-h-64 overflow-y-auto pr-1">
        {slots.map((s) => {
          const active = s.time === selectedTime;
          return (
            <button
              key={s.time}
              type="button"
              onClick={() => onPick(s.time)}
              disabled={s.busy}
              className={[
                "rounded border px-2 py-1 text-xs transition",
                s.busy ? "border-border bg-muted/40 text-muted-foreground line-through cursor-not-allowed" :
                active ? "border-primary bg-primary text-primary-foreground font-semibold" :
                "border-border bg-background hover:border-primary/50 hover:bg-primary/5",
              ].join(" ")}
              title={s.busy ? "Busy on Google Calendar" : s.label}
            >
              {s.label}
              {s.busy && <Badge variant="outline" className="ml-1 px-1 text-[8px]">busy</Badge>}
            </button>
          );
        })}
        {slots.length === 0 && (
          <div className="col-span-full text-center text-xs text-muted-foreground py-4">No slots in this window.</div>
        )}
      </div>
    </div>
  );
}