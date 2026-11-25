/**
 * Personal Context (Nov 25 2026): the coach-only section of a client's profile
 * (admin client page → Notes). What the coach knows about them outside the
 * training log: their work & lifestyle (the client's own answers, with where
 * each came from), the coach's private notes, how the coach knows them
 * (relationship labels: tone of messages only) and every change with its source
 * and time. Add context: type or say it, Cleo reads it into items, the coach
 * ticks what's right and saves; nothing on file is replaced unless he ticks it.
 * Never shown to the client (the server functions refuse anyone but staff who
 * reach this client, and RLS hides the tables).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChipGrid } from "@/components/client-goals/chip-grid";
import { LifestyleForm, lifestyleKey } from "@/components/client-context/lifestyle-questions";
import { useCoachVoice, VoiceButton, VoiceStatus } from "@/components/program-ai/coach-voice";
import { feedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { extractContextFn, getPersonalContextFn, saveContextFn, updateContextFactFn } from "@/lib/client-context/context.functions";
import {
  EXTRACT_MAX_INPUT,
  FACT_CATEGORY_LABEL,
  RELATIONSHIPS,
  SOURCE_LABEL,
  defaultTicks,
  historyLine,
  normalizeRelationship,
  type ContextFact,
  type ContextSource,
  type Extraction,
  type RelationshipKey,
} from "@/lib/client-context/lifestyle";

const pcKey = (clientId: string) => ["personal-context", clientId] as const;
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function PersonalContextCard({ clientId, className }: { clientId: string; className?: string }) {
  const get = useServerFn(getPersonalContextFn);
  const { data, isLoading, error } = useQuery({ queryKey: pcKey(clientId), queryFn: () => get({ data: { clientId } }), staleTime: 30_000 });
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: pcKey(clientId) });
    qc.invalidateQueries({ queryKey: lifestyleKey(clientId) });
  };

  return (
    <Card className={cn("space-y-5 p-4 sm:p-6", className)} data-personal-context>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Personal context</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">What Cleo and your messages fit around. The client never sees this section.</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" /> Coach only
        </span>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">Couldn't load their personal context.</p>
      ) : (
        <>
          <AddContext clientId={clientId} hasRelationship={!!data.relationship} onSaved={refresh} />
          <Section title="Relationship" hint="Private. Changes how familiar messages in your voice sound, never a coaching decision.">
            <RelationshipEditor key={JSON.stringify(data.relationship ?? null)} clientId={clientId} current={data.relationship} onSaved={refresh} />
          </Section>
          <Section title="Work & lifestyle" hint="Their own answers (they can change them in Account). Yours are marked as yours.">
            <LifestyleForm clientId={clientId} sources />
          </Section>
          <Section title="Private notes" hint="Context for you and Cleo. Never quoted to the client.">
            <FactList clientId={clientId} facts={data.facts as ContextFact[]} onSaved={refresh} />
          </Section>
          <History rows={data.history} />
        </>
      )}
    </Card>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Add context: type or say it → Cleo reads it → tick what's right → save     */

function AddContext({ clientId, hasRelationship, onSaved }: { clientId: string; hasRelationship: boolean; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Extraction | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const extract = useServerFn(extractContextFn);
  const save = useServerFn(saveContextFn);
  const voice = useCoachVoice((t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t)), "client_context");

  const read = useMutation({
    mutationFn: () => extract({ data: { clientId, text } }),
    onSuccess: (r) => {
      if (!r.ok) return void toast.error(r.reason);
      setResult(r.extraction);
      setTicks(defaultTicks(r.extraction, hasRelationship));
      if (!r.extraction.profile.length && !r.extraction.facts.length && !r.extraction.relationship) toast("Cleo didn't find anything new to add.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Cleo couldn't read that. Try again."),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const x = result!;
      const profile = Object.fromEntries(x.profile.filter((p) => ticks[`p:${p.field}`]).map((p) => [p.field, p.value]));
      const facts = x.facts.filter((_, i) => ticks[`f:${i}`]).map((f) => ({ category: f.category, text: f.text, validUntil: f.validUntil }));
      const rel = x.relationship && ticks.r ? { labels: x.relationship.labels, ...(x.relationship.custom ? { custom: x.relationship.custom } : {}) } : null;
      return save({ data: { clientId, source: "ai_confirmed", profile, facts, relationship: rel } });
    },
    onSuccess: () => {
      feedback("success");
      toast.success("Saved to their personal context");
      setResult(null);
      setText("");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that. Try again."),
  });

  // no Cleo: the words as one private note, exactly as typed
  const asNote = useMutation({
    mutationFn: () => save({ data: { clientId, source: "coach_provided", facts: [{ category: "other", text: text.trim() }] } }),
    onSuccess: () => {
      feedback("success");
      toast.success("Note saved");
      setText("");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that. Try again."),
  });

  const ticked = Object.values(ticks).some(Boolean);
  const busy = read.isPending || confirm.isPending || asNote.isPending;

  if (result) {
    const tick = (k: string) => (v: boolean | "indeterminate") => setTicks((t) => ({ ...t, [k]: v === true }));
    return (
      <div className="space-y-3 rounded-xl border border-border p-3" data-context-confirm>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" /> Cleo read this. Tick what's right.
        </div>
        <ul className="space-y-2 text-sm">
          {result.profile.map((p) => (
            <Row key={p.field} id={`p:${p.field}`} checked={!!ticks[`p:${p.field}`]} onChange={tick(`p:${p.field}`)}>
              <span className="text-muted-foreground">{p.fieldLabel}:</span> {p.label}
              {p.replaces && <span className="block text-xs text-warning">Replaces "{p.current}" on file</span>}
            </Row>
          ))}
          {result.facts.map((f, i) => (
            <Row key={`f${i}`} id={`f:${i}`} checked={!!ticks[`f:${i}`]} onChange={tick(`f:${i}`)}>
              <span className="text-muted-foreground">{FACT_CATEGORY_LABEL[f.category]}:</span> {f.text}
              {f.validUntil && <span className="text-xs text-muted-foreground"> (until {f.validUntil})</span>}
            </Row>
          ))}
          {result.relationship && (
            <Row id="r" checked={!!ticks.r} onChange={tick("r")}>
              <span className="text-muted-foreground">Relationship:</span> {result.relationship.words}
              {hasRelationship && <span className="block text-xs text-muted-foreground">Added to what's on file</span>}
            </Row>
          )}
        </ul>
        {result.dropped.length > 0 && <p className="text-xs text-muted-foreground">{result.dropped.join(" · ")}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setResult(null)} disabled={busy}>
            Back
          </Button>
          <Button type="button" size="sm" className="min-h-11" disabled={!ticked || busy} onClick={() => confirm.mutate()}>
            {confirm.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save ticked
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-add-context>
      <div className="flex items-start gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, EXTRACT_MAX_INPUT))}
          rows={3}
          placeholder="Add context: work, schedule, family, interests, how you know them… or paste a message"
          className="min-h-[88px] text-base sm:text-sm"
        />
        <VoiceButton voice={voice} disabled={busy} />
      </div>
      <VoiceStatus voice={voice} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy || !text.trim() || text.trim().length > 500} onClick={() => asNote.mutate()}>
          Save as a note
        </Button>
        <Button type="button" size="sm" className="min-h-11" disabled={busy || text.trim().length < 2} onClick={() => read.mutate()}>
          {read.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}Read with Cleo
        </Button>
      </div>
    </div>
  );
}

function Row({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean | "indeterminate") => void; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Checkbox id={`ctx-${id}`} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <label htmlFor={`ctx-${id}`} className="min-w-0 flex-1 leading-snug">
        {children}
      </label>
    </li>
  );
}

/* ------------------------------------------------------------------------ */
/* Relationship labels                                                       */

function RelationshipEditor({ clientId, current, onSaved }: { clientId: string; current: { labels: RelationshipKey[]; custom: string | null; note: string | null } | null; onSaved: () => void }) {
  const cur = normalizeRelationship(current ?? {});
  const [labels, setLabels] = useState<RelationshipKey[]>(cur.custom ? [...new Set([...cur.labels, "custom" as const])] : cur.labels);
  const [custom, setCustom] = useState(cur.custom ?? "");
  const [note, setNote] = useState(cur.note ?? "");
  const save = useServerFn(saveContextFn);
  const next = normalizeRelationship({ labels, custom: labels.includes("custom") ? custom : null, note });
  const changed = JSON.stringify(next) !== JSON.stringify(cur);
  const m = useMutation({
    mutationFn: () => save({ data: { clientId, source: "coach_provided", replaceLabels: true, relationship: { labels: next.labels, custom: next.custom, note: next.note } } }),
    onSuccess: () => {
      feedback("success");
      toast.success("Relationship saved");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that. Try again."),
  });
  return (
    <div className="space-y-2" data-relationship-editor>
      <ChipGrid
        multi
        options={RELATIONSHIPS.map((r) => r.key)}
        value={labels}
        labelFor={(k) => RELATIONSHIPS.find((r) => r.key === k)!.label}
        onChange={(v: RelationshipKey[]) => setLabels(v)}
        className="[&>button]:min-h-11 [&>button]:py-2"
      />
      {labels.includes("custom") && <Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={60} placeholder="Custom label, e.g. Cousin" className="h-11" />}
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Description (optional): how you know them" className="text-base sm:text-sm" />
      {changed && (
        <div className="flex justify-end">
          <Button type="button" size="sm" className="min-h-11" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save relationship
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Private facts                                                             */

function FactList({ clientId, facts, onSaved }: { clientId: string; facts: ContextFact[]; onSaved: () => void }) {
  const update = useServerFn(updateContextFactFn);
  const [showOld, setShowOld] = useState(false);
  const m = useMutation({
    mutationFn: (x: { id: string; status: "active" | "historical" }) => update({ data: { clientId, ...x } }),
    onSuccess: onSaved,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that. Try again."),
  });
  const active = facts.filter((f) => f.status === "active");
  const old = facts.filter((f) => f.status === "historical");
  const item = (f: ContextFact, action: { label: string; status: "active" | "historical" }) => (
    <li key={f.id} className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1 text-sm">
        <span className="text-muted-foreground">{FACT_CATEGORY_LABEL[f.category] ?? "Other"}:</span> {f.fact}
        <div className="text-[11px] text-muted-foreground">
          {SOURCE_LABEL[f.source as ContextSource] ?? "Coach"} · {when(f.created_at)}
          {f.valid_until ? ` · until ${f.valid_until}` : ""}
        </div>
      </div>
      <button type="button" disabled={m.isPending} onClick={() => f.id && m.mutate({ id: f.id, status: action.status })} className="min-h-9 shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline">
        {action.label}
      </button>
    </li>
  );
  return (
    <div>
      {active.length ? <ul className="divide-y divide-border">{active.map((f) => item(f, { label: "No longer true", status: "historical" }))}</ul> : <p className="text-sm text-muted-foreground">Nothing yet. Add context above.</p>}
      {old.length > 0 && (
        <div className="mt-1">
          <button type="button" onClick={() => setShowOld((v) => !v)} className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showOld && "rotate-180")} /> Earlier ({old.length})
          </button>
          {showOld && <ul className="divide-y divide-border opacity-70">{old.map((f) => item(f, { label: "Still true", status: "active" }))}</ul>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* History                                                                    */

function History({ rows }: { rows: Array<{ field: string; old_value: string | null; new_value: string | null; source: string; changed_at: string }> }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-11 items-center gap-1 text-sm font-semibold">
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> Change history
      </button>
      {open && (
        <ul className="divide-y divide-border text-sm" data-context-history>
          {rows.map((r, i) => {
            const h = historyLine(r);
            return (
              <li key={i} className="py-2">
                <div>
                  <span className="text-muted-foreground">{h.what}:</span> {h.change}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {h.source} · {when(r.changed_at)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
