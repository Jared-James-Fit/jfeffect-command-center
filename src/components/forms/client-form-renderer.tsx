import { useEffect, useMemo, useRef, useState } from "react";
import { useVideoTrimmer } from "@/components/video-trimmer";
import { looksLikeVideo, pickVideo } from "@/lib/video-edit/pick";
import { useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Send, MessageCircle, Upload, ArrowLeft, ExternalLink, Check, X, RotateCcw } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { QuestionReferenceImage, getQuestionReferenceImage } from "@/components/forms/question-reference-image";
import {
  listFormsForClient,
  listQuestions,
  getOrCreateCurrentSubmission,
  listAnswers,
  upsertAnswer,
  submitSubmission,
  uploadFormFile,
  listFiles,
  removeFormFile,
  replaceFormFile,
  getReview,
  shouldShowQuestion,
  statusLabel,
  statusTone,
  type NfForm,
  type NfAnswer,
  type NfQuestion,
} from "@/lib/native-forms";
import { buildFilloutUrl } from "@/lib/fillout";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { prefillAnswer, questionPrefill } from "@/lib/form-prefill";
import { sexFromAnswer } from "@/lib/athlete-sex";
import { playAppSound } from "@/lib/app-sounds";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { cn } from "@/lib/utils";
import { choiceLayout, formProgress, numberIssue, numberRange, quickAnswers, quickExclusive, quickNumberLabel, quickPicked, toggleQuick } from "@/lib/form-quick";
import { NF_JSON_TYPES } from "@/lib/native-forms";
import { alignRanking, meetItems } from "@/lib/form-fields";
import { AgeClassHint, GroupedChoice, MeetsInput, RankingInput } from "@/components/forms/form-field-inputs";
import { ChecklistSection, StillToSort, UnitNumberInput } from "@/components/forms/checklist-input";
import { carriedChecklist, checklistAnswered, checklistItems, checklistStates, visibleItems } from "@/lib/form-checklist";
import { bodyweightSuggestion, daysOutLabel, daysUntil, meetFacts, meetTimeline, currentStep, pickMeet, MEET_CHECKLIST_FORM_TYPE } from "@/lib/meet-checklist";
import { COMPETITION_FORM_ID, competitionPlanFromAnswers } from "@/lib/competition-plan";
import type { UnitValue } from "@/lib/form-prefill";

export type ClientFormRendererProps = {
  /** Form to render. */
  formId: string;
  /** True when hosted inside a sheet/modal — hides the page chrome. */
  embedded?: boolean;
  /** Called instead of navigating back when embedded. */
  onClose?: () => void;
};

const NO_ANSWERS: NfAnswer[] = [];

/** A number asked in a unit (bodyweight in lb or kg): `validation.units`. */
function questionUnits(q: NfQuestion): Array<"kg" | "lb"> | null {
  const u = (q.validation as any)?.units;
  if (!Array.isArray(u)) return null;
  const ok = u.filter((x: unknown): x is "kg" | "lb" => x === "kg" || x === "lb");
  return ok.length ? ok : null;
}
function isUnitValue(v: unknown): v is UnitValue {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as any).unit === "string" && "value" in (v as any);
}
const todayLocal = () => new Date().toLocaleDateString("en-CA");

export function ClientFormRenderer({ formId, embedded = false, onClose }: ClientFormRendererProps) {
  const portalUserId = usePortalUserId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const closeOrBack = () => {
    if (onClose) onClose();
    else navigate({ to: "/portal/messages" });
  };

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, user_id, full_name, first_name, last_name, email")
        .eq("user_id", portalUserId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: accessibleForms = [], isFetched: formsFetched } = useQuery({
    queryKey: ["nf-forms-for-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listFormsForClient(client!.id),
  });
  const form = useMemo<NfForm | undefined>(() => accessibleForms.find((item) => item.id === formId), [accessibleForms, formId]);

  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", formId],
    queryFn: () => listQuestions(formId),
    enabled: !!form && form.kind !== "external",
  });

  // Questions that start from the client's profile (e.g. sex, height).
  const prefillQs = useMemo(() => questions.filter((q) => questionPrefill(q)), [questions]);
  const { data: prefillProfile } = useQuery({
    queryKey: ["form-prefill-profile", client?.id, formId],
    enabled: !!client?.id && prefillQs.length > 0,
    queryFn: async () => {
      const wantsPlan = prefillQs.some((q) => questionPrefill(q) === "nutrition_plan");
      const keys = new Set(prefillQs.map((q) => questionPrefill(q)));
      const wantsMeet = keys.has("meet_name") || keys.has("meet_date") || keys.has("meet_weight_class");
      const [{ data }, plans] = await Promise.all([
        supabase.from("clients").select("sex, height_cm, preferred_height_unit, full_name, date_of_birth").eq("id", client!.id).maybeSingle(),
        wantsPlan
          ? (supabase as any)
              .from("nutrition_targets")
              .select("id, nutrition_target_days(id)")
              .eq("client_id", client!.id)
              .neq("status", "Archived")
              .limit(5)
          : Promise.resolve(null),
      ]);
      // Unknown (lookup failed) is null, so nothing gets pre-answered.
      const has_nutrition_plan = !plans || plans.error
        ? null
        : ((plans.data ?? []) as any[]).some((t) => (t.nutrition_target_days ?? []).length > 0);
      const [meet, bodyweight] = await Promise.all([
        wantsMeet ? loadMeetGuess(client!.id, formId).catch(() => null) : Promise.resolve(null),
        keys.has("bodyweight") ? loadLatestWeighIn(client!.id, (client as any)?.user_id ?? portalUserId).catch(() => null) : Promise.resolve(null),
      ]);
      return data ? { ...data, has_nutrition_plan, meet, bodyweight } : data;
    },
  });

  const { data: submission } = useQuery({
    queryKey: ["nf-current-submission", formId, client?.id],
    enabled: !!form && !!client?.id,
    queryFn: () => getOrCreateCurrentSubmission(form!, client!.id),
  });

  // NB: no `= []` default here — a fresh array every render re-fires the
  // effect below (setLocal) forever ("Maximum update depth exceeded").
  const { data: answersData } = useQuery({
    queryKey: ["nf-answers", submission?.id],
    enabled: !!submission?.id,
    queryFn: () => listAnswers(submission!.id),
  });

  const { data: files = [] } = useQuery({
    queryKey: ["nf-files", submission?.id],
    enabled: !!submission?.id,
    queryFn: () => listFiles(submission!.id),
  });

  const { data: review } = useQuery({
    queryKey: ["nf-review", submission?.id],
    enabled: !!submission?.id && (submission?.status === "reviewed"),
    queryFn: () => getReview(submission!.id),
  });

  const answersRaw = answersData ?? NO_ANSWERS;

  const answersMap = useMemo(() => {
    const m: Record<string, NfAnswer | undefined> = {};
    for (const a of answersRaw) m[a.question_id] = a;
    return m;
  }, [answersRaw]);

  const [local, setLocal] = useState<Record<string, any>>({});
  // Start from the saved answers when they change, and only then: React can re-run this effect
  // with the form's state kept (a part below it suspending after the first paint), and a reset
  // then wiped answers just prefilled or typed.
  const appliedAnswers = useRef<NfAnswer[] | null>(null);
  useEffect(() => {
    if (appliedAnswers.current === answersRaw) return;
    appliedAnswers.current = answersRaw;
    const base: Record<string, any> = {};
    for (const a of answersRaw) {
      const j = a.value_json as any;
      // a number kept with its unit (value_json {unit}) is { value, unit } on screen
      if (j && typeof j === "object" && !Array.isArray(j) && typeof j.unit === "string") {
        base[a.question_id] = { value: a.value_number == null ? "" : String(a.value_number), unit: j.unit === "kg" ? "kg" : "lb" };
        continue;
      }
      base[a.question_id] = a.value_json ?? a.value_text ?? a.value_number ?? "";
    }
    setLocal(base);
  }, [answersRaw]);

  // A form the coach lets them keep updating (a meet checklist) stays open after it's sent.
  const updating = !!submission && submission.status !== "in_progress" && !!form?.allow_updates;
  const readOnly = !!submission && submission.status !== "in_progress" && !form?.allow_updates;

  // Typed answers save a beat after the last key (and when the box is left),
  // and each question's writes go one at a time, so an older keystroke can
  // never land after a newer one. Taps save at once.
  const pendingSaves = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>());
  const saveChains = useRef(new Map<string, Promise<void>>());
  function writeAnswer(q: NfQuestion, raw: any): Promise<void> {
    if (!submission || readOnly) return Promise.resolve();
    const payload: any = { submission_id: submission.id, question_id: q.id };
    if (isUnitValue(raw)) {
      payload.value_number = raw.value === "" || !Number.isFinite(Number(raw.value)) ? null : Number(raw.value);
      payload.value_json = { unit: raw.unit };
    } else if (q.question_type === "number" || q.question_type === "rating") {
      payload.value_number = raw === "" || raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
    } else if (NF_JSON_TYPES.has(q.question_type)) {
      payload.value_json = raw ?? [];
    } else {
      payload.value_text = raw == null ? null : String(raw);
    }
    const next = (saveChains.current.get(q.id) ?? Promise.resolve())
      .then(() => upsertAnswer(payload))
      .catch((e: any) => {
        toast.error("Couldn't save: " + e.message);
      });
    saveChains.current.set(q.id, next);
    return next;
  }
  function saveAnswer(q: NfQuestion, raw: any, opts: { defer?: boolean } = {}) {
    if (!submission) return;
    setLocal((s) => ({ ...s, [q.id]: raw }));
    setFlagged((f) => (f.has(q.id) ? new Set([...f].filter((id) => id !== q.id)) : f));
    if (readOnly) return;
    const waiting = pendingSaves.current.get(q.id);
    if (waiting) clearTimeout(waiting.timer);
    if (opts.defer) {
      const run = () => {
        pendingSaves.current.delete(q.id);
        return writeAnswer(q, raw);
      };
      pendingSaves.current.set(q.id, { timer: setTimeout(() => void run(), 700), run });
      return;
    }
    pendingSaves.current.delete(q.id);
    return writeAnswer(q, raw);
  }
  /** Save whatever's still waiting (leaving a box, Submit). */
  async function flushSaves(id?: string) {
    const waiting = [...pendingSaves.current.entries()].filter(([qid]) => !id || qid === id);
    for (const [, w] of waiting) clearTimeout(w.timer);
    await Promise.all(waiting.map(([, w]) => w.run()));
    await Promise.all([...saveChains.current.values()]);
  }
  // leaving the form: nothing typed is lost
  useEffect(
    () => () => {
      for (const w of pendingSaves.current.values()) {
        clearTimeout(w.timer);
        void w.run();
      }
    },
    [],
  );
  // questions Submit found unanswered (or out of range): outlined until they're answered
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set());
  // prefilled one-line answers (their name) the athlete chose to change
  const [editingCompact, setEditingCompact] = useState<Set<string>>(() => new Set());
  // what's on screen now decides the follow-up questions, not just what was saved when it opened
  const liveAnswers = useMemo(() => {
    const m: Record<string, NfAnswer | undefined> = { ...answersMap };
    for (const [qid, v] of Object.entries(local)) {
      if (isUnitValue(v)) {
        m[qid] = { id: "", submission_id: submission?.id ?? "", question_id: qid, value_text: null, value_number: v.value === "" ? null : Number(v.value), value_json: { unit: v.unit } };
        continue;
      }
      m[qid] = {
        id: "",
        submission_id: submission?.id ?? "",
        question_id: qid,
        value_text: typeof v === "string" ? v : null,
        value_number: typeof v === "number" ? v : null,
        value_json: Array.isArray(v) ? v : null,
      };
    }
    return m;
  }, [answersMap, local, submission?.id]);

  // Save profile values as real answers the first time the form opens, so
  // required checks, the coach and the AI all see them. Never overwrites an
  // answer the client already gave.
  const seeded = useRef(new Set<string>());
  useEffect(() => {
    if (!submission || submission.status !== "in_progress" || !answersData || !prefillProfile)
      return;
    for (const q of prefillQs) {
      if (answersMap[q.id] || seeded.current.has(q.id)) continue;
      const value = prefillAnswer(q, prefillProfile);
      if (value == null) continue;
      seeded.current.add(q.id);
      void saveAnswer(q, value);
    }
    // saveAnswer is recreated each render; the inputs below decide when to seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, answersData, prefillProfile, prefillQs, answersMap]);

  // "Start from their last answer" (validation.remember): a form sent again opens on what they said
  // last time, so they only change what's different. Never over an answer already given.
  const rememberQs = useMemo(() => questions.filter((q) => (q.validation as any)?.remember === true), [questions]);
  const { data: lastAnswers } = useQuery({
    queryKey: ["nf-last-answers", formId, client?.id, submission?.id],
    enabled: !!client?.id && !!submission?.id && submission.status === "in_progress" && rememberQs.length > 0,
    queryFn: async () => {
      const { data: prev } = await supabase
        .from("nf_submissions")
        .select("id")
        .eq("form_id", formId)
        .eq("client_id", client!.id)
        .neq("id", submission!.id)
        .neq("status", "in_progress")
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      return prev ? listAnswers((prev as any).id) : [];
    },
  });
  const [carried, setCarried] = useState(false);
  useEffect(() => {
    if (!submission || submission.status !== "in_progress" || !answersData || !lastAnswers?.length) return;
    let any = false;
    for (const q of rememberQs) {
      if (answersMap[q.id] || seeded.current.has(q.id)) continue;
      const prev = lastAnswers.find((a) => a.question_id === q.id);
      if (!prev) continue;
      // a checklist carries only what they don't use (N/A): packed last meet isn't packed for this one
      const value = q.question_type === "checklist"
        ? carriedChecklist(prev.value_json)
        : NF_JSON_TYPES.has(q.question_type) ? prev.value_json : q.question_type === "number" || q.question_type === "rating" ? prev.value_number : prev.value_text;
      if (value == null || (Array.isArray(value) && !value.length) || value === "") continue;
      seeded.current.add(q.id);
      any = true;
      void saveAnswer(q, value);
    }
    if (any) setCarried(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, answersData, lastAnswers, rememberQs, answersMap]);

  const [busyQ, setBusyQ] = useState<Record<string, "uploading" | "removing" | "replacing" | undefined>>({});

  // Warn before leaving while a file upload/replace is in flight — those are
  // not idempotent and losing them mid-upload would corrupt the answer.
  useUnsavedWarning(
    !readOnly && Object.values(busyQ).some((v) => v === "uploading" || v === "replacing"),
  );

  // a video for the coach runs up to 10 minutes: a longer one opens the trimmer, and only that part uploads
  const trimmer = useVideoTrimmer();
  const readVideo = async (file: File) => {
    if (!looksLikeVideo(file)) return { ok: true as const, video: null };
    const res = await pickVideo(file, "coach", { trim: trimmer.request });
    if (!res.ok) {
      if (!res.cancelled) toast.error(res.reason);
      return { ok: false as const };
    }
    return { ok: true as const, video: res.video };
  };

  async function handleFileUpload(q: NfQuestion, file: File) {
    if (!submission || !client) return;
    setBusyQ((s) => ({ ...s, [q.id]: "uploading" }));
    try {
      const read = await readVideo(file);
      if (!read.ok) return;
      await uploadFormFile({ clientId: client.id, submissionId: submission.id, questionId: q.id, file, video: read.video });
      toast.success("Uploaded");
      qc.invalidateQueries({ queryKey: ["nf-files", submission.id] });
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
    } finally {
      setBusyQ((s) => ({ ...s, [q.id]: undefined }));
    }
  }

  async function handleFileRemove(q: NfQuestion, fileId: string) {
    if (!submission) return;
    setBusyQ((s) => ({ ...s, [q.id]: "removing" }));
    try {
      await removeFormFile(fileId);
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["nf-files", submission.id] });
    } catch (e: any) {
      toast.error("Couldn't remove: " + e.message);
    } finally {
      setBusyQ((s) => ({ ...s, [q.id]: undefined }));
    }
  }

  async function handleFileReplace(q: NfQuestion, fileId: string, file: File) {
    if (!submission || !client) return;
    setBusyQ((s) => ({ ...s, [q.id]: "replacing" }));
    try {
      const read = await readVideo(file);
      if (!read.ok) return;
      await replaceFormFile({ fileId, clientId: client.id, file, video: read.video });
      toast.success("Replaced");
      qc.invalidateQueries({ queryKey: ["nf-files", submission.id] });
    } catch (e: any) {
      toast.error("Replace failed: " + e.message);
    } finally {
      setBusyQ((s) => ({ ...s, [q.id]: undefined }));
    }
  }

  /** Items a ranking or a choice draws from another question (the meets picked earlier). */
  function sourceItems(q: NfQuestion) {
    const from = (q.validation as any)?.options_from;
    if (typeof from !== "string") return null;
    return meetItems(local[from]);
  }
  function rankItemsFor(q: NfQuestion) {
    return sourceItems(q) ?? ((q.options ?? []) as string[]).map((o) => ({ key: o, label: o }));
  }

  /** Answered as it's on screen: a checklist's must-haves marked, a ranking always (it's in order already). */
  function answeredNow(q: NfQuestion): boolean {
    if (q.question_type === "checklist") return checklistAnswered(visibleItems(checklistItems(q), liveAnswers), local[q.id], !!q.required);
    if (q.question_type === "ranking") return rankItemsFor(q).length > 0 || isAnswered(q, local[q.id], files);
    return isAnswered(q, local[q.id], files);
  }

  async function handleSubmit() {
    if (!submission) return;
    const visible = questions.filter((q) => shouldShowQuestion(q, liveAnswers));
    const missing = visible.filter((q) => q.required && !answeredNow(q));
    const off = visible.filter((q) => q.question_type === "number" && numberIssue(q, local[q.id]));
    if (missing.length > 0 || off.length > 0) {
      // outline them and take them to the first one
      const ids = new Set([...missing, ...off].map((q) => q.id));
      setFlagged(ids);
      const first = visible.find((q) => ids.has(q.id));
      if (first) document.getElementById(`q-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      throw new Error(
        missing.length > 0
          ? missing.length === 1
            ? "Answer the highlighted question"
            : `Answer the ${missing.length} highlighted questions`
          : "Check the highlighted answer",
      );
    }
    // a ranking nobody moved is answered in the order it's shown
    for (const q of visible) {
      if (q.question_type !== "ranking") continue;
      const list = alignRanking(local[q.id], rankItemsFor(q));
      const stored = Array.isArray(local[q.id]) ? (local[q.id] as any[]) : [];
      if (list.length && (stored.length !== list.length || list.some((l, i) => stored[i]?.key !== l.key || stored[i]?.label !== l.label))) {
        void saveAnswer(q, list);
      }
    }
    // typed answers still waiting to save go first
    await flushSaves();
    await submitSubmission(submission.id);
    // A sex answer here is the athlete's answer everywhere: keep the profile in step.
    const sexQ = prefillQs.find((q) => questionPrefill(q) === "sex");
    const nextSex = sexQ ? sexFromAnswer(local[sexQ.id]) : null;
    if (client?.id && nextSex && nextSex !== prefillProfile?.sex) {
      void supabase
        .from("clients")
        .update({ sex: nextSex })
        .eq("id", client.id)
        .then(({ error }) => {
          if (error) console.warn("Couldn't save sex to profile", error.message);
          else qc.invalidateQueries({ queryKey: ["athlete-sex"] });
        });
    }
    playAppSound("success");
    // tells the coach, and (a Nutrition Update Request) writes the AI targets + meal plan on the server
    fireAppEvent("form_submitted", submission.id);
    qc.invalidateQueries({ queryKey: ["nf-current-submission", formId, client?.id] });
    qc.invalidateQueries({ queryKey: ["nf-submissions-for-client", client?.id] });
  }

  if (client?.id && formsFetched && !form) {
    return (
      <>
        {!embedded && (
          <PageHeader title="Check-In unavailable" backTo="/portal/messages" backLabel="Back to Messages" />
        )}
        <div className="mx-auto max-w-2xl p-4 md:p-8">
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            This form is not currently assigned, active, or available in your portal.
            <div className="mt-4">
              <Button variant="outline" onClick={() => closeOrBack()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Check-Ins
              </Button>
            </div>
          </Card>
        </div>
      </>
    );
  }

  if (!form || !submission) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (form.kind === "external") {
    return (
      <ExternalFormView
        form={form}
        client={client}
        submission={submission}
        onMarkSubmitted={async () => {
          await submitSubmission(submission.id);
          fireAppEvent("form_submitted", submission.id);
          toast.success("Marked as submitted");
          qc.invalidateQueries({ queryKey: ["nf-current-submission", formId, client?.id] });
          qc.invalidateQueries({ queryKey: ["nf-submissions-for-client", client?.id] });
        }}
        onBack={closeOrBack}
        embedded={embedded}
      />
    );
  }

  const shownQuestions = questions.filter((q) => shouldShowQuestion(q, liveAnswers));
  const checklists = shownQuestions.filter((q) => q.question_type === "checklist");
  const progress = checklists.length
    ? checklistTotals(checklists, local, liveAnswers)
    : formProgress(shownQuestions.filter((q) => q.required).map((q) => ({ answered: answeredNow(q) })));
  // Everything marked Still need, critical first: what's left to sort before the meet.
  const stillToSort = checklists
    .flatMap((q) => {
      const states = checklistStates(local[q.id]);
      return visibleItems(checklistItems(q), liveAnswers)
        .filter((i) => states.get(i.key) === "need")
        .map((i) => ({ questionId: q.id, label: i.label, critical: i.priority === "critical" }));
    })
    .sort((a, b) => Number(b.critical) - Number(a.critical));
  const meet = form.form_type === MEET_CHECKLIST_FORM_TYPE ? meetFacts(questions, liveAnswers) : null;
  const goTo = (id: string) => document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      {trimmer.element}
      {embedded ? (
        <div className="flex items-center justify-end px-1 pb-1">
          <Badge className={statusTone(submission.status) + " border"}>{statusLabel(submission.status)}</Badge>
        </div>
      ) : (
        <PageHeader
          backTo="/portal/messages"
          backLabel="Back to Messages"
          title={form.title}
          subtitle={submission.period_start ? `Week of ${submission.period_start}` : undefined}
          actions={<Badge className={statusTone(submission.status) + " border"}>{statusLabel(submission.status)}</Badge>}
        />
      )}

      <div className={embedded ? "mx-auto max-w-3xl space-y-4 pb-24" : "mx-auto max-w-3xl space-y-4 p-4 md:p-8"}>
        {review && (
          <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-600">
              Coach Reply
            </div>
            <p className="whitespace-pre-wrap text-sm">{review.reply_text}</p>
            <div className="mt-3">
              <Link to="/portal/messages">
                <Button variant="outline" size="sm">
                  <MessageCircle className="mr-2 h-4 w-4" /> Continue in Messenger
                </Button>
              </Link>
            </div>
          </Card>
        )}

        {meet && <MeetLine name={meet.meetName} date={meet.meetDate} />}
        {stillToSort.length > 0 && <StillToSort rows={stillToSort} onGo={goTo} />}

        {carried && !readOnly && (
          <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[14px]" data-form-carried>
            Your last answers are filled in. Change anything that's different now.
          </p>
        )}

        {shownQuestions.map((q) => {
          if (q.question_type === "info") {
            return (
              <section key={q.id} id={`q-${q.id}`} className="px-1 pt-2" data-form-question="info">
                <h3 className="text-[19px] font-semibold leading-snug">{q.label}</h3>
                {q.help_text && <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-muted-foreground">{q.help_text}</p>}
              </section>
            );
          }
          if (q.question_type === "checklist") {
            return (
              <ChecklistSection
                key={q.id}
                q={q}
                value={local[q.id]}
                answers={liveAnswers}
                readOnly={!!readOnly}
                flagged={flagged.has(q.id)}
                onChange={(next) => saveAnswer(q, next)}
              />
            );
          }
          const units = q.question_type === "number" ? questionUnits(q) : null;
          if (units) {
            const cur: UnitValue = isUnitValue(local[q.id])
              ? local[q.id]
              : { value: local[q.id] == null || local[q.id] === "" ? "" : String(local[q.id]), unit: prefillProfile?.bodyweight?.unit ?? units[0] };
            const bw = questionPrefill(q) === "bodyweight" ? prefillProfile?.bodyweight : null;
            const hint = bw && !(cur.value !== "" && Number(cur.value) === bw.value && cur.unit === bw.unit)
              ? {
                  text: `Last weigh-in ${bw.value} ${bw.unit}, ${bw.ageDays === 0 ? "today" : bw.ageDays === 1 ? "yesterday" : new Date(`${bw.date}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`,
                  onUse: () => saveAnswer(q, { value: String(bw.value), unit: bw.unit }),
                }
              : null;
            return (
              <QuestionCard key={q.id} q={q} index={shownQuestions.filter((x) => x.question_type !== "info" && x.question_type !== "checklist").indexOf(q)} flagged={flagged.has(q.id)}>
                <UnitNumberInput
                  value={cur}
                  units={units}
                  readOnly={!!readOnly}
                  onChange={(next, typed) => saveAnswer(q, next, { defer: typed })}
                  onDone={() => void flushSaves(q.id)}
                  hint={hint}
                />
              </QuestionCard>
            );
          }
          if ((q.validation as any)?.compact && typeof local[q.id] === "string" && local[q.id].trim() && !editingCompact.has(q.id)) {
            return (
              <div key={q.id} id={`q-${q.id}`} className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5" data-form-compact>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-muted-foreground">{q.label}</p>
                  <p className="truncate text-[16px] font-semibold">{local[q.id]}</p>
                </div>
                {!readOnly && (
                  <Button variant="ghost" className="h-10 px-3" onClick={() => setEditingCompact((s) => new Set(s).add(q.id))}>
                    Edit
                  </Button>
                )}
              </div>
            );
          }
          const idx = shownQuestions.filter((x) => x.question_type !== "info" && x.question_type !== "checklist").indexOf(q);
          const issue = q.question_type === "number" ? numberIssue(q, local[q.id]) : null;
          const flag = flagged.has(q.id);
          return (
            <section
              key={q.id}
              id={`q-${q.id}`}
              className={cn("scroll-mt-24 rounded-2xl border bg-card p-4 transition-colors sm:p-5", flag ? "border-destructive ring-2 ring-destructive/20" : "border-border")}
              data-form-question={q.question_type}
            >
              <div className="flex items-start gap-3">
                <span className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-bold tabular-nums text-muted-foreground" aria-hidden>
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] font-bold leading-snug">
                    {q.label}
                    {q.required && <span className="ml-1 text-destructive">*</span>}
                  </h3>
                  {q.help_text && <p className="mt-1 text-[14px] leading-snug text-muted-foreground">{q.help_text}</p>}
                </div>
              </div>
              {getQuestionReferenceImage(q) && (
                <QuestionReferenceImage src={getQuestionReferenceImage(q)!} label={q.label} />
              )}

              <div className="mt-3.5">
                <QuestionInput
                  q={q}
                  value={local[q.id]}
                  sourceItems={sourceItems(q)}
                  profile={prefillProfile ?? null}
                  files={files.filter((f) => f.question_id === q.id)}
                  readOnly={!!readOnly}
                  busy={busyQ[q.id]}
                  onChange={(v, typed) => saveAnswer(q, v, { defer: typed })}
                  onDone={() => void flushSaves(q.id)}
                  onUpload={(file) => handleFileUpload(q, file)}
                  onRemove={(fileId) => handleFileRemove(q, fileId)}
                  onReplace={(fileId, file) => handleFileReplace(q, fileId, file)}
                />
              </div>
              {issue ? (
                <p className="mt-2 text-[13px] font-semibold text-amber-600 dark:text-amber-400" data-form-number-issue>{issue}</p>
              ) : (
                flag && <p className="mt-2 text-[13px] font-semibold text-destructive">This one needs an answer</p>
              )}
            </section>
          );
        })}

        {updating && (
          <div
            className={cn("sticky z-10 border-t border-border/70 bg-background/95 pt-3 backdrop-blur", embedded ? "px-1" : "-mx-4 px-4 md:mx-0 md:rounded-2xl md:border")}
            style={{
              bottom: embedded ? 0 : "calc(var(--bottom-nav-clearance, 0px) + env(safe-area-inset-bottom))",
              paddingBottom: embedded ? "max(env(safe-area-inset-bottom), 0.75rem)" : "0.75rem",
            }}
            data-form-update-bar
          >
            <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
              <span className="font-semibold tabular-nums">
                {progress.total > 0 ? `${progress.done} of ${progress.total} ${checklists.length ? "checked" : "answered"}` : "Sent to your coach"}
              </span>
              <span className="text-muted-foreground">Changes save as you go</span>
            </div>
            <Button
              className="h-14 w-full rounded-2xl text-[16px] font-semibold"
              onClick={async () => {
                await flushSaves();
                qc.invalidateQueries({ queryKey: ["chat-form-request-status", formId] });
                closeOrBack();
              }}
            >
              <Check className="mr-2 h-5 w-5" /> Done
            </Button>
          </div>
        )}

        {!readOnly && !updating && (
          // Submit sits above the tab bar (or the sheet's bottom), full width for a thumb
          <div
            className={cn("sticky z-10 border-t border-border/70 bg-background/95 pt-3 backdrop-blur", embedded ? "px-1" : "-mx-4 px-4 md:mx-0 md:rounded-2xl md:border")}
            style={{
              bottom: embedded ? 0 : "calc(var(--bottom-nav-clearance, 0px) + env(safe-area-inset-bottom))",
              paddingBottom: embedded ? "max(env(safe-area-inset-bottom), 0.75rem)" : "0.75rem",
            }}
            data-form-submit-bar
          >
            {progress.total > 0 && (
              <>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold tabular-nums">
                    {progress.done} of {progress.total} {checklists.length ? "checked" : "answered"}
                  </span>
                  <span className="text-muted-foreground">Saves as you go</span>
                </div>
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              </>
            )}
            <ActionButton
              onAction={handleSubmit}
              loadingLabel="Submitting…"
              successLabel="Submitted"
              successToast="Submitted! Coach Jared will reply in messenger."
              jobLabel="Submitting onboarding form"
              jobDescription={form?.title ?? undefined}
              className="h-14 w-full rounded-2xl bg-primary text-[16px] font-semibold"
              icon={<Send className="h-5 w-5" />}
            >
              {form.button_label ||
                (form.title?.toLowerCase().includes("check")
                  ? "Submit Weekly Check-In"
                  : `Submit ${form.title}`)}
            </ActionButton>
          </div>
        )}
      </div>
    </>
  );
}

/** Across every checklist on screen: items marked of items shown. */
function checklistTotals(qs: NfQuestion[], local: Record<string, any>, answers: Record<string, NfAnswer | undefined>) {
  let done = 0;
  let total = 0;
  for (const q of qs) {
    const items = visibleItems(checklistItems(q), answers);
    const states = checklistStates(local[q.id]);
    total += items.length;
    done += items.filter((i) => states.has(i.key)).length;
  }
  return { done, total };
}

/** The meet the checklist is for, how far out it is, and what's due now. */
function MeetLine({ name, date }: { name: string | null; date: string | null }) {
  if (!name && !date) return null;
  const today = todayLocal();
  const days = daysUntil(date, today);
  const step = currentStep(meetTimeline(date), today);
  const when = date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) : null;
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3" data-meet-line>
      <p className="text-[16px] font-semibold leading-snug">{name ?? "Your meet"}</p>
      <p className="mt-0.5 text-[14px] text-muted-foreground">
        {[when, days != null && days >= 0 ? daysOutLabel(days) : null].filter(Boolean).join(" · ")}
        {step && days != null && days >= 0 ? ` · ${step.label}` : ""}
      </p>
    </div>
  );
}

/** One question's card: its number, words and help, then the input. */
function QuestionCard({ q, index, flagged, children }: { q: NfQuestion; index: number; flagged: boolean; children: React.ReactNode }) {
  return (
    <section
      id={`q-${q.id}`}
      className={cn("scroll-mt-24 rounded-2xl border bg-card p-4 transition-colors sm:p-5", flagged ? "border-destructive ring-2 ring-destructive/20" : "border-border")}
      data-form-question={q.question_type}
    >
      <div className="flex items-start gap-3">
        <span className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-bold tabular-nums text-muted-foreground" aria-hidden>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-bold leading-snug">
            {q.label}
            {q.required && <span className="ml-1 text-destructive">*</span>}
          </h3>
          {q.help_text && <p className="mt-1 text-[14px] leading-snug text-muted-foreground">{q.help_text}</p>}
        </div>
      </div>
      <div className="mt-3.5">{children}</div>
      {flagged && <p className="mt-2 text-[13px] font-semibold text-destructive">This one needs an answer</p>}
    </section>
  );
}

/**
 * The meet a checklist is for, from what the athlete can see: the meet their
 * coach sent it with (the assignment's settings), their next meet prep, or
 * their own Competition Calendar answers (meet-checklist.ts pickMeet).
 */
async function loadMeetGuess(clientId: string, formId: string) {
  const db = supabase as any;
  const today = todayLocal();
  const [{ data: assignment }, { data: preps }, { data: lastPlan }] = await Promise.all([
    db.from("nf_assignments").select("settings").eq("form_id", formId).eq("client_id", clientId).maybeSingle(),
    db.from("pl_preps").select("title, event_name, event_date, weight_class, status, archived").eq("client_id", clientId).gte("event_date", today).order("event_date").limit(5),
    db
      .from("nf_submissions")
      .select("id")
      .eq("form_id", COMPETITION_FORM_ID)
      .eq("client_id", clientId)
      .neq("status", "in_progress")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);
  let plan = null as ReturnType<typeof competitionPlanFromAnswers> | null;
  if (lastPlan?.id) {
    const [{ data: qs }, answers] = await Promise.all([
      db.from("nf_questions").select("id, validation").eq("form_id", COMPETITION_FORM_ID),
      listAnswers(lastPlan.id),
    ]);
    if (qs?.length) plan = competitionPlanFromAnswers(qs, answers);
  }
  const sent = (assignment?.settings as any)?.meet ?? null;
  return pickMeet({ sent, preps: preps ?? [], plan }, today);
}

/** Their latest weigh-in (the app's log, else the coach's older entries) in their bodyweight unit. */
async function loadLatestWeighIn(clientId: string, userId: string | null | undefined) {
  const db = supabase as any;
  const [{ data: bw }, { data: legacy }, { data: pref }, { data: cl }] = await Promise.all([
    userId
      ? db.from("progress_bodyweight").select("logged_date, weight_value, weight_unit").eq("user_id", userId).order("logged_date", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("progress_metrics").select("entry_date, bodyweight, bodyweight_unit").eq("client_id", clientId).not("bodyweight", "is", null).order("entry_date", { ascending: false }).limit(1).maybeSingle(),
    userId ? db.from("bodyweight_unit_prefs").select("unit").eq("user_id", userId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("clients").select("preferred_weight_unit").eq("id", clientId).maybeSingle(),
  ]);
  const toKg = (v: number, u: string | null) => (u === "kg" ? v : v / 2.2046226);
  const a = bw?.weight_value != null ? { date: String(bw.logged_date), kg: toKg(Number(bw.weight_value), bw.weight_unit), unit: bw.weight_unit } : null;
  const b = legacy?.bodyweight != null ? { date: String(legacy.entry_date).slice(0, 10), kg: toKg(Number(legacy.bodyweight), legacy.bodyweight_unit ?? "lb"), unit: legacy.bodyweight_unit ?? "lb" } : null;
  // the app's own log wins a tie
  const latest = a && b ? (b.date > a.date ? b : a) : a ?? b;
  const unit: "kg" | "lb" = pref?.unit === "kg" || pref?.unit === "lb" ? pref.unit : latest?.unit === "kg" ? "kg" : cl?.preferred_weight_unit === "kg" ? "kg" : "lb";
  return bodyweightSuggestion(latest ? { date: latest.date, kg: latest.kg } : null, unit, todayLocal());
}

/** Answered: a file uploaded, something picked, or words typed (spaces don't count). */
function isAnswered(q: NfQuestion, v: any, files: { question_id: string }[]): boolean {
  if (q.question_type === "file" || q.question_type === "video") return files.some((f) => f.question_id === q.id);
  if (isUnitValue(v)) return v.value.trim() !== "" && Number.isFinite(Number(v.value));
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  return v !== undefined && v !== null;
}

function QuestionInput({
  q,
  value,
  sourceItems,
  profile,
  files,
  readOnly,
  busy,
  onChange,
  onDone,
  onUpload,
  onRemove,
  onReplace,
}: {
  q: NfQuestion;
  value: any;
  /** A ranking's or choice's items from another question (the meets picked earlier). */
  sourceItems?: Array<{ key: string; label: string }> | null;
  profile?: { sex?: string | null; date_of_birth?: string | null } | null;
  files: any[];
  readOnly: boolean;
  busy?: "uploading" | "removing" | "replacing";
  /** `typed`: from the keyboard (saved a beat later); taps save at once. */
  onChange: (v: any, typed?: boolean) => void;
  /** Left the box: save what was typed now. */
  onDone: () => void;
  onUpload: (f: File) => void;
  onRemove: (fileId: string) => void;
  onReplace: (fileId: string, file: File) => void;
}) {
  const opts = (q.options ?? []) as string[];
  const quick = quickAnswers(q);
  const exclusive = quickExclusive(q);
  // big enough for a thumb, 16px so iOS never zooms the page in
  const field = "h-12 rounded-xl px-3.5 text-[16px]";
  const v = (q.validation ?? {}) as Record<string, any>;
  if (q.question_type === "competitions") {
    return (
      <MeetsInput
        options={opts}
        noneLabel={typeof v.none_option === "string" ? v.none_option : null}
        value={value}
        readOnly={readOnly}
        onChange={(next, typed) => onChange(next, typed)}
      />
    );
  }
  if (q.question_type === "ranking") {
    const items = sourceItems ?? opts.map((o) => ({ key: o, label: o }));
    return (
      <RankingInput
        items={items}
        value={value}
        readOnly={readOnly}
        emptyText={sourceItems ? "Pick the meets you're considering above first." : "Nothing to put in order."}
        onChange={(next) => onChange(next)}
      />
    );
  }
  if ((q.question_type === "single_choice" || q.question_type === "dropdown") && sourceItems) {
    const labels = sourceItems.map((i) => i.label);
    if (!labels.length) return <p className="rounded-xl bg-muted px-3.5 py-3 text-[14px] text-muted-foreground">Pick the meets you're considering above first.</p>;
    return <ChoiceButtons options={labels} label={q.label} picked={(o) => value === o} readOnly={readOnly} onPick={(o) => onChange(value === o ? "" : o)} />;
  }
  if ((q.question_type === "single_choice" || q.question_type === "dropdown") && Array.isArray(v.group_prefixes) && v.group_prefixes.length) {
    return <GroupedChoice options={opts} prefixes={v.group_prefixes} value={typeof value === "string" ? value : ""} sex={profile?.sex} readOnly={readOnly} onChange={(o) => onChange(o)} />;
  }
  if (q.question_type === "short_text" || q.question_type === "long_text") {
    const text = typeof value === "string" ? value : value == null ? "" : String(value);
    const placeholder = quick.length ? "Or type your own…" : "Type your answer…";
    return (
      <div>
        {quick.length > 0 && (
          <QuickChips chips={quick} readOnly={readOnly} isOn={(c) => quickPicked(text, c)} onPick={(c) => onChange(toggleQuick(text, c, exclusive))} />
        )}
        {q.question_type === "short_text" ? (
          <Input
            className={field}
            value={text}
            disabled={readOnly}
            placeholder={placeholder}
            enterKeyHint="done"
            // a phone or an email opens the right keyboard
            type={v.input === "email" ? "email" : v.input === "tel" ? "tel" : "text"}
            inputMode={v.input === "email" ? "email" : v.input === "tel" ? "tel" : undefined}
            autoComplete={v.input === "email" ? "email" : v.input === "tel" ? "tel" : undefined}
            onChange={(e) => onChange(e.target.value, true)}
            onBlur={onDone}
          />
        ) : (
          <Textarea
            rows={3}
            className="min-h-[104px] rounded-xl px-3.5 py-3 text-[16px] leading-snug"
            value={text}
            disabled={readOnly}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value, true)}
            onBlur={onDone}
          />
        )}
      </div>
    );
  }
  if (q.question_type === "number") {
    const { unit } = numberRange(q);
    const text = value == null ? "" : String(value);
    return (
      <div>
        {quick.length > 0 && (
          <QuickChips
            chips={quick}
            readOnly={readOnly}
            label={quickNumberLabel}
            isOn={(c) => text !== "" && Number(text) === Number(c)}
            onPick={(c) => onChange(text !== "" && Number(text) === Number(c) ? "" : c)}
          />
        )}
        <div className="relative">
          <Input
            // the number pad, without a number box's spinners or scroll-to-change
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            className={cn(field, "text-[17px] font-semibold tabular-nums", unit && "pr-16")}
            value={text}
            disabled={readOnly}
            placeholder={quick.length ? "Or type the number" : "Type a number"}
            enterKeyHint="done"
            onChange={(e) => onChange(e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"), true)}
            onBlur={onDone}
          />
          {unit && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14px] font-semibold text-muted-foreground">{unit}</span>}
        </div>
      </div>
    );
  }
  if (q.question_type === "date") {
    return <Input type="date" className={field} value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.question_type === "rating") {
    const n = Number(value) || 0;
    return (
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={q.label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={n === i}
            disabled={readOnly}
            onClick={() => onChange(n === i ? "" : i)}
            className={cn(
              "h-12 rounded-xl border-2 text-[17px] font-bold tabular-nums transition-colors active:scale-[0.97]",
              n === i ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
            )}
          >
            {i}
          </button>
        ))}
      </div>
    );
  }
  if (q.question_type === "single_choice" || q.question_type === "dropdown") {
    return <ChoiceButtons options={opts} label={q.label} picked={(o) => value === o} readOnly={readOnly} onPick={(o) => onChange(value === o ? "" : o)} />;
  }
  if (q.question_type === "multi_choice") {
    const arr: string[] = Array.isArray(value) ? value : [];
    return (
      <>
      {v.prefill === "age_class" && !readOnly && <AgeClassHint options={opts} birthDate={profile?.date_of_birth} />}
      <ChoiceButtons
        multi
        options={opts}
        label={q.label}
        picked={(o) => arr.includes(o)}
        readOnly={readOnly}
        onPick={(o) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}
      />
      </>
    );
  }
  if (q.question_type === "file" || q.question_type === "video") {
    const accept = q.question_type === "video" ? "video/*" : "*/*";
    return (
      <div className="space-y-3">
        {files.length > 0 && (
          <ul className="space-y-2 text-sm">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/30 px-3 py-2"
              >
                <span className="truncate">{f.original_name}</span>
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted">
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{busy === "replacing" ? "Replacing…" : "Replace"}</span>
                      <input
                        type="file"
                        accept={accept}
                        className="hidden"
                        disabled={!!busy}
                        onChange={(e) => {
                          const nf = e.target.files?.[0];
                          if (nf) onReplace(f.id, nf);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        if (confirm("Remove this file?")) onRemove(f.id);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {busy === "removing" ? "Removing…" : "Remove"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span>
              {busy === "uploading"
                ? "Uploading…"
                : `Upload ${q.question_type === "video" ? "video" : "file"}`}
            </span>
            <input
              type="file"
              accept={accept}
              className="hidden"
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    );
  }
  return null;
}

/** One-tap answers above a box: tap to add (or take out), then type anything else. */
function QuickChips({ chips, readOnly, isOn, onPick, label }: { chips: string[]; readOnly: boolean; isOn: (c: string) => boolean; onPick: (c: string) => void; label?: (c: string) => string }) {
  return (
    <div className="mb-2.5 flex flex-wrap gap-2" data-quick-answers>
      {chips.map((c) => {
        const on = isOn(c);
        return (
          <button
            key={c}
            type="button"
            disabled={readOnly}
            aria-pressed={on}
            onClick={() => onPick(c)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-4 text-[15px] font-semibold transition-colors active:scale-[0.97] disabled:opacity-60",
              on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-foreground",
            )}
            data-quick-answer
          >
            {on && <Check className="h-4 w-4 text-primary" />}
            {label ? label(c) : c}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A question's choices as buttons a thumb can't miss: a single "Yes, I
 * agree" is one big tick, short ones share a row, the rest are full-width
 * rows (choiceLayout). Tap again to take it back.
 */
function ChoiceButtons({ options, label, picked, onPick, readOnly, multi = false }: { options: string[]; label: string; picked: (o: string) => boolean; onPick: (o: string) => void; readOnly: boolean; multi?: boolean }) {
  const layout = choiceLayout(options);
  const role = multi ? "checkbox" : "radio";
  const mark = (on: boolean) => (
    <span
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center border-2 transition-colors",
        multi || layout === "agree" ? "rounded-md" : "rounded-full",
        on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background",
      )}
      aria-hidden
    >
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
  if (layout === "agree") {
    const o = options[0];
    const on = picked(o);
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        disabled={readOnly}
        onClick={() => onPick(o)}
        className={cn(
          "flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[16px] font-bold transition-colors active:scale-[0.99] disabled:opacity-60",
          on ? "border-primary bg-primary/10" : "border-border bg-background",
        )}
        data-choice-agree
      >
        {mark(on)}
        <span className="min-w-0">{o}</span>
      </button>
    );
  }
  if (layout === "row") {
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role={multi ? "group" : "radiogroup"} aria-label={label}>
        {options.map((o) => {
          const on = picked(o);
          return (
            <button
              key={o}
              type="button"
              role={role}
              aria-checked={on}
              disabled={readOnly}
              onClick={() => onPick(o)}
              className={cn(
                "min-h-[52px] rounded-2xl border-2 px-2 text-[16px] font-bold leading-tight transition-colors active:scale-[0.97] disabled:opacity-60",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
              )}
              data-choice
            >
              {o}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="space-y-2" role={multi ? "group" : "radiogroup"} aria-label={label}>
      {options.map((o) => {
        const on = picked(o);
        return (
          <button
            key={o}
            type="button"
            role={role}
            aria-checked={on}
            disabled={readOnly}
            onClick={() => onPick(o)}
            className={cn(
              "flex min-h-[52px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[16px] font-semibold leading-snug transition-colors active:scale-[0.99] disabled:opacity-60",
              on ? "border-primary bg-primary/10" : "border-border bg-background",
            )}
            data-choice
          >
            {mark(on)}
            <span className="min-w-0">{o}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExternalFormView({
  form,
  client,
  submission,
  onMarkSubmitted,
  onBack,
  embedded = false,
}: {
  form: any;
  client: any;
  submission: any;
  onMarkSubmitted: () => Promise<void> | void;
  onBack: () => void;
  embedded?: boolean;
}) {
  const [iframeFailed, setIframeFailed] = useState(false);
  const { data: assignmentId } = useQuery({
    queryKey: ["nf-assignment-for", form.id, client?.id],
    enabled: !!client?.id && !!form?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("nf_assignments")
        .select("id")
        .eq("form_id", form.id)
        .eq("client_id", client.id)
        .maybeSingle();
      return (data as any)?.id ?? null;
    },
  });
  const rawUrl = form.external_url as string | null;
  const url = rawUrl && form.requires_client_identity !== false
    ? buildFilloutUrl(rawUrl, client, {
        assignmentId: assignmentId ?? null,
        formId: form.id,
        periodStart: submission?.period_start ?? null,
      })
    : rawUrl;
  const openStyle = (form.open_style ?? "embed") as "embed" | "modal" | "new_tab";
  const submitted = submission.status !== "in_progress";
  const canEmbed = !!url && openStyle !== "new_tab" && !iframeFailed;

  return (
    <>
      {!embedded && (
        <PageHeader
          backTo="/portal/messages"
          backLabel="Back to Messages"
          title={form.title}
          subtitle={submission.period_start ? `Week of ${submission.period_start}` : undefined}
          actions={
            <div className="flex items-center gap-2">
              <Badge className={statusTone(submission.status) + " border"}>{statusLabel(submission.status)}</Badge>
            </div>
          }
        />
      )}
      <div className={embedded ? "mx-auto max-w-4xl space-y-4 pb-24" : "mx-auto max-w-4xl space-y-4 p-4 md:p-6"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {embedded ? (
            <Badge className={statusTone(submission.status) + " border"}>{statusLabel(submission.status)}</Badge>
          ) : (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Check-Ins
            </Button>
          )}
          {url && (
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Open in new tab
              </a>
            </Button>
          )}
        </div>

        {form.description && (
          <Card className="border-border bg-card p-4 text-sm text-muted-foreground">{form.description}</Card>
        )}

        {!url ? (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            This form doesn't have a link yet. Please contact your coach.
          </Card>
        ) : canEmbed ? (
          <Card className="overflow-hidden border-border bg-card">
            <iframe
              src={url}
              title={form.title}
              className="h-[75vh] w-full"
              onError={() => setIframeFailed(true)}
              allow="camera; microphone; clipboard-write; encrypted-media"
            />
          </Card>
        ) : (
          <Card className="border-dashed border-border bg-card p-6 text-center text-sm">
            <p className="text-muted-foreground">
              {iframeFailed
                ? "This form provider blocked embedding. Use the button below to open it."
                : "This form opens in a new tab."}
            </p>
            <Button asChild className="mt-3 bg-primary font-semibold">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                {form.button_label || `Open ${form.title}`}
              </a>
            </Button>
          </Card>
        )}

        <Card className="border-primary/30 bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {submitted
                ? "Marked as submitted. Your coach will follow up in messenger."
                : "Finished the form? Tap below so your coach knows to review it."}
            </div>
            <ActionButton
              onAction={async () => { await onMarkSubmitted(); }}
              disabled={submitted}
              loadingLabel="Marking…"
              successLabel="Submitted"
              successToast={submitted ? false : "Marked submitted"}
              jobLabel="Marking form submitted"
              jobDescription={form?.title ?? undefined}
              className="bg-primary font-semibold"
              icon={<Check className="h-4 w-4" />}
            >
              {submitted ? "Submitted" : "Mark as submitted"}
            </ActionButton>
          </div>
        </Card>
      </div>
    </>
  );
}