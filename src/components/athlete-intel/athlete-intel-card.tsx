/**
 * Athlete information on the competition's Overview (Nov 26 2026): one
 * compact card. Add information is always one tap; "Information needed" shows
 * only when a genuinely important question is open (one at a time); key
 * findings and recommendations only when there are some; files fold away,
 * each opening to what was read from it (correct, dismiss, restore, replace,
 * delete). While anything is being read it says so and refreshes itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, FileSpreadsheet, FileText, FileVideo, Image as ImageIcon, Loader2, NotebookPen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  answerQuestionFn,
  applyRecommendationsFn,
  applyMeetFileFactsFn,
  factActionFn,
  getIntelFn,
  requestAnswerFn,
  sourceActionFn,
  sourceFileFn,
} from "@/lib/athlete-intel/intel.functions";
import { MEET_LOGISTICS_LABELS } from "@/lib/competition/attachment-intake";
import { defaultMeetFileSelection, validMeetFileValue, type MeetFileProposal } from "@/lib/athlete-intel/meet-files";
import { factLine } from "@/lib/athlete-intel/findings";
import { PROVIDER_LABEL, PURPOSE_LABEL, type Fact, type FactKind } from "@/lib/athlete-intel/types";
import { AddInfoSheet } from "./add-info-sheet";

export const intelKey = (clientId: string, competitionId: string | null) => ["athlete-intel", clientId, competitionId] as const;

const STATUS_WORD: Record<string, string> = {
  uploading: "Uploading",
  queued: "Waiting to be read",
  reading: "Reading",
  waiting_consent: "Partly read",
  waiting_ai: "Waiting for AI",
  ready: "Read",
  stored: "Kept",
  failed: "Couldn't be read",
  replaced: "Older version",
  deleted: "Deleted",
};
const KIND_ICON: Record<string, any> = { xlsx: FileSpreadsheet, csv: FileSpreadsheet, docx: FileText, pdf: FileText, image: ImageIcon, video: FileVideo, text: NotebookPen, manual: NotebookPen };
const FACT_GROUP: Array<[FactKind[], string]> = [
  [["attempt_plan", "warmup"], "Attempts and warm-ups"],
  [["training"], "Training"],
  [["meet"], "Meets"],
  [["cue", "technique", "instruction", "preference", "taper", "note"], "Coaching notes and cues"],
  [["equipment", "bodyweight", "risk"], "Equipment, bodyweight and pain"],
];
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(iso.length <= 10 ? { timeZone: "UTC" } : {}) }) : "";

export function AthleteIntelCard({
  clientId,
  competitionId,
  athleteFirst,
  coachName,
  coachContactOk,
  onChanged,
}: {
  clientId: string;
  competitionId: string | null;
  athleteFirst: string;
  coachName: string | null;
  coachContactOk: boolean;
  /** the competition read changed (new facts move the forecast and the gameplan draft) */
  onChanged?: () => void;
}) {
  const read = useServerFn(getIntelFn);
  const qc = useQueryClient();
  const [adding, setAdding] = useState<null | { replaces?: { id: string; name: string } | null; files?: File[] | null }>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const q = useQuery({
    queryKey: intelKey(clientId, competitionId),
    queryFn: () => read({ data: { clientId, competitionId } }),
    staleTime: 15_000,
    refetchInterval: (query) => ((query.state.data as any)?.pending ? 4_000 : false),
  });
  const data = q.data as any;
  // when reading finishes, the competition read (forecast, gameplan draft) moves with it
  const wasPending = useRef(0);
  useEffect(() => {
    const p = data?.pending ?? 0;
    if (wasPending.current && !p) onChanged?.();
    wasPending.current = p;
  }, [data?.pending, onChanged]);
  // a push link (?intel=1) lands here
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("intel") === "1") ref.current?.scrollIntoView({ block: "start" });
  }, []);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["athlete-intel", clientId] });
    onChanged?.();
  };

  if (q.isLoading) return <section className="h-16 animate-none rounded-2xl border border-border bg-muted/30" aria-busy="true" />;
  if (q.isError && !data)
    return (
      <section className="rounded-2xl border border-border p-4 text-[13px] text-muted-foreground">
        Athlete information couldn't load. <button className="underline" onClick={() => q.refetch()}>Try again</button>
      </section>
    );
  const sources: any[] = data?.sources ?? [];
  const findings: any[] = data?.findings ?? [];
  const recs: any[] = data?.recommendations ?? [];
  const question = data?.questions?.now?.[0] ?? null;
  const reading = sources.filter((s) => ["uploading", "queued", "reading", "waiting_ai"].includes(s.status));
  const latest = sources.find((s) => s.status === "ready" || s.status === "waiting_consent" || s.status === "stored");
  const shownFindings = showAll ? findings : findings.slice(0, 3);

  return (
    <section ref={ref} className="rounded-2xl border border-border bg-card p-3 sm:p-4" data-athlete-intel>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{competitionId ? "Competition files" : "Athlete information"}</h3>
          <p className="text-[12.5px] text-muted-foreground">
            {sources.length
              ? `${sources.length} item${sources.length === 1 ? "" : "s"} · used in meet preparation`
              : `Schedules, nominations, rules, logs and coach notes: Cleo reads them into ${athleteFirst}'s preparation.`}
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setAdding({})} data-intel-add-open>
          <Plus /> {competitionId ? "Upload files" : "Add"}
        </Button>
      </div>

      {reading.length ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground" data-intel-reading>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {reading.some((s) => s.status === "waiting_ai") ? "Waiting for AI to read the rest: it carries on by itself" : `Reading ${reading.length} item${reading.length === 1 ? "" : "s"}…`}
        </p>
      ) : latest && latest.summary?.line && Date.now() - Date.parse(latest.analyzed_at ?? latest.updated_at) < 6 * 3600_000 ? (
        <p className="mt-3 text-[13px]" data-intel-latest>
          <span className="text-muted-foreground">{latest.file_name ?? "Your note"}: </span>
          {latest.summary.line}.
          {latest.summary.impact?.before && latest.summary.impact?.after ? (
            <span className="text-muted-foreground"> Expected total {latest.summary.impact.before} → {latest.summary.impact.after} kg.</span>
          ) : (
            <span className="text-muted-foreground"> Read and organized; meet changes require confirmation.</span>
          )}
        </p>
      ) : null}

      {competitionId && data?.meetLogistics?.length ? (
        <MeetFileReview key={competitionId} competitionId={competitionId} proposals={data.meetLogistics} onDone={refresh} />
      ) : null}
      {question ? <QuestionBlock q={question} more={data.questions.later} athleteFirst={athleteFirst} coachContactOk={coachContactOk} onDone={refresh} /> : null}

      {findings.length ? (
        <div className="mt-3" data-intel-findings>
          <p className="text-[12px] font-medium text-muted-foreground">Key findings</p>
          <ul className="mt-1 space-y-1">
            {shownFindings.map((f) => (
              <li key={f.key}>
                <details className="group">
                  <summary className="cursor-pointer list-none text-[14px] leading-snug [&::-webkit-details-marker]:hidden">
                    {f.text}
                  </summary>
                  {f.detail ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{f.detail}</p> : null}
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    From {f.sourceIds.map((id: string) => sources.find((s) => s.id === id)?.file_name ?? "a note").join(", ") || "uploaded information"}
                  </p>
                </details>
              </li>
            ))}
          </ul>
          {findings.length > 3 ? (
            <button type="button" className="mt-1 text-[12.5px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowAll((x) => !x)}>
              {showAll ? "Fewer" : `All ${findings.length}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {recs.length && competitionId ? <Recommendations recs={recs} competitionId={competitionId} onDone={refresh} /> : null}

      {sources.length || (data?.deleted ?? []).length ? (
        <details className="mt-3 border-t border-border pt-2" data-intel-files>
          <summary className="cursor-pointer text-[13px] text-muted-foreground">Files and notes ({sources.length})</summary>
          <ul className="mt-1 divide-y divide-border">
            {sources.map((s) => {
              const Icon = KIND_ICON[s.kind] ?? FileText;
              return (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setOpenSource(s.id)} data-intel-source={s.status}>
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px]">{s.file_name ?? "Typed note"}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {s.provider_name || PROVIDER_LABEL[s.provider as keyof typeof PROVIDER_LABEL]} · {day(s.created_at)}
                        {s.summary?.line ? ` · ${s.summary.line}` : ""}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-[11.5px]", s.status === "failed" ? "text-destructive" : s.status === "waiting_consent" ? "text-warning" : "text-muted-foreground")}>
                      {STATUS_WORD[s.status] ?? s.status}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
          {(data?.deleted ?? []).length ? <DeletedList rows={data.deleted} onDone={refresh} /> : null}
        </details>
      ) : null}

      <AddInfoSheet
        open={!!adding}
        onOpenChange={(o) => !o && setAdding(null)}
        clientId={clientId}
        competitionId={competitionId}
        athleteFirst={athleteFirst}
        coachName={coachName}
        coachContactOk={coachContactOk}
        replaces={adding?.replaces ?? null}
        initialFiles={adding?.files ?? null}
        onSent={refresh}
      />
      <SourceSheet
        source={sources.find((s) => s.id === openSource) ?? null}
        facts={(data?.facts ?? []) as Fact[]}
        onClose={() => setOpenSource(null)}
        onReplace={(s) => {
          setOpenSource(null);
          setAdding({ replaces: { id: s.id, name: s.file_name ?? "this file" } });
        }}
        onDone={refresh}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */


/** One confirmation, with source evidence and coach overrides kept distinct. */
function MeetFileReview({ competitionId, proposals, onDone }: {
  competitionId: string;
  proposals: MeetFileProposal[];
  onDone: () => Promise<void>;
}) {
  const apply = useServerFn(applyMeetFileFactsFn);
  // Only explicit user choices are stored. Newly read, non-conflicting fields
  // default to selected; a changed source or before-value requires a fresh review.
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const rowKey = (p: MeetFileProposal) => JSON.stringify([p.factId, p.before, p.value, p.conflict]);
  const available = proposals.filter(p => !saved.includes(rowKey(p)));
  const defaults = new Set(defaultMeetFileSelection(available));
  const selected = available.filter(p => choices[rowKey(p)] ?? defaults.has(p.factId));
  const safe = available.filter(p => !p.conflict);
  const selectedSafe = safe.filter(p => selected.includes(p)).length;
  const invalid = selected.some(p => !validMeetFileValue(p.field, edits[rowKey(p)] ?? p.value));
  const pick = (p: MeetFileProposal, checked: boolean) => {
    setChoices(old => {
      const next = { ...old, [rowKey(p)]: checked };
      if (checked) for (const other of available) {
        if (other.field === p.field && other.factId !== p.factId) next[rowKey(other)] = false;
      }
      return next;
    });
  };
  const selectAll = () => setChoices(old => {
    const next = { ...old };
    for (const p of safe) next[rowKey(p)] = true;
    return next;
  });
  const clearAll = () => setChoices(Object.fromEntries(available.map(p => [rowKey(p), false])));
  const run = useMutation({
    mutationFn: () => apply({ data: {
      competitionId,
      updates: selected.map(p => ({
        factId: p.factId,
        before: p.before,
        extracted: p.value,
        value: (edits[rowKey(p)] ?? p.value).trim(),
      })),
    } }),
    onSuccess: async (r) => {
      const fields = new Set(selected.map(p => p.field));
      setSaved(old => [...old, ...available.filter(p => fields.has(p.field)).map(rowKey)]);
      setEditing(null);
      toast.success(r.count === 1 ? "Meet detail updated" : `${r.count} meet details updated`);
      if (r.scheduleWarning) toast.warning("Saved. Schedule refresh will be retried by the competition worker.");
      await onDone();
    },
    onError: async (e: any) => {
      toast.error(e?.message ?? "Couldn't save these updates");
      await onDone();
    },
  });
  if (!available.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-muted/35" data-meet-file-proposals>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <div>
          <p className="text-[14px] font-semibold">Review meet details <span className="font-normal text-muted-foreground">({available.length})</span></p>
          <p className="text-[12px] text-muted-foreground">Edit or uncheck before confirming.</p>
        </div>
        <span className="text-[12px] font-medium tabular-nums">{selected.length} selected</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-[12px]">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <Checkbox aria-label="Select all non-conflicting updates" disabled={run.isPending || !safe.length} checked={safe.length > 0 && selectedSafe === safe.length ? true : selectedSafe > 0 ? "indeterminate" : false} onCheckedChange={v => v === true ? selectAll() : setChoices(old => ({ ...old, ...Object.fromEntries(safe.map(p => [rowKey(p), false])) }))} />
          {available.some(p => p.conflict) ? "Select all clear" : "Select all"}
        </label>
        <button type="button" disabled={run.isPending} onClick={clearAll} className="text-muted-foreground hover:text-foreground hover:underline">Deselect all</button>
      </div>
      {available.some(p => p.conflict) ? <p className="px-3 pt-2 text-[12px] text-warning">Sources disagree. Choose at most one value per field.</p> : null}
      <div className="divide-y divide-border px-3">
        {available.map(p => {
          const k = rowKey(p);
          const value = edits[k] ?? p.value;
          const label = MEET_LOGISTICS_LABELS[p.field] ?? p.field;
          const valid = validMeetFileValue(p.field, value);
          return (
            <div key={k} className="py-2.5" data-meet-file-row={p.field}>
              <div className="flex items-start gap-2.5">
                <Checkbox className="mt-1" aria-label={`Select ${label}: ${p.value}`} disabled={run.isPending} checked={selected.includes(p)} onCheckedChange={v => pick(p, v === true)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-medium">{label}</span>
                    {p.conflict ? <span className="text-[11px] text-warning">Conflict</span> : null}
                    {value !== p.value ? <span className="text-[11px] text-muted-foreground">Edited</span> : null}
                  </div>
                  {editing === k ? (
                    <div className="mt-1">
                      <Input autoFocus disabled={run.isPending} aria-label={`Edit ${label}`} aria-invalid={!valid} className="h-8 w-full max-w-xs bg-background text-[13px]" type={["weigh_in_at", "lifting_start"].includes(p.field) ? "time" : "text"} value={value} onChange={e => setEdits(old => ({...old, [k]: e.target.value}))} onKeyDown={e => { if (e.key === "Enter" && valid) setEditing(null); }} />
                      {!valid ? <p className="mt-1 text-[11px] text-destructive">Enter a valid value.</p> : null}
                    </div>
                  ) : (
                    <div className="break-words text-[13px]"><span className="text-muted-foreground">{p.before || "Not set"} → </span><span className={cn("font-medium", !valid && "text-destructive")}>{value || "Empty"}</span></div>
                  )}
                  <details className="mt-0.5 text-[11.5px] text-muted-foreground">
                    <summary className="cursor-pointer break-words">{p.source}{p.location ? " · " + p.location : ""}</summary>
                    <p className="break-words">{p.quote}</p>
                    {value !== p.value ? <p>Original extraction: {p.value}</p> : null}
                  </details>
                </div>
                <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2" disabled={run.isPending} aria-label={editing === k ? `Done editing ${label}` : `Edit ${label}`} onClick={() => setEditing(editing === k ? null : k)}>{editing === k ? "Done" : "Edit"}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-border bg-card px-3 py-2.5">
        <span className="text-[11.5px] text-muted-foreground">Only selected details will change.</span>
        <Button size="sm" className="shrink-0" disabled={!selected.length || invalid} loading={run.isPending} onClick={() => run.mutate()} data-meet-file-confirm>
          Confirm {selected.length} {selected.length === 1 ? "update" : "updates"}
        </Button>
      </div>
    </div>
  );
}

function QuestionBlock({ q, more, athleteFirst, coachContactOk, onDone }: { q: any; more: number; athleteFirst: string; coachContactOk: boolean; onDone: () => void }) {
  const answer = useServerFn(answerQuestionFn);
  const ask = useServerFn(requestAnswerFn);
  const [num, setNum] = useState("");
  const [date, setDate] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; to: "athlete" | "primary_coach"; link: string | null } | null>(null);
  const run = useMutation({
    mutationFn: (v: { value: string; number?: number | null; date?: string | null }) => answer({ data: { questionId: q.id, ...v } }),
    onSuccess: () => {
      toast.success("Saved: preparation updated");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const request = useMutation({
    mutationFn: (o: { to: "athlete" | "primary_coach"; send?: boolean; text?: string | null }) => ask({ data: { questionId: q.id, to: o.to, send: !!o.send, text: o.text ?? null } }),
    onSuccess: (r: any, o) => {
      if (o.send || r.sent) {
        toast.success(`Sent to ${athleteFirst}`);
        setDraft(null);
        onDone();
        return;
      }
      setDraft({ text: r.text, to: o.to, link: r.link });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't prepare that"),
  });
  const opts: Array<{ value: string; label: string }> = q.answer?.options ?? [];
  const kind = q.answer?.kind as string;
  return (
    <div className="mt-3 rounded-xl border border-warning/40 bg-warning/5 p-3" data-intel-question={q.key}>
      <p className="text-[12px] font-medium text-warning">Information needed</p>
      <p className="mt-0.5 text-[14px] font-medium leading-snug">{q.text}</p>
      {q.why ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{q.why}</p> : null}
      {q.askedAt ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">Asked {q.askedVia === "athlete_chat" ? athleteFirst : "their coach"} {day(q.askedAt)}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {kind === "date" ? (
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-auto text-[13px]" />
            <Button size="sm" disabled={!date} loading={run.isPending} onClick={() => run.mutate({ value: "date", date })}>
              Save
            </Button>
          </>
        ) : (
          opts
            .filter((o) => o.value !== "unknown")
            .map((o) =>
              o.value === "other" ? (
                <Button key={o.value} size="sm" variant={picked === "other" ? "default" : "outline"} onClick={() => setPicked("other")}>
                  {o.label}
                </Button>
              ) : (
                <Button key={o.value} size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal py-1 text-left" loading={run.isPending && picked === o.value} onClick={() => (setPicked(o.value), run.mutate({ value: o.value }))}>
                  {o.label}
                </Button>
              ),
            )
        )}
        {picked === "other" ? (
          <>
            <Input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value)} placeholder="kg" className="h-8 w-20 text-[13px]" />
            <Button size="sm" disabled={!(Number(num) > 0)} loading={run.isPending} onClick={() => run.mutate({ value: "other", number: Number(num) })}>
              Save
            </Button>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        {(q.askWho ?? []).includes("athlete") ? (
          <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => request.mutate({ to: "athlete" })}>
            Ask {athleteFirst}
          </button>
        ) : null}
        {(q.askWho ?? []).includes("primary_coach") && coachContactOk ? (
          <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => request.mutate({ to: "primary_coach" })}>
            Ask their coach
          </button>
        ) : null}
        <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => run.mutate({ value: "unknown" })}>
          Skip for now
        </button>
        {more ? <span className="text-muted-foreground">· {more} more after this</span> : null}
      </div>
      {draft ? (
        <div className="mt-2 space-y-2 rounded-lg bg-background p-2">
          <textarea className="min-h-[70px] w-full resize-y rounded-md border border-border bg-background p-2 text-[13px]" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <div className="flex gap-2">
            {draft.to === "athlete" ? (
              <Button size="sm" loading={request.isPending} onClick={() => request.mutate({ to: "athlete", send: true, text: draft.text })}>
                Send in their chat
              </Button>
            ) : (
              <Button size="sm" onClick={() => navigator.clipboard?.writeText(draft.text).then(() => toast.success("Copied: send it to their coach"))}>
                Copy message
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Recommendations({ recs, competitionId, onDone }: { recs: any[]; competitionId: string; onDone: () => void }) {
  const apply = useServerFn(applyRecommendationsFn);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(recs.map((r) => r.key)));
  const run = useMutation({
    mutationFn: () => apply({ data: { competitionId, keys: [...chosen] } }),
    onSuccess: (r: any) => {
      toast.success(r?.version ? `Gameplan draft v${r.version} is ready to review` : "Nothing to change");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't draft that"),
  });
  return (
    <div className="mt-3" data-intel-recs>
      <p className="text-[12px] font-medium text-muted-foreground">Recommendations for the approved gameplan</p>
      <ul className="mt-1 space-y-1.5">
        {recs.map((r) => (
          <li key={r.key} className="flex items-start gap-2">
            <Checkbox
              checked={chosen.has(r.key)}
              onCheckedChange={(v) =>
                setChosen((s) => {
                  const n = new Set(s);
                  if (v === true) n.add(r.key);
                  else n.delete(r.key);
                  return n;
                })
              }
              className="mt-0.5"
            />
            <span className="text-[14px] leading-snug">
              {r.text}
              {r.detail ? <span className="block text-[12px] text-muted-foreground">{r.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" className="mt-2" disabled={!chosen.size} loading={run.isPending} onClick={() => run.mutate()}>
        Put these in a new draft to review
      </Button>
      <p className="mt-1 text-[11.5px] text-muted-foreground">The approved plan stays as it is until you approve the new version.</p>
    </div>
  );
}

function DeletedList({ rows, onDone }: { rows: any[]; onDone: () => void }) {
  const act = useServerFn(sourceActionFn);
  return (
    <div className="mt-2 border-t border-border pt-2">
      <p className="text-[11.5px] text-muted-foreground">Recently deleted (kept 30 days)</p>
      {rows.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 py-1 text-[12.5px]">
          <span className="truncate text-muted-foreground">{s.file_name ?? "Typed note"}</span>
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => act({ data: { sourceId: s.id, action: "restore" } }).then(onDone, (e) => toast.error(e?.message))}>
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SourceSheet({ source, facts, onClose, onReplace, onDone }: { source: any | null; facts: Fact[]; onClose: () => void; onReplace: (s: any) => void; onDone: () => void }) {
  const act = useServerFn(sourceActionFn);
  const file = useServerFn(sourceFileFn);
  const run = useMutation({
    mutationFn: (action: "retry" | "delete" | "restore_version") => act({ data: { sourceId: source.id, action } }),
    onSuccess: (_r, action) => {
      toast.success(action === "delete" ? "Deleted: restore it from Recently deleted" : action === "retry" ? "Reading it again" : "Restored");
      onDone();
      if (action === "delete") onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
  });
  const mine = useMemo(() => (source ? facts.filter((f) => f.source_id === source.id) : []), [facts, source]);
  if (!source) return null;
  return (
    <Sheet open={!!source} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-intel-source-sheet>
        <SheetHeader className="text-left">
          <SheetTitle className="break-words">{source.file_name ?? "Typed note"}</SheetTitle>
          <SheetDescription>
            From {source.provider_name || PROVIDER_LABEL[source.provider as keyof typeof PROVIDER_LABEL].toLowerCase()} · added {day(source.created_at)}
            {(source.detected_purposes?.length ? source.detected_purposes : source.purposes)?.length
              ? ` · ${(source.purposes?.length ? source.purposes : source.detected_purposes).map((p: string) => PURPOSE_LABEL[p as keyof typeof PURPOSE_LABEL] ?? p).join(", ")}`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3 text-[13.5px]">
          <p>
            <span className="font-medium">{STATUS_WORD[source.status] ?? source.status}</span>
            {source.summary?.line ? ` · ${source.summary.line}` : ""}
          </p>
          {source.error ? <p className={cn("text-[13px]", source.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{source.error}</p> : null}
          {(source.summary?.notes ?? []).map((n: string, i: number) => (
            <p key={i} className="text-[12.5px] text-muted-foreground">
              {n}
            </p>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {source.file_path ? (
              <Button size="sm" variant="outline" onClick={() => file({ data: { sourceId: source.id } }).then((r: any) => (r.url ? window.open(r.url, "_blank", "noopener") : toast.error("The file isn't there")))}>
                Open original
              </Button>
            ) : null}
            {["failed", "waiting_ai", "waiting_consent", "ready"].includes(source.status) ? (
              <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate("retry")}>
                Read again
              </Button>
            ) : null}
            {source.status === "replaced" ? (
              <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate("restore_version")}>
                Use this version again
              </Button>
            ) : source.file_path ? (
              <Button size="sm" variant="outline" onClick={() => onReplace(source)}>
                Replace with a newer version
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="text-destructive" loading={run.isPending} onClick={() => run.mutate("delete")}>
              Delete
            </Button>
          </div>
          {mine.length ? (
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-[12px] text-muted-foreground">What Cleo read from it ({mine.filter((f) => f.status === "active").length} in use)</p>
              {FACT_GROUP.map(([kinds, label]) => {
                const list = mine.filter((f) => kinds.includes(f.kind));
                if (!list.length) return null;
                return (
                  <div key={label}>
                    <p className="text-[12px] font-medium">{label}</p>
                    <ul className="mt-0.5 space-y-1">
                      {list.slice(0, 80).map((f) => (
                        <FactRow key={f.id} f={f} onDone={onDone} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FactRow({ f, onDone }: { f: Fact; onDone: () => void }) {
  const act = useServerFn(factActionFn);
  const [editing, setEditing] = useState(false);
  const d: any = f.data;
  const [load, setLoad] = useState(String(d.loadKg ?? ""));
  const [reps, setReps] = useState(String(d.reps ?? ""));
  const run = useMutation({
    mutationFn: (o: { action: "dismiss" | "restore" | "correct"; data?: Record<string, unknown> }) => act({ data: { factId: f.id, ...o } }),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const off = f.status !== "active";
  return (
    <li className={cn("text-[13px]", off && "text-muted-foreground")} data-intel-fact={f.kind}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          {f.date ? <span className="text-muted-foreground">{day(f.date)} · </span> : null}
          {factLine(f)}
          {f.basis !== "source" ? <span className="text-muted-foreground"> · {f.basis === "coach" ? "corrected" : "answered"}</span> : null}
          {off ? <span> · {f.status === "superseded" ? "replaced by a newer one" : "dismissed"}</span> : null}
          {f.location || f.quote ? (
            <span className="block truncate text-[11.5px] text-muted-foreground" title={f.quote ?? undefined}>
              {f.location ?? ""}
              {f.quote ? ` · "${f.quote}"` : ""}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 gap-2 text-[11.5px]">
          {f.kind === "training" && !off ? (
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing((x) => !x)}>
              Fix
            </button>
          ) : null}
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => run.mutate({ action: f.status === "dismissed" ? "restore" : "dismiss" })}>
            {f.status === "dismissed" ? "Restore" : "Dismiss"}
          </button>
        </span>
      </div>
      {editing ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Input inputMode="decimal" value={load} onChange={(e) => setLoad(e.target.value)} className="h-8 w-20 text-[13px]" aria-label="kg" placeholder="kg" />
          <Input inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} className="h-8 w-16 text-[13px]" aria-label="reps" placeholder="reps" />
          {(["completed", "prescribed"] as const).map((c) => (
            <Button key={c} size="sm" variant={d.completion === c ? "default" : "outline"} onClick={() => run.mutate({ action: "correct", data: { completion: c, loadKg: load ? Number(load) : null, reps: Number(reps) } })}>
              {c === "completed" ? "Done" : "Prescribed"}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
