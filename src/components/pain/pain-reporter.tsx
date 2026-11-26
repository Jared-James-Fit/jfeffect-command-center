/**
 * "Anything hurt?" → Yes, in the workout review (Nov 26 2026): voice first.
 *
 *   Tap the mic → say it → check it → Confirm & finish.
 *
 * One big mic, one line on what to say and one example. They say everything
 * in one go ("my left knee hurt on squats, about a 4, and my lower back's
 * tight"); the app's own reader (describe.ts: free, instant, on the phone)
 * turns it into places, and only when it can't place anything does the
 * server read it. Every place lands in one list right here (pain-entries.tsx)
 * with what's still needed on it (a side, how bad or Unsure), so nothing is
 * hidden behind another screen and the review's button says what's left.
 * Saying more later ("it's sharp", "actually the right one") joins the places
 * already there, never a second copy (picks.ts `applyDescribed`).
 *
 * Typing ("Type instead") and the body map ("Select area") are the small ways
 * in under the mic, into the same places and the same list. Voice is the
 * default every time this opens; the mic is never on without a tap.
 *
 * Voice is turned into text by OpenAI only with the person's permission
 * (src/lib/ai-consent). Someone who hasn't given it is asked in one line at
 * the moment they tap the mic, and nothing is recorded until they allow it;
 * typing and the body map need no permission (the reader runs on the phone).
 *
 * A severe place, tingling or numbness, a pop or swelling shows the safety
 * notice (safety.ts). That's the only advice the athlete sees here.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Mic, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { noAutofill } from "@/lib/no-autofill";
import { PainMap, type PainMapContext } from "@/components/pain/pain-map";
import { PainEntryRow } from "@/components/pain/pain-entries";
import { VoiceTimer, VoiceWaveform } from "@/components/voice/voice-waveform";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { useMyAiConsent } from "@/components/ai-consent/ai-consent";
import { readPainDescriptionFn, transcribePainVoiceFn } from "@/lib/pain/describe.functions";
import { describePain, DESCRIBE_MAX_CHARS, type DescribeResult, type Unclear } from "@/lib/pain/describe";
import { followUpFor } from "@/lib/pain/history";
import { placeLabel } from "@/lib/pain/report";
import { regionOf, type PainSide } from "@/lib/pain/regions";
import { addPick, applyDescribed, applyDetail, mirrorOf, replacePlace, type PainPick } from "@/lib/pain/picks";
import { CLIENT_SAFETY_NOTICE, needsSafetyNotice, URGENT_SIGNS } from "@/lib/pain/safety";

export type PainContext = PainMapContext & { recentExercises?: { id: string | null; name: string }[] };

/** What to say, once, and one way of saying it. */
export const VOICE_PROMPT = "Say where it hurts, which side, and how bad out of 10.";
export const VOICE_EXAMPLE = "“My left knee hurt during squats, about a 4. My lower back's a bit tight too.”";

const MAX_VOICE_MS = 60_000;

export function PainReporter({ picks, onChange, ctx }: { picks: PainPick[]; onChange: (next: PainPick[]) => void; ctx: PainContext | null }) {
  // always the latest places: voice and the server answer after the screen moved on
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const change = useCallback(
    (next: PainPick[]) => {
      picksRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  // voice first, every time this opens (a fresh mount per "Yes")
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [text, setText] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [unclear, setUnclear] = useState<Unclear[]>([]);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [flashUids, setFlashUids] = useState<string[]>([]);
  const [askConsent, setAskConsent] = useState(false);
  const [map, setMap] = useState<{ open: boolean; replaceUid: string | null }>({ open: false, replaceUid: null });
  // the places the last description was about (for "it's sharp" said next)
  const lastUids = useRef<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const typeRef = useRef<HTMLTextAreaElement | null>(null);

  const consent = useMyAiConsent();
  const readFn = useServerFn(readPainDescriptionFn);
  const hearFn = useServerFn(transcribePainVoiceFn);

  const exercises = useMemo(() => [...(ctx?.exercises ?? []), ...(ctx?.recentExercises ?? [])], [ctx]);

  const flash = (uids: string[]) => {
    setFlashUids(uids);
    window.setTimeout(() => setFlashUids((f) => (f === uids ? [] : f)), 1200);
  };

  const prior = useMemo(
    () => (ctx ? (pl: { region: string; side: PainSide | null; site: string | null }) => followUpFor(ctx.entries, pl.region, pl.side, { today: ctx.today, feedbackId: ctx.feedbackId, site: pl.site }) : undefined),
    [ctx],
  );

  /** What they said or typed, into the places. */
  const use = useCallback(
    (r: DescribeResult, words: string): boolean => {
      const before = picksRef.current;
      let next = before;
      let touched: string[] = [];
      if (r.places.length) {
        const res = applyDescribed(before, r.places, prior);
        next = res.picks;
        touched = res.uids;
      } else if (r.detail) {
        // said about no place of its own: the one open, else the only one, else the ones just described
        const open = openUid && before.some((p) => p.uid === openUid) ? [openUid] : [];
        const only = before.length === 1 ? [before[0].uid] : [];
        const last = lastUids.current.filter((u) => before.some((p) => p.uid === u));
        const target = open.length ? open : only.length ? only : last;
        if (target.length) {
          next = applyDetail(before, r.detail, target);
          touched = target;
        }
      }
      if (next !== before) change(next);
      if (touched.length) {
        lastUids.current = touched;
        flash(touched);
      }
      if (r.unclear.length) setUnclear((u) => [...u.filter((x) => !r.unclear.some((y) => y.word === x.word)), ...r.unclear]);
      const placed = touched.length > 0 || r.unclear.length > 0;
      if (!placed) {
        setNote(
          r.detail && before.length > 1
            ? "Which place is that about? Tap it below to add it there."
            : words.trim().split(/\s+/).length < 2
              ? "Didn't catch where. Say the body part, like “left knee”, or select the area."
              : "Couldn't place that. Name the body part (knee, low back, left shoulder), or select the area.",
        );
      } else setNote(null);
      if (touched.length) feedback("confirm");
      return placed;
    },
    [change, openUid, prior],
  );

  /** Read it: the phone first; the server only when the phone couldn't place anything and they've allowed it. */
  const process = useCallback(
    async (words: string): Promise<boolean> => {
      const t = words.trim().slice(0, DESCRIBE_MAX_CHARS);
      if (t.length < 2) return false;
      const local = describePain(t, { exercises });
      if (local.places.length || local.unclear.length || local.detail) return use(local, t);
      const mayAsk = !consent.askable || consent.state === "granted";
      if (!mayAsk || t.length < 3) return use(local, t);
      setReading(true);
      try {
        const r = await readFn({ data: { text: t, exercises: exercises.slice(0, 80) } });
        return use(r.ok ? { places: r.places, unclear: r.unclear } : local, t);
      } catch {
        return use(local, t);
      } finally {
        setReading(false);
      }
    },
    [exercises, use, consent.askable, consent.state, readFn],
  );

  const voice = useVoiceDictation({
    maxMs: MAX_VOICE_MS,
    transcribe: async (audio, mime) => {
      const r = await hearFn({ data: { audio, mime } });
      if (!r.ok && "consent" in r && r.consent) setAskConsent(true);
      return r.ok ? { ok: true, text: r.text ?? "" } : { ok: false, reason: r.reason };
    },
    onText: (said) => {
      setHeard(said);
      void process(said);
    },
    tooShort: "That was too short. Tap the mic, say it, then tap again to finish.",
  });
  const state = voice.state;
  const recording = state === "recording";
  const busy = state === "requesting" || state === "processing" || state === "transcribing" || reading;

  const startVoice = () => {
    setNote(null);
    if (recording) return voice.finish();
    if (busy) return;
    // speech goes to OpenAI: someone who hasn't allowed it is asked first, in one line, and nothing records until they do
    if (consent.needsYes) {
      setAskConsent(true);
      feedback("tap");
      return;
    }
    void voice.start();
  };
  const allowAndSpeak = () => {
    setAskConsent(false);
    // a take the server refused for want of permission goes again; else the tap starts the mic
    if (voice.fail?.canRetry) voice.retry();
    else void voice.start();
    consent.set(true).catch((e: any) => toast.error(e?.message ?? "Couldn't save that. Try again."));
  };

  const typeInstead = () => {
    feedback("tap");
    setAskConsent(false);
    if (recording) voice.cancel();
    setMode("type");
    window.setTimeout(() => typeRef.current?.focus(), 30);
  };
  const submitTyped = async () => {
    const t = text.trim();
    if (!t || reading) return;
    const placed = await process(t);
    if (placed) {
      setText("");
      setHeard(t);
      setMode("voice");
    }
  };
  // the box grows with what's typed
  useLayoutEffect(() => {
    const el = typeRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, mode]);

  // Yes was just tapped: bring the mic into view
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const remove = (p: PainPick) => {
    feedback("tap");
    const before = picksRef.current;
    const mirror = mirrorOf(before, p);
    change(before.filter((x) => x.uid !== p.uid && x.uid !== mirror?.uid));
    if (openUid === p.uid) setOpenUid(null);
    toast(`${mirror ? `${placeLabel({ ...p, side: null })} (both sides)` : placeLabel(p)} removed`, { action: { label: "Undo", onClick: () => change(before) }, duration: 5000 });
  };

  const pickFromMap = (place: { region: string; side: PainSide | null; site: string | null }) => {
    const before = picksRef.current;
    const res = map.replaceUid ? replacePlace(before, map.replaceUid, place) : addPick(before, place);
    if (res.picks !== before) change(res.picks);
    setMap({ open: false, replaceUid: null });
    setNote(null);
    flash([res.uid]);
    lastUids.current = [res.uid];
    feedback("confirm");
  };

  const answerUnclear = (u: Unclear, region: string) => {
    feedback("tap");
    const r = regionOf(region);
    const res = applyDescribed(picksRef.current, [
      { region, site: null, side: null, score: null, feel: [], timing: [], exerciseName: null, exerciseId: null, impact: null, change: null, note: heard?.slice(0, 300) ?? "", needs: r?.sided ? ["score", "side"] : ["score"] },
    ]);
    change(res.picks);
    setUnclear((list) => list.filter((x) => x.word !== u.word));
    flash(res.uids);
  };

  const safety = needsSafetyNotice(picks.map((p) => ({ region: p.region, side: p.side ?? null, severity: p.severity, score: p.score, feel: p.feel, trigger: p.trigger, timing: p.timing })));
  const hasPlaces = picks.length > 0;
  const consentLine = askConsent && consent.askable && consent.state !== "granted";

  const micButton = (size: "lg" | "md") => (
    <button
      type="button"
      onClick={startVoice}
      disabled={busy && !recording}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color] active:scale-95 disabled:opacity-70",
        size === "lg" ? "h-20 w-20 shadow-lg" : "h-12 w-12",
        // neutral and big while it waits; the brand red only while it's live (the voice rule)
        recording ? "jf-mic-listening bg-primary text-primary-foreground" : "bg-foreground text-background",
      )}
      aria-label={recording ? "Finish and use what I said" : "Tap to speak"}
      data-pain-mic={state}
    >
      {busy && !recording ? (
        <Loader2 className={cn(size === "lg" ? "h-8 w-8" : "h-5 w-5", "animate-spin")} aria-hidden />
      ) : recording ? (
        <Square className={cn(size === "lg" ? "h-7 w-7" : "h-4 w-4", "fill-current")} aria-hidden />
      ) : (
        <Mic className={size === "lg" ? "h-9 w-9" : "h-5 w-5"} aria-hidden />
      )}
    </button>
  );

  const statusWords = recording
    ? "Listening… tap to finish"
    : state === "requesting"
      ? "Starting the mic…"
      : state === "processing" || state === "transcribing"
        ? "Getting that down…"
        : reading
          ? "Reading it…"
          : hasPlaces
            ? "Add more by voice"
            : "Tap to speak";

  const secondary = (
    <div className="flex items-center justify-center gap-1 text-[13px] text-muted-foreground" data-pain-secondary>
      {mode === "voice" ? (
        <button type="button" onClick={typeInstead} className="inline-flex h-9 items-center rounded-full px-2.5 font-medium hover:text-foreground" data-pain-type-instead>
          Type instead
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setMode("voice");
            feedback("tap");
          }}
          className="inline-flex h-9 items-center rounded-full px-2.5 font-medium hover:text-foreground"
          data-pain-use-voice
        >
          Use voice
        </button>
      )}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => {
          feedback("tap");
          if (recording) voice.cancel();
          setMap({ open: true, replaceUid: null });
        }}
        className="inline-flex h-9 items-center rounded-full px-2.5 font-medium hover:text-foreground"
        data-pain-select-area
      >
        Select area
      </button>
    </div>
  );

  const voiceProblem =
    state === "error" && voice.fail && !consentLine ? (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px]" role="alert" data-pain-voice-error>
        <span className="text-foreground">{voice.fail.message}</span>
        {voice.fail.canRetry && (
          <button type="button" onClick={voice.retry} className="font-semibold underline underline-offset-2" data-voice-retry>
            Try again
          </button>
        )}
      </div>
    ) : null;

  const consentAsk = consentLine ? (
    <div className="w-full rounded-xl bg-muted/70 p-3 text-left" role="group" aria-label="Voice to text" data-pain-voice-consent>
      <p className="text-[13px] leading-snug text-foreground">
        {consent.state === "declined"
          ? "AI processing is off for your account. To use voice, your recording is sent to OpenAI to be turned into text."
          : "To use voice, your recording is sent to OpenAI to be turned into text."}{" "}
        <Link to="/portal/account" hash="privacy-data" className="text-muted-foreground underline underline-offset-2">
          Privacy
        </Link>
      </p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={allowAndSpeak} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-foreground text-[14px] font-semibold text-background" data-pain-consent-allow>
          {consent.state === "declined" ? "Turn on & speak" : "Allow & speak"}
        </button>
        <button type="button" onClick={typeInstead} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg text-[14px] font-semibold text-muted-foreground hover:bg-muted" data-pain-consent-type>
          Type instead
        </button>
      </div>
    </div>
  ) : null;

  const typeBox =
    mode === "type" ? (
      <div className="w-full rounded-xl border border-border p-2" data-pain-type>
        <textarea
          ref={typeRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value.slice(0, DESCRIBE_MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submitTyped();
            }
          }}
          enterKeyHint="done"
          placeholder="e.g. left knee hurt on squats, about a 4"
          aria-label="Type where it hurts"
          {...noAutofill("pain-type")}
          autoCapitalize="sentences"
          className="block max-h-40 w-full resize-none bg-transparent px-1.5 py-1.5 text-base leading-snug outline-none placeholder:text-muted-foreground"
          data-pain-type-text
        />
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => void submitTyped()}
            disabled={!text.trim() || reading}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40"
            data-pain-type-add
          >
            {reading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Add
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div ref={rootRef} className="space-y-3" data-pain-reporter data-pain-mode={mode}>
      {!hasPlaces ? (
        // the hero: the mic, what to say, one example; typing and the body map small underneath
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border px-4 pb-3 pt-5 text-center" data-pain-voice>
          {mode === "voice" && (
            <>
              {micButton("lg")}
              <p className="text-[16px] font-semibold" role="status" aria-live="polite" data-pain-voice-status>
                {statusWords}
              </p>
              {recording ? (
                <div className="flex w-full max-w-[16rem] items-center gap-2" data-pain-recording>
                  <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
                    <VoiceTimer meter={voice.meter} />
                  </span>
                  <VoiceWaveform meter={voice.meter} height={28} className="flex-1 text-foreground" />
                  <button type="button" onClick={voice.cancel} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Cancel recording" data-voice-cancel>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : !busy ? (
                <>
                  <p className="max-w-[18rem] text-[13px] leading-snug text-muted-foreground" data-pain-voice-prompt>
                    {VOICE_PROMPT}
                  </p>
                  <p className="max-w-[19rem] text-[13px] italic leading-snug text-muted-foreground/90" data-pain-voice-example>
                    {VOICE_EXAMPLE}
                  </p>
                </>
              ) : null}
              {consentAsk}
              {voiceProblem}
            </>
          )}
          {typeBox}
          {note && <p className="text-[13px] text-muted-foreground" data-pain-note>{note}</p>}
          {!recording && !consentLine && secondary}
        </div>
      ) : (
        <>
          {heard && (
            <p className="line-clamp-2 px-1 text-[12px] italic leading-snug text-muted-foreground" data-pain-heard>
              “{heard}”
            </p>
          )}
          <ul className="space-y-2" aria-label="Where it hurts" data-pain-entries>
            {picks
              // both sides of one place are one row
              .filter((p) => {
                const m = mirrorOf(picks, p);
                return !m || picks.indexOf(m) > picks.indexOf(p);
              })
              .map((p) => (
              <PainEntryRow
                key={p.uid}
                pick={p}
                picks={picks}
                ctx={ctx}
                open={openUid === p.uid}
                flash={flashUids.includes(p.uid)}
                onToggle={() => {
                  feedback("tap");
                  setOpenUid((u) => (u === p.uid ? null : p.uid));
                }}
                onChange={change}
                onRemove={() => remove(p)}
                onChangeSpot={() => setMap({ open: true, replaceUid: p.uid })}
              />
            ))}
          </ul>

          {unclear.map((u) => (
            <div key={u.word} className="space-y-2 rounded-xl border border-warning/50 p-3" data-pain-unclear={u.word}>
              <p className="text-[14px] font-semibold">Which part of your {u.word}?</p>
              <div className="flex flex-wrap gap-1.5">
                {u.options.map((r) => (
                  <button key={r} type="button" onClick={() => answerUnclear(u, r)} className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-[13px] font-medium hover:bg-muted">
                    {regionOf(r)?.label ?? r}
                  </button>
                ))}
                <button type="button" onClick={() => setUnclear((list) => list.filter((x) => x.word !== u.word))} className="inline-flex min-h-9 items-center rounded-full px-3 text-[13px] text-muted-foreground hover:bg-muted">
                  Skip
                </button>
              </div>
            </div>
          ))}

          {/* add more: by voice first, without starting over */}
          <div className="space-y-2 rounded-xl border border-dashed border-border p-2.5" data-pain-add-more>
            {mode === "voice" && (
              <div className="flex items-center gap-3">
                {micButton("md")}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold" role="status" aria-live="polite" data-pain-voice-status>
                    {statusWords}
                  </p>
                  {recording ? (
                    <div className="flex items-center gap-2" data-pain-recording>
                      <span className="text-[12px] tabular-nums text-muted-foreground">
                        <VoiceTimer meter={voice.meter} />
                      </span>
                      <VoiceWaveform meter={voice.meter} height={20} className="flex-1 text-foreground" />
                      <button type="button" onClick={voice.cancel} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Cancel recording" data-voice-cancel>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Another place, or more about one above.</p>
                  )}
                </div>
              </div>
            )}
            {consentAsk}
            {voiceProblem}
            {typeBox}
            {note && <p className="text-[13px] text-muted-foreground" data-pain-note>{note}</p>}
            {!recording && !consentLine && secondary}
          </div>
        </>
      )}

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

      <PainMap
        open={map.open}
        onOpenChange={(o) => setMap((m) => ({ open: o, replaceUid: o ? m.replaceUid : null }))}
        picks={picks}
        ctx={ctx}
        focusUid={map.replaceUid}
        onPick={pickFromMap}
      />
    </div>
  );
}
