/**
 * After a meeting (coach only), compact: what Cleo did and what still needs
 * the coach, then the meeting's outcome (feedback, what to improve, decisions,
 * who does what, measurable objectives, open concerns, loads to confirm in kg
 * or lb), Cleo's recommendations as rows whose status never claims more than
 * happened (Suggested · Needs review · Approved, not applied yet · Applied ·
 * Kept as is · Later · Dismissed), commitments, memories, the recap to send
 * if the coach wants, and the recording or transcript behind it (speakers to
 * name, lines to correct, deletion). Nothing is sent or changed on its own:
 * approving a training, nutrition or cardio change puts it in that plan's own
 * Cleo box to review and apply there.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, FileText, Plus, Quote, Send, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HandlingOpportunities } from "@/components/competition/prep/handling-opportunities";
import {
  analyseNotesFn,
  commitmentFn,
  decideRecommendationFn,
  deleteTranscriptFn,
  importTranscriptFn,
  markRecommendationAppliedFn,
  recordingDeleteAudioFn,
  recordingEditLineFn,
  recordingSpeakersFn,
  sendSessionSummaryFn,
  updateSessionFn,
} from "@/lib/coaching-sessions/sessions.functions";
import { plainTranscript, type MeetingAnalysis } from "@/lib/coaching-sessions/analysis";
import {
  organizeOutcome,
  recStatus,
  REC_STATUS_WORDS,
  workSummary,
  type OutcomeLine,
} from "@/lib/coaching-sessions/outcomes";
import {
  speakers as speakerList,
  transcriptLines,
  clock,
  type SpeakerRole,
} from "@/lib/coaching-sessions/recording";
import {
  draftGamePlan,
  gamePlanMessage,
  type GamePlan,
} from "@/lib/coaching-sessions/presentation";
import { handOffToCleo } from "@/lib/cleo-handoff";
import { queueComposerInsert } from "@/lib/composer-insert";
import { isCoachConsentMessage } from "@/lib/ai-consent/consent";
import { billingDay } from "@/lib/date-range";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { MemoryPanel } from "./memory-panel";

const AREA_WORDS: Record<string, string> = {
  training: "Training",
  nutrition: "Nutrition",
  cardio: "Cardio",
  recovery: "Recovery",
  schedule: "Schedule",
  competition: "Competition",
  communication: "Communication",
  coaching: "Coaching",
};
const TAB_FOR: Record<string, string> = {
  training: "training",
  nutrition: "nutrition",
  cardio: "cardio",
};
const STATUS_TONE: Record<string, string> = {
  suggested: "bg-secondary text-foreground",
  needs_review: "bg-warning/15 text-warning",
  approved: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  applied: "bg-success/10 text-success",
  kept: "bg-muted text-muted-foreground",
  later: "bg-muted text-muted-foreground",
  dismissed: "bg-muted text-muted-foreground",
};

export function SessionAfter({
  data,
  clientId,
  today,
  onOpenTab,
  refresh,
}: {
  data: any;
  clientId: string;
  today: string;
  onOpenTab?: (tab: string) => void;
  refresh: () => void;
}) {
  const s = data.session;
  const analysis: (MeetingAnalysis & { source?: string; model?: string }) | null = s.analysis ?? null;
  const working = s.analysis_status === "queued" || s.analysis_status === "running";
  const privateReview = analysis?.model === "private-extractive";
  const retryPrivate = useServerFn(analyseNotesFn);
  const retryReview = useMutation({
    mutationFn: () => retryPrivate({ data: { sessionId: s.id } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Could not start review"),
  });
  const decisions: string[] = useMemo(() => s.live?.decisions ?? [], [s.live?.decisions]);
  const outcome = useMemo(
    () =>
      organizeOutcome({
        analysis,
        decisions,
        commitments: data.commitments.filter((c: any) => c.session_id === s.id),
      }),
    [analysis, decisions, data.commitments, s.id],
  );
  const parts = useMemo(() => (data.audio ?? []) as any[], [data.audio]);
  const spk = useMemo(
    () => speakerList(parts, s.recording?.speakers ?? {}),
    [parts, s.recording?.speakers],
  );
  const summary = workSummary({
    analysisReady: !!analysis,
    source: s.recording?.transcript_ready ? "recording" : ((analysis?.source as any) ?? null),
    recs: data.recommendations,
    memories: data.intelligence,
    commitmentsProposed: (data.commitments as any[]).filter(
      (c) => c.session_id === s.id && c.confirmed === false && c.status === "open",
    ).length,
    recapSent: !!s.shared_at,
    unitChecks: analysis?.unitChecks?.length ?? 0,
    speakersToConfirm:
      s.recording?.transcript_ready && s.recording?.speakers_confirmed !== true && spk.length > 1
        ? 1
        : 0,
  });

  return (
    <div className="space-y-4" data-after>
      {analysis || summary.needs.length ? (
        <section
          className="flex items-start gap-3 rounded-2xl border border-border p-3"
          data-work-summary
        >
          <CleoAvatar className="h-7 w-7 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            {summary.did.length ? (
              <p className="text-[13px] text-muted-foreground">Cleo: {summary.did.join(" · ")}</p>
            ) : null}
            {summary.needs.length ? (
              <div className="flex flex-wrap gap-1.5">
                {summary.needs.map((n) => (
                  <span key={n} className="rounded-full bg-secondary px-2 py-0.5 text-[12px]">
                    {n}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-success">Nothing waiting on you.</p>
            )}
            {privateReview ? <p className="text-[12px] text-muted-foreground">Private review · transcript excerpts, not AI-generated recommendations.</p> : null}
            {analysis?.summary ? <Summary text={analysis.summary} /> : null}
          </div>
        </section>
      ) : null}

      {!data.cleo ? (
        <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
          Cleo isn't switched on for your account, so recordings and notes aren't read here. Your
          notes, decisions and commitments still work.
        </p>
      ) : working ? (
        <p
          className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-[13.5px]"
          data-analysis-working
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/50" /> Cleo is reading
          the {s.transcript_path ? "transcript" : "notes"}. It carries on if you close this.
        </p>
      ) : !analysis && (!s.recording?.consent || recordingGaveUp(s.recording, data.audio)) ? (
        <>
          {s.recording?.consent ? (
            <p className="text-[13px] text-muted-foreground" data-recording-gave-up>
              The recording didn't become a transcript. Upload one instead (Otter, notes or the
              call's own transcript).
            </p>
          ) : null}
          <Import data={data} refresh={refresh} />
        </>
      ) : !analysis && s.recording?.consent && !s.recording?.transcript_ready ? (
        <RecordingProgress parts={(data.audio ?? []) as any[]} />
      ) : null}
      {s.analysis_status === "failed" && isCoachConsentMessage(s.analysis_error) ? (
        data.cleo && (s.transcript_path || `${s.live?.notes ?? ""} ${(s.live?.decisions ?? []).join(" ")}`.trim().length >= 40) ? (
          <Button size="sm" variant="outline" loading={retryReview.isPending} onClick={() => retryReview.mutate()}>
            Review saved meeting
          </Button>
        ) : null
      ) : s.analysis_status === "failed" ? (
        <p
          className={cn(
            "text-[13px]",
            isCoachConsentMessage(s.analysis_error) ? "text-muted-foreground" : "text-destructive",
          )}
          data-ai-consent-refused={isCoachConsentMessage(s.analysis_error) || undefined}
        >
          {isCoachConsentMessage(s.analysis_error)
            ? s.analysis_error
            : `Cleo couldn't read it${s.analysis_error ? `: ${s.analysis_error}` : ""}.`}
        </p>
      ) : s.analysis_error?.startsWith("Waiting for AI") ? (
        <p className="text-[13px] text-muted-foreground">
          {s.analysis_error}. It'll carry on by itself.
        </p>
      ) : null}

      {s.recording?.transcript_ready && spk.length ? (
        <Speakers data={data} list={spk} refresh={refresh} />
      ) : null}

      <OutcomeGroups outcome={outcome} />

      <HandlingOpportunities sessionId={s.id} />

      {(data.recommendations as any[]).length ? (
        <section className="rounded-2xl border border-border" data-recommendations>
          <header className="px-3 py-2.5">
            <h3 className="text-[15px] font-semibold">What could change</h3>
          </header>
          <ul className="divide-y divide-border border-t border-border">
            {(data.recommendations as any[]).map((r) => (
              <RecRow
                key={r.id}
                r={r}
                clientId={clientId}
                sessionId={s.id}
                firstName={data.firstName}
                onOpenTab={onOpenTab}
                refresh={refresh}
              />
            ))}
          </ul>
        </section>
      ) : analysis && !privateReview ? (
        <p className="text-[13px] text-muted-foreground">
          No changes came out of this conversation. That's often the right answer.
        </p>
      ) : null}

      <Commitments
        sessionId={s.id}
        items={(data.commitments as any[]).filter(
          (c) => c.session_id === s.id || c.confirmed !== false,
        )}
        refresh={refresh}
      />

      {(data.intelligence as any[]).length ? (
        <MemoryPanel
          clientId={clientId}
          rows={data.intelligence}
          today={today}
          onChange={refresh}
          title="From this meeting"
          compact
        />
      ) : null}

      <Recap data={data} decisions={decisions} refresh={refresh} />

      {parts.some((p) => p.status === "done") ? (
        <TranscriptView data={data} refresh={refresh} />
      ) : null}
      {data.cleo && (s.transcript_path || s.transcript_deleted_at || parts.length) ? (
        <TranscriptControls
          s={s}
          refresh={refresh}
          hasAudio={parts.some((p) => p.status !== "deleted")}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Cleo's summary: three lines, the rest a tap away (the groups under it carry the detail). */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div>
      <p className={cn("text-[14px] leading-relaxed", long && !open && "line-clamp-3")}>{text}</p>
      {long ? (
        <button
          type="button"
          className="mt-0.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

/** A recording that will never become a transcript: its audio is gone, or every part failed. */
function recordingGaveUp(rec: any, audio: any[] | undefined): boolean {
  if (!rec?.consent || rec.transcript_ready) return false;
  if (rec.status === "expired" || rec.audio_deleted_at) return true;
  const parts = (audio ?? []) as any[];
  return (
    rec.status === "processing" && parts.length > 0 && parts.every((p) => p.status === "failed")
  );
}

/** Where a stopped recording is: parts transcribed so far, or waiting on the client's AI permission. */
function RecordingProgress({ parts }: { parts: any[] }) {
  if (!parts.length) return null;
  const waiting = parts.find((p) => p.status === "waiting_consent");
  const done = parts.filter((p) => p.status === "done" || p.status === "failed").length;
  return (
    <p
      className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-[13.5px]"
      data-recording-progress
    >
      {waiting ? (
        <span className="text-muted-foreground">
          {waiting.error ?? "Waiting on their permission for AI."} It carries on by itself once they
          allow it.
        </span>
      ) : (
        <>
          <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/50" />
          Turning the recording into a transcript: {done} of {parts.length} parts. It carries on if
          you close this.
        </>
      )}
    </p>
  );
}

function Fold({
  title,
  count,
  children,
  defaultOpen = false,
  tone,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  tone?: "warn";
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="text-[14px] font-medium">{title}</span>
        {count != null ? (
          <span
            className={cn(
              "text-[12px]",
              tone === "warn" ? "text-warning" : "text-muted-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </button>
      {open ? <div className="space-y-1.5 px-3 pb-2.5">{children}</div> : null}
    </div>
  );
}

function QuoteLine({ q }: { q?: string | null }) {
  if (!q) return null;
  return (
    <p className="flex gap-1.5 pl-1 text-[12px] italic text-muted-foreground">
      <Quote className="mt-0.5 h-3 w-3 shrink-0" />“{q}”
    </p>
  );
}

function OutcomeGroups({ outcome }: { outcome: ReturnType<typeof organizeOutcome> }) {
  const groups: Array<[string, OutcomeLine[], boolean?]> = [
    ["Key feedback", outcome.feedback, true],
    ["To improve", outcome.improve, true],
    ["Decided", outcome.decisions, true],
    ["Their part", outcome.clientDoes],
    ["Your part", outcome.coachDoes],
    ["Objectives", outcome.objectives],
    ["Wins", outcome.wins],
    ["Still open", outcome.concerns, true],
    ["Floated, not decided", outcome.floated],
  ];
  const shown = groups.filter(([, rows]) => rows.length);
  if (!shown.length) return null;
  return (
    <section className="rounded-2xl border border-border" data-outcome>
      <header className="px-3 py-2.5">
        <h3 className="text-[15px] font-semibold">Outcome</h3>
      </header>
      <div className="border-t border-border">
        {shown.map(([title, rows, open]) => (
          <Fold
            key={title}
            title={title}
            count={rows.length}
            defaultOpen={!!open}
            tone={title === "Still open" ? "warn" : undefined}
          >
            {rows.map((r, i) => (
              <div key={i}>
                <p className="text-[14px] leading-snug">
                  {r.text}
                  {r.due ? (
                    <span className="text-muted-foreground"> · by {billingDay(r.due)}</span>
                  ) : null}
                  {r.basis === "tentative" ? (
                    <span className="ml-1 rounded bg-muted px-1 text-[10.5px] text-muted-foreground">
                      floated
                    </span>
                  ) : null}
                </p>
                <QuoteLine q={r.quote} />
              </div>
            ))}
          </Fold>
        ))}
      </div>
    </section>
  );
}

function RecRow({
  r,
  clientId,
  sessionId,
  firstName,
  onOpenTab,
  refresh,
}: {
  r: any;
  clientId: string;
  sessionId: string;
  firstName: string | null;
  onOpenTab?: (tab: string) => void;
  refresh: () => void;
}) {
  const decide = useServerFn(decideRecommendationFn);
  const applied = useServerFn(markRecommendationAppliedFn);
  const addCommitment = useServerFn(commitmentFn);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>(r.proposed_text ?? "");
  const status = recStatus(r);
  const go = useMutation({
    mutationFn: async (
      st: "approved" | "edited" | "kept" | "rejected" | "deferred" | "clarify" | "proposed",
    ) => {
      const out = await decide({
        data: { id: r.id, status: st, proposed: st === "edited" ? text.trim() : null },
      });
      return { st, out };
    },
    onSuccess: async ({ st, out }) => {
      setEditing(false);
      refresh();
      if (st === "approved" || st === "edited") {
        const tab = TAB_FOR[out.area];
        if (tab && out.ask) {
          handOffToCleo(clientId, out.area as any, out.ask);
          toast.success(
            `Approved. It's in ${AREA_WORDS[out.area]}'s Cleo box: apply it there, then mark it applied`,
          );
          onOpenTab?.(tab);
        } else if (out.area === "communication" && out.ask) {
          queueComposerInsert(clientId, r.proposed_text ?? r.title);
          toast.success("Approved. It's in their chat box to read over and send");
        } else {
          await addCommitment({
            data: { sessionId, owner: "coach", text: r.title.slice(0, 400) },
          }).catch(() => null);
          toast.success("Approved and on your list for this client");
        }
      }
      if (st === "clarify") {
        queueComposerInsert(
          clientId,
          `Quick question from our call${firstName ? `, ${firstName}` : ""}: ${r.title.replace(/\.$/, "")}?`,
        );
        toast.success("A question is in their chat box to send");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const mark = useMutation({
    mutationFn: (v: boolean) => applied({ data: { id: r.id, applied: v } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const flags = (Array.isArray(r.flags) ? r.flags : []) as string[];
  return (
    <li className="px-3 py-2" data-recommendation={r.id}>
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-snug">{r.title}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {AREA_WORDS[r.area] ?? r.area}
            {r.proposed_text ? ` · ${r.proposed_text}` : r.kind === "keep" ? " · keep as is" : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
            STATUS_TONE[status],
          )}
          data-rec-status={status}
        >
          {REC_STATUS_WORDS[status]}
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-xl bg-muted/50 p-3">
          {r.current_text || r.proposed_text ? (
            <div className="grid gap-2 text-[13.5px] sm:grid-cols-2">
              {r.current_text ? (
                <p>
                  <span className="text-[11px] text-muted-foreground">Now</span>
                  <br />
                  {r.current_text}
                </p>
              ) : null}
              {r.proposed_text ? (
                <div>
                  <span className="text-[11px] text-muted-foreground">Proposed</span>
                  {editing ? (
                    <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                  ) : (
                    <p>{r.proposed_text}</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          {r.reason ? (
            <p className="text-[13.5px]">
              <span className="text-muted-foreground">Why: </span>
              {r.reason}
            </p>
          ) : null}
          {r.benefit ? (
            <p className="text-[13px] text-muted-foreground">Impact: {r.benefit}</p>
          ) : null}
          {r.tradeoffs ? (
            <p className="text-[13px] text-muted-foreground">Trade-offs: {r.tradeoffs}</p>
          ) : null}
          {flags.map((f) => (
            <p key={f} className="text-[13px] text-warning">
              {f}
            </p>
          ))}
          {((r.evidence ?? []) as any[]).map((e, n) => (
            <QuoteLine key={n} q={e.quote} />
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {status === "suggested" || status === "needs_review" ? (
              <>
                {editing ? (
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => go.mutate("edited")}
                    loading={go.isPending}
                    disabled={text.trim().length < 3}
                  >
                    Approve as edited
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => go.mutate(r.kind === "keep" ? "kept" : "approved")}
                    loading={go.isPending}
                    disabled={!!flags.length && status === "needs_review" && false}
                  >
                    {r.kind === "keep" ? "Keep it" : "Approve"}
                  </Button>
                )}
                {r.kind !== "keep" && r.proposed_text && !editing ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                ) : null}
                {r.kind !== "keep" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => go.mutate("kept")}
                  >
                    Keep as is
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => go.mutate("deferred")}
                >
                  Later
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => go.mutate("clarify")}
                >
                  Ask them
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  onClick={() => go.mutate("rejected")}
                >
                  Dismiss
                </Button>
              </>
            ) : status === "approved" ? (
              <>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => mark.mutate(true)}
                  loading={mark.isPending}
                  data-mark-applied
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Mark applied
                </Button>
                {TAB_FOR[r.area] ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => onOpenTab?.(TAB_FOR[r.area]!)}
                  >
                    Open {AREA_WORDS[r.area]}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  onClick={() => go.mutate("proposed")}
                >
                  Undo approval
                </Button>
              </>
            ) : status === "applied" ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                onClick={() => mark.mutate(false)}
              >
                Not applied after all
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                onClick={() => go.mutate("proposed")}
              >
                Undo
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Commitments({
  sessionId,
  items,
  refresh,
}: {
  sessionId: string;
  items: any[];
  refresh: () => void;
}) {
  const save = useServerFn(commitmentFn);
  const [owner, setOwner] = useState<"athlete" | "coach">("athlete");
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => save({ data: { sessionId, owner, text: text.trim() } }),
    onSuccess: () => {
      setText("");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add it"),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) =>
      save({ data: { sessionId, id: v.id, ...v.patch } as any }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const proposed = items.filter(
    (c) => c.session_id === sessionId && c.confirmed === false && c.status === "open",
  );
  const kept = items.filter((c) => c.confirmed !== false && c.status !== "dropped");
  return (
    <section className="rounded-2xl border border-border" data-commitments>
      <header className="flex items-center gap-2 px-3 py-2.5">
        <h3 className="text-[15px] font-semibold">Who does what</h3>
        {proposed.length ? (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[12px] font-medium text-warning">
            {proposed.length} to confirm
          </span>
        ) : null}
      </header>
      <ul className="border-t border-border py-1">
        {proposed.map((c) => (
          <li key={c.id} className="flex items-start gap-2 px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">
                <span className="text-muted-foreground">
                  {c.owner === "athlete" ? "Them: " : "You: "}
                </span>
                {c.text}
                {c.due_on ? (
                  <span className="text-muted-foreground"> · by {billingDay(c.due_on)}</span>
                ) : null}
              </p>
              <QuoteLine q={c.source_quote} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[12px]"
              onClick={() => update.mutate({ id: c.id, patch: { confirmed: true } })}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[12px] text-muted-foreground"
              onClick={() => update.mutate({ id: c.id, patch: { status: "dropped" } })}
            >
              No
            </Button>
          </li>
        ))}
        {kept.map((c) => (
          <li key={c.id} className="flex items-start gap-2 px-3 py-1.5">
            <button
              type="button"
              onClick={() =>
                update.mutate({
                  id: c.id,
                  patch: { status: c.status === "open" ? "done" : "open" },
                })
              }
              aria-label={c.status === "open" ? "Mark done" : "Reopen"}
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                c.status === "done" ? "border-success bg-success text-white" : "border-border",
              )}
            >
              {c.status === "done" ? <Check className="h-3 w-3" /> : null}
            </button>
            <span
              className={cn(
                "text-[14px]",
                c.status === "done" && "text-muted-foreground line-through",
              )}
            >
              <span className="text-muted-foreground">
                {c.owner === "athlete" ? "Them: " : "You: "}
              </span>
              {c.text}
              {c.session_id !== sessionId ? (
                <span className="text-muted-foreground"> · carried over</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 border-t border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) add.mutate();
        }}
      >
        <button
          type="button"
          onClick={() => setOwner(owner === "athlete" ? "coach" : "athlete")}
          className="h-9 shrink-0 rounded-lg border border-border px-3 text-[13px]"
        >
          {owner === "athlete" ? "Them" : "You"}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a commitment"
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-9"
          loading={add.isPending}
          aria-label="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}

function Recap({
  data,
  decisions,
  refresh,
}: {
  data: any;
  decisions: string[];
  refresh: () => void;
}) {
  const s = data.session;
  const send = useServerFn(sendSessionSummaryFn);
  const draft = useMemo<GamePlan>(
    () => (s.game_plan as GamePlan) ?? draftGamePlan(s.agenda, decisions, data.commitments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.id, decisions.join("|"), data.commitments.length],
  );
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const message = text ?? gamePlanMessage(data.firstName, draft);
  const go = useMutation({
    mutationFn: () => send({ data: { sessionId: s.id, text: message } }),
    onSuccess: (r) => {
      toast.success(r.already ? "Already sent" : "Recap sent in their chat");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send it"),
  });
  return (
    <section className="rounded-2xl border border-border" data-recap>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <h3 className="text-[15px] font-semibold">Client recap</h3>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {s.shared_at
            ? `Sent ${new Date(s.shared_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
            : "Optional"}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border p-3">
          <Textarea rows={9} value={message} onChange={(e) => setText(e.target.value)} />
          {!data.hasApp ? (
            <p className="text-[13px] text-muted-foreground">
              They don't have the app yet: copy it and send it another way.
            </p>
          ) : s.shared_at ? null : (
            <Button
              onClick={() => go.mutate()}
              loading={go.isPending}
              disabled={message.trim().length < 10}
              size="sm"
            >
              <Send className="mr-1.5 h-4 w-4" /> Send in their chat
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Speakers({
  data,
  list,
  refresh,
}: {
  data: any;
  list: ReturnType<typeof speakerList>;
  refresh: () => void;
}) {
  const s = data.session;
  const save = useServerFn(recordingSpeakersFn);
  const [map, setMap] = useState<Record<string, { role: SpeakerRole; name?: string | null }>>(
    () => ({ ...(s.recording?.speakers ?? {}) }),
  );
  const go = useMutation({
    mutationFn: () => save({ data: { sessionId: s.id, speakers: map as any } }),
    onSuccess: (r) => {
      toast.success(r.confirmed ? "Speakers named. Cleo reads it again with the names." : "Saved");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const total = list.reduce((a, x) => a + x.seconds, 0) || 1;
  const done = s.recording?.speakers_confirmed === true;
  return (
    <section className="rounded-2xl border border-border p-3" data-speakers>
      <div className="flex items-baseline gap-2">
        <h3 className="text-[15px] font-semibold">Who's who</h3>
        <span className="text-[12px] text-muted-foreground">
          {list.length} voice{list.length === 1 ? "" : "s"} heard
          {done ? " · named" : ": name them so nothing is misattributed"}
        </span>
      </div>
      <ul className="mt-2 space-y-2">
        {list.map((sp) => {
          const cur = map[sp.key];
          return (
            <li key={sp.key} className="rounded-lg bg-muted/50 p-2">
              <p className="text-[13px]">
                <span className="font-medium">{sp.label}</span>{" "}
                <span className="text-muted-foreground">
                  · {Math.round((sp.seconds / total) * 100)}% of the talking
                </span>
              </p>
              <p className="truncate text-[12.5px] italic text-muted-foreground">“{sp.sample}”</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["coach", "client", "other"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() =>
                      setMap((m) => ({
                        ...m,
                        [sp.key]: {
                          role,
                          name:
                            role === "client"
                              ? (data.firstName ?? null)
                              : role === "coach"
                                ? null
                                : (m[sp.key]?.name ?? null),
                        },
                      }))
                    }
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[12px]",
                      cur?.role === role
                        ? "border-foreground bg-secondary font-medium"
                        : "border-border",
                    )}
                  >
                    {role === "coach"
                      ? "You"
                      : role === "client"
                        ? (data.firstName ?? "Client")
                        : "Someone else"}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <Button size="sm" className="mt-2 h-8" onClick={() => go.mutate()} loading={go.isPending}>
        Save names
      </Button>
    </section>
  );
}

function TranscriptView({ data, refresh }: { data: any; refresh: () => void }) {
  const s = data.session;
  const edit = useServerFn(recordingEditLineFn);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const lines = useMemo(
    () =>
      transcriptLines(
        data.audio ?? [],
        s.recording?.speakers ?? {},
        s.recording?.participants ?? [],
      ),
    [data.audio, s.recording],
  );
  const go = useMutation({
    mutationFn: (v: { seq: number; index: number; text: string }) =>
      edit({ data: { sessionId: s.id, ...v } }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  return (
    <section className="rounded-2xl border border-border" data-transcript>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <h3 className="text-[15px] font-semibold">Transcript</h3>
        <span className="ml-auto text-[12px] text-muted-foreground">{lines.length} lines</span>
      </button>
      {open ? (
        <ol className="max-h-[60svh] space-y-1 overflow-y-auto border-t border-border p-3">
          {lines.map((l) => {
            const k = `${l.seq}:${l.index}`;
            return (
              <li key={k} className="text-[13.5px] leading-snug">
                <span className="mr-1.5 tabular-nums text-[11.5px] text-muted-foreground">
                  {clock(l.at)}
                </span>
                <span className="font-medium">{l.speaker}:</span>{" "}
                {editing === k ? (
                  <form
                    className="mt-1 flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      go.mutate({ seq: l.seq, index: l.index, text });
                    }}
                  >
                    <input
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[16px] sm:text-[13px]"
                    />
                    <Button size="sm" type="submit" className="h-8">
                      Save
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => {
                      setEditing(k);
                      setText(l.text);
                    }}
                  >
                    {l.text}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function Import({ data, refresh }: { data: any; refresh: () => void }) {
  const s = data.session;
  const send = useServerFn(importTranscriptFn);
  const fromNotes = useServerFn(analyseNotesFn);
  const [source, setSource] = useState<"otter" | "notes" | "other">("otter");
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [retain, setRetain] = useState<30 | 90 | 365 | 0>(30);
  const [reading, setReading] = useState(false);
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const recording = source !== "notes";
  const go = useMutation({
    mutationFn: () =>
      send({ data: { sessionId: s.id, text: text.trim(), source, consent, retainDays: retain } }),
    onSuccess: () => {
      toast.success("Cleo is reading it");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add it"),
  });
  const notesGo = useMutation({
    mutationFn: () => fromNotes({ data: { sessionId: s.id } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't start it"),
  });
  const hasNotes =
    `${s.live?.notes ?? ""} ${(s.live?.decisions ?? []).join(" ")}`.trim().length >= 40;
  const onFile = async (f: File) => {
    setReading(true);
    try {
      const ext = f.name.toLowerCase().split(".").pop() ?? "";
      let raw = "";
      if (ext === "docx") {
        const { parseDocx } = await import("@/lib/program-import/extract");
        raw = parseDocx(new Uint8Array(await f.arrayBuffer())).text;
      } else if (["txt", "srt", "vtt", "md"].includes(ext) || f.type.startsWith("text/"))
        raw = await f.text();
      else
        throw new Error("Export it from Otter as a .txt, .docx or .srt file, or paste the text.");
      const t = plainTranscript(f.name, raw);
      if (t.length < 40) throw new Error("That file has almost no text in it.");
      setText(t.slice(0, 200_000));
      setOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read that file");
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };
  return (
    <section className="space-y-2 rounded-2xl border border-border p-3" data-transcript-import>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[14px] font-medium">Add what happened in the meeting</p>
        {hasNotes || s.transcript_path ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => notesGo.mutate()}
            loading={notesGo.isPending}
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" /> {s.transcript_path ? "Read saved transcript" : "Read my notes"}
          </Button>
        ) : null}
        <input
          ref={file}
          type="file"
          accept=".txt,.docx,.srt,.vtt,.md,text/plain"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => file.current?.click()}
          loading={reading}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" /> Transcript file
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen((v) => !v)}>
          Paste
        </Button>
      </div>
      {open ? (
        <>
          <div className="flex gap-1.5">
            {(
              [
                ["otter", "Otter"],
                ["other", "Other recording"],
                ["notes", "My notes"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSource(k)}
                className={cn(
                  "h-8 rounded-full border px-3 text-[12.5px]",
                  source === k ? "border-foreground bg-secondary font-medium" : "border-border",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the transcript or your notes"
            data-transcript-text
          />
          {recording ? (
            <label className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2 text-[13.5px]">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
                data-transcript-consent
              />
              <span>
                {data.firstName ?? "They"} knew the meeting was recorded and agreed to it being used
                for their coaching.
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">Keep it:</span>
            {(
              [
                [30, "30 days"],
                [90, "90 days"],
                [365, "A year"],
                [0, "Until deleted"],
              ] as const
            ).map(([d, label]) => (
              <button
                key={d}
                type="button"
                onClick={() => setRetain(d)}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-[12px]",
                  retain === d ? "border-foreground bg-secondary font-medium" : "border-border",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => go.mutate()}
            loading={go.isPending}
            disabled={text.trim().length < 40 || (recording && !consent)}
            data-transcript-read
          >
            Read it with Cleo
          </Button>
        </>
      ) : null}
    </section>
  );
}

function TranscriptControls({
  s,
  refresh,
  hasAudio,
}: {
  s: any;
  refresh: () => void;
  hasAudio: boolean;
}) {
  const del = useServerFn(deleteTranscriptFn);
  const delAudio = useServerFn(recordingDeleteAudioFn);
  const [asking, setAsking] = useState(false);
  const go = useMutation({
    mutationFn: (derived: "none" | "unkept" | "all") => del({ data: { sessionId: s.id, derived } }),
    onSuccess: () => {
      setAsking(false);
      toast.success("Deleted");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't delete it"),
  });
  const audio = useMutation({
    mutationFn: () => delAudio({ data: { sessionId: s.id } }),
    onSuccess: () => {
      toast.success("Audio deleted");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't delete it"),
  });
  if (!s.transcript_path && !hasAudio)
    return s.transcript_deleted_at ? (
      <p className="text-[12px] text-muted-foreground">
        The transcript was deleted {billingDay(String(s.transcript_deleted_at).slice(0, 10))}.
      </p>
    ) : null;
  return (
    <section className="space-y-2 rounded-xl bg-muted px-3 py-2.5" data-transcript-controls>
      <p className="text-[12.5px] text-muted-foreground">
        {hasAudio ? "The recording and transcript are" : "The transcript is"} private to you and
        their coaches
        {s.transcript_retain_until
          ? `, kept until ${billingDay(s.transcript_retain_until)}`
          : ", kept until you delete it"}
        {s.transcript_consent_at
          ? `, with their consent (given ${billingDay(String(s.transcript_consent_at).slice(0, 10))})`
          : ""}
        . What you keep from it stays.
      </p>
      {asking ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => go.mutate("none")}
            loading={go.isPending}
          >
            Just the file{hasAudio ? "s" : ""}
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => go.mutate("unkept")}>
            And what I haven't kept
          </Button>
          <Button size="sm" variant="destructive" className="h-8" onClick={() => go.mutate("all")}>
            And everything taken from it
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {hasAudio ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground"
              onClick={() => audio.mutate()}
              loading={audio.isPending}
            >
              Delete the audio, keep the words
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            onClick={() => setAsking(true)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete now
          </Button>
        </div>
      )}
    </section>
  );
}

export { updateSessionFn };
