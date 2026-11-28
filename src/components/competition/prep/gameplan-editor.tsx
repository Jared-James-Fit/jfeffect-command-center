/**
 * Editing a gameplan: attempts, each lift's warm-up ladder, racks, gear, the
 * day's food and fluids, contacts. The coach edits everything; an athlete
 * edits only their warm-ups, racks, gear and the day (attempts are their own
 * coach's or the handler's call), and what they save is a suggestion, never
 * the approved plan. Numbers are kilograms; a typed attempt off the
 * federation's increment is pointed out, not silently changed.
 */
import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { dualLoad, inputKg, roundUpWeight, weightNumber, kgIn, type WeightUnit } from "@/lib/dual-weight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkGameplan, LIFTS, type GameplanDoc, type WarmupRow } from "@/lib/competition/gameplan";
import type { FederationRules } from "@/lib/competition/rules";
import type { Lift } from "@/lib/competition/types";

const WORD: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const n = (s: string): number | null => {
  const v = Number(String(s).replace(",", ".").replace(/[^\d.]/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

export function GameplanEditor({
  initial,
  onDraftCues,
  rules,
  who,
  saving,
  onSave,
  onCancel,
}: {
  initial: GameplanDoc;
  onDraftCues?:()=>Promise<Record<Lift,string[]>>;
  rules: FederationRules;
  who: "coach" | "athlete";
  saving?: boolean;
  onSave: (plan: GameplanDoc, mode: "draft" | "approve" | "suggest", note?: string) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<GameplanDoc>(() => JSON.parse(JSON.stringify(initial)));
  const [note, setNote] = useState("");
  const [cueText,setCueText]=useState(()=>Object.fromEntries(LIFTS.map(l=>[l,(initial.cues[l]??[]).join("\n")])) as Record<Lift,string>);
  const [drafting,setDrafting]=useState(false);
  const [cueError,setCueError]=useState("");
  async function organizeCues(){
    if(!onDraftCues||drafting)return;
    setDrafting(true);setCueError("");
    try{
      const result=await onDraftCues();
      const supplied=LIFTS.filter(l=>result[l].length);
      setCueText(old=>({...old,...Object.fromEntries(supplied.map(l=>[l,result[l].join("\n")]))}));
      setP(old=>({...old,cues:{...old.cues,...Object.fromEntries(supplied.map(l=>[l,result[l]]))}}));
    }catch(e){setCueError(e instanceof Error?e.message:"Couldn't organize cues.");}
    finally{setDrafting(false);}
  }
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
  const problems = useMemo(() => checkGameplan(p, rules), [p, rules]);
  const errors = problems.filter((x) => x.severity === "error");
  const coach = who === "coach";

  const setAttempt = (l: Lift, k: "opener" | "second" | "third", v: number | null) =>
    setP((x) => ({
      ...x,
      attempts: {
        ...x.attempts,
        [l]: { ...(x.attempts[l] ?? { opener: null, second: null, third: null, status: "confirmed", source: "coach" }), [k]: v, status: "confirmed", source: "coach" },
      },
    }));
  const setRows = (l: Lift, rows: WarmupRow[]) =>
    setP((x) => ({ ...x, warmups: { ...x.warmups, [l]: { rows, status: "confirmed", source: coach ? "coach" : "athlete" } } }));
  const setRack = (l: "squat" | "bench", k: "height" | "safety" | "footBlocks", v: string) =>
    setP((x) => ({
      ...x,
      equipment: {
        ...x.equipment,
        status: "confirmed",
        racks: { ...x.equipment.racks, [l]: { height: null, safety: null, ...(x.equipment.racks[l] ?? {}), [k]: v.trim() || null } },
      },
    }));

  return (
    <div className="space-y-4" data-gameplan-editor={who}>
      {coach ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold">Attempts</h3>
            <div className="flex items-center gap-1 text-xs" aria-label="Gameplan input unit">
              {(["kg", "lb"] as const).map(u => <Button key={u} type="button" size="sm" variant={u === weightUnit ? "default" : "outline"} aria-pressed={u === weightUnit} className="h-8 px-2" onClick={() => setWeightUnit(u)}>{u}</Button>)}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-[4.5rem_1fr_1fr_1fr] items-center gap-2 text-[13px]">
            <span />
            <span className="text-muted-foreground">Opener</span>
            <span className="text-muted-foreground">Second</span>
            <span className="text-muted-foreground">Third</span>
            {LIFTS.map((l) => (
              <AttemptRow key={l} lift={l} p={p} onChange={setAttempt} rules={rules} unit={weightUnit} />
            ))}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">On {rules.incrementKg} kg steps, each at least one step over the last.</p>
        </section>
      ) : null}

      {coach && <section className="rounded-2xl border border-border bg-card p-4 space-y-2"><h3 className="text-[15px] font-semibold">Coaching cues</h3><p className="text-xs text-muted-foreground">Write up to 12 short cues per lift in setup order. Use the athlete’s own preferences and specify when to stay quiet.</p>{onDraftCues&&<Button type="button" size="sm" variant="outline" disabled={drafting} onClick={()=>void organizeCues()}>{drafting?"Organizing…":"Organize with Cleo"}</Button>}{cueError&&<p role="alert" className="text-sm text-destructive">{cueError}</p>}{LIFTS.map(l=><label key={l} className="block space-y-1 text-sm">{WORD[l]}<Textarea rows={3} value={cueText[l]} disabled={drafting} onChange={e=>{const value=e.target.value;setCueText(x=>({...x,[l]:value}));setP(x=>({...x,cues:{...x.cues,[l]:value.split("\n").map(s=>s.trim()).filter(Boolean).slice(0,12)}}));}} placeholder="Approach: …&#10;Brace: …"/></label>)}</section>}
      {LIFTS.map((l) => (
        <WarmupRows key={l} lift={l} rows={p.warmups[l]?.rows ?? []} opener={p.attempts[l]?.opener ?? null} onChange={(rows) => setRows(l, rows)} unit={weightUnit} />
      ))}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">Racks and gear</h3>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
          <span className="text-muted-foreground">Squat height</span>
          <span className="text-muted-foreground">Squat safeties</span>
          <span />
          <Input value={p.equipment.racks.squat?.height ?? ""} onChange={(e) => setRack("squat", "height", e.target.value)} aria-label="Squat rack height" />
          <Input value={p.equipment.racks.squat?.safety ?? ""} onChange={(e) => setRack("squat", "safety", e.target.value)} aria-label="Squat safety height" />
          <span />
          <span className="text-muted-foreground">Bench height</span>
          <span className="text-muted-foreground">Bench safeties</span>
          <span className="text-muted-foreground">Foot blocks</span>
          <Input value={p.equipment.racks.bench?.height ?? ""} onChange={(e) => setRack("bench", "height", e.target.value)} aria-label="Bench rack height" />
          <Input value={p.equipment.racks.bench?.safety ?? ""} onChange={(e) => setRack("bench", "safety", e.target.value)} aria-label="Bench safety height" />
          <Input value={p.equipment.racks.bench?.footBlocks ?? ""} onChange={(e) => setRack("bench", "footBlocks", e.target.value)} aria-label="Foot blocks" />
        </div>
        <label className="mt-3 block text-[13px] text-muted-foreground">
          Gear (comma separated)
          <Input
            className="mt-1"
            value={p.equipment.gear.join(", ")}
            onChange={(e) => setP((x) => ({ ...x, equipment: { ...x.equipment, gear: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } }))}
          />
        </label>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">Food, fluids and the day</h3>
        <label className="mt-2 block text-[13px] text-muted-foreground">
          After weigh-in
          <Textarea
            className="mt-1"
            rows={2}
            value={p.day.afterWeighIn.join("\n")}
            onChange={(e) => setP((x) => ({ ...x, day: { ...x.day, afterWeighIn: lines(e.target.value) } }))}
          />
        </label>
        <label className="mt-2 block text-[13px] text-muted-foreground">
          Between lifts
          <Textarea
            className="mt-1"
            rows={2}
            value={p.day.during.join("\n")}
            onChange={(e) => setP((x) => ({ ...x, day: { ...x.day, during: lines(e.target.value) } }))}
          />
        </label>
        <label className="mt-2 block text-[13px] text-muted-foreground">
          Notes
          <Textarea
            className="mt-1"
            rows={2}
            value={p.day.notes.join("\n")}
            onChange={(e) => setP((x) => ({ ...x, day: { ...x.day, notes: lines(e.target.value) } }))}
          />
        </label>
      </section>

      {coach ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-[15px] font-semibold">Who does what</h3>
          <ul className="mt-2 space-y-2">
            {p.contacts.map((c, i) => (
              <li key={i} className="grid grid-cols-2 gap-2">
                <Input value={c.name} placeholder="Name" onChange={(e) => setP((x) => ({ ...x, contacts: x.contacts.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
                <Input value={c.role} placeholder="Role" onChange={(e) => setP((x) => ({ ...x, contacts: x.contacts.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)) }))} />
                <Input value={c.phone ?? ""} placeholder="Phone" onChange={(e) => setP((x) => ({ ...x, contacts: x.contacts.map((y, j) => (j === i ? { ...y, phone: e.target.value || null } : y)) }))} />
                <Input value={c.responsibility ?? ""} placeholder="Responsible for" onChange={(e) => setP((x) => ({ ...x, contacts: x.contacts.map((y, j) => (j === i ? { ...y, responsibility: e.target.value || null } : y)) }))} />
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() => setP((x) => ({ ...x, contacts: [...x.contacts, { name: "", role: "Helper", phone: null, responsibility: null }] }))}
          >
            <Plus className="h-4 w-4" /> Add someone
          </Button>
        </section>
      ) : (
        <label className="block text-[13px] text-muted-foreground">
          A note for {""}your handler (optional)
          <Textarea className="mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}

      {problems.length ? (
        <ul className="space-y-1 text-[13px]" data-plan-problems>
          {problems.map((x, i) => (
            <li key={i} className={x.severity === "error" ? "text-destructive" : "text-warning"}>
              {x.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="sticky bottom-[calc(var(--bottom-nav-clearance,0px)+0.5rem)] flex flex-wrap justify-end gap-2 rounded-2xl border border-border bg-background/95 p-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {coach ? (
          <>
            <Button variant="outline" loading={saving} onClick={() => onSave(clean(p), "draft")} data-save-draft>
              Save draft
            </Button>
            <Button loading={saving} disabled={!!errors.length} onClick={() => onSave(clean(p), "approve")} data-approve-plan>
              Approve
            </Button>
          </>
        ) : (
          <Button loading={saving} onClick={() => onSave(clean(p), "suggest", note)} data-suggest-plan>
            Send to my handler
          </Button>
        )}
      </div>
    </div>
  );
}

function lines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}
function clean(p: GameplanDoc): GameplanDoc {
  return { ...p, contacts: p.contacts.filter((c) => c.name.trim()) };
}

/** The plan stores kg. A unit toggle is presentation only. Draft text is local
 * until blur; an explicit rounding click commits the exact standard step. */
function MeetWeightCell({ kg, unit, onChange, label, marker, incrementKg, confirmed, required = false }: {
  kg: number | null; unit: WeightUnit; onChange: (v: number | null) => void;
  label: string; marker?: string; incrementKg?: number; confirmed?: boolean; required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const raw = draft ?? (kg == null ? "" : weightNumber(kgIn(kg, unit), 2));
  const parsed = raw.trim() && /^\d+(?:[.,]\d*)?$/.test(raw.trim()) ? Number(raw.replace(",", ".")) : null;
  const exact = draft == null ? kg : parsed != null && parsed > 0 ? inputKg(parsed, unit) : null;
  const next = exact != null && incrementKg != null ? roundUpWeight(exact, incrementKg) : null;
  const finish = () => {
    if (draft == null) return;
    if (exact != null) onChange(exact);
    else if (!required && !raw.trim()) onChange(null);
    setDraft(null);
  };
  return <div className="min-w-0 space-y-0.5">
    <Input inputMode="decimal" value={raw} onFocus={e => e.currentTarget.select()} onChange={e => setDraft(e.target.value)}
      onBlur={finish} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      aria-label={label} data-attempt-input={marker} className="h-9 w-full max-w-20 px-2 tabular-nums" />
    <p className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">{exact == null ? unit : dualLoad(exact, unit).secondary}</p>
    {next != null && <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 px-1.5 py-1 text-[10px] leading-tight whitespace-normal"
      title={confirmed ? "Round to the meet's standard increment" : "Standard increment; confirm the meet rules"} onClick={() => { setDraft(null); onChange(next); }}>Round up {next} kg</Button>}
  </div>;
}

function AttemptRow({ lift, p, onChange, rules, unit }: { lift: Lift; p: GameplanDoc; onChange: (l: Lift, k: "opener" | "second" | "third", v: number | null) => void; rules: FederationRules; unit: WeightUnit }) {
  const a = p.attempts[lift];
  return (
    <>
      <span className="text-[14px] font-medium">{WORD[lift]}</span>
      {(["opener", "second", "third"] as const).map((k) => (
        <MeetWeightCell key={k + unit} kg={a?.[k] ?? null} unit={unit} onChange={v => onChange(lift, k, v)}
          label={`${WORD[lift]} ${k} (${unit})`} marker={`${lift}:${k}`} incrementKg={rules.incrementKg} confirmed={rules.confirmed} />
      ))}
    </>
  );
}

function WarmupRows({ lift, rows, opener, onChange, unit }: { lift: Lift; rows: WarmupRow[]; opener: number | null; onChange: (rows: WarmupRow[]) => void; unit: WeightUnit }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-warmup-editor={lift}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">{WORD[lift]} warm-ups</h3>
        {opener != null ? <span className="text-[12px] text-muted-foreground">Opener {dualLoad(opener, "kg").primary} ({dualLoad(opener, "kg").secondary})</span> : null}
      </div>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r, i) => (
          <li key={`${i}:${r.kg}:${r.reps}:${rows.length}`} className="flex items-center gap-2">
            <MeetWeightCell key={unit} kg={r.kg} unit={unit} required onChange={v => { if (v != null) onChange(rows.map((x,j) => j === i ? {...x, kg: v} : x)); }} label={`${WORD[lift]} warm-up ${i + 1} ${unit}`} />
            <span className="text-[13px] text-muted-foreground">{unit} ×</span>
            <Input
              inputMode="numeric"
              className="h-10 w-16 tabular-nums"
              defaultValue={r.reps}
              onBlur={(e) => {
                const v = n(e.target.value);
                if (v != null && v >= 1) onChange(rows.map((x, j) => (j === i ? { ...x, reps: Math.round(v) } : x)));
              }}
              aria-label={`${WORD[lift]} warm-up ${i + 1} reps`}
            />
            <Button size="icon" variant="ghost" aria-label="Remove this set" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Minus className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1"
        onClick={() => {
          const last = rows[rows.length - 1];
          onChange([...rows, { kg: last ? last.kg + 10 : 20, reps: 1, minutesBefore: null }]);
        }}
      >
        <Plus className="h-4 w-4" /> Add a set
      </Button>
    </section>
  );
}
