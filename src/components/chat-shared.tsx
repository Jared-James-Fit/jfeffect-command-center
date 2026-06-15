import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ChatSoundCard } from "@/components/chat-sound-card";
import { GifThumb } from "@/components/gif-thumb";
import { fallbackEmoji } from "@/lib/gif-fallback";
import { PaymentRequestCard } from "@/components/payment-request-card";
import {
  FileText, Image as ImageIcon, Video, Link as LinkIcon, ExternalLink,
  Mic, File as FileIcon, Download, ChevronDown, ChevronUp, Play, Pause, Gauge,
} from "lucide-react";
import { ClipboardList, FileSignature, UtensilsCrossed, ChevronRight } from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";

/* ------------------------------- Attachment Types (shared shape) ------------------------------- */

export type SharedAttachment = {
  type: "image" | "video" | "audio" | "pdf" | "file" | "link" | "drive" | "sheets" | "youtube";
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  duration?: number;
  storage_path?: string;
  peaks?: number[];
  kind?: "sound" | "gif" | "payment_request" | "form_request" | "signature_request" | "recipe_share";
  fallback_emoji?: string;
  category?: string;
  // payment_request fields (used when kind === "payment_request")
  purchase_id?: string;
  payment_url?: string;
  amount_cents?: number;
  currency?: string;
  title?: string;
  payment_structure?: string;
  status?: string;
  // chat request kinds:
  form_id?: string;
  template_id?: string;
  recipe_id?: string;
  agreement_ids?: string[];
  assignment_client_ids?: string[];
  agreement_client_map?: { client_id: string; agreement_id: string }[];
  request_title?: string;
  request_note?: string;
};

/* ------------------------------- Helpers ------------------------------- */

export function attachIcon(t: SharedAttachment["type"]) {
  if (t === "image") return ImageIcon;
  if (t === "video") return Video;
  if (t === "audio") return Mic;
  if (t === "pdf") return FileText;
  if (t === "file") return FileIcon;
  return LinkIcon;
}

export function fmtTime(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

export const LINK_RE = /\bhttps?:\/\/[^\s)]+/gi;

/** Matches Google Meet links (meet.google.com/abc-defg-hij or stream.meet.google.com/…). */
export const MEET_RE = /\bhttps?:\/\/(?:[a-z0-9-]+\.)*meet\.google\.com\/[A-Za-z0-9_\-?=&./]+/gi;

/** Strip trailing punctuation that often follows a pasted URL inside prose. */
function trimUrl(u: string) {
  return u.replace(/[)\].,;:!?]+$/, "");
}

/** Standalone Google Meet call card. */
export function MeetCallCard({ url, mine }: { url: string; mine: boolean }) {
  const code = (() => {
    try {
      const p = new URL(url).pathname.replace(/^\/+/, "").split("/")[0];
      return p || "";
    } catch { return ""; }
  })();
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mt-1 flex w-full max-w-[280px] items-center gap-3 rounded-2xl border p-3 transition hover:opacity-95",
        mine
          ? "border-primary-foreground/25 bg-primary-foreground/10"
          : "border-border bg-background/70",
      )}
    >
      <div className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        mine ? "bg-primary-foreground/20" : "bg-primary/10",
      )}>
        <Video className={cn("h-5 w-5", mine ? "text-primary-foreground" : "text-primary")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-tight">Google Meet Call</div>
        <div className={cn(
          "truncate text-[11px]",
          mine ? "text-primary-foreground/75" : "text-muted-foreground",
        )}>
          {code || "Join the video call"}
        </div>
        <div className={cn(
          "mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
          mine ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
        )}>
          <Video className="h-3 w-3" />
          Join Google Meet
        </div>
      </div>
    </a>
  );
}

/**
 * Renders a message body, replacing any Google Meet URL with a clean call card
 * while preserving surrounding text.
 */
export function renderBodyWithMeet(body: string, mine: boolean) {
  if (!body) return null;
  const parts: Array<{ type: "text" | "meet"; value: string }> = [];
  let lastIdx = 0;
  const re = new RegExp(MEET_RE.source, MEET_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIdx) parts.push({ type: "text", value: body.slice(lastIdx, m.index) });
    parts.push({ type: "meet", value: trimUrl(m[0]) });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) parts.push({ type: "text", value: body.slice(lastIdx) });

  if (parts.length === 0 || !parts.some((p) => p.type === "meet")) {
    return <div className="whitespace-pre-wrap break-words">{body}</div>;
  }

  return (
    <div className="space-y-1.5">
      {parts.map((p, i) => {
        if (p.type === "text") {
          const trimmed = p.value.replace(/^\s+|\s+$/g, "");
          if (!trimmed) return null;
          return (
            <div key={i} className="whitespace-pre-wrap break-words">{trimmed}</div>
          );
        }
        return <MeetCallCard key={i} url={p.value} mine={mine} />;
      })}
    </div>
  );
}

export function fmtBytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(s?: number) {
  if (!s || !isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export function fileToAttachmentType(file: File): SharedAttachment["type"] {
  const m = file.type.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  return "file";
}

/** Upload a file to the message-attachments bucket at a caller-provided path. */
export async function uploadAttachmentToPath(path: string, file: File): Promise<SharedAttachment> {
  const { error } = await supabase.storage.from("message-attachments").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return {
    type: fileToAttachmentType(file),
    url: "",
    storage_path: path,
    name: file.name,
    size: file.size,
    mime: file.type,
  };
}

/* ------------------------------- Signed URLs ------------------------------- */

export function useSignedUrl(path?: string) {
  const q = useQuery({
    queryKey: ["msg-attach", path],
    enabled: !!path,
    staleTime: 1000 * 60 * 50,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("message-attachments").createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  return q.data;
}

/* ------------------------------- Waveforms ------------------------------- */

export function fakePeaks(n = 40, seed = 1) {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    out.push(0.25 + (x / 233280) * 0.75);
  }
  return out;
}

export function WaveformBars({
  peaks, progress, onSeek, mine,
}: {
  peaks: number[];
  progress: number;
  onSeek?: (ratio: number) => void;
  mine: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={ref}
      className={cn("flex h-7 cursor-pointer items-center gap-[2px]", onSeek ? "" : "cursor-default")}
      onClick={(e) => {
        if (!onSeek || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        onSeek(Math.max(0, Math.min(1, x)));
      }}
    >
      {peaks.map((p, i) => {
        const played = i / peaks.length <= progress;
        return (
          <span
            key={i}
            className={cn(
              "w-[2.5px] flex-1 rounded-full transition-colors",
              played
                ? mine ? "bg-primary-foreground" : "bg-primary"
                : mine ? "bg-primary-foreground/35" : "bg-foreground/25",
            )}
            style={{ height: `${Math.max(10, p * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

export function LiveWaveform({ levels }: { levels: number[] }) {
  const BAR_COUNT = 48;
  const padded = Array.from(
    { length: BAR_COUNT },
    (_, i) => levels[levels.length - BAR_COUNT + i] ?? 0,
  );
  return (
    <div className="flex h-10 flex-1 items-center justify-center gap-[2px] overflow-hidden">
      {padded.map((v, i) => {
        const h = Math.max(10, Math.min(100, v * 130));
        return (
          <span
            key={i}
            className="w-[3px] flex-1 rounded-full bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.45)] transition-[height,opacity] duration-100"
            style={{ height: `${h}%`, opacity: v > 0.05 ? 1 : 0.35 }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------- Voice Recorder Hook ------------------------------- */

export function useVoiceRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveLevelsRef = useRef<number[]>([]);
  const accumulatedPeaksRef = useRef<number[]>([]);
  const sinceLastPeakRef = useRef<number>(0);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveLevels, setLiveLevels] = useState<number[]>([]);

  const LIVE_BAR_COUNT = 40;

  const teardownAudioGraph = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Recording not supported on this device.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.start();
    mediaRef.current = mr;
    startedAtRef.current = Date.now();
    setRecording(true);
    setElapsed(0);
    liveLevelsRef.current = [];
    accumulatedPeaksRef.current = [];
    sinceLastPeakRef.current = Date.now();
    setLiveLevels([]);

    try {
      const ACtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new ACtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(1, Math.max(0.05, rms * 2.8));
        const next = [...liveLevelsRef.current, level].slice(-LIVE_BAR_COUNT);
        liveLevelsRef.current = next;
        if (Date.now() - sinceLastPeakRef.current > 80) {
          accumulatedPeaksRef.current.push(level);
          sinceLastPeakRef.current = Date.now();
        }
        setLiveLevels(next);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn("analyser unavailable", e);
    }

    tickRef.current = window.setInterval(
      () => setElapsed((Date.now() - startedAtRef.current) / 1000),
      200,
    );
  };

  const stop = async (): Promise<{ blob: Blob; duration: number; peaks: number[] } | null> => {
    const mr = mediaRef.current;
    if (!mr) return null;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const duration = (Date.now() - startedAtRef.current) / 1000;
    const done = new Promise<Blob>((resolve) => {
      mr.onstop = () => resolve(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }));
    });
    mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    setRecording(false);
    const blob = await done;
    const raw = accumulatedPeaksRef.current;
    const targetCount = 48;
    const peaks: number[] = [];
    if (raw.length > 0) {
      const step = raw.length / targetCount;
      for (let i = 0; i < targetCount; i++) {
        const a = Math.floor(i * step);
        const b = Math.min(raw.length, Math.floor((i + 1) * step));
        let max = 0;
        for (let j = a; j < b; j++) if (raw[j] > max) max = raw[j];
        peaks.push(Number(max.toFixed(3)));
      }
    }
    teardownAudioGraph();
    return { blob, duration, peaks };
  };

  const cancel = () => {
    const mr = mediaRef.current;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (mr) {
      try { mr.stop(); } catch {}
      mr.stream.getTracks().forEach((t) => t.stop());
    }
    mediaRef.current = null;
    chunksRef.current = [];
    accumulatedPeaksRef.current = [];
    liveLevelsRef.current = [];
    setLiveLevels([]);
    teardownAudioGraph();
    setRecording(false);
    setElapsed(0);
  };

  return { recording, elapsed, liveLevels, start, stop, cancel };
}

/* ------------------------------- Attachment renderers ------------------------------- */

function ImageAttachment({ att }: { att: SharedAttachment }) {
  const signed = useSignedUrl(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  const [errored, setErrored] = useState(false);
  const looksLikeGif = !!att.url && /tenor\.com|\.gif(\?|$)/i.test(att.url);
  if (!src || errored) {
    return (
      <div className="flex w-[180px] flex-col items-center justify-center gap-1 rounded-xl border border-border bg-secondary/40 p-4">
        <span className="text-5xl">{att.fallback_emoji ?? fallbackEmoji(att.name, att.category)}</span>
        {att.name && <span className="text-[11px] text-muted-foreground">{att.name}</span>}
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block max-w-[280px]">
      <img
        src={src}
        alt={att.name ?? ""}
        className={cn(
          looksLikeGif ? "h-[180px] w-[180px] object-cover" : "max-h-80 w-auto object-cover",
          "rounded-md",
        )}
        loading="lazy"
        onError={() => setErrored(true)}
      />
    </a>
  );
}

function VideoAttachment({ att }: { att: SharedAttachment }) {
  const signed = useSignedUrl(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  if (!src) return null;
  return <video src={src} controls playsInline className="max-h-80 w-full max-w-[280px] rounded-md bg-black" />;
}

function AudioAttachment({
  att, mine, transcript, transcriptStatus,
}: {
  att: SharedAttachment;
  mine: boolean;
  transcript?: string | null;
  transcriptStatus?: string | null;
}) {
  const signed = useSignedUrl(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(att.duration ?? 0);
  const [rate, setRate] = useState(1);
  const [showTx, setShowTx] = useState(false);

  const peaks = useMemo(
    () => (att.peaks && att.peaks.length ? att.peaks : fakePeaks(48, (att.duration ?? 1) * 13 + (att.size ?? 1))),
    [att.peaks, att.duration, att.size],
  );

  if (!src) return <div className="text-xs opacity-70">Loading voice message…</div>;

  const ratio = duration > 0 ? progress / duration : 0;
  const hasTranscript = transcriptStatus !== undefined && transcriptStatus !== null;

  return (
    <div className={cn(
      "w-full max-w-[260px] rounded-2xl p-2",
      mine ? "bg-primary-foreground/10" : "bg-background/60",
    )}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mine ? "secondary" : "default"}
          className="h-9 w-9 shrink-0 rounded-full p-0"
          onClick={() => {
            const a = ref.current; if (!a) return;
            if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
          }}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </Button>
        <div className="flex-1">
          <WaveformBars
            peaks={peaks}
            progress={ratio}
            mine={mine}
            onSeek={(r) => {
              const a = ref.current; if (!a || !duration) return;
              a.currentTime = r * duration;
              setProgress(r * duration);
            }}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] opacity-80">
            <span>{fmtDuration(progress)} / {fmtDuration(duration)}</span>
            <button
              type="button"
              className="inline-flex items-center gap-0.5 hover:underline"
              onClick={() => {
                const speeds = [1, 1.25, 1.5, 2];
                const next = speeds[(speeds.indexOf(rate) + 1) % speeds.length];
                setRate(next);
                if (ref.current) ref.current.playbackRate = next;
              }}
            >
              <Gauge className="h-2.5 w-2.5" />{rate}x
            </button>
          </div>
        </div>
      </div>

      {hasTranscript && (
        <div className="mt-1.5 border-t border-current/10 pt-1.5">
          <button
            type="button"
            onClick={() => setShowTx((s) => !s)}
            className="flex w-full items-center gap-1 text-[10px] opacity-80 hover:opacity-100"
          >
            <FileText className="h-3 w-3" />
            <span>
              {transcriptStatus === "processing" || transcriptStatus === null || transcriptStatus === undefined
                ? "Transcript processing…"
                : transcriptStatus === "failed"
                ? "Transcript unavailable"
                : transcriptStatus === "empty"
                ? "No speech detected"
                : showTx ? "Hide transcript" : "View transcript"}
            </span>
            {transcriptStatus === "ready" && (showTx ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />)}
          </button>
          {showTx && transcriptStatus === "ready" && transcript && (
            <div className="mt-1 rounded-md bg-background/40 p-1.5 text-[11px] leading-snug whitespace-pre-wrap">
              {transcript}
            </div>
          )}
        </div>
      )}

      <audio
        ref={ref} src={src} preload="metadata"
        onLoadedMetadata={(e) => { const d = (e.currentTarget.duration); if (isFinite(d)) setDuration(d); }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
    </div>
  );
}

function FileAttachment({ att, mine }: { att: SharedAttachment; mine: boolean }) {
  const signed = useSignedUrl(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  const Icon = attachIcon(att.type);
  return (
    <a href={src} target="_blank" rel="noreferrer" download={att.name}
      className={cn(
        "flex max-w-[280px] items-center gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-foreground/5",
        mine ? "border-primary-foreground/30" : "border-border bg-background/60",
      )}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{att.name ?? att.url}</div>
        <div className="text-[10px] opacity-70">{att.type.toUpperCase()}{att.size ? ` · ${fmtBytes(att.size)}` : ""}</div>
      </div>
      <Download className="h-3 w-3 shrink-0 opacity-70" />
    </a>
  );
}

function LinkAttachment({ att, mine }: { att: SharedAttachment; mine: boolean }) {
  const Icon = attachIcon(att.type);
  return (
    <a href={att.url} target="_blank" rel="noreferrer"
      className={cn(
        "flex max-w-[280px] items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-foreground/5",
        mine ? "border-primary-foreground/30" : "border-border bg-background/60",
      )}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{att.name ?? att.url}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
    </a>
  );
}

export function AttachmentView({
  att, mine, transcript, transcriptStatus,
}: {
  att: SharedAttachment;
  mine: boolean;
  transcript?: string | null;
  transcriptStatus?: string | null;
}) {
  if (att.kind === "payment_request") {
    return <PaymentRequestCard att={att} mine={mine} />;
  }
  if (att.kind === "form_request") {
    return <FormRequestCard att={att} mine={mine} />;
  }
  if (att.kind === "signature_request") {
    return <SignatureRequestCard att={att} mine={mine} />;
  }
  if (att.kind === "recipe_share") {
    return <RecipeShareCard att={att} mine={mine} />;
  }
  if (att.kind === "sound") {
    return (
      <ChatSoundCard
        url={att.url}
        title={att.name ?? "Sound Effect"}
        durationMs={att.duration ? Math.round(att.duration * 1000) : null}
        mine={mine}
      />
    );
  }
  if (att.kind === "gif") {
    return (
      <a href={att.url} target="_blank" rel="noreferrer"
        className="block w-[220px] max-w-full overflow-hidden rounded-xl border border-border bg-secondary/40">
        <GifThumb
          src={att.url}
          title={att.name}
          category={att.category}
          fallback={att.fallback_emoji}
          className="aspect-square w-full"
          emojiClassName="text-7xl"
        />
        {att.name && (
          <div className="truncate px-2 py-1 text-[11px] text-muted-foreground">{att.name}</div>
        )}
      </a>
    );
  }
  if (att.type === "image") return <ImageAttachment att={att} />;
  if (att.type === "video") return <VideoAttachment att={att} />;
  if (att.type === "audio") return <AudioAttachment att={att} mine={mine} transcript={transcript} transcriptStatus={transcriptStatus} />;
  if (att.type === "pdf" || att.type === "file") return <FileAttachment att={att} mine={mine} />;
  return <LinkAttachment att={att} mine={mine} />;
}

/* ============================ Chat Request Cards ============================ */

function statusTone(label: string) {
  const l = label.toLowerCase();
  if (l.includes("submit") || l.includes("sign") || l.includes("verifi") || l.includes("complete")) {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  }
  if (l.includes("open") || l.includes("progress")) {
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  }
  if (l.includes("error") || l.includes("declin") || l.includes("expired") || l.includes("cancel")) {
    return "bg-destructive/15 text-destructive border-destructive/30";
  }
  return "bg-secondary/40 text-muted-foreground border-border";
}

function useClientNames(ids: string[]) {
  return useQuery({
    queryKey: ["chat-req-client-names", ids.slice().sort().join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("id, full_name").in("id", ids);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as any[]) map.set(r.id as string, (r.full_name as string) ?? "Client");
      return map;
    },
    staleTime: 60_000,
  });
}

function RequestShell({
  icon: Icon, title, subtitle, chip, mine, children, onOpen,
}: {
  icon: any; title: string; subtitle?: string;
  chip?: { label: string; tone?: string };
  mine: boolean; children?: ReactNode; onOpen?: () => void;
}) {
  return (
    <div
      className={cn(
        "w-[260px] max-w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        mine ? "border-primary/30" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2.5 p-3 text-left hover:bg-accent/40 transition-colors"
      >
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
          {chip && (
            <div className={cn("mt-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", chip.tone ?? statusTone(chip.label))}>
              {chip.label}
            </div>
          )}
        </div>
        {onOpen && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {children}
    </div>
  );
}

function PerClientRows({
  clientIds, rowFor,
}: {
  clientIds: string[];
  rowFor: (clientId: string, name: string) => { label: string; tone?: string };
}) {
  const { data: names } = useClientNames(clientIds);
  const [open, setOpen] = useState(false);
  if (clientIds.length <= 1) return null;
  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent/40"
      >
        <span>{clientIds.length} recipients</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <ul className="max-h-40 overflow-y-auto px-3 pb-2 pt-0.5 text-[11px]">
          {clientIds.map((cid) => {
            const name = names?.get(cid) ?? "Client";
            const r = rowFor(cid, name);
            return (
              <li key={cid} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate">{name}</span>
                <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", r.tone ?? statusTone(r.label))}>{r.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------- Form request -------- */

function FormRequestCard({ att, mine }: { att: SharedAttachment; mine: boolean }) {
  const formId = att.form_id;
  const clientIds = att.assignment_client_ids ?? [];
  // Admin/coach jump straight to the form management page; clients open the
  // portal URL we stored on the attachment (which carries identity params
  // for external Fillout forms via the portal page's buildFilloutUrl()).
  const { role } = useAuth();
  const isStaff = role === "admin" || role === "coach" || role === "media_manager";
  const { data: form } = useQuery({
    queryKey: ["chat-req-form", formId],
    enabled: !!formId,
    queryFn: async () => {
      const { data } = await supabase.from("nf_forms").select("id, title").eq("id", formId!).maybeSingle();
      return data as { id: string; title: string } | null;
    },
    staleTime: 60_000,
  });
  const { data: subs } = useQuery({
    queryKey: ["chat-req-form-status", formId, clientIds.slice().sort().join(",")],
    enabled: !!formId && clientIds.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("nf_submissions")
        .select("client_id, status, submitted_at, started_at, updated_at")
        .eq("form_id", formId!)
        .in("client_id", clientIds);
      const map = new Map<string, any>();
      for (const r of (data ?? []) as any[]) {
        const prev = map.get(r.client_id);
        if (!prev || new Date(r.updated_at) > new Date(prev.updated_at)) map.set(r.client_id, r);
      }
      return map;
    },
  });

  function statusFor(cid: string): { label: string } {
    const s = subs?.get(cid);
    if (!s) return { label: "Sent" };
    if (s.status === "submitted" || s.status === "reviewed" || s.status === "pending_review") return { label: "Submitted" };
    if (s.status === "in_progress") return { label: "In progress" };
    return { label: "Sent" };
  }

  const total = clientIds.length;
  const done = clientIds.filter((c) => statusFor(c).label === "Submitted").length;
  const rollup =
    total <= 1
      ? statusFor(clientIds[0] ?? "").label
      : done === total
        ? "All submitted"
        : `${done}/${total} submitted`;

  return (
    <RequestShell
      icon={ClipboardList}
      title={att.request_title ?? form?.title ?? "Form request"}
      subtitle={att.request_note || `Form to fill${form?.title ? `: ${form.title}` : ""}`}
      chip={{ label: rollup }}
      mine={mine}
      onOpen={() => {
        if (isStaff) {
          if (formId) window.open(`/admin/native-forms`, "_blank");
          return;
        }
        if (att.url) window.open(att.url, "_blank");
      }}
    >
      <PerClientRows clientIds={clientIds} rowFor={(cid) => statusFor(cid)} />
    </RequestShell>
  );
}

/* -------- Signature request -------- */

function SignatureRequestCard({ att, mine }: { att: SharedAttachment; mine: boolean }) {
  const map = att.agreement_client_map ?? [];
  const ids = (att.agreement_ids ?? map.map((m) => m.agreement_id)).filter(Boolean);
  const clientIds = map.map((m) => m.client_id);

  const { data: agreements } = useQuery({
    queryKey: ["chat-req-agreements", ids.slice().sort().join(",")],
    enabled: ids.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("agreements")
        .select("id, status, verification_status, signed_at, signnow_signing_link, template_name, client_id")
        .in("id", ids);
      const m = new Map<string, any>();
      for (const r of (data ?? []) as any[]) m.set(r.id as string, r);
      return m;
    },
  });

  function labelFor(a: any): string {
    if (!a) return "Sent";
    if (a.status === "Verified" || a.verification_status === "Manually Verified" || a.verification_status === "Auto-Matched") return "Verified";
    if (a.status === "Signed" || a.status === "Completed" || !!a.signed_at) return "Signed";
    if (a.status === "Opened") return "Opened";
    if (a.status === "Declined" || a.status === "Expired" || a.status === "Cancelled") return a.status;
    return "Sent";
  }

  const allAgreements = ids.map((id) => agreements?.get(id));
  const labels = allAgreements.map(labelFor);
  const done = labels.filter((l) => l === "Signed" || l === "Verified").length;
  const rollup =
    ids.length <= 1
      ? labels[0] ?? "Sent"
      : done === ids.length
        ? "All signed"
        : `${done}/${ids.length} signed`;

  const first = allAgreements[0];
  const single = ids.length === 1;

  return (
    <RequestShell
      icon={FileSignature}
      title={att.request_title ?? first?.template_name ?? "Signature request"}
      subtitle={att.request_note || "Tap to open and sign"}
      chip={{ label: rollup }}
      mine={mine}
      onOpen={() => {
        if (single && first?.signnow_signing_link) window.open(first.signnow_signing_link, "_blank");
        else if (first?.id) window.open(`/admin/agreements`, "_blank");
      }}
    >
      <PerClientRows
        clientIds={clientIds}
        rowFor={(cid) => {
          const a = map.find((m) => m.client_id === cid);
          const ag = a ? agreements?.get(a.agreement_id) : null;
          return { label: labelFor(ag) };
        }}
      />
    </RequestShell>
  );
}

/* -------- Recipe share -------- */

function RecipeShareCard({ att, mine }: { att: SharedAttachment; mine: boolean }) {
  const id = att.recipe_id;
  const { data: recipe } = useQuery({
    queryKey: ["chat-req-recipe", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("recipes").select("id, title, category").eq("id", id!).maybeSingle();
      return data as { id: string; title: string; category: string } | null;
    },
    staleTime: 5 * 60_000,
  });
  return (
    <RequestShell
      icon={UtensilsCrossed}
      title={att.request_title ?? recipe?.title ?? "Recipe"}
      subtitle={recipe?.category ?? "Shared recipe"}
      chip={{ label: "Shared" }}
      mine={mine}
      onOpen={() => id && window.open(`/portal/recipes/${id}`, "_blank")}
    />
  );
}