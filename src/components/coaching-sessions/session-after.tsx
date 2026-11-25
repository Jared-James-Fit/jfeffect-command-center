/**
 * After a meeting (coach only): bring in the notes or an Otter transcript
 * (with the athlete's consent for a recording, kept only as long as the coach
 * chose), Cleo's read of it checked against the words themselves, and every
 * proposal decided here: commitments kept or dropped, recommendations approved
 * (into that plan's own editor), kept, rejected, deferred or asked about, and
 * lasting coaching intelligence remembered or let go. Nothing is sent or
 * changed on its own.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, FileText, Quote, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { cn } from "@/lib/utils";
import {
  analyseNotesFn,
  commitmentFn,
  decideRecommendationFn,
  deleteTranscriptFn,
  importTranscriptFn,
  intelligenceFn,
} from "@/lib/coaching-sessions/sessions.functions";
import { plainTranscript, type AnalysisItem, type MeetingAnalysis } from "@/lib/coaching-sessions/analysis";
import { handOffToCleo } from "@/lib/cleo-handoff";
import { queueComposerInsert } from "@/lib/composer-insert";
import { meetingsKey, sessionKey } from "./keys";

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
const BASIS_WORDS = { confirmed: "Said", tentative: "Floated", interpretation: "Cleo's read" } as const;
const KIND_WORDS: Record<string, string> = {
  goal: "Goal",
  preference: "Preference",
  training_response: "How they respond",
  approach: "What works with them",
  decision: "Decision",
  technique: "Technique",
  constraint: "Constraint",
  achievement: "Achievement",
  relationship: "Relationship",
  concern: "Concern",
  other: "Note",
};
const DECISION_WORDS: Record<string, string> = {
  approved: "Approved",
  edited: "Approved as edited",
  kept: "Keeping what's in place",
  rejected: "Not doing it",
  deferred: "Later",
  clarify: "Asking them first",
};
const TAB_FOR: Record<string, string> = { training: "training", nutrition: "nutrition", cardio: "cardio" };

export function SessionAfter({
  data,
  clientId,
  onOpenTab,
}: {
  data: any;
  clientId: string;
  onOpenTab?: (tab: string) => void;
}) {
  const s = data.session;
  const analysis: (MeetingAnalysis & { model?: string; source?: string; clipped?: boolean }) | null = s.analysis ?? null;
  const working = s.analysis_status === "queued" || s.analysis_status === "running";
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: sessionKey(s.id) });
    qc.invalidateQueries({ queryKey: meetingsKey(clientId) });
  };

  return (
    <div className="space-y-6">
      {!data.cleo ? (
        <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
          Cleo isn't switched on for your account, so notes and transcripts aren't read here. Your notes, decisions and commitments still work.
        </p>
      ) : working ? (
        <Working s={s} />
      ) : analysis ? (
        <Analysis data={data} analysis={analysis} clientId={clientId} onOpenTab={onOpenTab} refresh={refresh} />
      ) : (
        <Import data={data} refresh={refresh} />
      )}
      {s.analysis_status === "failed" ? (
        <p className="text-[13px] text-destructive">Cleo couldn't read it{s.analysis_error ? `: ${s.analysis_error}` : ""}. Try again below.</p>
      ) : s.analysis_error?.startsWith("Waiting for AI") ? (
        <p className="text-[13px] text-muted-foreground">{s.analysis_error}. It'll carry on by itself.</p>
      ) : null}
      {data.cleo && (s.transcript_path || s.transcript_deleted_at) ? <TranscriptControls s={s} refresh={refresh} /> : null}
    </div>
  );
}

function Working({ s }: { s: any }) {
  return (
    <section className="flex items-start gap-3 rounded-2xl border border-border p-4" data-analysis-working>
      <CleoAvatar className="h-8 w-8 shrink-0" />
      <div>
        <p className="text-[15px] font-medium">Cleo is reading the {s.transcript_path ? "transcript" : "notes"}…</p>
        <p className="text-[13px] text-muted-foreground">
          Usually under a minute or two. You can close this; it carries on.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Import({ data, refresh }: { data: any; refresh: () => void }) {
  const s = data.session;
  const send = useServerFn(importTranscriptFn);
  const fromNotes = useServerFn(analyseNotesFn);
  const [source, setSource] = useState<"otter" | "notes" | "other">("otter");
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [retain, setRetain] = useState<30 | 90 | 365 | 0>(30);
  const [reading, setReading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const recording = source !== "notes";
  const go = useMutation({
    mutationFn: () => send({ data: { sessionId: s.id, text: text.trim(), source, consent, retainDays: retain } }),
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
  const hasNotes = `${s.live?.notes ?? ""} ${(s.live?.decisions ?? []).join(" ")}`.trim().length >= 40;

  const onFile = async (f: File) => {
    setReading(true);
    try {
      const ext = f.name.toLowerCase().split(".").pop() ?? "";
      let raw = "";
      if (ext === "docx") {
        const { parseDocx } = await import("@/lib/program-import/extract");
        raw = parseDocx(new Uint8Array(await f.arrayBuffer())).text;
      } else if (["txt", "srt", "vtt", "md"].includes(ext) || f.type.startsWith("text/")) {
        raw = await f.text();
      } else {
        throw new Error("Export it from Otter as a .txt, .docx or .srt file, or paste the text.");
      }
      const t = plainTranscript(f.name, raw);
      if (t.length < 40) throw new Error("That file has almost no text in it.");
      setText(t.slice(0, 200_000));
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read that file");
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border p-4" data-transcript-import>
      <div className="flex items-start gap-3">
        <CleoAvatar className="h-8 w-8 shrink-0" />
        <div>
          <h3 className="text-[16px] font-semibold">What happened in the call</h3>
          <p className="text-[13px] text-muted-foreground">
            Add the Otter transcript or your notes. Cleo pulls out what was agreed, what was only floated, who does what, and anything worth remembering, each with the words it came from. You decide on all of it.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["otter", "Otter transcript"],
            ["notes", "My notes"],
            ["other", "Other recording"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSource(k)}
            className={cn("min-h-10 rounded-lg border px-2 text-[13px]", source === k ? "border-foreground bg-secondary font-medium" : "border-border")}
          >
            {label}
          </button>
        ))}
      </div>
      <Textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={source === "notes" ? "Paste or type your notes from the call" : "Paste the transcript, or choose the file Otter exported"}
        data-transcript-text
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={file}
          type="file"
          accept=".txt,.docx,.srt,.vtt,.md,text/plain"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        />
        <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => file.current?.click()} loading={reading}>
          <Upload className="mr-1.5 h-4 w-4" /> Choose a file
        </Button>
        {text ? <span className="text-[12px] tabular-nums text-muted-foreground">{text.length.toLocaleString()} characters</span> : null}
      </div>
      {recording ? (
        <label className="flex items-start gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-[14px]">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" data-transcript-consent />
          <span>
            {data.firstName ?? "They"} knew the call was recorded and agreed to it being used for their coaching.
          </span>
        </label>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">Keep the raw {recording ? "transcript" : "notes"}</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              [30, "30 days"],
              [90, "90 days"],
              [365, "A year"],
              [0, "Until I delete it"],
            ] as const
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              onClick={() => setRetain(d)}
              className={cn("h-9 rounded-full border px-3 text-[13px]", retain === d ? "border-foreground bg-secondary font-medium" : "border-border")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">Only you and their coaches can read it. What you keep from it stays after the file is deleted.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => go.mutate()} loading={go.isPending} disabled={text.trim().length < 40 || (recording && !consent)} data-transcript-read>
          Read it with Cleo
        </Button>
        {hasNotes ? (
          <Button variant="outline" onClick={() => notesGo.mutate()} loading={notesGo.isPending}>
            <FileText className="mr-1.5 h-4 w-4" /> Read my call notes instead
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Analysis({
  data,
  analysis,
  clientId,
  onOpenTab,
  refresh,
}: {
  data: any;
  analysis: MeetingAnalysis & { model?: string; source?: string; clipped?: boolean };
  clientId: string;
  onOpenTab?: (tab: string) => void;
  refresh: () => void;
}) {
  const s = data.session;
  const group = (k: AnalysisItem["kind"][]) => analysis.items.filter((i) => k.includes(i.kind));
  const agreed = group(["agreement"]);
  const floated = group(["tentative"]);
  const concerns = group(["concern"]);
  const wins = group(["win", "goal"]);
  const open = group(["open_question"]);
  const proposedCommitments = (data.commitments as any[]).filter((c) => c.session_id === s.id && !c.confirmed && c.status === "open");
  const proposedIntel = (data.intelligence as any[]).filter((i) => i.status === "proposed");
  const keptIntel = (data.intelligence as any[]).filter((i) => i.status === "confirmed");
  const reread = useServerFn(analyseNotesFn);
  const again = useMutation({ mutationFn: () => reread({ data: { sessionId: s.id } }), onSuccess: refresh, onError: (e: any) => toast.error(e?.message ?? "Couldn't start it") });

  return (
    <div className="space-y-6" data-analysis>
      <section className="space-y-2">
        <div className="flex items-start gap-3">
          <CleoAvatar className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground">
              Cleo's read of the {analysis.source === "transcript" ? "transcript" : "notes"}
              {analysis.clipped ? " (the first part: it was very long)" : ""}
            </p>
            <p className="text-[15px] leading-relaxed">{analysis.summary}</p>
          </div>
        </div>
      </section>

      {analysis.contradictions.length ? (
        <section className="space-y-2 rounded-2xl border border-warning/50 p-4" data-analysis-contradictions>
          <h3 className="text-[15px] font-semibold">Doesn't match what's on file</h3>
          {analysis.contradictions.map((c, n) => (
            <div key={n} className="text-[14px]">
              <p>{c.text}</p>
              <p className="text-[13px] text-muted-foreground">On file: {c.against}</p>
              <QuoteLine q={c.quote} />
            </div>
          ))}
        </section>
      ) : null}

      <ItemGroup title="What you agreed" items={agreed} />
      <ItemGroup title="Floated, not decided" items={floated} hint="Ideas from the call nobody committed to. Nothing here is a decision." />
      <ItemGroup title="Concerns raised" items={concerns} />
      <ItemGroup title="Wins and goals" items={wins} />
      <ItemGroup title="Still open" items={open} />

      {proposedCommitments.length ? <ProposedCommitments sessionId={s.id} items={proposedCommitments} refresh={refresh} /> : null}

      {(data.recommendations as any[]).length ? (
        <section className="space-y-3" data-analysis-recommendations>
          <h3 className="text-[16px] font-semibold">What could change</h3>
          <p className="text-[13px] text-muted-foreground">
            Approving a training, nutrition or cardio change opens it in that plan's own editor for you to review and apply. Nothing changes from here.
          </p>
          {(data.recommendations as any[]).map((r) => (
            <RecommendationCard key={r.id} r={r} clientId={clientId} sessionId={s.id} firstName={data.firstName} onOpenTab={onOpenTab} refresh={refresh} />
          ))}
        </section>
      ) : (
        <p className="text-[13px] text-muted-foreground">No changes came out of this conversation. That's often the right answer.</p>
      )}

      {proposedIntel.length || keptIntel.length ? (
        <section className="space-y-2" data-analysis-intelligence>
          <h3 className="text-[16px] font-semibold">Worth remembering</h3>
          <p className="text-[13px] text-muted-foreground">What you keep, Cleo uses in every plan it helps with. You can change or remove it any time.</p>
          {[...proposedIntel, ...keptIntel].map((i) => (
            <IntelRow key={i.id} item={i} clientId={clientId} refresh={refresh} />
          ))}
        </section>
      ) : null}

      {analysis.feedback.strengths.length || analysis.feedback.consider.length ? (
        <Fold title="For you: how the conversation went">
          {analysis.feedback.strengths.map((f) => (
            <p key={f} className="text-[14px]">✓ {f}</p>
          ))}
          {analysis.feedback.consider.map((f) => (
            <p key={f} className="text-[14px] text-muted-foreground">Next time: {f}</p>
          ))}
          <p className="pt-1 text-[12px] text-muted-foreground">Private to you. Never in anything sent.</p>
        </Fold>
      ) : null}

      {analysis.dropped.length ? (
        <Fold title={`What Cleo left out (${analysis.dropped.length})`}>
          {analysis.dropped.map((d, n) => (
            <p key={n} className="text-[13px] text-muted-foreground">{d}</p>
          ))}
        </Fold>
      ) : null}

      <Button variant="ghost" size="sm" onClick={() => again.mutate()} loading={again.isPending} className="text-muted-foreground">
        Read it again
      </Button>
    </div>
  );
}

function ItemGroup({ title, items, hint }: { title: string; items: AnalysisItem[]; hint?: string }) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
      <ul className="space-y-2.5">
        {items.map((i, n) => (
          <li key={n} className="text-[14px] leading-snug">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">{BASIS_WORDS[i.basis]}</span>
              <span>
                {i.text}
                {i.due ? <span className="text-muted-foreground"> · by {i.due}</span> : null}
              </span>
            </div>
            <QuoteLine q={i.quote} speaker={i.speaker} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuoteLine({ q, speaker }: { q: string; speaker?: string }) {
  return (
    <p className="mt-1 flex gap-1.5 pl-1 text-[12px] italic text-muted-foreground">
      <Quote className="mt-0.5 h-3 w-3 shrink-0" />
      <span>
        {speaker && speaker !== "unclear" ? `${speaker === "coach" ? "You" : "Them"}: ` : ""}“{q}”
      </span>
    </p>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[14px] font-medium">
        {title}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="space-y-1.5 px-3 pb-3">{children}</div> : null}
    </section>
  );
}

function ProposedCommitments({ sessionId, items, refresh }: { sessionId: string; items: any[]; refresh: () => void }) {
  const save = useServerFn(commitmentFn);
  const keep = useMutation({
    mutationFn: (v: { id: string; keep: boolean }) =>
      save({ data: { sessionId, id: v.id, ...(v.keep ? { confirmed: true } : { status: "dropped" as const }) } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  return (
    <section className="space-y-2" data-proposed-commitments>
      <h3 className="text-[15px] font-semibold">Who said they'd do what</h3>
      <p className="text-[12px] text-muted-foreground">Keep the ones that were real: they're carried into your next call.</p>
      {items.map((c) => (
        <div key={c.id} className="rounded-xl border border-border p-3">
          <p className="text-[14px]">
            <span className="text-muted-foreground">{c.owner === "athlete" ? "Them: " : "You: "}</span>
            {c.text}
            {c.due_on ? <span className="text-muted-foreground"> · by {c.due_on}</span> : null}
          </p>
          {c.source_quote ? <QuoteLine q={c.source_quote} /> : null}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" className="h-9" onClick={() => keep.mutate({ id: c.id, keep: true })}>
              Keep
            </Button>
            <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => keep.mutate({ id: c.id, keep: false })}>
              Not a commitment
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function RecommendationCard({
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
  const addCommitment = useServerFn(commitmentFn);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>(r.proposed_text ?? "");
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: async (status: "approved" | "edited" | "kept" | "rejected" | "deferred" | "clarify" | "proposed") => {
      const out = await decide({ data: { id: r.id, status, note: note.trim() || null, proposed: status === "edited" ? text.trim() : null } });
      return { status, out };
    },
    onSuccess: async ({ status, out }) => {
      refresh();
      if (status === "approved" || status === "edited") {
        const tab = TAB_FOR[out.area];
        if (tab && out.ask) {
          handOffToCleo(clientId, out.area as any, out.ask);
          toast.success(`In ${AREA_WORDS[out.area]}'s Cleo box: review and apply it there`);
          onOpenTab?.(tab);
        } else if (out.area === "communication" && out.ask) {
          queueComposerInsert(clientId, r.proposed_text ?? r.title);
          toast.success("In their chat box, ready to read over and send");
        } else {
          await addCommitment({ data: { sessionId, owner: "coach", text: r.title.slice(0, 400) } }).catch(() => null);
          toast.success("Approved: it's on your list for this client");
        }
      }
      if (status === "clarify") {
        queueComposerInsert(clientId, `Quick question from our call${firstName ? `, ${firstName}` : ""}: ${r.title.replace(/\.$/, "")}?`);
        toast.success("A question is in their chat box to read over and send");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const decided = r.status !== "proposed";
  return (
    <div className={cn("rounded-2xl border p-4", decided ? "border-border bg-muted/40" : "border-border")} data-recommendation={r.id}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          {AREA_WORDS[r.area] ?? r.area}
          {r.kind === "keep" ? " · keep" : ""}
        </p>
        {decided ? <span className="text-[12px] font-medium">{DECISION_WORDS[r.status] ?? r.status}</span> : null}
      </div>
      <p className="mt-0.5 text-[15px] font-semibold leading-snug">{r.title}</p>
      {r.current_text || r.proposed_text ? (
        <div className="mt-2 grid gap-2 text-[14px] sm:grid-cols-2">
          {r.current_text ? (
            <div className="rounded-lg bg-muted px-2.5 py-2">
              <p className="text-[11px] text-muted-foreground">Now</p>
              <p>{r.current_text}</p>
            </div>
          ) : null}
          {r.proposed_text ? (
            <div className="rounded-lg bg-secondary px-2.5 py-2">
              <p className="text-[11px] text-muted-foreground">Proposed</p>
              {editing ? <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /> : <p>{r.proposed_text}</p>}
            </div>
          ) : null}
        </div>
      ) : null}
      {r.reason ? <p className="mt-2 text-[14px]">{r.reason}</p> : null}
      <div className="mt-1.5 space-y-0.5 text-[13px] text-muted-foreground">
        {r.benefit ? <p>Benefit: {r.benefit}</p> : null}
        {r.tradeoffs ? <p>Trade-offs: {r.tradeoffs}</p> : null}
        {r.affects ? <p>Also affects: {r.affects}</p> : null}
      </div>
      {((r.evidence ?? []) as any[]).map((e, n) => (
        <QuoteLine key={n} q={e.quote} />
      ))}
      {!decided ? (
        <>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why (optional, Cleo remembers it)"
            className="mt-3 h-10 w-full rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {editing ? (
              <Button size="sm" className="h-9" onClick={() => go.mutate("edited")} loading={go.isPending} disabled={text.trim().length < 3}>
                Approve as edited
              </Button>
            ) : (
              <Button size="sm" className="h-9" onClick={() => go.mutate(r.kind === "keep" ? "kept" : "approved")} loading={go.isPending}>
                {r.kind === "keep" ? "Keep it" : "Approve"}
              </Button>
            )}
            {r.kind !== "keep" && r.proposed_text && !editing ? (
              <Button size="sm" variant="outline" className="h-9" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {r.kind !== "keep" ? (
              <Button size="sm" variant="outline" className="h-9" onClick={() => go.mutate("kept")}>
                Keep what's in place
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="h-9" onClick={() => go.mutate("deferred")}>
              Later
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => go.mutate("clarify")}>
              Ask them
            </Button>
            <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => go.mutate("rejected")}>
              No
            </Button>
          </div>
        </>
      ) : (
        <button type="button" className="mt-2 text-[13px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => go.mutate("proposed")}>
          Undo
        </button>
      )}
    </div>
  );
}

export function IntelRow({ item, clientId, refresh }: { item: any; clientId: string; refresh: () => void }) {
  const act = useServerFn(intelligenceFn);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>(item.text);
  const go = useMutation({
    mutationFn: (v: { action: "confirm" | "edit" | "archive" | "remove"; permanence?: "lasting" | "temporary" }) =>
      act({ data: { clientId, id: item.id, action: v.action, ...(v.action === "confirm" || v.action === "edit" ? { text: text.trim() } : {}), ...(v.permanence ? { permanence: v.permanence } : {}) } }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const proposed = item.status === "proposed";
  return (
    <div className={cn("rounded-xl border p-3", proposed ? "border-border" : "border-border bg-muted/40")} data-intel={item.id}>
      <p className="text-[12px] text-muted-foreground">
        {KIND_WORDS[item.kind] ?? item.kind}
        {item.permanence === "temporary" && item.expires_on ? ` · until ${item.expires_on}` : ""}
        {!proposed ? " · kept" : ""}
      </p>
      {editing ? (
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} className="mt-1" />
      ) : (
        <p className="text-[14px] leading-snug">{item.text}</p>
      )}
      {item.source_quote ? <QuoteLine q={item.source_quote} /> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {proposed ? (
          <Button size="sm" variant="outline" className="h-9" onClick={() => go.mutate({ action: "confirm" })} loading={go.isPending}>
            Remember
          </Button>
        ) : editing ? (
          <Button size="sm" variant="outline" className="h-9" onClick={() => go.mutate({ action: "edit" })} loading={go.isPending}>
            Save
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : "Edit"}
        </Button>
        {proposed ? (
          <Button size="sm" variant="ghost" className="h-9" onClick={() => go.mutate({ action: "confirm", permanence: item.permanence === "temporary" ? "lasting" : "temporary" })}>
            {item.permanence === "temporary" ? "Remember for good" : "Only for now"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="h-9" onClick={() => go.mutate({ action: "archive" })}>
            No longer true
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => go.mutate({ action: "remove" })}>
          {proposed ? "Not this" : "Remove"}
        </Button>
      </div>
    </div>
  );
}

function TranscriptControls({ s, refresh }: { s: any; refresh: () => void }) {
  const del = useServerFn(deleteTranscriptFn);
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
  if (!s.transcript_path)
    return <p className="text-[12px] text-muted-foreground">The raw transcript was deleted {String(s.transcript_deleted_at).slice(0, 10)}.</p>;
  return (
    <section className="space-y-2 rounded-xl bg-muted px-3 py-2.5" data-transcript-controls>
      <p className="text-[13px] text-muted-foreground">
        {s.transcript_source === "notes" ? "Your notes are" : "The transcript is"} kept privately
        {s.transcript_retain_until ? ` until ${s.transcript_retain_until}` : " until you delete it"}
        {s.transcript_consent_at ? `, with their consent (${String(s.transcript_consent_at).slice(0, 10)})` : ""}.
      </p>
      {asking ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-9" onClick={() => go.mutate("none")} loading={go.isPending}>
            Just the file
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => go.mutate("unkept")}>
            And what I haven't kept
          </Button>
          <Button size="sm" variant="destructive" className="h-9" onClick={() => go.mutate("all")}>
            And everything taken from it
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => setAsking(true)}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Delete the transcript now
        </Button>
      )}
    </section>
  );
}
