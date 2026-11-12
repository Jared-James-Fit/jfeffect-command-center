/**
 * Supplements on a nutrition plan (supplements.ts): the list as the client and
 * coach read it, the AI plan's review (what the evidence rules picked, what's
 * left out and why, extras to add), and the editor's section to change them.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pill, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { suggestSupplementsFn } from "@/lib/nutrition-ai-plans.functions";
import { planSupplementsFrom, toPlanItem, type PlanSupplement, type PlanSupplements, type SupplementAdvice, type SupplementPick } from "@/lib/nutrition-targets/supplements";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<SupplementPick["tier"], string> = { core: "Core", consider: "Worth it", check: "Check first" };

/** The plan's supplements: name and dose, when, why, and the lines under them. */
export function SupplementList({ value, compact, className }: { value: PlanSupplements; compact?: boolean; className?: string }) {
  if (!value.items.length && !value.notes.length) return null;
  return (
    <div className={cn("space-y-3", className)} data-plan-supplements>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {value.items.map((s, i) => (
          <li key={`${s.name}-${i}`} className="space-y-0.5 px-3 py-3">
            <div className="text-[15px] font-medium">{s.name}</div>
            {s.dose ? <div className="text-[14px]">{s.dose}</div> : null}
            {s.timing ? <div className="text-[13px] text-muted-foreground">{s.timing}</div> : null}
            {!compact && s.why ? <div className="text-[13px]">{s.why}</div> : null}
            {!compact && s.note ? <div className="text-[12px] leading-5 text-muted-foreground">{s.note}</div> : null}
          </li>
        ))}
      </ul>
      {!compact && value.notes.length > 0 && (
        <ul className="space-y-1.5 text-[13px] text-muted-foreground">
          {value.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The AI plan's supplements before publishing: the picks (× takes one off),
 * extras worth adding if the budget allows (+ adds), what was left out and
 * why, and anything for the coach. Changes save with `onChange`.
 */
export function AiSupplementsReview({
  advice,
  onChange,
  busy,
}: {
  advice: SupplementAdvice;
  onChange: (next: { picks: SupplementPick[]; extras: SupplementPick[] }) => void;
  busy?: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const coachNotes = advice.notes.filter((n) => n.for === "coach");
  const move = (p: SupplementPick, toPicks: boolean) =>
    onChange(
      toPicks
        ? { picks: [...advice.picks, p], extras: advice.extras.filter((x) => x.key !== p.key) }
        : { picks: advice.picks.filter((x) => x.key !== p.key), extras: [p, ...advice.extras] },
    );
  return (
    <div className="space-y-2" data-ai-supplements>
      <div className="flex items-center gap-2">
        <Pill className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-[15px] font-semibold">Supplements</span>
        {advice.tested && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">Drug-tested: certified only</span>}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {coachNotes.map((n) => (
        <p key={n.text} className="text-[13px] text-warning">
          {n.text}
        </p>
      ))}
      {advice.picks.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {advice.picks.map((p) => (
            <li key={p.key} className="flex items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-medium">{p.name}</span>
                  <span className={cn("text-[12px]", p.tier === "check" ? "text-warning" : "text-muted-foreground")}>
                    {TIER_LABEL[p.tier]}
                    {p.already ? " · already takes it" : ""} · {p.cost}
                  </span>
                </div>
                <div className="text-[13px] text-muted-foreground">
                  {p.dose} · {p.timing}
                </div>
                <div className="text-[12px] text-muted-foreground">{p.reason}</div>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`Leave out ${p.name}`} onClick={() => move(p, false)} disabled={busy}>
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">None for this plan.</p>
      )}
      {advice.extras.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted-foreground">If the budget allows:</span>
          {advice.extras.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => move(p, true)}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-[13px] hover:bg-muted"
              title={p.reason}
            >
              <Plus className="h-3.5 w-3.5" /> {p.name}
            </button>
          ))}
        </div>
      )}
      {(advice.skipped.length > 0 || advice.notes.some((n) => n.for === "client")) && (
        <button type="button" className="text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowWhy((v) => !v)}>
          {showWhy ? "Hide" : "What's left out and the notes they get"}
        </button>
      )}
      {showWhy && (
        <div className="space-y-2 text-[13px]">
          {advice.skipped.length > 0 && (
            <ul className="space-y-1">
              {advice.skipped.map((s) => (
                <li key={s.name}>
                  <span className="font-medium">{s.name}:</span> <span className="text-muted-foreground">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {planSupplementsFrom(advice).notes.map((n) => (
            <p key={n} className="text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The editor's Supplements: each one's name, dose, when, why and note, the
 * lines under them, and "Suggest from their record" (the same evidence rules
 * as the AI plan, from what's on file now and this plan's foods).
 */
export function SupplementsEditor({
  clientId,
  value,
  onChange,
  foods,
  kcal,
}: {
  clientId?: string | null;
  value: PlanSupplements;
  onChange: (v: PlanSupplements) => void;
  /** The plan's meals as text (for fish / whey). */
  foods?: string;
  kcal?: number | null;
}) {
  const suggestFn = useServerFn(suggestSupplementsFn);
  const [loading, setLoading] = useState(false);
  const setItem = (i: number, patch: Partial<PlanSupplement>) => onChange({ ...value, items: value.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const suggest = async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const advice = (await suggestFn({ data: { clientId, foods: foods ?? null, kcal: kcal ?? null } })) as SupplementAdvice;
      const next = planSupplementsFrom(advice);
      onChange(next);
      const extra = advice.extras.length ? ` Also worth it if the budget allows: ${advice.extras.map((x) => x.name).join(", ")}.` : "";
      toast.success(`${next.items.length} suggested from their record.${extra}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't suggest supplements");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-3" data-supplements-editor>
      <p className="text-[13px] text-muted-foreground">
        Food first; only what's worth it. Suggestions follow the evidence and their record: health, medications, diet, drug testing and budget.
      </p>
      {value.items.map((s, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex gap-2">
            <Input value={s.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Name (e.g. Creatine monohydrate)" className="h-11 text-[16px]" />
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label={`Remove ${s.name || "supplement"}`}
              onClick={() => onChange({ ...value, items: value.items.filter((_, j) => j !== i) })}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={s.dose} onChange={(e) => setItem(i, { dose: e.target.value })} placeholder="Dose (e.g. 5 g a day)" className="h-11 text-[16px]" />
            <Input value={s.timing} onChange={(e) => setItem(i, { timing: e.target.value })} placeholder="When (e.g. with breakfast)" className="h-11 text-[16px]" />
          </div>
          <Textarea value={s.why ?? ""} onChange={(e) => setItem(i, { why: e.target.value || null })} placeholder="Why (what they read)" rows={2} className="text-[15px]" />
          <Textarea value={s.note ?? ""} onChange={(e) => setItem(i, { note: e.target.value || null })} placeholder="Note (how to pick one, cautions)" rows={2} className="text-[15px]" />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11 gap-1.5" onClick={() => onChange({ ...value, items: [...value.items, toPlanItem({ name: "", dose: "", timing: "" })] })}>
          <Plus className="h-4 w-4" /> Add
        </Button>
        {clientId && (
          <Button variant="outline" className="h-11 gap-1.5" onClick={suggest} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Suggest from their record
          </Button>
        )}
      </div>
      <NotesBox key={value.notes.join("\n")} notes={value.notes} onChange={(notes) => onChange({ ...value, notes })} />
    </div>
  );
}

/** One note per line; read into the list when the box is left, so typing a new line never loses it. */
function NotesBox({ notes, onChange }: { notes: string[]; onChange: (notes: string[]) => void }) {
  const [text, setText] = useState(notes.join("\n"));
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium">Notes under the list</span>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split("\n").map((l) => l.trim()).filter(Boolean))}
        placeholder="One per line (e.g. drug testing, timing with medications)"
        rows={3}
        className="text-[15px]"
      />
    </label>
  );
}
