/**
 * Recording a meeting (coach only). Consent first: who's in the meeting, that
 * everyone agreed, and how long the audio and words are kept; nothing records
 * before. Then a plain indicator (a red dot and the time), Pause, Resume and
 * Stop. Parts upload in the background while the meeting goes on and are kept
 * on the device until the server has them, so a dropped connection or a closed
 * tab loses nothing (reopening the meeting sends what's left). The server
 * transcribes each part with speakers; the coach names them afterwards.
 *
 * What it can hear is said plainly: this device's microphone (in person, or a
 * call on speaker), or a video call in another tab of this browser on a
 * computer (Chrome or Edge, with the tab's audio shared). A call in the Zoom
 * or Meet app, or on a phone, can't be captured by a web page: upload its
 * transcript after.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Mic, Pause, Play, Square, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { VoiceWaveform } from "@/components/voice/voice-waveform";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { createMeter } from "@/lib/voice/voice-capture";
import { micErrorMessage } from "@/lib/voice/voice-meter";
import {
  startMeetingCapture,
  tabAudioSupported,
  voiceSample,
  type MeetingCapture,
  type MeetingSource,
  type PartReady,
} from "@/lib/voice/meeting-capture";
import { dropPart, partsFor, savePart } from "@/lib/voice/meeting-audio-store";
import {
  recordingFinishFn,
  recordingPartDoneFn,
  recordingSpeakerRefsFn,
  recordingStartFn,
  recordingUploadUrlFn,
} from "@/lib/coaching-sessions/sessions.functions";
import { clock } from "@/lib/coaching-sessions/recording";

type Phase = "idle" | "consent" | "starting" | "recording" | "paused" | "stopping";

export function MeetingRecorder({ data, onChange }: { data: any; onChange: () => void }) {
  const s = data.session;
  const rec = s.recording ?? null;
  const start = useServerFn(recordingStartFn);
  const uploadUrl = useServerFn(recordingUploadUrlFn);
  const partDone = useServerFn(recordingPartDoneFn);
  const finish = useServerFn(recordingFinishFn);
  const sendRefs = useServerFn(recordingSpeakerRefsFn);
  const meter = useMemo(() => createMeter(), []);
  const cap = useRef<MeetingCapture | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState<MeetingSource>("room");
  const [consent, setConsent] = useState(false);
  const [others, setOthers] = useState("");
  const [retain, setRetain] = useState<30 | 90 | 365 | 0>(90);
  const [uploading, setUploading] = useState(0);
  const [failed, setFailed] = useState(0);
  const [tickMs, setTickMs] = useState(0);
  const [leftover, setLeftover] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const firstPart = useRef<{ seq: number; blob: Blob } | null>(null);
  const refsSent = useRef(!!rec?.speaker_refs?.length);
  const tabOk = tabAudioSupported();

  // parts an interrupted recording left on this device
  useEffect(() => {
    void partsFor(s.id).then((p) => setLeftover(p.length));
  }, [s.id]);
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const t = window.setInterval(() => setTickMs(cap.current?.elapsed() ?? 0), 500);
    return () => window.clearInterval(t);
  }, [phase]);
  // leaving mid-recording finishes it (the parts so far are kept)
  useEffect(() => () => void cap.current?.stop().catch(() => {}), []);

  const upload = (
    p: PartReady | { seq: number; blob: Blob; mime: string; offsetMs: number; durationMs: number },
  ) => {
    setUploading((n) => n + 1);
    queue.current = queue.current.then(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const u = await uploadUrl({ data: { sessionId: s.id, seq: p.seq, mime: p.mime } });
          const { error } = await supabase.storage
            .from(u.bucket)
            .uploadToSignedUrl(u.path, u.token, p.blob, { contentType: p.mime.split(";")[0] });
          if (error) throw error;
          await partDone({
            data: {
              sessionId: s.id,
              seq: p.seq,
              path: u.path,
              mime: p.mime,
              bytes: p.blob.size,
              offsetMs: p.offsetMs,
              durationMs: p.durationMs,
            },
          });
          await dropPart(s.id, p.seq);
          setUploading((n) => n - 1);
          onChange();
          return;
        } catch (e) {
          if (attempt === 3) {
            setUploading((n) => n - 1);
            setFailed((n) => n + 1);
            console.warn("[recorder] upload failed", e);
            return;
          }
          await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        }
      }
    });
  };

  const onPart = (p: PartReady) => {
    void savePart({
      sessionId: s.id,
      seq: p.seq,
      mime: p.mime,
      offsetMs: p.offsetMs,
      durationMs: p.durationMs,
      blob: p.blob,
      partial: false,
    });
    if (!firstPart.current) firstPart.current = { seq: p.seq, blob: p.blob };
    upload(p);
  };

  // once the first part has its speakers, short voice samples keep later parts' labels consistent
  useEffect(() => {
    const fp = firstPart.current;
    if (refsSent.current || !fp || (phase !== "recording" && phase !== "paused")) return;
    const part = ((data.audio ?? []) as any[]).find((a) => a.seq === fp.seq && a.status === "done");
    const segs = (part?.transcript?.segments ?? []) as Array<{
      start: number;
      end: number;
      speaker: string | null;
    }>;
    const best = new Map<string, { start: number; end: number }>();
    for (const g of segs) {
      if (!g.speaker) continue;
      const cur = best.get(g.speaker);
      if (!cur || g.end - g.start > cur.end - cur.start) best.set(g.speaker, g);
    }
    const labels = [...best.entries()].filter(([, g]) => g.end - g.start >= 2.5).slice(0, 4);
    if (!labels.length) return;
    refsSent.current = true;
    void (async () => {
      const refs: Array<{ name: string; path: string }> = [];
      for (const [label, g] of labels) {
        const wav = await voiceSample(fp.blob, g.start + 0.2, g.end - 0.2);
        if (!wav) continue;
        try {
          const u = await uploadUrl({
            data: { sessionId: s.id, seq: null, mime: "audio/wav", ref: label },
          });
          const { error } = await supabase.storage
            .from(u.bucket)
            .uploadToSignedUrl(u.path, u.token, wav, { contentType: "audio/wav" });
          if (!error) refs.push({ name: label, path: u.path });
        } catch {
          /* without samples each part keeps its own labels */
        }
      }
      if (refs.length) await sendRefs({ data: { sessionId: s.id, refs } }).catch(() => null);
    })();
  }, [data.audio, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setPhase("starting");
    try {
      const participants = [
        { role: "coach" as const, name: "Coach" },
        { role: "client" as const, name: data.firstName ?? null },
        ...others
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .map((name) => ({ role: "other" as const, name })),
      ];
      const r = await start({
        data: { sessionId: s.id, mode: source, participants, consent, retainDays: retain },
      });
      cap.current = await startMeetingCapture({
        source,
        meter,
        firstSeq: r.parts ?? 0,
        onPart,
        onChunk: (seq, chunks, mime, offsetMs) =>
          void savePart({
            sessionId: s.id,
            seq,
            mime,
            offsetMs,
            durationMs: null,
            blob: new Blob(chunks, { type: mime }),
            partial: true,
          }),
        onInterrupted: (why) => {
          toast.error(`${why} The recording stopped; what was recorded is kept.`);
          void stop();
        },
      });
      setPhase("recording");
      onChange();
    } catch (e: any) {
      setPhase("consent");
      toast.error(e?.name === "NoTabAudio" ? e.message : micErrorMessage(e));
    }
  };

  const stop = async () => {
    const c = cap.current;
    if (!c) return;
    cap.current = null;
    setPhase("stopping");
    const out = await c.stop();
    await queue.current;
    await finish({ data: { sessionId: s.id, parts: out.parts, durationMs: out.durationMs } }).catch(
      (e: any) => toast.error(e?.message ?? "Couldn't finish the recording"),
    );
    setPhase("idle");
    onChange();
    toast.success("Recording saved. Cleo is transcribing it.");
  };

  const sendLeftover = async () => {
    const parts = await partsFor(s.id);
    for (const p of parts)
      upload({
        seq: p.seq,
        blob: p.blob,
        mime: p.mime,
        offsetMs: p.offsetMs,
        durationMs: p.durationMs ?? 0,
      });
    await queue.current;
    const maxSeq = parts.reduce((m, p) => Math.max(m, p.seq + 1), Number(rec?.parts_uploaded ?? 0));
    await finish({ data: { sessionId: s.id, parts: maxSeq, durationMs: 0 } }).catch(() => null);
    setLeftover((await partsFor(s.id)).length);
    onChange();
  };

  const parts = (data.audio ?? []) as any[];
  const transcribing = parts.filter(
    (p) => p.status === "uploaded" || p.status === "transcribing",
  ).length;
  const waitingConsent = parts.find((p) => p.status === "waiting_consent");

  if (phase === "recording" || phase === "paused" || phase === "stopping") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
          phase === "paused" ? "border-border" : "border-destructive/40 bg-destructive/5",
        )}
        data-recorder={phase}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            phase === "paused" ? "bg-muted-foreground" : "animate-pulse bg-destructive",
          )}
          aria-hidden
        />
        <span className="text-[13px] font-medium tabular-nums">
          {phase === "paused" ? "Paused" : phase === "stopping" ? "Saving…" : "Recording"} ·{" "}
          {clock(tickMs / 1000)}
        </span>
        <VoiceWaveform meter={meter} className="hidden h-6 w-24 sm:block" height={24} />
        {uploading ? (
          <span className="text-[12px] text-muted-foreground">
            <UploadCloud className="mr-1 inline h-3.5 w-3.5" />
            Uploading
          </span>
        ) : null}
        {failed ? (
          <span className="text-[12px] text-warning">
            {failed} part{failed === 1 ? "" : "s"} waiting to upload
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          {phase === "recording" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                cap.current?.pause();
                setPhase("paused");
              }}
              aria-label="Pause recording"
            >
              <Pause className="h-3.5 w-3.5" />
            </Button>
          ) : phase === "paused" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                cap.current?.resume();
                setPhase("recording");
              }}
              aria-label="Resume recording"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => void stop()}
            disabled={phase === "stopping"}
            data-recorder-stop
          >
            <Square className="mr-1 h-3.5 w-3.5" /> Stop
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "consent" || phase === "starting") {
    return (
      <div className="space-y-3 rounded-xl border border-border p-3" data-recorder-consent>
        <p className="text-[14px] font-medium">Record this meeting</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setSource("room")}
            className={cn(
              "rounded-lg border px-3 py-2 text-left",
              source === "room" ? "border-foreground bg-secondary" : "border-border",
            )}
          >
            <p className="text-[14px] font-medium">This device's microphone</p>
            <p className="text-[12px] text-muted-foreground">In person, or a call on speaker</p>
          </button>
          <button
            type="button"
            disabled={!tabOk}
            onClick={() => setSource("call_tab")}
            className={cn(
              "rounded-lg border px-3 py-2 text-left disabled:opacity-50",
              source === "call_tab" ? "border-foreground bg-secondary" : "border-border",
            )}
          >
            <p className="text-[14px] font-medium">A video call in another tab</p>
            <p className="text-[12px] text-muted-foreground">
              {tabOk
                ? "Chrome or Edge on a computer: share the call's tab with its audio"
                : "Chrome or Edge on a computer only"}
            </p>
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          A call in the Zoom or Meet app, or on a phone, can't be recorded from a web page. Upload
          its transcript afterwards instead.
        </p>
        <input
          value={others}
          onChange={(e) => setOthers(e.target.value)}
          placeholder="Anyone else in the meeting (names, comma separated)"
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
        />
        <label className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2 text-[13.5px]">
          <Checkbox
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
            className="mt-0.5"
            data-recorder-consent-check
          />
          <span>
            Everyone in the meeting (
            {[
              data.firstName ?? "the client",
              "you",
              ...others
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            ].join(", ")}
            ) agreed to it being recorded and transcribed for coaching.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted-foreground">
            Keep the recording and transcript:
          </span>
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
        <div className="flex gap-2">
          <Button
            onClick={() => void begin()}
            disabled={!consent}
            loading={phase === "starting"}
            data-recorder-start
          >
            <Mic className="mr-1.5 h-4 w-4" /> Start recording
          </Button>
          <Button variant="ghost" onClick={() => setPhase("idle")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-recorder="idle">
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => setPhase("consent")}
        data-recorder-open
      >
        <Mic className="mr-1.5 h-4 w-4" /> {rec?.consent ? "Record again" : "Record"}
      </Button>
      {leftover ? (
        <Button variant="outline" size="sm" className="h-9" onClick={() => void sendLeftover()}>
          <UploadCloud className="mr-1.5 h-4 w-4" /> Send {leftover} unsent part
          {leftover === 1 ? "" : "s"}
        </Button>
      ) : null}
      {transcribing ? (
        <span className="text-[12.5px] text-muted-foreground">
          Transcribing {transcribing} part{transcribing === 1 ? "" : "s"}…
        </span>
      ) : null}
      {waitingConsent ? (
        <span className="text-[12.5px] text-muted-foreground">
          {waitingConsent.error ?? "Waiting for the client's permission for AI processing."}
        </span>
      ) : null}
    </div>
  );
}
