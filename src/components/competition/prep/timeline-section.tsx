/**
 * The meet day's estimated timeline (coach and athlete): every entry with its
 * time or range and what kind of time it is. The warm-up sets of each lift fold
 * into one line until opened. The coach sets the day's facts (start, weigh-in,
 * flight, how many flights and lifters, travel) and confirms an entry's time;
 * a confirmed time is kept, and a new estimate that disagrees is offered beside
 * it, never swapped in.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { clock, entryTime, hhmm, zoneLabel, type Timeline, type TimelineEntry, type TimelineGroup } from "@/lib/competition/event-timeline";
import { toLb } from "@/lib/competition/rules";
import { StatusWord, dayWords } from "./prep-ui";

const GROUP_LABEL: Record<TimelineGroup, string> = {
  before: "Before lifting",
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
  event: "The event",
  after: "After",
};

export type ScheduleFacts = {
  lifting_start: string | null;
  weigh_in_at: string | null;
  flight: string | null;
  flights_in_session: number | null;
  lifters_per_flight: number | null;
  platforms: number | null;
  timezone: string | null;
  travelMinutes: number | null;
  verified: Partial<Record<"lifting_start" | "weigh_in_at" | "flight" | "flights" | "lifters", boolean>>;
};

export function TimelineSection({
  timeline,
  tz,
  today,
  facts,
  onSaveFacts,
  onConfirmEntry,
  saving,
  compact = false,
}: {
  timeline: Timeline;
  tz: string;
  today: string;
  facts?: ScheduleFacts | null;
  onSaveFacts?: (f: ScheduleFacts) => void;
  onConfirmEntry?: (key: string, at: string | null) => void;
  saving?: boolean;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const groups = ["before", "squat", "bench", "deadlift", "event", "after"] as TimelineGroup[];
  return (
    <div className="space-y-3" data-prep-timeline>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold">{dayWords(timeline.meetDate)}</h3>
            <p className="text-[12.5px] text-muted-foreground">
              Times in {zoneLabel(tz, new Date(`${timeline.meetDate}T12:00:00Z`))}
              {timeline.shift != null && Math.abs(timeline.shift) >= 5
                ? ` · running about ${Math.abs(timeline.shift)} min ${timeline.shift > 0 ? "behind" : "ahead"}`
                : ""}
            </p>
          </div>
          {onSaveFacts && facts ? (
            <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)} data-edit-schedule>
              {editing ? "Done" : "Edit the day's details"}
            </Button>
          ) : null}
        </div>
        {editing && facts && onSaveFacts ? (
          <FactsForm facts={facts} saving={saving} onSave={(f) => { onSaveFacts(f); setEditing(false); }} />
        ) : timeline.missing.length ? (
          <p className="mt-2 text-[13px] text-muted-foreground" data-timeline-missing>
            Sharper with: {timeline.missing.slice(0, 3).join(" · ")}
          </p>
        ) : null}
      </div>

      {groups.map((g) => {
        const list = timeline.entries.filter((e) => e.group === g);
        if (!list.length) return null;
        return <Group key={g} label={GROUP_LABEL[g]} entries={list} onConfirm={onConfirmEntry} compact={compact} today={today} />;
      })}

      {timeline.assumptions.length ? (
        <details className="rounded-2xl border border-border px-4 py-3 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">How it's worked out</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {timeline.assumptions.map((a) => (
              <li key={a}>· {a}</li>
            ))}
            <li>· Confirmed times are kept; nothing is moved without your say-so</li>
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Group({
  label,
  entries,
  onConfirm,
  compact,
  today,
}: {
  label: string;
  entries: TimelineEntry[];
  onConfirm?: (key: string, at: string | null) => void;
  compact: boolean;
  today: string;
}) {
  const [openSets, setOpenSets] = useState(false);
  const sets = entries.filter((e) => e.kind === "warmup_set");
  const main = entries.filter((e) => e.kind !== "warmup_set");
  return (
    <section className="rounded-2xl border border-border bg-card" data-timeline-group={label}>
      <h3 className="px-4 pt-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      <ul className="mt-1 divide-y divide-border">
        {main.map((e) => (
          <Row key={e.key} e={e} onConfirm={onConfirm} today={today} />
        ))}
        {sets.length ? (
          <li>
            <button
              type="button"
              onClick={() => setOpenSets((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[14px]"
              aria-expanded={openSets}
            >
              <span>
                Warm-up sets <span className="text-muted-foreground">· {sets.length}</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openSets && "rotate-180")} />
            </button>
            {openSets || !compact ? (
              <table className={cn("w-full text-[14px] tabular-nums", !openSets && "hidden")}>
                <tbody>
                  {sets.map((s) => (
                    <tr key={s.key} className="border-t border-border">
                      <td className="w-24 px-4 py-1.5 text-muted-foreground">{entryTime(s)}</td>
                      <td className="py-1.5 font-semibold">{s.kg} kg</td>
                      <td className="py-1.5 text-muted-foreground">{s.kg != null ? `${toLb(s.kg)} lb` : ""}</td>
                      <td className="px-4 py-1.5 text-right">×{s.reps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Row({ e, onConfirm }: { e: TimelineEntry; onConfirm?: (key: string, at: string | null) => void; today: string }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(e.at != null ? hhmm(e.at) : "");
  return (
    <li className="px-4 py-2.5" data-entry={e.key} data-entry-status={e.status}>
      <div className="flex items-baseline gap-3">
        <span className="w-[7.5rem] shrink-0 text-[14.5px] font-semibold tabular-nums">{entryTime(e)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-snug">
            {e.label}
            {e.kind === "attempt" && e.kg != null ? (
              <span className="ml-1.5 font-semibold tabular-nums">{e.kg} kg</span>
            ) : null}
          </p>
          {e.note ? <p className="text-[12px] text-muted-foreground">{e.note}</p> : null}
          {e.conflict ? (
            <p className="mt-0.5 text-[12px] text-warning" data-entry-conflict>
              The estimate is now {clock(e.conflict.estimated)}.{" "}
              {onConfirm ? (
                <>
                  <button type="button" className="underline" onClick={() => onConfirm(e.key, null)}>
                    Use the estimate
                  </button>{" "}
                  or keep {clock(e.at)}.
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <StatusWord status={e.status} />
          {onConfirm && e.kind !== "warmup_set" ? (
            <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setEdit((v) => !v)}>
              {e.status === "confirmed" ? "Change" : "Confirm"}
            </button>
          ) : null}
        </div>
      </div>
      {edit && onConfirm ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input type="time" value={val} onChange={(x) => setVal(x.target.value)} className="h-9 w-32" aria-label={`${e.label} time`} />
          <Button size="sm" disabled={!/^\d{2}:\d{2}$/.test(val)} onClick={() => { onConfirm(e.key, val); setEdit(false); }}>
            Confirm {val ? clock(Number(val.slice(0, 2)) * 60 + Number(val.slice(3))) : ""}
          </Button>
          {e.status === "confirmed" ? (
            <Button size="sm" variant="ghost" onClick={() => { onConfirm(e.key, null); setEdit(false); }}>
              Back to the estimate
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function FactsForm({ facts, onSave, saving }: { facts: ScheduleFacts; onSave: (f: ScheduleFacts) => void; saving?: boolean }) {
  const [f, setF] = useState<ScheduleFacts>(facts);
  const set = <K extends keyof ScheduleFacts>(k: K, v: ScheduleFacts[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))) || null);
  const official = (k: keyof ScheduleFacts["verified"]) => (
    <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
      <Switch checked={!!f.verified[k]} onCheckedChange={(v) => set("verified", { ...f.verified, [k]: v })} aria-label="From the official schedule" />
      Official
    </label>
  );
  return (
    <form
      className="mt-3 grid grid-cols-2 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(f);
      }}
      data-schedule-form
    >
      <div className="space-y-1">
        <Label htmlFor="ls">Lifting starts</Label>
        <Input id="ls" type="time" value={f.lifting_start ?? ""} onChange={(e) => set("lifting_start", e.target.value || null)} />
        {official("lifting_start")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="wi">Weigh-in</Label>
        <Input id="wi" type="time" value={f.weigh_in_at ?? ""} onChange={(e) => set("weigh_in_at", e.target.value || null)} />
        {official("weigh_in_at")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="fl">Their flight</Label>
        <Input id="fl" placeholder="A, B…" value={f.flight ?? ""} onChange={(e) => set("flight", e.target.value || null)} />
        {official("flight")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="fs">Flights in the session</Label>
        <Input id="fs" inputMode="numeric" value={f.flights_in_session ?? ""} onChange={(e) => set("flights_in_session", num(e.target.value))} />
        {official("flights")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="lp">Lifters per flight</Label>
        <Input id="lp" inputMode="numeric" value={f.lifters_per_flight ?? ""} onChange={(e) => set("lifters_per_flight", num(e.target.value))} />
        {official("lifters")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="pl">Platforms</Label>
        <Input id="pl" inputMode="numeric" value={f.platforms ?? ""} onChange={(e) => set("platforms", num(e.target.value))} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tr">Minutes to the venue</Label>
        <Input id="tr" inputMode="numeric" value={f.travelMinutes ?? ""} onChange={(e) => set("travelMinutes", num(e.target.value))} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tz">Meet's time zone</Label>
        <Input id="tz" placeholder="America/Winnipeg" value={f.timezone ?? ""} onChange={(e) => set("timezone", e.target.value.trim() || null)} />
      </div>
      <div className="col-span-2 flex justify-end">
        <Button type="submit" size="sm" loading={saving} data-save-schedule>
          Save and work it out again
        </Button>
      </div>
    </form>
  );
}
