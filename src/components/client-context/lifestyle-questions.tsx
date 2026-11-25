/**
 * Work & lifestyle questions (Nov 25 2026, client-context/lifestyle.ts): one
 * tap each, saved the moment they're picked, conditional on what's already
 * said. Used by Goals & Setup's "Work & lifestyle" step, the Account page's
 * Complete your profile card and section, and the coach's Personal Context.
 * A client's own answer is saved as theirs; the database keeps every change.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, Loader2, Pencil, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChipGrid } from "@/components/client-goals/chip-grid";
import { feedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { getLifestyleFn, saveLifestyleFn } from "@/lib/client-context/context.functions";
import {
  EMPTY_LIFESTYLE,
  FIELD_LABEL,
  FIELD_OPTIONS,
  FIELD_PROMPT,
  applicableFields,
  keyForLabel,
  nextMissingItem,
  occupationMatches,
  optionLabel,
  profileCompletion,
  type ChoiceField,
  type Lifestyle,
  type LifestyleField,
} from "@/lib/client-context/lifestyle";

export const lifestyleKey = (clientId: string) => ["client-lifestyle", clientId] as const;

export function useLifestyle(clientId: string | null | undefined) {
  const get = useServerFn(getLifestyleFn);
  return useQuery({
    queryKey: lifestyleKey(clientId ?? ""),
    enabled: !!clientId,
    queryFn: () => get({ data: { clientId: clientId! } }),
    staleTime: 60_000,
  });
}

type SaveArgs = { patch?: { [field: string]: string | null }; decline?: LifestyleField[]; undecline?: LifestyleField[]; snooze?: LifestyleField | null };

export function useSaveLifestyle(clientId: string) {
  const save = useServerFn(saveLifestyleFn);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: SaveArgs) => save({ data: { clientId, ...(args as any) } }),
    onMutate: (args) => {
      // show the answer at once; the server's row replaces it
      qc.setQueryData(lifestyleKey(clientId), (old: any) => (old ? { ...old, lifestyle: { ...old.lifestyle, ...(args.patch ?? {}) } } : old));
    },
    onSuccess: (res) => {
      qc.setQueryData(lifestyleKey(clientId), (old: any) => (old ? { ...old, lifestyle: res.lifestyle } : old));
      qc.invalidateQueries({ queryKey: ["personal-context", clientId] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
      qc.invalidateQueries({ queryKey: lifestyleKey(clientId) });
    },
  });
}

const isChoice = (f: LifestyleField): f is ChoiceField => f !== "occupation" && f !== "employer";
const done = (l: Lifestyle, f: LifestyleField) => (l[f] != null && String(l[f]).trim() !== "") || l.declined.includes(f);

/** One question's one-tap answers (labels shown, keys saved). */
function Choices({ field, value, onPick, compact }: { field: ChoiceField; value: string | null; onPick: (key: string | null) => void; compact?: boolean }) {
  const labels = FIELD_OPTIONS[field].map((o) => o.label);
  return (
    <ChipGrid
      options={labels}
      value={optionLabel(field, value)}
      onChange={(label: string | null) => onPick(label ? keyForLabel(field, label) : null)}
      className={compact ? "[&>button]:min-h-11 [&>button]:py-2" : undefined}
    />
  );
}

/** Job title: type to search common ones, or keep exactly what was typed. */
export function OccupationInput({ value, onCommit, autoFocus, placeholder = "Search or type your job title" }: { value: string | null; onCommit: (v: string | null) => void; autoFocus?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => setText(value ?? ""), [value]);
  const matches = useMemo(() => occupationMatches(text), [text]);
  const typed = text.trim();
  const commit = (v: string) => {
    const t = v.trim();
    setText(t);
    setOpen(false);
    if (t !== (value ?? "")) onCommit(t || null);
  };
  return (
    <div className="relative" data-occupation-input>
      <Input
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={120}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => commit(text), 120)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          }
        }}
        className="h-12 text-base"
      />
      {open && typed && (matches.length > 0 || !matches.some((m) => m.toLowerCase() === typed.toLowerCase())) && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {matches.map((m) => (
            <li key={m}>
              <button type="button" role="option" aria-selected={m === value} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(m)} className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-muted">
                {m}
              </button>
            </li>
          ))}
          {!matches.some((m) => m.toLowerCase() === typed.toLowerCase()) && (
            <li>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(typed)} className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-muted">
                Use “<span className="font-medium text-foreground">{typed}</span>”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Goals & Setup's "Work & lifestyle" step: one question at a time, a tap saves
 * it and moves on, answered ones fold into a line above (tap to change), and
 * the whole step skips in one tap. Employment is the one a new client answers
 * (Prefer not to say counts); `onReady` says when the step can move on.
 */
export function LifestyleStep({ clientId, requireEmployment, onReady, onSkip }: { clientId: string; requireEmployment: boolean; onReady: (ready: boolean) => void; onSkip: () => void }) {
  const { data, isLoading } = useLifestyle(clientId);
  const save = useSaveLifestyle(clientId);
  const l = data?.lifestyle ?? EMPTY_LIFESTYLE;
  const [passed, setPassed] = useState<LifestyleField[]>([]);
  const [editing, setEditing] = useState<LifestyleField | null>(null);
  const { essential, optional } = applicableFields(l);
  const fields = [...essential, ...optional];
  const current = editing ?? fields.find((f) => !done(l, f) && !passed.includes(f)) ?? null;
  // only a client in their first setup must answer it (one tap, Prefer not to say counts); a coach never
  const must = requireEmployment && data?.actor === "client";
  const ready = !must || done(l, "employment_status");
  useEffect(() => onReady(ready), [ready, onReady]);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const pick = (f: LifestyleField, v: string | null) => {
    feedback("tap");
    setEditing(null);
    save.mutate({ patch: { [f]: v } });
  };
  const answeredRows = fields.filter((f) => f !== current && done(l, f));

  return (
    <div className="space-y-5" data-lifestyle-step>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold sm:text-lg">Work & lifestyle</h3>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">A few taps so your coach can fit training, recovery and meals around your day.</p>
        </div>
        {ready && (
          <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0" onClick={onSkip}>
            Skip
          </Button>
        )}
      </div>

      {answeredRows.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {answeredRows.map((f) => (
            <li key={f}>
              <button type="button" onClick={() => setEditing(f)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm">
                <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{FIELD_LABEL[f]}</span>
                <span className="ml-auto truncate font-medium">{l.declined.includes(f) ? "Rather not say" : optionLabel(f, l[f] as string)}</span>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {current ? (
        <div className="space-y-3" key={current}>
          <h4 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {FIELD_PROMPT[current]}
            {current === "employment_status" && must && !done(l, current) && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Required</span>
            )}
            {(current === "occupation" || current === "employer") && <span className="text-xs font-normal text-muted-foreground">Optional</span>}
          </h4>
          {isChoice(current) ? (
            <Choices field={current} value={(l[current] as string) ?? null} onPick={(v) => pick(current, v)} />
          ) : (
            <div className="space-y-2">
              {current === "occupation" ? (
                <OccupationInput value={l.occupation} onCommit={(v) => pick("occupation", v)} />
              ) : (
                <Input
                  defaultValue={l.employer ?? ""}
                  placeholder="Company or organization"
                  maxLength={120}
                  className="h-12 text-base"
                  enterKeyHint="done"
                  onBlur={(e) => e.target.value.trim() !== (l.employer ?? "") && pick("employer", e.target.value.trim() || null)}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                />
              )}
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setEditing(null); setPassed((p) => [...p, current]); }}>
                Skip this one
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4" /> All set. Tap Next to keep going.
        </p>
      )}
    </div>
  );
}

/**
 * Complete your profile (Account): a compact indicator and the next missing
 * answer right there (one tap, under 10 seconds), essentials before optional
 * personalization. Declined answers count as done; it's gone once complete.
 */
export function CompleteProfileCard({ clientId, preview }: { clientId: string; preview?: boolean }) {
  const { data } = useLifestyle(clientId);
  const save = useSaveLifestyle(clientId);
  const l = data?.lifestyle ?? null;
  const item = l ? nextMissingItem(l) : null;
  if (!data?.coaching || !l || !item) return null;
  const c = profileCompletion(l);
  const later = () => save.mutate(item.essential ? { snooze: item.field } : { decline: [item.field] });
  return (
    <Card className="space-y-3 p-4" data-complete-profile>
      <div className="flex items-center gap-3">
        <div className="relative grid h-10 w-10 shrink-0 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-muted" />
            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-foreground" strokeDasharray={`${(c.percent / 100) * 97.4} 97.4`} />
          </svg>
          <span className="text-[11px] font-semibold tabular-nums">{c.percent}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Complete your profile</div>
          <div className="text-xs text-muted-foreground">{item.essential ? "Helps your coach fit your plan around your day" : "Optional, for a more personal plan"}</div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">{item.prompt}</div>
        {item.options ? (
          <Choices field={item.field as ChoiceField} value={null} compact onPick={(v) => !preview && v && (feedback("tap"), save.mutate({ patch: { [item.field]: v } }))} />
        ) : item.field === "occupation" ? (
          <OccupationInput value={null} onCommit={(v) => !preview && v && save.mutate({ patch: { occupation: v } })} />
        ) : (
          <Input placeholder="Company or organization" maxLength={120} className="h-11" onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} onBlur={(e) => !preview && e.target.value.trim() && save.mutate({ patch: { employer: e.target.value.trim() } })} />
        )}
        <button type="button" disabled={preview || save.isPending} onClick={later} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          {item.essential ? "Not now" : "Rather not say"}
        </button>
      </div>
    </Card>
  );
}

/** Every work & lifestyle answer, each changeable in place (Account → Work & lifestyle; the coach's Personal Context). */
export function LifestyleForm({ clientId, preview, sources }: { clientId: string; preview?: boolean; sources?: boolean }) {
  const { data, isLoading } = useLifestyle(clientId);
  const save = useSaveLifestyle(clientId);
  const l = data?.lifestyle ?? EMPTY_LIFESTYLE;
  const [open, setOpen] = useState<LifestyleField | null>(null);
  const { essential, optional } = applicableFields(l);
  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="divide-y divide-border" data-lifestyle-form>
      {[...essential, ...optional].map((f) => {
        const declined = l.declined.includes(f);
        const shown = declined ? "Rather not say" : optionLabel(f, l[f] as string);
        const meta = l.field_meta[f];
        return (
          <div key={f} className="py-2">
            <button type="button" disabled={preview} onClick={() => setOpen(open === f ? null : f)} className="flex min-h-11 w-full items-center gap-2 text-left text-sm">
              <span className="text-muted-foreground">{FIELD_LABEL[f]}</span>
              <span className={cn("ml-auto truncate font-medium", !shown && "text-muted-foreground")}>{shown ?? "Add"}</span>
              <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open === f && "rotate-90")} />
            </button>
            {sources && meta?.source && !declined && shown && (
              <div className="-mt-1 text-right text-[11px] text-muted-foreground">
                {meta.source === "client_reported" ? "From the client" : meta.source === "ai_confirmed" ? "From Cleo, confirmed" : "From the coach"}
                {meta.at ? ` · ${new Date(meta.at).toLocaleDateString()}` : ""}
              </div>
            )}
            {open === f && (
              <div className="space-y-2 pb-2 pt-1">
                {isChoice(f) ? (
                  <Choices field={f} value={(l[f] as string) ?? null} compact onPick={(v) => { save.mutate({ patch: { [f]: v } }); setOpen(null); }} />
                ) : f === "occupation" ? (
                  <OccupationInput value={l.occupation} autoFocus onCommit={(v) => { save.mutate({ patch: { occupation: v } }); setOpen(null); }} />
                ) : (
                  <Input defaultValue={l.employer ?? ""} autoFocus maxLength={120} className="h-11" placeholder="Company or organization" onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== l.employer) save.mutate({ patch: { employer: v } }); setOpen(null); }} />
                )}
                {/* employment has its own "Prefer not to say" answer */}
                {f !== "employment_status" ? (
                  <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { save.mutate(declined ? { undecline: [f] } : { decline: [f], patch: { [f]: null } }); setOpen(null); }}>
                    {declined ? "Answer it after all" : "Rather not say"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      {!essential.length && <p className="py-2 text-sm text-muted-foreground"><UserRound className="mr-1 inline h-4 w-4" /> Nothing to add.</p>}
    </div>
  );
}

/** The Account row's summary: their work in a few words, or how much is left. */
export function lifestyleSummary(l: Lifestyle | null | undefined): { text: string; warn?: boolean } {
  if (!l) return { text: "Not started", warn: true };
  const c = profileCompletion(l);
  const s = l.employment_status && l.employment_status !== "prefer_not" ? optionLabel("employment_status", l.employment_status) : null;
  const words = [l.occupation ?? s, l.work_schedule ? optionLabel("work_schedule", l.work_schedule) : null].filter(Boolean).join(" · ");
  if (c.complete) return { text: words || "Complete" };
  return { text: words || `${c.percent}% complete`, warn: !words };
}
