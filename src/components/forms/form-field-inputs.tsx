import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  alignRanking,
  groupOptions,
  moveRank,
  readMeets,
  startGroup,
  toggleMeetLevel,
  type MeetEntry,
  type RankItem,
} from "@/lib/form-fields";

/**
 * The richer native-form inputs (see form-fields.ts for the rules): built
 * for a thumb like the rest of the form, chips and big rows, nothing a giant
 * dropdown.
 */

const chip = (on: boolean) =>
  cn(
    "min-h-11 rounded-full border px-3.5 text-[15px] font-medium transition-colors active:scale-[0.98]",
    on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground",
  );

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

/**
 * Competitions: tap the levels you're considering; each opens a short card
 * for what you know (all optional): the meet's name, date, place, whether
 * you're registered and qualified. "None" stands alone.
 */
export function MeetsInput({
  options,
  noneLabel,
  value,
  readOnly,
  onChange,
}: {
  options: string[];
  noneLabel: string | null;
  value: unknown;
  readOnly: boolean;
  /** `typed`: from the keyboard (saved a beat later). */
  onChange: (next: MeetEntry[], typed?: boolean) => void;
}) {
  const meets = readMeets(value);
  const picked = (o: string) => meets.some((m) => m.level === o);
  const update = (id: string, patch: Partial<MeetEntry>, typed = false) =>
    onChange(meets.map((m) => (m.id === id ? { ...m, ...patch } : m)), typed);
  const remove = (id: string) => onChange(meets.filter((m) => m.id !== id));
  const addAnother = (level: string) => onChange([...meets, { id: newId(), level }]);
  const toggle = (level: string) => {
    const hasDetails = meets.some((m) => m.level === level && (m.name || m.date || m.location));
    if (picked(level) && hasDetails && !confirm(`Take ${level} off? What you typed for it goes too.`)) return;
    onChange(toggleMeetLevel(meets, level, noneLabel, newId));
  };

  return (
    <div className="space-y-3" data-meets-input>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Meet levels">
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={picked(o)} disabled={readOnly} onClick={() => toggle(o)} className={chip(picked(o))}>
            {o}
          </button>
        ))}
      </div>
      {meets
        .filter((m) => !m.none)
        .map((m, i, list) => {
          const again = list.filter((x) => x.level === m.level);
          return (
            <MeetCard
              key={m.id}
              meet={m}
              readOnly={readOnly}
              onChange={(patch, typed) => update(m.id, patch, typed)}
              onRemove={() => remove(m.id)}
              canAddAnother={!readOnly && again[again.length - 1]?.id === m.id && i < 19}
              onAddAnother={() => addAnother(m.level)}
            />
          );
        })}
    </div>
  );
}

function MeetCard({
  meet,
  readOnly,
  onChange,
  onRemove,
  canAddAnother,
  onAddAnother,
}: {
  meet: MeetEntry;
  readOnly: boolean;
  onChange: (patch: Partial<MeetEntry>, typed?: boolean) => void;
  onRemove: () => void;
  canAddAnother: boolean;
  onAddAnother: () => void;
}) {
  const [more, setMore] = useState(!!meet.federation);
  const field = "h-11 rounded-xl px-3 text-[16px]";
  const tri = (label: string, v: boolean | null | undefined, set: (x: boolean | null) => void) => (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-0.5 text-[13px] text-muted-foreground">{label}</span>
      {([true, false] as const).map((opt) => (
        <button
          key={String(opt)}
          type="button"
          disabled={readOnly}
          aria-pressed={v === opt}
          onClick={() => set(v === opt ? null : opt)}
          className={cn("h-9 rounded-full border px-3 text-[13px] font-medium", v === opt ? "border-foreground bg-foreground text-background" : "border-border")}
        >
          {opt ? "Yes" : "Not yet"}
        </button>
      ))}
    </div>
  );
  return (
    <div className="rounded-xl border border-border p-3" data-meet-card>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[15px] font-semibold">{meet.level}</span>
        {!readOnly && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${meet.level}`} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2 grid gap-2">
        <Input className={field} placeholder="Meet name (if you know it)" value={meet.name ?? ""} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value }, true)} />
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" className={field} aria-label="Date" value={meet.date ?? ""} disabled={readOnly} onChange={(e) => onChange({ date: e.target.value || null })} />
          <Input className={field} placeholder="Where" value={meet.location ?? ""} disabled={readOnly} onChange={(e) => onChange({ location: e.target.value }, true)} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {tri("Registered", meet.registered, (x) => onChange({ registered: x }))}
          {tri("Qualified", meet.qualified, (x) => onChange({ qualified: x }))}
        </div>
        {more ? (
          <Input className={field} placeholder="Federation (e.g. CPF)" value={meet.federation ?? ""} disabled={readOnly} onChange={(e) => onChange({ federation: e.target.value }, true)} />
        ) : (
          !readOnly && (
            <button type="button" onClick={() => setMore(true)} className="flex h-9 items-center gap-1 self-start text-[13px] text-muted-foreground">
              <ChevronDown className="h-3.5 w-3.5" /> Federation
            </button>
          )
        )}
      </div>
      {canAddAnother && (
        <button type="button" onClick={onAddAnother} className="mt-1 flex h-9 items-center gap-1 text-[13px] font-medium">
          <Plus className="h-3.5 w-3.5" /> Another {meet.level.toLowerCase()}
        </button>
      )}
    </div>
  );
}

/** Put items in order, most important first: ↑ ↓ on each, big enough for a thumb. */
export function RankingInput({
  items,
  value,
  readOnly,
  emptyText,
  onChange,
}: {
  items: RankItem[];
  value: unknown;
  readOnly: boolean;
  emptyText: string;
  onChange: (next: RankItem[]) => void;
}) {
  // The order on screen is the answer (saved as it is on Submit if it's never moved).
  const list = alignRanking(value, items);
  if (!list.length) return <p className="rounded-xl bg-muted px-3.5 py-3 text-[14px] text-muted-foreground">{emptyText}</p>;
  return (
    <ol className="space-y-2" data-ranking-input>
      {list.map((item, i) => (
        <li key={item.key} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-semibold tabular-nums">{i + 1}</span>
          <span className="min-w-0 flex-1 text-[15px] leading-snug">{item.label}</span>
          {!readOnly && list.length > 1 && (
            <span className="flex shrink-0">
              <button type="button" aria-label={`Move ${item.label} up`} disabled={i === 0} onClick={() => onChange(moveRank(list, i, -1))} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground disabled:opacity-30">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Move ${item.label} down`} disabled={i === list.length - 1} onClick={() => onChange(moveRank(list, i, 1))} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground disabled:opacity-30">
                <ArrowDown className="h-4 w-4" />
              </button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Options in groups (Men's / Women's): pick the group, then the class, as short chips. */
export function GroupedChoice({
  options,
  prefixes,
  value,
  sex,
  readOnly,
  onChange,
}: {
  options: string[];
  prefixes: string[];
  value: string;
  sex: string | null | undefined;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  const groups = groupOptions(options, prefixes);
  const [group, setGroup] = useState<string | null>(() => startGroup(prefixes, value, sex) ?? groups[0]?.prefix ?? null);
  const shown = groups.find((g) => g.prefix === group) ?? groups[0];
  return (
    <div className="space-y-2.5" data-grouped-choice>
      <div className="inline-flex rounded-full border border-border p-0.5" role="radiogroup" aria-label="Group">
        {groups.map((g) => (
          <button
            key={g.prefix}
            type="button"
            role="radio"
            aria-checked={shown?.prefix === g.prefix}
            disabled={readOnly}
            onClick={() => setGroup(g.prefix)}
            className={cn("h-9 rounded-full px-4 text-[14px] font-medium", shown?.prefix === g.prefix ? "bg-secondary text-foreground" : "text-muted-foreground")}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Class">
        {shown?.options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={readOnly} onClick={() => onChange(value === o.value ? "" : o.value)} className={chip(value === o.value)}>
            {o.short}
          </button>
        ))}
      </div>
    </div>
  );
}

