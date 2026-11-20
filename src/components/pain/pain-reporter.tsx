/**
 * "Anything hurt?" → Yes: where, then how bad, and nothing else unless they
 * want to add it. One tap on the body (or the list) per place, one tap for
 * how bad; a place that came up in the last six weeks asks "since Nov 16:
 * better, same, worse, or something new?" instead of the whole form; what set
 * it off, how it feels, whether it changed the session and a note sit behind
 * "Add details". A common report is three taps.
 *
 * A severe place, numbness or tingling, a pop or swelling shows the safety
 * notice (safety.ts): the urgent signs, and "worth a physio or doctor's look".
 * That's the only advice the athlete sees here; anything about training or
 * recovery comes from their coach.
 */
import { useMemo, useState } from "react";
import { ChevronDown, Map as MapIcon, List, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { BodyMap } from "@/components/pain/body-map";
import { PAIN_REGIONS, REGION_GROUPS, areaLabel, regionOf, type PainSide } from "@/lib/pain/regions";
import { CHANGES, FEELS, IMPACTS, NOTE_MAX, SEVERITIES, TRIGGERS, type Feel } from "@/lib/pain/report";
import { followUpFor, shortDay, type PainEntry } from "@/lib/pain/history";
import { answerFollowUp, recentPlaces, togglePick, updatePick, type PainPick } from "@/lib/pain/picks";
import { CLIENT_SAFETY_NOTICE, needsSafetyNotice, URGENT_SIGNS } from "@/lib/pain/safety";

export type PainContext = {
  today: string;
  entries: PainEntry[];
  exercises: { id: string | null; name: string }[];
  feedbackId: string | null;
};

const chip = (on: boolean) =>
  cn(
    "inline-flex h-9 items-center justify-center rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-[0.97]",
    on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:bg-muted",
  );

function Segmented<T extends string>({ options, value, onPick, label, className }: { options: { v: T; label: string }[]; value: T | null | undefined; onPick: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={cn("grid rounded-lg border border-border p-0.5", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => {
            feedback("tap");
            onPick(o.v);
          }}
          aria-pressed={value === o.v}
          className={cn(
            "h-10 rounded-md text-[13px] font-semibold transition-colors",
            value === o.v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlaceRow({ p, ctx, onChange, onRemove }: { p: PainPick; ctx: PainContext | null; onChange: (patch: Partial<PainPick>) => void; onRemove: () => void }) {
  const region = regionOf(p.region);
  const label = p.region === "other" ? "Somewhere else" : areaLabel(p.region, p.side);
  const prior = useMemo(
    () => (ctx ? followUpFor(ctx.entries, p.region, p.side ?? null, { today: ctx.today, feedbackId: ctx.feedbackId }) : null),
    [ctx, p.region, p.side],
  );
  const followChoice = p.sameIssue === false ? "new" : p.sameIssue ? p.change ?? null : null;
  const detailCount = [p.trigger, p.feel?.length ? 1 : null, p.impact, p.note?.trim() ? 1 : null].filter(Boolean).length;
  const toggleFeel = (f: Feel) => onChange({ feel: (p.feel ?? []).includes(f) ? (p.feel ?? []).filter((x) => x !== f) : [...(p.feel ?? []), f] });

  return (
    <div className="space-y-2.5 rounded-xl border border-border p-3" data-pain-place={`${p.region}:${p.side ?? "-"}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{label}</span>
        <button type="button" onClick={onRemove} className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label={`Remove ${label}`}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <Segmented label={`${label}: how bad`} options={SEVERITIES} value={p.severity} onPick={(v) => onChange({ severity: v })} />

      {prior && (
        <div className="space-y-1.5" data-pain-followup>
          <p className="text-[12px] text-muted-foreground">
            You flagged this {shortDay(prior.date)}
            {prior.severity ? ` (${prior.severity})` : ""}. Since then?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...CHANGES, { v: "new" as const, label: "Something new" }].map((o) => (
              <button
                key={o.v}
                type="button"
                className={chip(followChoice === o.v)}
                aria-pressed={followChoice === o.v}
                onClick={() => {
                  feedback("tap");
                  onChange(answerFollowUp(p, o.v, prior));
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {p.open ? (
        <div className="space-y-3 pt-1" data-pain-details>
          {region && !region.sided && region.key !== "other" && region.lateral && (
            <div className="space-y-1.5">
              <p className="text-[12px] font-semibold text-muted-foreground">Which side?</p>
              <div className="flex flex-wrap gap-1.5">
                {([["L", "Left"], [null, "Middle"], ["R", "Right"]] as [PainSide | null, string][]).map(([v, l]) => (
                  <button key={l} type="button" className={chip((p.side ?? null) === v)} aria-pressed={(p.side ?? null) === v} onClick={() => onChange({ side: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {p.region === "other" && (
            <input
              value={p.note ?? ""}
              onChange={(e) => onChange({ note: e.target.value.slice(0, NOTE_MAX) })}
              placeholder="Where does it hurt?"
              aria-label="Where does it hurt?"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-foreground"
            />
          )}

          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-muted-foreground">What set it off?</p>
            <div className="flex flex-wrap gap-1.5">
              {TRIGGERS.map((t) => (
                <button key={t.v} type="button" className={chip(p.trigger === t.v)} aria-pressed={p.trigger === t.v} onClick={() => onChange({ trigger: p.trigger === t.v ? null : t.v })}>
                  {t.label}
                </button>
              ))}
            </div>
            {p.trigger === "exercise" &&
              (ctx?.exercises.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Which exercise">
                  {ctx.exercises.map((x) => {
                    const on = p.exerciseName === x.name;
                    return (
                      <button
                        key={x.name}
                        type="button"
                        className={cn(chip(on), "h-8 text-[12px]")}
                        aria-pressed={on}
                        onClick={() => onChange(on ? { exerciseName: null, exerciseId: null } : { exerciseName: x.name, exerciseId: x.id })}
                      >
                        {x.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  value={p.exerciseName ?? ""}
                  onChange={(e) => onChange({ exerciseName: e.target.value.slice(0, 120), exerciseId: null })}
                  placeholder="Which exercise?"
                  aria-label="Which exercise?"
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-foreground"
                />
              ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-muted-foreground">How does it feel?</p>
            <div className="flex flex-wrap gap-1.5">
              {FEELS.map((f) => {
                const on = (p.feel ?? []).includes(f.v);
                return (
                  <button key={f.v} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleFeel(f.v)}>
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-muted-foreground">Did it change your session?</p>
            <div className="flex flex-wrap gap-1.5">
              {IMPACTS.map((o) => (
                <button key={o.v} type="button" className={chip(p.impact === o.v)} aria-pressed={p.impact === o.v} onClick={() => onChange({ impact: p.impact === o.v ? null : o.v })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {p.region !== "other" && (
            <input
              value={p.note ?? ""}
              onChange={(e) => onChange({ note: e.target.value.slice(0, NOTE_MAX) })}
              placeholder="Anything else about it? (optional)"
              aria-label={`${label}: note`}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-foreground"
            />
          )}
        </div>
      ) : (
        <button type="button" onClick={() => onChange({ open: true })} className="inline-flex h-8 items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground" data-pain-add-details>
          {detailCount ? `Details (${detailCount})` : "Add details"} <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** The accessible list: every place by name, a Left / Right for the ones that come in pairs. */
function PlaceList({ picks, onToggle }: { picks: PainPick[]; onToggle: (place: { region: string; side: PainSide | null }) => void }) {
  const on = (region: string, side: PainSide | null) => picks.some((p) => p.region === region && (side == null || p.side === side));
  const btn = (active: boolean) =>
    cn("inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-[12px] font-semibold transition-colors", active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted-foreground/20");
  return (
    <div className="space-y-3" data-pain-list>
      {REGION_GROUPS.map((g) => (
        <div key={g.key} className="space-y-1.5">
          <p className="text-[12px] font-semibold text-muted-foreground">{g.label}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PAIN_REGIONS.filter((r) => r.group === g.key).map((r) =>
              r.sided ? (
                <div key={r.key} className="flex h-11 items-center justify-between gap-1 rounded-lg border border-border pl-2.5 pr-1">
                  <span className="min-w-0 text-[13px] font-medium leading-tight">{r.label}</span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" className={btn(on(r.key, "L"))} aria-pressed={on(r.key, "L")} aria-label={`Left ${r.label.toLowerCase()}`} onClick={() => onToggle({ region: r.key, side: "L" })}>L</button>
                    <button type="button" className={btn(on(r.key, "R"))} aria-pressed={on(r.key, "R")} aria-label={`Right ${r.label.toLowerCase()}`} onClick={() => onToggle({ region: r.key, side: "R" })}>R</button>
                  </span>
                </div>
              ) : (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on(r.key, null)}
                  onClick={() => onToggle({ region: r.key, side: null })}
                  className={cn("flex h-11 items-center rounded-lg border px-2.5 text-left text-[13px] font-medium transition-colors", on(r.key, null) ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}
                >
                  {r.label}
                </button>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PainReporter({ picks, onChange, ctx }: { picks: PainPick[]; onChange: (next: PainPick[]) => void; ctx: PainContext | null }) {
  const [mode, setMode] = useState<"map" | "list">("map");
  const recent = useMemo(() => (ctx ? recentPlaces(ctx.entries, ctx.feedbackId) : undefined), [ctx]);
  const toggle = (place: { region: string; side: PainSide | null }) => onChange(togglePick(picks, place));
  const safety = needsSafetyNotice(picks.map((p) => ({ region: p.region, side: p.side ?? null, severity: p.severity, feel: p.feel, trigger: p.trigger })));

  return (
    <div className="space-y-3" data-pain-reporter>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground" data-testid="pain-where">
          {picks.length ? "Tap more places, or tap one to take it off" : "Where? Tap all that hurt"}
        </p>
        <div className="flex shrink-0 rounded-lg border border-border p-0.5" role="group" aria-label="Pick from">
          {([["map", "Body", MapIcon], ["list", "List", List]] as const).map(([v, l, Icon]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              aria-pressed={mode === v}
              className={cn("inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold", mode === v ? "bg-secondary text-foreground" : "text-muted-foreground")}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {l}
            </button>
          ))}
        </div>
      </div>

      {mode === "map" ? (
        <div className="space-y-1">
          <BodyMap picked={picks.map((p) => ({ region: p.region, side: p.side ?? null }))} recent={recent} onToggle={toggle} className="h-[300px] w-auto max-w-full" />
          <button type="button" onClick={() => onChange(togglePick(picks, { region: "other", side: null }))} className="mx-auto block h-8 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
            Somewhere else?
          </button>
        </div>
      ) : (
        <PlaceList picks={picks} onToggle={toggle} />
      )}

      {picks.map((p) => (
        <PlaceRow key={p.uid} p={p} ctx={ctx} onChange={(patch) => onChange(updatePick(picks, p.uid, patch))} onRemove={() => onChange(picks.filter((x) => x.uid !== p.uid))} />
      ))}

      {safety && (
        <div className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[13px] leading-snug" data-pain-safety role="note">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden /> {CLIENT_SAFETY_NOTICE.title}
          </p>
          <p>{CLIENT_SAFETY_NOTICE.body}</p>
          <p className="text-muted-foreground">
            {CLIENT_SAFETY_NOTICE.urgentLead} {URGENT_SIGNS.join("; ")}.
          </p>
        </div>
      )}
    </div>
  );
}
