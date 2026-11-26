/**
 * Training: the athlete's program as they see it, read-only. The competition
 * lifts, variations and primary / secondary work up front; accessories
 * folded. What's coming up and what was just done first. Never a coach's
 * notes or a program's private notes (the server never reads them).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";
import { QueryState, ListSkeleton, EmptyState } from "@/components/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { billingDay, billingRange } from "@/lib/date-range";
import {
  KIND_WORD,
  type DayStatus,
  type TrainingDay,
  type TrainingRow,
} from "@/lib/team-access/training";
import { getSpecialistTraining } from "@/lib/team-access/specialist.functions";
import { useSpecialist } from "./specialist-context";
import { NotShared } from "./specialist-shell";
import { SpecialistNotes } from "./specialist-notes";

export function TrainingTab() {
  const { athlete } = useSpecialist();
  if (!athlete) return null;
  if (!athlete.training) return <NotShared what="Training" />;
  return <TrainingBody clientId={athlete.clientId} />;
}

const STATUS: Record<DayStatus, { word: string; cls: string }> = {
  done: { word: "Done", cls: "text-success" },
  today: { word: "Today", cls: "text-foreground font-semibold" },
  upcoming: { word: "Upcoming", cls: "text-muted-foreground" },
  missed: { word: "Missed", cls: "text-destructive" },
  skipped: { word: "Skipped (optional)", cls: "text-muted-foreground" },
  undated: { word: "No date", cls: "text-muted-foreground" },
};

function TrainingBody({ clientId }: { clientId: string }) {
  const load = useServerFn(getSpecialistTraining);
  const [blockId, setBlockId] = useState<string | null>(null);
  const training = useQuery({
    queryKey: ["specialist-training", clientId, blockId],
    queryFn: () => load({ data: { clientId, blockId } }),
    staleTime: 5 * 60_000,
  });
  return (
    <QueryState
      query={training}
      what="the training"
      skeleton={<ListSkeleton rows={5} avatar={false} />}
      isEmpty={(d) => !d.blocks.length}
      empty={
        <EmptyState
          title="No program yet"
          detail="Once there's a program on their calendar it shows here."
        />
      }
    >
      {(t) => (
        <div className="space-y-5">
          {(t.upcoming.length > 0 || t.recent.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <DayList title="Coming up" days={t.upcoming} />
              <DayList title="Recently done" days={t.recent} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold">{t.block?.name ?? "Program"}</h2>
              {t.block && (
                <div className="text-xs text-muted-foreground">
                  {billingRange(t.block.start, t.block.end)}
                </div>
              )}
            </div>
            {t.blocks.length > 1 && t.block && (
              <Select value={t.block.id} onValueChange={(v) => setBlockId(v)}>
                <SelectTrigger className="h-9 w-auto max-w-[12rem]" aria-label="Block">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {t.blocks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.current ? " (now)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {t.weeks.map((w) => (
            <Week
              key={w.id}
              number={w.number}
              start={w.start}
              end={w.end}
              phase={w.phase}
              current={w.current}
              days={w.days}
              clientId={clientId}
            />
          ))}
        </div>
      )}
    </QueryState>
  );
}

function DayList({
  title,
  days,
}: {
  title: string;
  days: Array<{ dayId: string; date: string; title: string }>;
}) {
  if (!days.length) return null;
  return (
    <div className="rounded-xl border border-border p-3">
      <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-1 text-sm">
        {days.map((d) => (
          <li key={d.dayId} className="flex justify-between gap-2">
            <span className="truncate">{d.title}</span>
            <span className="shrink-0 text-muted-foreground">{billingDay(d.date)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Week(props: {
  number: number;
  start: string | null;
  end: string | null;
  phase: string | null;
  current: boolean;
  days: TrainingDay[];
  clientId: string;
}) {
  const [open, setOpen] = useState(props.current);
  return (
    <section className="rounded-2xl border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold">Week {props.number}</span>
        {props.current && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">This week</span>
        )}
        <span className="truncate text-xs text-muted-foreground">
          {[props.phase, billingRange(props.start, props.end)].filter(Boolean).join(" · ")}
        </span>
        <ChevronDown
          className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {props.days.length ? (
            props.days.map((d) => <Day key={d.id} day={d} clientId={props.clientId} />)
          ) : (
            <p className="text-sm text-muted-foreground">No workouts this week.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Day({ day, clientId }: { day: TrainingDay; clientId: string }) {
  const { athlete } = useSpecialist();
  const [accOpen, setAccOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const s = STATUS[day.status];
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-sm font-semibold">{day.title}</span>
        {day.optional && <span className="text-xs text-muted-foreground">Optional</span>}
        <span className={cn("ml-auto shrink-0 text-xs", s.cls)}>
          {[day.date ? billingDay(day.date) : null, s.word].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {day.main.map((r) => (
          <Row key={r.id} row={r} />
        ))}
        {!day.main.length && !day.accessories.length && (
          <p className="text-sm text-muted-foreground">Nothing written for this day.</p>
        )}
      </div>
      {day.accessories.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground"
            onClick={() => setAccOpen((v) => !v)}
            aria-expanded={accOpen}
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", accOpen && "rotate-180")}
            />
            {accOpen ? "Hide" : "Show"} {day.accessories.length}{" "}
            {day.accessories.length === 1 ? "accessory" : "accessories"}
          </button>
          {accOpen && (
            <div className="mt-2 space-y-2">
              {day.accessories.map((r) => (
                <Row key={r.id} row={r} quiet />
              ))}
            </div>
          )}
        </div>
      )}
      {athlete && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setNotesOpen((v) => !v)}
          >
            {notesOpen ? "Hide your notes" : "Your notes on this session"}
          </button>
          {notesOpen && (
            <div className="mt-2">
              <SpecialistNotes
                clientId={clientId}
                athleteFirstName={athlete.firstName}
                targetKind="session"
                targetId={day.id}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ row, quiet }: { row: TrainingRow; quiet?: boolean }) {
  return (
    <div className={cn("text-sm", quiet && "text-muted-foreground")}>
      <div className="flex items-baseline gap-2">
        <span className={cn("min-w-0 truncate", !quiet && "font-medium")}>{row.name}</span>
        {!quiet && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{KIND_WORD[row.kind]}</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">Planned: {row.prescription || "—"}</div>
      {row.logged.length > 0 && (
        <ul className="mt-0.5 text-xs">
          {row.logged.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
