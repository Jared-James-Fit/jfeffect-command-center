import React, { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  listMessages, sendMessage, markRead, setConversationStatus, setConversationPriority,
  detectAttachmentType, MESSAGE_TYPES, PRIORITIES, QUICK_REPLIES, priorityTone,
  editMessage, deleteMessageForEveryone, adminDeleteMessages, replyMediaFor,
  listReactions, toggleReaction, REACTION_EMOJIS,
  listOlderMessages,
  type Message, type MessageAttachment, type SenderRole, type ConversationState,
  type MessageReaction, type MessageReplyPreview,
} from "@/lib/messages";
import type { SharedAttachment } from "@/components/chat-shared";
import { transcribeVoiceMessage } from "@/lib/voice-transcribe.functions";
import { Button } from "@/components/ui/button";
import { ChatImageAttachment } from "@/components/chat-media-attachment";
import { Textarea } from "@/components/ui/textarea";
import { AutoGrowTextarea, focusComposerAtEnd } from "@/components/ui/auto-grow-textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { PaymentRequestCard } from "@/components/payment-request-card";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { shouldSendOnEnter } from "@/lib/enter-to-send";
import { formatReadReceipt, formatReceiptStamp } from "@/lib/read-receipt";
import { getChatSettings, DEFAULT_REACTION } from "@/lib/chat-settings";
import { markRecent } from "@/lib/chat-gifs";
import { GifThumb } from "@/components/gif-thumb";
import { fallbackEmoji } from "@/lib/gif-fallback";
import { markRecent as markSoundRecent } from "@/lib/chat-sounds";
import { ChatSoundCard } from "@/components/chat-sound-card";
import { ScheduledStrip } from "@/components/messages/scheduled-strip";
import { DeletedMessagesStrip, deletionsQueryKey } from "@/components/messages/deleted-messages-strip";
import { ScheduleButton } from "@/components/messages/schedule-button";
import { renderBodyWithMeet, uploadChatAttachment } from "@/components/chat-shared";
import { ComposerPlusMenu } from "@/components/composer-plus-menu";
import {
  Paperclip, Send, X, FileText, Image as ImageIcon, Video, Link as LinkIcon, ExternalLink,
  Mic, Trash2, Play, Pause, Camera, File as FileIcon, Flag, AlertCircle, AlertTriangle,
  Gauge, Download, ChevronDown, ChevronUp, Square, Loader2, MoreHorizontal, Pencil, Check,
  CheckCircle2, Circle, CheckSquare, Copy, Reply,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { runJob } from "@/lib/progress-jobs";
import { toast } from "sonner";
import { playUiSound } from "@/lib/ui-sounds";
import { haptic } from "@/platform/haptics";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { useDraftUploads, releaseDraft } from "@/hooks/use-draft-uploads";
import { useChatSignedUrls } from "@/hooks/use-chat-signed-urls";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { belongsInInbox, resolveOptimistic, upsertRow } from "@/lib/inbox-cache";
import { useResyncOnResume, onRealtimeRejoin } from "@/hooks/use-resync-on-resume";
import { DraftUploadChips, DraftUploadStatus } from "@/components/messages/draft-upload-chips";
import { ChatVideoTile } from "@/components/chat-video-tile";
import { ReplyThumb } from "@/components/messages/reply-thumb";
import {
  FormHistoryGroup,
  FormHistoryRow,
  MessengerCheckinRequestCard,
  FormRequestChatCard,
  MessengerCheckinSubmissionCard,
} from "@/components/messages/messenger-checkin-card";
import { groupFormHistory, planFormMessages } from "@/lib/form-message-presentation";
import { playAppSound, registerOpenThread } from "@/lib/app-sounds";
import { ensureDueMessengerCheckins } from "@/lib/messenger-checkins.functions";

function attachIcon(t: MessageAttachment["type"]) {
  if (t === "image") return ImageIcon;
  if (t === "video") return Video;
  if (t === "audio") return Mic;
  if (t === "pdf") return FileText;
  if (t === "file") return FileIcon;
  return LinkIcon;
}

function fmtTime(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

function makeReplyPreview(message: Message): MessageReplyPreview {
  const first = message.attachments?.[0];
  const isMedia = first?.type === "image" || first?.type === "video";
  return {
    sender_role: message.sender_role,
    body: (message.body || "").trim().slice(0, 260),
    attachment_type: first?.type ?? null,
    attachment_name: first?.name ?? null,
    // Lets the quote show a thumbnail without loading the original message.
    attachment_path: isMedia ? first?.storage_path ?? null : null,
    attachment_url: isMedia && !first?.storage_path ? first?.url || null : null,
    is_internal_note: !!message.is_internal_note,
  };
}

function replyPreviewText(preview?: MessageReplyPreview | null) {
  if (!preview) return "Original message";
  if (preview.body) return preview.body;
  // "IMG_5678.mov" means nothing in a quote; say what it is, like iMessage.
  if (preview.attachment_type === "video") return "Video";
  if (preview.attachment_type === "image") return "Photo";
  if (preview.attachment_name) return preview.attachment_name;
  if (preview.attachment_type) return `${preview.attachment_type.charAt(0).toUpperCase()}${preview.attachment_type.slice(1)} attachment`;
  return "Attachment";
}

const LINK_RE = /\bhttps?:\/\/[^\s)]+/gi;

function fmtBytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(s?: number) {
  if (!s || !isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function uploadAttachment(
  clientId: string,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<MessageAttachment> {
  return uploadChatAttachment(clientId, file, onProgress, signal) as Promise<MessageAttachment>;
}

/* ------------------------------- Signed URLs ------------------------------- */

// Signed URLs come from the shared cache (src/hooks/use-chat-signed-urls.ts):
// signed once per path, one batched call for whatever is missing, and the same
// URL string for the life of the path, so media never reloads when other
// messages arrive.
const EMPTY_URL_RECORD: Record<string, string> = {};

const SignedUrlContext = createContext<{ urls: Record<string, string>; pending: boolean }>({
  urls: EMPTY_URL_RECORD,
  pending: false,
});

function useSignedUrlFor(path?: string): string | undefined {
  return useContext(SignedUrlContext).urls[path ?? ""];
}

/* ------------------------------- Attachment Renderers ------------------------------- */

function ImageAttachment({ att, messageId }: { att: MessageAttachment; messageId?: string }) {
  const signed = useSignedUrlFor(att.storage_path);
  const { pending } = useContext(SignedUrlContext);
  // While the shared batch is in flight, don't let every image sign itself too.
  return <ChatImageAttachment att={att} messageId={messageId} initialSignedUrl={signed} deferSign={!signed && pending} />;
}

function VideoAttachment({ att }: { att: MessageAttachment }) {
  const signed = useSignedUrlFor(att.storage_path);
  const poster = useSignedUrlFor(att.thumbnail_storage_path);
  const src = att.storage_path ? signed : att.url;
  // One tap plays it full screen. The tile shows (and reserves room for) the poster
  // immediately, even while the video's own link is still being signed.
  return (
    <ChatVideoTile
      src={src}
      poster={poster}
      expectPoster={!!att.thumbnail_storage_path}
      width={att.width}
      height={att.height}
      duration={att.duration}
      cacheKey={att.storage_path}
      name={att.name}
    />
  );
}

function fakePeaks(n = 40, seed = 1) {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    out.push(0.25 + (x / 233280) * 0.75);
  }
  return out;
}

function WaveformBars({
  peaks,
  progress,
  onSeek,
  mine,
}: {
  peaks: number[];
  progress: number; // 0..1
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

function AudioAttachment({
  att, mine, message,
}: {
  att: MessageAttachment;
  mine: boolean;
  message?: Message;
}) {
  const signed = useSignedUrlFor(att.storage_path);
  const initialSrc = att.storage_path ? signed : att.url;
  const [freshSrc, setFreshSrc] = useState<string | null>(null);
  const src = freshSrc || initialSrc;
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(att.duration ?? 0);
  const [rate, setRate] = useState(1);
  const [showTx, setShowTx] = useState(false);
  const [playError, setPlayError] = useState(false);

  const playOutLoud = async () => {
    const a = ref.current;
    if (!a) return;
    setPlayError(false);
    try {
      // Voice playback on iOS/PWA must begin inside the original tap. Waiting
      // for a network request first can consume the user activation and leave
      // the player advancing with no useful audible output.
      const audioSession = (navigator as any).audioSession;
      if (audioSession && "type" in audioSession) audioSession.type = "playback";
    } catch {}
    a.muted = false;
    a.volume = 1;
    a.playbackRate = rate;

    // First use the already-resolved signed URL immediately, preserving the
    // user's gesture so iOS routes this as normal media playback.
    try {
      await a.play();
      return;
    } catch {}

    // If that URL is stale, refresh it and retry. This path is intentionally
    // fallback-only; most taps never cross an async network boundary.
    try {
      if (att.storage_path) {
        const { data, error } = await supabase.storage
          .from("message-attachments")
          .createSignedUrl(att.storage_path, 3600);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error("No audio URL returned");
        setFreshSrc(data.signedUrl);
        a.pause();
        a.src = data.signedUrl;
        a.load();
      } else if (src) {
        a.pause();
        a.src = src;
        a.load();
      }
      a.muted = false;
      a.volume = 1;
      a.playbackRate = rate;
      await a.play();
    } catch {
      setPlaying(false);
      setPlayError(true);
      toast.error("Voice message couldn't play. Tap Retry audio.");
    }
  };

  const peaks = useMemo(
    () => (att.peaks && att.peaks.length ? att.peaks : fakePeaks(48, (att.duration ?? 1) * 13 + (att.size ?? 1))),
    [att.peaks, att.duration, att.size],
  );

  if (!src) return <div className="text-xs opacity-70">Loading voice message…</div>;

  const safeProgress = duration > 0 ? Math.min(progress, duration) : progress;
  const ratio = duration > 0 ? safeProgress / duration : 0;
  const txStatus = message?.transcript_status;
  const txText = message?.transcript;

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
            if (a.paused) {
              void playOutLoud();
            } else {
              a.pause();
              setPlaying(false);
            }
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
            <span>{fmtDuration(safeProgress)} / {fmtDuration(duration)}</span>
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

      {message && (
        <div className="mt-1.5 border-t border-current/10 pt-1.5">
          <button
            type="button"
            onClick={() => setShowTx((s) => !s)}
            className="flex w-full items-center gap-1 text-[10px] opacity-80 hover:opacity-100"
          >
            <FileText className="h-3 w-3" />
            <span>
              {txStatus === "processing" || txStatus === null || txStatus === undefined
                ? "Transcript processing…"
                : txStatus === "failed"
                ? "Transcript unavailable"
                : txStatus === "empty"
                ? "No speech detected"
                : showTx ? "Hide transcript" : "View transcript"}
            </span>
            {txStatus === "ready" && (showTx ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />)}
          </button>
          {showTx && txStatus === "ready" && txText && (
            <div className="mt-1 rounded-md bg-background/40 p-1.5 text-[11px] leading-snug whitespace-pre-wrap">
              {txText}
            </div>
          )}
        </div>
      )}

      {playError && (
        <button type="button" onClick={() => void playOutLoud()} className="mt-1.5 text-[10px] font-semibold underline underline-offset-2">
          Retry audio
        </button>
      )}
      <audio
        ref={ref} src={src} preload="metadata" playsInline
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0) setDuration(d); }}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0) setDuration(d); }}
        onCanPlay={() => setPlayError(false)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onPause={() => setPlaying(false)}
        onPlay={() => { setPlaying(true); setPlayError(false); }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onError={() => { setPlaying(false); setPlayError(true); }}
      />
    </div>
  );
}

function FileAttachment({ att, mine }: { att: MessageAttachment; mine: boolean }) {
  const signed = useSignedUrlFor(att.storage_path);
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

function LinkAttachment({ att, mine }: { att: MessageAttachment; mine: boolean }) {
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

function AttachmentView({
  att,
  mine,
  message,
  role,
  clientId,
  onUseReply,
}: {
  att: MessageAttachment;
  mine: boolean;
  message?: Message;
  role: SenderRole;
  clientId: string;
  onUseReply?: (text: string) => void;
}) {
  if (att.kind === "checkin_request" && att.checkin_submission_id && att.checkin_task_type) {
    return (
      <MessengerCheckinRequestCard
        submissionId={att.checkin_submission_id}
        taskType={att.checkin_task_type}
        role={role}
        clientId={clientId}
      />
    );
  }
  if (att.kind === "checkin_submission" && att.checkin_submission_id && att.checkin_task_type) {
    return (
      <MessengerCheckinSubmissionCard
        submissionId={att.checkin_submission_id}
        taskType={att.checkin_task_type}
        role={role}
        onUseReply={role === "admin" ? onUseReply : undefined}
      />
    );
  }
  if (att.kind === "form_request" && (att as any).form_id) {
    const a = att as any;
    return (
      <FormRequestChatCard
        formId={a.form_id}
        title={a.request_title ?? null}
        note={a.request_note ?? null}
        clientId={clientId}
        role={role === "client" ? "client" : "admin"}
        sentAt={(message as any)?.sent_at ?? (message as any)?.created_at ?? null}
      />
    );
  }
  if (att.kind === "payment_request") {
    return <PaymentRequestCard att={att as unknown as SharedAttachment} mine={mine} />;
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
  if (att.type === "image") return <ImageAttachment att={att} messageId={message?.id} />;
  if (att.type === "video") return <VideoAttachment att={att} />;
  if (att.type === "audio") return <AudioAttachment att={att} mine={mine} message={message} />;
  if (att.type === "pdf" || att.type === "file") return <FileAttachment att={att} mine={mine} />;
  return <LinkAttachment att={att} mine={mine} />;
}

/* ------------------------------- Voice Recorder ------------------------------- */

function useVoiceRecorder() {
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
    const isiOSWebKit = /iP(?:hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mimeCandidates = isiOSWebKit
      ? ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
    const mime = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
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

    // Web Audio analyser for live levels
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
        // RMS
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(1, Math.max(0.05, rms * 2.8));
        const next = [...liveLevelsRef.current, level].slice(-LIVE_BAR_COUNT);
        liveLevelsRef.current = next;
        // Accumulate peaks for saved waveform every ~80ms
        if (Date.now() - sinceLastPeakRef.current > 80) {
          accumulatedPeaksRef.current.push(level);
          sinceLastPeakRef.current = Date.now();
        }
        setLiveLevels(next);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      // analyser optional; recording still works
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
    // downsample accumulated peaks to ~48 bars
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
    // Restore normal media playback routing after microphone capture on iOS.
    try {
      const audioSession = (navigator as any).audioSession;
      if (audioSession && "type" in audioSession) audioSession.type = "playback";
    } catch {}
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
    try {
      const audioSession = (navigator as any).audioSession;
      if (audioSession && "type" in audioSession) audioSession.type = "playback";
    } catch {}
    setRecording(false);
    setElapsed(0);
  };

  return { recording, elapsed, liveLevels, start, stop, cancel };
}

function LiveWaveform({ levels }: { levels: number[] }) {
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

/**
 * Query options for a 1:1 thread's latest page. Shared with the inbox so a
 * row can prefetch on press and the thread opens with history already there.
 */
export function threadMessagesQuery(clientId: string, role: SenderRole) {
  return {
    queryKey: ["messages", clientId, role] as const,
    enabled: !!clientId,
    staleTime: 0,              // Always fetch fresh on mount for latest messages
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    queryFn: () => listMessages(clientId, { includeInternal: role === "admin", limit: 25 }),
  };
}

export function MessageThread({
  clientId,
  role,
  conversationState,
  hideControls = false,
  fullBleed = false,
  peerName,
  peerAvatarPath,
}: {
  clientId: string;
  role: SenderRole;
  conversationState?: ConversationState | null;
  hideControls?: boolean;
  /** When true, render as full-height chat (no card border) and let the
   *  parent control overall height. Composer sits flush at the bottom. */
  fullBleed?: boolean;
  /** Other participant (for avatar next to incoming bubbles). */
  peerName?: string | null;
  peerAvatarPath?: string | null;
}) {
  const { user, role: appRole } = useAuth();
  // A coach viewing as this client: look, but leave no trace (no read receipts,
  // no "online", no typing, no auto-created check-ins).
  const viewingAsClient = useViewingAsClient();
  const povClient = role === "client" && viewingAsClient;
  // Admins (not coaches) can silently delete any message in the chat.
  const isAdmin = role === "admin" && appRole === "admin";
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; pct: number } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  // Picked photos/videos/files upload in the background; Send never waits on them.
  const uploads = useDraftUploads<MessageAttachment>();
  // Messages already sent from the composer but still waiting on their media.
  const [queuedUploadSends, setQueuedUploadSends] = useState(0);
  const [sending, setSending] = useState(false);
  const [messageType, setMessageType] = useState("General");
  const [internalNote, setInternalNote] = useState(false);
  const [priority, setPriority] = useState<string>("Normal");
  // Peer typing indicator (iMessage-style). Set via Realtime broadcast.
  const [peerTyping, setPeerTyping] = useState(false);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  // Dedupe reaction toggles: touch double-tap + synthesized dblclick can both
  // fire, flipping the reaction off immediately after adding it. This ref
  // ignores repeat toggles on the same message within ~600ms.
  const lastReactionAtRef = useRef<Map<string, number>>(new Map());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();
  const transcribeFn = useServerFn(transcribeVoiceMessage);
  const ensureCheckinsFn = useServerFn(ensureDueMessengerCheckins);
  // Defer PWA updates while there's an in-flight composer draft. No unload prompt
  // — chat threads navigate freely and the draft is short-lived.
  useUnsavedWarning(
    body.trim().length > 0 || !!replyingTo || sending || uploading || uploads.drafts.length > 0 || queuedUploadSends > 0,
    { warnOnUnload: false },
  );
  const [preview, setPreview] = useState<{
    blob: Blob; url: string; duration: number; peaks: number[];
  } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [actionsForId, setActionsForId] = useState<string | null>(null);
  // Mobile/tablet long-press action sheet + iMessage-style selection mode.
  const [sheetForId, setSheetForId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  // Long-press timer — fires after ~450ms hold without movement.
  const longPressRef = useRef<{ id: string; t: any; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  // iMessage-style swipe-left to reveal exact per-message timestamps.
  const [swipeX, setSwipeX] = useState(0);
  const swipeRef = useRef<{ x: number; y: number; decided: boolean; horizontal: boolean } | null>(null);

  // Safety net for the well-known Radix Dialog/Sheet quirk on iOS where
  // `body { pointer-events: none }` (and stale aria-hidden) can stick after
  // a fast open→close. Whenever our action sheet or dropdown closes, we
  // proactively clear those so the chat is never frozen.
  useEffect(() => {
    if (sheetForId || actionsForId) return;
    const t = window.setTimeout(() => {
      try {
        if (document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "";
        }
        if (document.documentElement.getAttribute("data-messenger-scroll-locked") !== "true") {
          document.body.style.removeProperty("overflow");
          document.body.removeAttribute("data-scroll-locked");
        }
      } catch {}
    }, 350);
    return () => window.clearTimeout(t);
  }, [sheetForId, actionsForId]);

  // Recurring check-ins arrive as real chat requests instead of Home-page
  // form cards. Client opens are an idempotent safety trigger for due reminders.
  useEffect(() => {
    if (role !== "client" || !clientId || povClient) return;
    void ensureCheckinsFn({ data: { clientId } })
      .then((res) => {
        if (res?.created) {
          qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
        }
      })
      .catch(() => {});
  }, [role, clientId, ensureCheckinsFn, qc, povClient]);

  const { data: messages = [], isPending: messagesPending } = useQuery(threadMessagesQuery(clientId, role));

  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Reset the older-messages buffer when switching conversations or roles.
  // Composer media also resets: an upload picked for one client must never
  // ride along into the next conversation.
  const resetUploads = uploads.reset;
  useEffect(() => {
    setOlderMessages([]);
    setReplyingTo(null);
    setFlashMessageId(null);
    setAttachments([]);
    resetUploads();
  }, [clientId, role, resetUploads]);

  const allMessages = useMemo(() => {
    const seen = new Set(messages.map((m) => m.id));
    const uniqueOlder = olderMessages.filter((m) => !seen.has(m.id));
    const combined = olderMessages.length === 0 ? messages : [...uniqueOlder, ...messages];

    // A completed messenger check-in creates a client submission bubble. Once
    // that exists, the original coach request should no longer render as a
    // second check-in card (and especially must not keep saying “Waiting for
    // client”). Keep only the completed submission in the visible timeline.
    const submittedIds = new Set<string>();
    for (const message of combined) {
      for (const att of message.attachments ?? []) {
        if (att?.kind === "checkin_submission" && att.checkin_submission_id) {
          submittedIds.add(att.checkin_submission_id);
        }
      }
    }

    if (submittedIds.size === 0) return combined;
    return combined.filter((message) => {
      const atts = message.attachments ?? [];
      const completedRequest = atts.some(
        (att) =>
          att?.kind === "checkin_request" &&
          !!att.checkin_submission_id &&
          submittedIds.has(att.checkin_submission_id),
      );
      return !completedRequest;
    });
  }, [olderMessages, messages]);

  const canLoadOlder = messages.length >= 25;

  const messageById = useMemo(() => new Map(allMessages.map((x) => [x.id, x])), [allMessages]);

  // Replies to photos/videos sent before previews carried a storage path, whose
  // original is older than the loaded window: fetch just those attachments once
  // so the quote still gets a thumbnail.
  const unresolvedReplyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of allMessages) {
      const rp = m.reply_preview;
      if (!m.reply_to_message_id || !rp) continue;
      if (rp.attachment_type !== "image" && rp.attachment_type !== "video") continue;
      if (rp.attachment_path || rp.attachment_url || messageById.has(m.reply_to_message_id)) continue;
      ids.add(m.reply_to_message_id);
    }
    return Array.from(ids).sort();
  }, [allMessages, messageById]);
  const { data: replySources } = useQuery({
    queryKey: ["reply-sources", clientId, unresolvedReplyIds.join("|")],
    enabled: unresolvedReplyIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, attachments")
        .in("id", unresolvedReplyIds);
      if (error) throw error;
      return new Map(((data ?? []) as unknown as Array<Pick<Message, "id" | "attachments">>).map((r) => [r.id, r]));
    },
  });
  const replySourceFor = (id?: string | null) => (id ? messageById.get(id) ?? replySources?.get(id) ?? null : null);

  // Collect every attachment storage_path across visible messages so we can
  // resolve them in one batched createSignedUrls() call instead of N.
  const attachmentPaths = useMemo(() => {
    const out: string[] = [];
    for (const m of allMessages) {
      const atts = m.attachments;
      if (!atts?.length) continue;
      for (const a of atts) {
        if (a?.storage_path) out.push(a.storage_path);
        if (a?.thumbnail_storage_path) out.push(a.thumbnail_storage_path);
      }
    }
    // Replies to media whose original isn't loaded still show a thumbnail.
    for (const m of allMessages) {
      const rp = m.reply_preview?.attachment_path;
      if (rp) out.push(rp);
    }
    for (const r of replySources?.values() ?? []) {
      const first = r.attachments?.[0];
      if (first?.storage_path) out.push(first.storage_path);
    }
    return out;
  }, [allMessages, replySources]);
  const signedUrls = useChatSignedUrls(attachmentPaths);
  const signedUrlMap = signedUrls.urls;

  const loadOlder = async () => {
    if (loadingOlder) return;
    const earliest = allMessages[0];
    if (!earliest) return;
    // Capture current scroll geometry so we can restore the exact viewport
    // once older messages have been prepended (prevents jump-to-top).
    const el = scrollerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const older = await listOlderMessages(clientId, earliest.created_at, 50, {
        includeInternal: role === "admin",
      });
      if (older.length) {
        setOlderMessages((prev) => {
          const seen = new Set([...prev, ...messages].map((m) => m.id));
          const fresh = older.filter((m) => !seen.has(m.id));
          return [...fresh, ...prev];
        });
        // After layout with the newly prepended rows, keep the user anchored
        // to what they were reading by preserving (scrollHeight - scrollTop).
        requestAnimationFrame(() => {
          const node = scrollerRef.current;
          if (!node) return;
          const delta = node.scrollHeight - prevHeight;
          node.scrollTop = prevTop + delta;
        });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load earlier messages");
    } finally {
      setLoadingOlder(false);
    }
  };

  const { data: reactions = [] } = useQuery({
    queryKey: ["message-reactions", clientId],
    enabled: !!clientId,
    queryFn: () => listReactions(clientId),
  });

  const { data: chatSettings } = useQuery({
    queryKey: ["chat-settings"],
    queryFn: getChatSettings,
    staleTime: 60_000,
  });
  const defaultReaction = chatSettings?.defaultReaction || DEFAULT_REACTION;
  const canSendGifs =
    role === "admin"
      ? true
      : role === "client"
      ? !!chatSettings?.clientsCanSendGifs
      : true;
  const canSendSounds =
    role === "admin"
      ? true
      : role === "client"
      ? !!chatSettings?.clientsCanSendSounds
      : true;

  // Group reactions by message id for fast lookup.
  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const list = map.get(r.message_id) ?? [];
      list.push(r);
      map.set(r.message_id, list);
    }
    return map;
  }, [reactions]);

  const myReactions = useMemo(
    () => reactions.filter((r) => r.user_id === user?.id),
    [reactions, user?.id],
  );

  // Optimistic, non-blocking reaction toggle. Enforces one reaction per user
  // per message: same emoji removes; different emoji replaces; none adds.
  const onToggleReaction = (messageId: string, emoji: string) => {
    if (!user) return;
    // Ignore rapid duplicate toggles (touchend double-tap + synthesized
    // dblclick, accidental repeat taps). The UI still feels instant because
    // the first tap already applied the optimistic update.
    const nowTs = Date.now();
    const lastTs = lastReactionAtRef.current.get(messageId) ?? 0;
    if (nowTs - lastTs < 600) return;
    lastReactionAtRef.current.set(messageId, nowTs);
    const key = ["message-reactions", clientId] as const;
    const prev = qc.getQueryData<MessageReaction[]>(key) ?? reactions;

    const mineOnMsg = prev.filter((r) => r.user_id === user.id && r.message_id === messageId);
    const samePicked = mineOnMsg.find((r) => r.emoji === emoji);

    let next: MessageReaction[];
    if (samePicked) {
      next = prev.filter((r) => r.id !== samePicked.id);
    } else {
      const mineIds = new Set(mineOnMsg.map((r) => r.id));
      next = prev.filter((r) => !mineIds.has(r.id));
      next.push({
        // temp id — gets replaced on next refetch
        id: `optimistic-${messageId}-${user.id}-${Date.now()}`,
        message_id: messageId,
        user_id: user.id,
        emoji,
        created_at: new Date().toISOString(),
      });
    }
    qc.setQueryData(key, next);

    // Fire to server in background; revert on failure. Never blocks the UI.
    void (async () => {
      try {
        await toggleReaction(messageId, user.id, emoji, mineOnMsg);
        // Quietly sync with server truth (real ids, etc.).
        qc.invalidateQueries({ queryKey: key });
      } catch (e: any) {
        qc.setQueryData(key, prev);
        toast.error(e?.message ?? "Reaction failed. Try again.");
      }
    })();
  };

  // Realtime
  const messageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messageIdsRef.current = new Set(allMessages.map((m) => m.id));
  }, [allMessages]);

  // This thread plays its own message sounds; keep the global listener quiet.
  useEffect(() => (clientId ? registerOpenThread(clientId) : undefined), [clientId]);

  // Pull anything that arrived while the app was backgrounded / offline.
  const resyncThread = useCallback(() => {
    if (!clientId) return;
    qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
    qc.invalidateQueries({ queryKey: ["message-reactions", clientId] });
  }, [clientId, role, qc]);
  useResyncOnResume(resyncThread, !!clientId);

  useEffect(() => {
    if (!clientId) return;
    const key = ["messages", clientId, role] as const;
    const ch = supabase
      .channel(`messages-${clientId}-${role}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` }, (payload: any) => {
        // Append the new message directly to the cache — no full refetch needed.
        // This is the primary performance fix: instead of invalidating the entire
        // query (which triggers a 25-message DB fetch), we splice the new row in.
        const newMsg = payload.new as Message;
        if (!newMsg?.id) return;
        qc.setQueryData(key, (prev: Message[] | undefined) => {
          const existing = prev ?? [];
          // Deduplicate: skip if already in cache (e.g. our own optimistic send)
          if (existing.some((m) => m.id === newMsg.id)) return existing;
          // If this is our own message that we optimistically appended (temp id),
          // swap the temp row for the real one instead of appending a duplicate.
          const tempIdx = existing.findIndex((m) =>
            m.id.startsWith("optimistic-") &&
            // Still uploading: can't be this row yet (two media-only sends share an empty body).
            !(m as any).local_upload_ids &&
            m.sender_id === newMsg.sender_id &&
            m.sender_role === newMsg.sender_role &&
            m.body === newMsg.body,
          );
          if (tempIdx >= 0) {
            const copy = existing.slice();
            copy[tempIdx] = newMsg;
            return copy;
          }
          return [...existing, newMsg];
        });
        if (newMsg.sender_role !== role && !(newMsg as any).is_internal_note) playAppSound("message");
        // Still update conversation state and notification counts. If this is
        // a submitted messenger check-in, also refresh its shared check-in
        // query immediately so an already-open request card never stays in a
        // stale "Waiting for client" state.
        qc.invalidateQueries({ queryKey: ["conversation-states"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        for (const att of newMsg.attachments ?? []) {
          if (att?.kind === "checkin_submission" && att.checkin_submission_id) {
            qc.invalidateQueries({ queryKey: ["messenger-checkin", att.checkin_submission_id] });
          }
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` }, (payload: any) => {
        // For edits/deletes, patch the specific message in cache
        const updated = payload.new as Message;
        if (!updated?.id) return;
        qc.setQueryData(key, (prev: Message[] | undefined) =>
          (prev ?? []).map((m) => m.id === updated.id ? updated : m)
        );
      })
      // DELETE events can't be filtered server-side (only the id is sent),
      // so listen to all and drop the row if it's in this thread.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload: any) => {
        const deletedId = payload.old?.id;
        if (!deletedId) return;
        qc.setQueryData(key, (prev: Message[] | undefined) =>
          prev && prev.some((m) => m.id === deletedId) ? prev.filter((m) => m.id !== deletedId) : prev
        );
        setOlderMessages((prev) => (prev.some((m) => m.id === deletedId) ? prev.filter((m) => m.id !== deletedId) : prev));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload: any) => {
        const msgId = payload.new?.message_id ?? payload.old?.message_id;
        if (msgId && messageIdsRef.current.has(msgId)) {
          qc.invalidateQueries({ queryKey: ["message-reactions", clientId] });
        }
      })
      .subscribe(onRealtimeRejoin(resyncThread));
    return () => { supabase.removeChannel(ch); };
  }, [clientId, role, qc, resyncThread]);

  // ---------- Realtime typing indicator (iMessage-style) ----------
  // Uses Supabase Realtime broadcast (ephemeral, no DB writes). Peer typing
  // auto-clears after 3s of silence, or immediately on send.
  useEffect(() => {
    if (!clientId || !user?.id) return;
    const ch = supabase.channel(`typing-${clientId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, (payload: any) => {
      const from = payload?.payload?.senderId as string | undefined;
      const fromRole = payload?.payload?.role as SenderRole | undefined;
      const stopped = !!payload?.payload?.stopped;
      if (!from || from === user.id) return;
      if (fromRole === role) return; // ignore same-role echoes
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      if (stopped) { setPeerTyping(false); return; }
      setPeerTyping(true);
      peerTypingTimerRef.current = setTimeout(() => setPeerTyping(false), 3200);
    }).subscribe();
    typingChannelRef.current = ch;
    return () => {
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      supabase.removeChannel(ch);
      typingChannelRef.current = null;
    };
  }, [clientId, user?.id, role]);

  const broadcastTyping = (stopped = false) => {
    if (povClient) return;
    const ch = typingChannelRef.current;
    if (!ch || !user?.id) return;
    const now = Date.now();
    // Throttle to at most one event per ~1.5s while actively typing.
    if (!stopped && now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    void ch.send({
      type: "broadcast",
      event: "typing",
      payload: { senderId: user.id, role, stopped },
    });
  };

  // Mark read when the thread opens AND whenever a new message arrives while
  // this thread is open. Previously the effect could fire before messages
  // loaded, return early, and never retry until the conversation was reopened.
  const latestMessageId = messages[messages.length - 1]?.id ?? null;
  // Read receipts must reflect a person actually looking at this thread, so
  // a thread mounted in a hidden/backgrounded tab waits until it is visible.
  useEffect(() => {
    if (!clientId || !latestMessageId || povClient) return;
    let cancelled = false;
    const run = () => {
      void markRead(clientId, role).then(() => {
        if (cancelled) return;
        qc.invalidateQueries({ queryKey: ["conversation-states"] });
        qc.invalidateQueries({ queryKey: ["staff-inbox-state"] });
        qc.invalidateQueries({ queryKey: ["last-messages"] });
        qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      });
    };
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      run();
      return () => { cancelled = true; };
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); };
  }, [clientId, role, qc, latestMessageId, povClient]);

  // Bottom-pinning, done without visible jumps:
  //  - the first scroll to the latest message runs in a layout effect, i.e.
  //    before the browser paints, so the thread never flashes at the top first;
  //  - `pinnedRef` tracks whether the reader is at the bottom; while they are,
  //    anything that makes the thread taller (an image or video poster loading,
  //    a reaction appearing, the keyboard opening) keeps them there, and the
  //    moment they scroll up we stop touching their position.
  const initialScrollDoneRef = React.useRef<string | null>(null);
  const pinnedRef = useRef(true);
  const onThreadScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !messages.length) return;
    if (initialScrollDoneRef.current !== clientId) {
      initialScrollDoneRef.current = clientId ?? null;
      pinnedRef.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    // New message: follow it only if the reader was already at the bottom.
    if (pinnedRef.current || el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      el.scrollTop = el.scrollHeight;
      pinnedRef.current = true;
    }
  }, [messages.length, clientId]);

  // Watch the thread's content (not just the scroller's own box) so late-loading
  // media can't push the latest message out of view.
  const contentCount = allMessages.length;
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [clientId, contentCount]);

  const visibleMessages = useMemo(() => {
    const base = role === "admin"
      ? allMessages
      : allMessages.filter((m) => !m.is_internal_note);

    // A messenger check-in has two persisted timeline events by design:
    // the coach request and the client's completed submission. Once the
    // submission exists, showing both cards makes it look like the coach sent
    // a second check-in. Keep the DB audit trail, but collapse the completed
    // pair to the submission/recap card in the visible chat. Pending requests
    // still render normally until the client actually submits.
    const submittedIds = new Set<string>();
    for (const message of base) {
      for (const att of message.attachments ?? []) {
        if (att?.kind === "checkin_submission" && att.checkin_submission_id) {
          submittedIds.add(att.checkin_submission_id);
        }
      }
    }
    if (submittedIds.size === 0) return base;

    return base.filter((message) => !(message.attachments ?? []).some((att) =>
      att?.kind === "checkin_request" &&
      !!att.checkin_submission_id &&
      submittedIds.has(att.checkin_submission_id),
    ));
  }, [allMessages, role]);

  // Recurring chat forms: only the current one of each type renders as a big
  // card; older / finished ones become compact history rows. Decided up front
  // from the loaded messages so nothing renders expanded and then collapses.
  // Built from the raw list (requests included) so completed units keep their
  // original sent/read timestamps even though the request bubble is hidden.
  const formPlan = useMemo(
    () => planFormMessages([...olderMessages, ...messages], role === "admin" ? "admin" : "client"),
    [olderMessages, messages, role],
  );
  // Older units of each form type collapse into one "history" row with
  // filled / missed counts instead of one row per old request.
  const formHistory = useMemo(
    () => groupFormHistory(formPlan, visibleMessages.map((m) => m.id)),
    [formPlan, visibleMessages],
  );

  // Id of the latest message I sent (for inline "Read/Sent" receipt).
  const lastOwnMessageId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.sender_role === role && !m.is_internal_note && !m.deleted_at) return m.id;
    }
    return null;
  }, [visibleMessages, role]);

  // Coach view: the latest message of mine the client has actually read, so
  // "Read 6:01 PM" stays visible even after newer unread messages go out.
  const lastReadOwnMessageId = useMemo(() => {
    if (role !== "admin") return null;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.sender_role === role && !m.is_internal_note && !m.deleted_at && m.read_by_client_at) return m.id;
    }
    return null;
  }, [visibleMessages, role]);

  // First incoming message that was unread when this thread opened — used
  // to render an iMessage-style "New messages" divider so unread items are
  // still distinguishable after the auto mark-read fires.
  const initialUnreadFirstIdRef = useRef<string | null>(null);
  const initialUnreadCapturedRef = useRef(false);
  useEffect(() => {
    if (initialUnreadCapturedRef.current) return;
    if (!visibleMessages.length) return;
    initialUnreadCapturedRef.current = true;
    const oppRole: SenderRole = role === "admin" ? "client" : "admin";
    const first = visibleMessages.find((m) =>
      m.sender_role === oppRole &&
      !m.is_internal_note &&
      !(role === "admin" ? m.read_by_admin_at : m.read_by_client_at),
    );
    initialUnreadFirstIdRef.current = first?.id ?? null;
  }, [visibleMessages, role]);
  // Reset divider when switching conversations.
  useEffect(() => {
    initialUnreadCapturedRef.current = false;
    initialUnreadFirstIdRef.current = null;
  }, [clientId]);

  // Composer grew/shrank: if the reader was at the latest message, keep it
  // glued above the composer like iMessage instead of letting it slide under.
  const keepLatestVisible = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, []);

  const useSuggestedReply = useCallback((text: string) => {
    setBody(text);
    // Focus inside the tap so iOS opens the keyboard; the composer sizes
    // itself to the inserted text on the next layout pass.
    focusComposerAtEnd(composerRef.current);
  }, []);

  const startReply = (message: Message) => {
    if (message.deleted_at || message.is_internal_note || message.id.startsWith("optimistic-")) return;
    setReplyingTo(message);
    setSheetForId(null);
    setActionsForId(null);
    // Wait for the mobile action sheet to release focus before opening the keyboard.
    window.setTimeout(() => composerRef.current?.focus(), 120);
  };

  const jumpToReplySource = (messageId?: string | null) => {
    if (!messageId) return;
    const node = document.getElementById(`message-${messageId}`);
    if (!node) {
      toast.message("Original message is outside the loaded history.");
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashMessageId(messageId);
    window.setTimeout(() => {
      setFlashMessageId((current) => current === messageId ? null : current);
    }, 1400);
  };

  // Sheets/dialogs opened from a message (check-ins, forms, payment cards)
  // are portaled to <body> but still bubble React events through the
  // message bubble. Bubble gestures must ignore those, or a resting finger in
  // the sheet starts a long-press / double-tap that swallows the next tap.
  const fromPortal = (e: React.SyntheticEvent) =>
    !(e.currentTarget as Node).contains(e.target as Node);

  // ---------- Long-press + selection helpers ----------
  const startLongPress = (id: string, x: number, y: number) => {
    if (longPressRef.current?.t) clearTimeout(longPressRef.current.t);
    const t = setTimeout(() => {
      suppressClickRef.current = true;
      // Haptic feedback when available.
      try { (navigator as any).vibrate?.(10); } catch {}
      if (selectionMode) toggleSelected(id);
      else setSheetForId(id);
    }, 450);
    longPressRef.current = { id, t, x, y };
  };
  const cancelLongPress = () => {
    if (longPressRef.current?.t) clearTimeout(longPressRef.current.t);
    longPressRef.current = null;
  };
  const onPointerMoveDuringHold = (e: React.PointerEvent) => {
    const lp = longPressRef.current;
    if (!lp) return;
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLongPress();
  };
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  // Horizontal-swipe gesture: when user drags left, slide bubbles to reveal
  // exact timestamps on the right edge. Vertical scroll wins ties so the
  // chat keeps scrolling naturally; back-gesture (right-edge swipe) is left
  // alone because we only react to leftward dx.
  const onSwipeTouchStart = (e: React.TouchEvent) => {
    if (fromPortal(e)) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, decided: false, horizontal: false };
  };
  const onSwipeTouchMove = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Only activate for a clear leftward horizontal drag.
      s.horizontal = dx < -6 && Math.abs(dx) > Math.abs(dy) * 1.4;
      s.decided = true;
      if (s.horizontal) cancelLongPress();
    }
    if (s.horizontal) {
      const clamped = Math.max(-72, Math.min(0, dx));
      setSwipeX(clamped);
    }
  };
  const onSwipeTouchEnd = () => {
    if (!swipeRef.current) return;
    swipeRef.current = null;
    setSwipeX(0);
  };

  const canDeleteMessage = useCallback(
    (m: Message) =>
      !m.id.startsWith("optimistic-") && (isAdmin || (m.sender_role === role && !m.deleted_at)),
    [isAdmin, role],
  );
  const myIds = useMemo(
    () => new Set(visibleMessages.filter(canDeleteMessage).map((m) => m.id)),
    [visibleMessages, canDeleteMessage],
  );
  const selectedDeletable = useMemo(
    () => Array.from(selectedIds).filter((id) => myIds.has(id)),
    [selectedIds, myIds],
  );
  const allMineSelected = myIds.size > 0 && Array.from(myIds).every((id) => selectedIds.has(id));

  /** Admin silent delete: gone for everyone, no placeholder. */
  const performAdminDelete = async (ids: string[]) => {
    const gone = new Set(ids);
    try {
      await adminDeleteMessages(ids);
      qc.setQueryData(["messages", clientId, role], (prev: Message[] | undefined) => (prev ?? []).filter((m) => !gone.has(m.id)));
      setOlderMessages((prev) => prev.filter((m) => !gone.has(m.id)));
      qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
      qc.invalidateQueries({ queryKey: deletionsQueryKey({ clientId }) });
      qc.invalidateQueries({ queryKey: ["conversation-states"] });
      toast.success(`${ids.length} message${ids.length === 1 ? "" : "s"} deleted`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete");
    }
    exitSelection();
  };

  const performBulkDelete = async (ids: string[]) => {
    if (isAdmin) return performAdminDelete(ids);
    let failed = 0;
    for (const id of ids) {
      try { await deleteMessageForEveryone(id); }
      catch { failed++; }
    }
    qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
    if (failed) toast.error(`${failed} message${failed === 1 ? "" : "s"} could not be deleted`);
    else toast.success(`${ids.length} message${ids.length === 1 ? "" : "s"} deleted`);
    exitSelection();
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    uploads.add(
      Array.from(files),
      (file, onProgress, signal) => uploadAttachment(clientId, file, onProgress, signal),
      (d, e: any) => toast.error(`${d.name}: ${e?.message ?? "upload failed"}`),
    );
  };

  const stopForPreview = async () => {
    const result = await recorder.stop();
    if (!result) return;
    if (result.duration < 0.5) { toast.message("Voice message too short"); return; }
    const url = URL.createObjectURL(result.blob);
    setPreview({ blob: result.blob, url, duration: result.duration, peaks: result.peaks });
  };

  const discardPreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPreviewPlaying(false);
  };

  const sendPreview = async () => {
    if (!preview) return;
    setUploading(true);
    try {
      const ext = preview.blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([preview.blob], `voice-${Date.now()}.${ext}`, { type: preview.blob.type });
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setUploadProgress({ name: "Voice message", pct: 0 });
      const att = await uploadAttachment(clientId, file, (pct) => setUploadProgress({ name: "Voice message", pct }), controller.signal);
      att.type = "audio";
      att.duration = preview.duration;
      att.peaks = preview.peaks;
      const sent = await doSend({ body: "", extraAttachments: [att], returnMessage: true });
      URL.revokeObjectURL(preview.url);
      setPreview(null);
      setPreviewPlaying(false);
      // Fire and forget transcription
      if (sent?.id && att.storage_path) {
        transcribeFn({ data: { messageId: sent.id, storagePath: att.storage_path, mime: preview.blob.type } })
          .then(() => qc.invalidateQueries({ queryKey: ["messages", clientId, role] }))
          .catch((e) => console.warn("transcription failed", e));
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send voice message");
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
      setUploading(false);
    }
  };

  const doSend = async (opts?: { body?: string; extraAttachments?: MessageAttachment[]; returnMessage?: boolean; withDrafts?: boolean }) => {
    if (!user) return null;
    const text = (opts?.body ?? body).trim();
    const atts = [...attachments, ...(opts?.extraAttachments ?? [])];
    if (!text && atts.length === 0 && !(opts?.withDrafts && uploads.drafts.length)) return null;
    // Media still uploading goes out with this message: the bubble shows
    // local previews + progress now, the insert happens once uploads land.
    const drafts = opts?.withDrafts ? uploads.take() : [];
    const draftPreviews: MessageAttachment[] = drafts.map((d) => ({
      type: d.kind,
      url: d.previewUrl ?? "",
      name: d.name,
      size: d.file.size,
      mime: d.file.type,
    }));
    const replyTarget = replyingTo && !replyingTo.deleted_at && !replyingTo.is_internal_note && !replyingTo.id.startsWith("optimistic-")
      ? replyingTo
      : null;
    const replyPreview = replyTarget ? makeReplyPreview(replyTarget) : null;
    
    // Direct send — no ProgressDrawer popup for simple messages.
    // The button spinner (Loader2) provides sufficient feedback.
    const linkAtts: MessageAttachment[] = [];
    const matches = text.match(LINK_RE);
    if (matches) {
      for (const u of matches.slice(0, 3)) {
        if (atts.some((a) => a.url === u)) continue;
        linkAtts.push({ type: detectAttachmentType(u), url: u });
      }
    }
    // ---------- Optimistic send (iMessage-style) ----------
    // Immediately append a temporary bubble so the composer clears and the
    // message appears with no server round-trip. Replace with the real row
    // when the insert resolves; mark failed on error.
    const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nowIso = new Date().toISOString();
    const key = ["messages", clientId, role] as const;
    const optimistic: Message = {
      id: tempId,
      client_id: clientId,
      sender_id: user.id,
      sender_role: role,
      body: text,
      attachments: [...atts, ...draftPreviews, ...linkAtts],
      message_type: messageType,
      priority: role === "admin" ? priority : null,
      is_internal_note: role === "admin" ? internalNote : false,
      read_by_admin_at: role === "admin" ? nowIso : null,
      read_by_client_at: role === "client" ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
      reply_to_message_id: replyTarget?.id ?? null,
      reply_preview: replyPreview,
      delivery_status: "sending",
      ...(drafts.length ? { local_upload_ids: drafts.map((d) => d.id) } : {}),
    } as Message;
    qc.setQueryData<Message[]>(key, (prev) => [...(prev ?? []), optimistic]);
    // Coach side: the inbox row (preview, time, order) reflects this send at once.
    const patchInbox = (fn: (prev: Message[] | undefined) => Message[] | undefined) => {
      if (role === "admin") qc.setQueryData<Message[] | undefined>(["last-messages"], fn);
    };
    if (belongsInInbox(optimistic)) patchInbox((prev) => (prev ? upsertRow(prev, optimistic) : prev));
    setBody("");
    setAttachments([]);
    setReplyingTo(null);
    setInternalNote(false);
    broadcastTyping(true);
    const releaseDrafts = () => {
      // Give the swapped-in server row a moment to render before freeing blobs.
      if (drafts.length) window.setTimeout(() => drafts.forEach(releaseDraft), 5000);
    };
    let uploaded: MessageAttachment[] = [];
    if (drafts.length) {
      setQueuedUploadSends((n) => n + 1);
      try {
        uploaded = await Promise.all(drafts.map((d) => d.done));
      } catch (e: any) {
        drafts.forEach((d) => d.abort());
        qc.setQueryData<Message[]>(key, (prev) => (prev ?? []).filter((m) => m.id !== tempId));
        patchInbox((prev) => resolveOptimistic(prev, tempId, null));
        drafts.forEach(releaseDraft);
        // Nothing was sent: put the caption back so the coach can re-attach and retry.
        if (text) setBody((b) => b || text);
        if (replyTarget) setReplyingTo((r) => r ?? replyTarget);
        playUiSound("error");
        haptic("error");
        toast.error(`Upload failed: ${e?.message ?? "try again"}`);
        return null;
      } finally {
        setQueuedUploadSends((n) => n - 1);
      }
      // Uploads done: from here it's a normal optimistic row the realtime INSERT may claim.
      qc.setQueryData<Message[]>(key, (prev) =>
        (prev ?? []).map((m) => (m.id === tempId ? ({ ...m, local_upload_ids: undefined } as Message) : m)),
      );
    }
    try {
      const sent = await sendMessage({
        clientId,
        senderId: user.id,
        senderRole: role,
        body: text,
        attachments: [...atts, ...uploaded, ...linkAtts],
        messageType,
        isInternalNote: role === "admin" ? internalNote : false,
        priority: role === "admin" ? priority : undefined,
        replyToMessageId: replyTarget?.id ?? null,
        replyPreview,
      });
      playAppSound("sent");
      patchInbox((prev) => resolveOptimistic(prev, tempId, sent));
      // Swap the optimistic row for the persisted row (dedupe if realtime
      // already delivered it via INSERT).
      qc.setQueryData<Message[]>(key, (prev) => {
        const list = prev ?? [];
        const withoutTemp = list.filter((m) => m.id !== tempId);
        if (withoutTemp.some((m) => m.id === sent.id)) return withoutTemp;
        return [...withoutTemp, sent];
      });
      playUiSound("message");
      haptic("light");
      releaseDrafts();
      return sent;
    } catch (e: any) {
      patchInbox((prev) => resolveOptimistic(prev, tempId, null));
      // Mark the optimistic bubble as failed so the user can see it didn't send.
      qc.setQueryData<Message[]>(key, (prev) =>
        (prev ?? []).map((m) => m.id === tempId
          ? { ...m, delivery_status: "failed" as const, delivery_error: e?.message ?? "Failed to send" }
          : m),
      );
      if (replyTarget) setReplyingTo(replyTarget);
      playUiSound("error");
      haptic("error");
      toast.error(e?.message ?? "Failed to send");
      releaseDrafts();
      return null;
    }
  };

  const onSend = () => doSend({ withDrafts: true });

  const priorityIconTone =
    priority === "High Priority" ? "text-destructive"
    : priority === "Important" ? "text-warning"
    : "text-muted-foreground";

  return (
    <SignedUrlContext.Provider value={signedUrls}>
    <div className={cn(
      "flex flex-col",
      fullBleed
        ? "relative isolate h-full min-h-0 flex-1 overflow-hidden bg-background"
        : "h-[min(80vh,640px)] rounded-md border border-border bg-card",
    )}>
      {/* Admin status/priority controls intentionally removed — kept simple like the client thread.
          Status/priority are managed from the inbox list. */}

      <div
        ref={scrollerRef}
        className={cn(
          "flex-1 min-h-0 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]",
          fullBleed ? "px-3 py-4 sm:px-6" : "p-3 sm:p-4",
        )}
        onScroll={onThreadScroll}
        onTouchStart={onSwipeTouchStart}
        onTouchMove={onSwipeTouchMove}
        onTouchEnd={onSwipeTouchEnd}
        onTouchCancel={onSwipeTouchEnd}
      >
        {canLoadOlder && (
          <div className="flex justify-center pb-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-3 text-xs text-muted-foreground"
              onClick={loadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? (
                <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Loading…</>
              ) : (
                "Load earlier messages"
              )}
            </Button>
          </div>
        )}
        {visibleMessages.length === 0 && messagesPending ? (
          // First open: hold the shape of a thread instead of flashing
          // "No messages yet" before the real history pops in.
          <div className="flex h-full flex-col justify-end gap-3" aria-busy="true" aria-label="Loading messages">
            {[["w-2/3", "start"], ["w-1/2", "end"], ["w-3/5", "start"], ["w-2/5", "end"]].map(([w, side], i) => (
              <div key={i} className={cn("flex", side === "end" ? "justify-end" : "justify-start")}>
                <div className={cn("h-10 animate-pulse rounded-2xl", w, side === "end" ? "bg-primary/20" : "bg-secondary")} />
              </div>
            ))}
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            {role === "client" ? "Send your coach a message to start the conversation." : "No messages yet."}
          </div>
        ) : visibleMessages.map((m) => {
          if (formHistory.hidden.has(m.id)) return null;
          const historyGroup = formHistory.leaders.get(m.id);
          if (historyGroup) {
            return (
              <div key={m.id} id={`message-${m.id}`} className="w-full min-w-0">
                <FormHistoryGroup group={historyGroup} role={role === "admin" ? "admin" : "client"} />
              </div>
            );
          }
          const mine = m.sender_role === role;
          const isDeleted = !!m.deleted_at;
          const isEditing = editingId === m.id;
          const isSelected = selectedIds.has(m.id);
          const canModify = mine && !isDeleted;
          const otherName = mine
            ? null
            : m.is_internal_note
            ? "Internal Note"
            : role === "admin"
            ? peerName ?? "Client"
            : peerName ?? "Coach Jared";
          const otherAvatar = mine || m.is_internal_note
            ? null
            : role === "admin"
            ? peerAvatarPath ?? null
            : null;
          return (
            <Fragment key={m.id}>
              {initialUnreadFirstIdRef.current === m.id && (
                <div className="my-1 flex items-center gap-2 px-1">
                  <span className="h-px flex-1 bg-primary/40" />
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                    New
                  </span>
                  <span className="h-px flex-1 bg-primary/40" />
                </div>
              )}
              {formPlan.get(m.id)?.mode === "compact" ? (
                <div id={`message-${m.id}`} className="w-full min-w-0">
                  <FormHistoryRow p={formPlan.get(m.id)!} role={role === "admin" ? "admin" : "client"} />
                </div>
              ) : (
              <div
              id={`message-${m.id}`}
              className={cn(
                "relative flex w-full min-w-0 items-end gap-2 will-change-transform rounded-2xl transition-[background-color,box-shadow] duration-500",
                flashMessageId === m.id && "bg-primary/10 ring-2 ring-primary/25 ring-offset-2 ring-offset-background",
                mine ? "justify-end" : "justify-start",
                selectionMode && "cursor-pointer",
                (() => {
                  const hasR = (reactionsByMsg.get(m.id)?.length ?? 0) > 0;
                  const hasReceipt = mine && !isDeleted && !selectionMode &&
                    (m.id === lastOwnMessageId || m.id === lastReadOwnMessageId);
                  if (hasR && hasReceipt) return "pb-8";
                  if (hasR) return "pb-3";
                  if (hasReceipt) return "pb-4";
                  return "";
                })(),
              )}
              style={{
                transform: swipeX !== 0 ? `translate3d(${swipeX}px,0,0)` : undefined,
                transition: swipeX === 0 ? "transform 220ms cubic-bezier(.2,.8,.2,1)" : "none",
              }}
              onClick={() => { if (selectionMode && canModify) toggleSelected(m.id); }}
            >
              {/* iMessage-style exact timestamp revealed by swiping left */}
              <div
                aria-hidden
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{
                  right: -64,
                  width: 56,
                  opacity: Math.min(1, Math.abs(swipeX) / 48),
                  transition: swipeX === 0 ? "opacity 220ms ease" : "none",
                }}
              >
                {fmtTime(m.created_at)}
              </div>
              {selectionMode && (
                <div className={cn("self-center shrink-0", mine && "order-last")}>
                  {canModify ? (
                    isSelected
                      ? <CheckCircle2 className="h-5 w-5 text-primary" />
                      : <Circle className="h-5 w-5 text-muted-foreground/60" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/20" />
                  )}
                </div>
              )}
              {!mine && (
                <UserAvatar
                  src={otherAvatar}
                  name={otherName}
                  size={28}
                  tone={m.is_internal_note ? "accent" : "neutral"}
                  className="mb-1"
                />
              )}
              <div
                className={cn(
                  "group relative select-none touch-manipulation",
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm transition-shadow",
                  m.is_internal_note
                    ? "border border-warning/40 bg-warning/10"
                    : mine
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-secondary text-foreground",
                  !mine && !m.is_internal_note && "rounded-bl-md",
                  isDeleted && "italic opacity-70",
                  selectionMode && isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                style={{
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                  WebkitTapHighlightColor: "transparent",
                }}
                onContextMenu={(e) => { if (!isDeleted && !fromPortal(e)) e.preventDefault(); }}
                onPointerDown={(e) => {
                  if (isEditing || (isDeleted && !isAdmin) || fromPortal(e)) return;
                  if ((e.target as HTMLElement).closest("a,button,textarea,input,audio,video")) return;
                  startLongPress(m.id, e.clientX, e.clientY);
                }}
                onPointerMove={onPointerMoveDuringHold}
                onPointerUp={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onTouchEnd={(e) => {
                  if (isDeleted || isEditing || selectionMode || fromPortal(e)) return;
                  const lp = longPressRef.current;
                  if (lp) return; // long-press handler owns this gesture
                  const t = e.changedTouches[0];
                  if (!t) return;
                  if ((t.target as HTMLElement).closest("a,button,textarea,input,audio,video,img,[data-no-doubletap]")) return;
                  const now = Date.now();
                  const last = (m as any).__lastTap as { t: number; x: number; y: number } | undefined;
                  if (last && now - last.t < 320 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 14) {
                    (m as any).__lastTap = undefined;
                    e.preventDefault();
                    suppressClickRef.current = true;
                    void onToggleReaction(m.id, defaultReaction);
                  } else {
                    (m as any).__lastTap = { t: now, x: t.clientX, y: t.clientY };
                  }
                }}
                onDoubleClick={(e) => {
                  if (isDeleted || isEditing || selectionMode || fromPortal(e)) return;
                  if ((e.target as HTMLElement).closest("a,button,textarea,input,audio,video,img")) return;
                  try {
                    const sel = window.getSelection();
                    if (sel && !sel.isCollapsed) return;
                  } catch {}
                  void onToggleReaction(m.id, defaultReaction);
                }}
                onClickCapture={(e) => {
                  if (suppressClickRef.current && !fromPortal(e)) {
                    suppressClickRef.current = false;
                    e.stopPropagation();
                    e.preventDefault();
                  }
                }}
              >
                {!isDeleted && m.reply_to_message_id && m.reply_preview && (
                  <button
                    type="button"
                    data-no-doubletap
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpToReplySource(m.reply_to_message_id);
                    }}
                    className={cn(
                      "mb-2 block w-full rounded-xl border-l-2 px-2.5 py-2 text-left transition",
                      mine
                        ? "border-primary-foreground/60 bg-primary-foreground/10 hover:bg-primary-foreground/15"
                        : "border-primary/60 bg-background/55 hover:bg-background/80",
                    )}
                    title="Jump to original message"
                  >
                    <div className={cn(
                      "mb-0.5 text-[10px] font-bold",
                      mine ? "text-primary-foreground/80" : "text-primary",
                    )}>
                      {m.reply_preview.sender_role === role
                        ? "You"
                        : m.reply_preview.is_internal_note
                          ? "Internal note"
                          : role === "admin"
                            ? peerName ?? "Client"
                            : "Coach Jared"}
                    </div>
                    {(() => {
                      const media = replyMediaFor(m.reply_preview, replySourceFor(m.reply_to_message_id));
                      return (
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            "line-clamp-2 min-w-0 flex-1 text-xs leading-snug",
                            mine ? "text-primary-foreground/80" : "text-muted-foreground",
                          )}>
                            {replyPreviewText(m.reply_preview)}
                          </div>
                          {media && <ReplyThumb media={media} signedUrl={media.path ? signedUrlMap[media.path] : undefined} />}
                        </div>
                      );
                    })()}
                  </button>
                )}
                {m.is_internal_note && (
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-warning">Internal Coach Note</div>
                )}
                {isDeleted ? (
                  <div className="flex items-center gap-1.5 whitespace-pre-wrap break-words">
                    <Trash2 className="h-3 w-3 opacity-70" />
                    <span>This message was deleted</span>
                    {role === "admin" && !m.id.startsWith("optimistic-") && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Same admin silent delete as Select → Delete: removes the row and keeps the audit copy.
                          void performAdminDelete([m.id]);
                        }}
                        className="ml-1 rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold not-italic opacity-80 active:scale-95"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : isEditing ? (
                  <div className="space-y-1.5">
                    <Textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={2}
                      className={cn(
                        "min-h-[60px] resize-none rounded-md border-0 bg-background/20 px-2 py-1 text-sm",
                        mine ? "text-primary-foreground placeholder:text-primary-foreground/60" : "text-foreground",
                      )}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void (async () => {
                            const next = editingBody.trim();
                            if (!next || next === m.body) { setEditingId(null); return; }
                            try {
                              await editMessage(m.id, next);
                              setEditingId(null);
                              qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to edit");
                            }
                          })();
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                        onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" className="h-7 px-2 text-[11px]"
                        onClick={async () => {
                          const next = editingBody.trim();
                          if (!next || next === m.body) { setEditingId(null); return; }
                          try {
                            await editMessage(m.id, next);
                            setEditingId(null);
                            qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
                          } catch (err: any) {
                            toast.error(err?.message ?? "Failed to edit");
                          }
                        }}
                      >
                        <Check className="mr-1 h-3 w-3" /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  m.body && renderBodyWithMeet(m.body, mine)
                )}
                {!isDeleted && !isEditing && m.attachments?.length > 0 && (
                  <div className={cn("mt-2 space-y-2", m.body ? "" : "")}>
                    {m.attachments.map((a, i) => (
                      <AttachmentView
                        key={i}
                        att={a}
                        mine={mine}
                        message={m}
                        role={role}
                        clientId={clientId}
                        onUseReply={useSuggestedReply}
                      />
                    ))}
                    {(m as any).local_upload_ids?.length > 0 && (
                      <DraftUploadStatus store={uploads.store} ids={(m as any).local_upload_ids} />
                    )}
                  </div>
                )}
                <div className={cn("mt-1 flex items-center gap-2 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  <span>{fmtTime(m.created_at)}</span>
                  {m.edited_at && !isDeleted && <span>· edited</span>}
                  {m.message_type !== "General" && <span>· {m.message_type}</span>}
                  {m.priority && <span>· {m.priority}</span>}
                </div>
                {/* Reaction chips (grouped by emoji) */}
                {!isDeleted && (() => {
                  const list = reactionsByMsg.get(m.id) ?? [];
                  if (list.length === 0) return null;
                  const groups = new Map<string, MessageReaction[]>();
                  for (const r of list) {
                    const g = groups.get(r.emoji) ?? [];
                    g.push(r);
                    groups.set(r.emoji, g);
                  }
                  return (
                    <div className={cn(
                      "absolute -bottom-3 flex flex-wrap gap-1",
                      mine ? "right-2" : "left-2",
                    )}>
                      {Array.from(groups.entries()).map(([emoji, rs]) => {
                        const minePicked = rs.some((r) => r.user_id === user?.id);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void onToggleReaction(m.id, emoji); }}
                            className={cn(
                              "inline-flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[11px] shadow-sm transition animate-reaction-pop",
                              minePicked ? "border-primary bg-primary/10" : "border-border hover:bg-secondary",
                            )}
                          >
                            <span>{emoji}</span>
                            {rs.length > 1 && <span className="text-[10px] font-medium">{rs.length}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* Read receipt: under my latest message, plus (coach view) the
                    latest one the client has read. */}
                {mine && (m.id === lastOwnMessageId || m.id === lastReadOwnMessageId) && !selectionMode && (() => {
                  const readAt = role === "admin" ? m.read_by_client_at : m.read_by_admin_at;
                  const hasReactions = (reactionsByMsg.get(m.id)?.length ?? 0) > 0;
                  const status = m.delivery_status;
                  const label = status === "sending"
                    ? "Sending…"
                    : status === "failed"
                    ? "Not delivered · tap to retry"
                    : readAt
                    ? formatReadReceipt(readAt)
                    : role === "admin"
                    ? "Delivered · not read yet"
                    : "Sent";
                  return (
                    // One line, anchored to the bubble's right edge. Without nowrap
                    // the label is capped at the bubble's width, so on short
                    // messages it wraps and the extra lines climb into the bubble.
                    <div className={cn(
                      "absolute right-1 whitespace-nowrap text-[10px] text-muted-foreground",
                      hasReactions ? "-bottom-8" : "-bottom-4",
                      status === "failed" && "text-destructive",
                    )}>
                      {label}
                    </div>
                  );
                })()}
                {mine && !isDeleted && !isEditing && !selectionMode && (
                  <div className={cn(
                    "absolute -top-2 right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                    actionsForId === m.id && "opacity-100",
                  )}>
                    <DropdownMenu open={actionsForId === m.id} onOpenChange={(o) => setActionsForId(o ? m.id : null)}>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon" variant="secondary"
                          className="h-8 w-8 rounded-full border border-border shadow-sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {!m.is_internal_note && !m.id.startsWith("optimistic-") && (() => {
                          const readAt = role === "admin" ? m.read_by_client_at : m.read_by_admin_at;
                          const sentAt = (m as any).sent_at ?? m.created_at;
                          return (
                            <>
                              <div className="space-y-0.5 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                                <div><span className="font-semibold text-foreground">Sent</span> {formatReceiptStamp(sentAt)}</div>
                                <div>
                                  <span className={cn("font-semibold", readAt ? "text-primary" : "text-foreground")}>Read</span>{" "}
                                  {readAt ? formatReceiptStamp(readAt) : "Not yet"}
                                </div>
                              </div>
                              <DropdownMenuSeparator />
                            </>
                          );
                        })()}
                        <div className="flex items-center justify-around px-1 py-1.5">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="rounded-full p-1 text-lg hover:bg-secondary"
                              onClick={() => {
                                void onToggleReaction(m.id, emoji);
                                setActionsForId(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <DropdownMenuSeparator />
                        {!m.is_internal_note && !m.id.startsWith("optimistic-") && (
                          <DropdownMenuItem onClick={() => startReply(m)}>
                            <Reply className="mr-2 h-4 w-4" /> Reply
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => { setEditingId(m.id); setEditingBody(m.body); setActionsForId(null); }}
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { setActionsForId(null); setSelectionMode(true); setSelectedIds(new Set([m.id])); }}
                        >
                          <CheckSquare className="mr-2 h-4 w-4" /> Select
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setActionsForId(null);
                            setConfirmDelete({ ids: [m.id], label: isAdmin ? "Delete this message?" : "Delete this message for everyone?" });
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> {isAdmin ? "Delete" : "Delete for everyone"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {/* Desktop hover quick-react for incoming messages */}
                {!mine && (!isDeleted || isAdmin) && !isEditing && !selectionMode && (
                  <div className={cn(
                    "absolute -top-2 left-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                    actionsForId === m.id && "opacity-100",
                  )}>
                    <DropdownMenu open={actionsForId === m.id} onOpenChange={(o) => setActionsForId(o ? m.id : null)}>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon" variant="secondary"
                          className="h-8 w-8 rounded-full border border-border shadow-sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        <div className="flex items-center justify-around px-1 py-1.5">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="rounded-full p-1 text-lg hover:bg-secondary"
                              onClick={() => {
                                void onToggleReaction(m.id, emoji);
                                setActionsForId(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => startReply(m)}>
                          <Reply className="mr-2 h-4 w-4" /> Reply
                        </DropdownMenuItem>
                        {isAdmin && (
                          <>
                            <DropdownMenuItem
                              onClick={() => { setActionsForId(null); setSelectionMode(true); setSelectedIds(new Set([m.id])); }}
                            >
                              <CheckSquare className="mr-2 h-4 w-4" /> Select
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                setActionsForId(null);
                                setConfirmDelete({ ids: [m.id], label: "Delete this message?" });
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </div>
              )}
            </Fragment>
          );
        })}
        {peerTyping && (
          <div className="flex items-end gap-2" aria-live="polite" aria-label="typing">
            <UserAvatar
              src={peerAvatarPath ?? null}
              name={peerName ?? (role === "admin" ? "Client" : "Coach Jared")}
              size={28}
              tone="neutral"
              className="mb-1"
            />
            <div className="rounded-2xl rounded-bl-md bg-secondary px-3 py-2 shadow-sm">
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-typing-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.32s]" />
                <span className="h-1.5 w-1.5 animate-typing-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.16s]" />
                <span className="h-1.5 w-1.5 animate-typing-bounce rounded-full bg-muted-foreground/70" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Phase 4A — admin strip showing scheduled & failed messages with
          cancel/retry. RLS hides these rows from clients, so it's only
          rendered for the admin role. */}
      {role === "admin" && clientId && <ScheduledStrip clientId={clientId} />}
      {role === "admin" && clientId && <DeletedMessagesStrip clientId={clientId} />}

      <div
        className={cn(
          "space-y-2 border-t border-border",
          fullBleed
            ? "shrink-0 bg-background/95 px-3 pt-2 pb-[var(--composer-bottom-pad)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 sm:pt-3"
            : "bg-card p-2 sm:p-3",
        )}
      >
        {/* Quick replies removed — keeping the composer minimal. */}

        {replyingTo && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
            <Reply className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 border-l-2 border-primary/50 pl-2">
              <div className="text-[10px] font-bold text-primary">
                Replying to {replyingTo.sender_role === role
                  ? "your message"
                  : role === "admin"
                    ? peerName ?? "client"
                    : "Coach Jared"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {replyPreviewText(makeReplyPreview(replyingTo))}
              </div>
            </div>
            {(() => {
              const media = replyMediaFor(makeReplyPreview(replyingTo), replyingTo);
              return media ? <ReplyThumb media={media} signedUrl={media.path ? signedUrlMap[media.path] : undefined} /> : null;
            })()}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {uploadProgress && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{uploadProgress.pct <= 3 ? "Preparing" : "Uploading"} {uploadProgress.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{uploadProgress.pct}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-primary/15">
                <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${uploadProgress.pct}%` }} />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 shrink-0 px-2"
              onClick={() => uploadAbortRef.current?.abort()}
            >
              Cancel
            </Button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {attachments.map((a, i) => (
              <Badge key={i} variant="outline" className="gap-1">
                {(() => { const Icon = attachIcon(a.type); return <Icon className="h-3 w-3" />; })()}
                <span className="max-w-[180px] truncate">{a.name ?? a.url}</span>
                <button onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </Badge>
            ))}
          </div>
        )}

        <DraftUploadChips drafts={uploads.drafts} store={uploads.store} onRemove={uploads.cancel} />

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
        <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
          onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
        <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" className="hidden"
          onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />

        {recorder.recording ? (
          <div className="flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-2">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
            <span className="shrink-0 text-xs font-medium tabular-nums">{fmtDuration(recorder.elapsed)}</span>
            <LiveWaveform levels={recorder.liveLevels} />
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-muted-foreground" onClick={() => recorder.cancel()} title="Discard">
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" className="h-8 shrink-0 bg-primary" onClick={stopForPreview} title="Stop">
              <Square className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : preview ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-2">
            <Button
              type="button" size="icon" variant="default"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={() => {
                const a = previewAudioRef.current; if (!a) return;
                if (a.paused) {
                  try {
                    const audioSession = (navigator as any).audioSession;
                    if (audioSession && "type" in audioSession) audioSession.type = "playback";
                  } catch {}
                  a.muted = false;
                  a.volume = 1;
                  void a.play().catch(() => toast.error("Preview couldn't play. Try recording again."));
                } else { a.pause(); setPreviewPlaying(false); }
              }}
            >
              {previewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
            </Button>
            <div className="flex-1">
              <WaveformBars peaks={preview.peaks.length ? preview.peaks : fakePeaks(40, preview.duration * 9)} progress={0} mine={false} />
              <div className="mt-0.5 text-[10px] text-muted-foreground">Preview · {fmtDuration(preview.duration)}</div>
            </div>
            <audio
              ref={previewAudioRef} src={preview.url} preload="metadata"
              onEnded={() => setPreviewPlaying(false)}
              onPause={() => setPreviewPlaying(false)}
              onPlay={() => setPreviewPlaying(true)}
            />
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-muted-foreground" onClick={discardPreview} title="Discard">
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" className="h-8 shrink-0 bg-primary" onClick={sendPreview} disabled={uploading}>
              <Send className="mr-1 h-3.5 w-3.5" /> Send
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <ComposerPlusMenu
              role={role}
              surface="dm"
              clientIds={[clientId]}
              defaultClientId={clientId}
              disabled={sending}
              canSendGifs={canSendGifs}
              canSendSounds={canSendSounds}
              onPickCamera={() => cameraInputRef.current?.click()}
              onPickPhotos={() => photoInputRef.current?.click()}
              onPickFiles={() => fileInputRef.current?.click()}
              onInsertText={role === "admin" ? (text) =>
                setBody((b) => (b ? `${b.replace(/\s+$/, "")} ${text}` : text))
              : undefined}
              onAttach={role === "admin" ? async (att, noteBody) => {
                await doSend({ body: noteBody, extraAttachments: [att as unknown as MessageAttachment] });
              } : undefined}
              onPickGif={async (g) => {
                if (!user) return;
                setSending(true);
                try {
                  await sendMessage({
                    clientId,
                    senderId: user.id,
                    senderRole: role,
                    body: "",
                    attachments: [{
                      type: g.media_type.startsWith("video") ? "video" : "image",
                      url: g.media_url,
                      name: g.title,
                      mime: g.media_type,
                      kind: "gif",
                      category: g.category,
                      fallback_emoji: fallbackEmoji(g.title, g.category),
                    }],
                    messageType,
                    isInternalNote: role === "admin" ? internalNote : false,
                    priority: role === "admin" ? priority : undefined,
                    replyToMessageId: replyingTo?.id ?? null,
                    replyPreview: replyingTo ? makeReplyPreview(replyingTo) : null,
                  });
                  setReplyingTo(null);
                  qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
                  try { await markRecent(user.id, g.id); } catch {}
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to send GIF");
                } finally {
                  setSending(false);
                }
              }}
              onPickSound={!canSendSounds ? undefined : async (s) => {
                if (!user) return;
                setSending(true);
                try {
                  await sendMessage({
                    clientId,
                    senderId: user.id,
                    senderRole: role,
                    body: "",
                    attachments: [{
                      type: "audio",
                      kind: "sound",
                      url: s.media_url,
                      name: s.title,
                      mime: s.mime,
                      duration: s.duration_ms ? s.duration_ms / 1000 : undefined,
                    }],
                    messageType,
                    isInternalNote: role === "admin" ? internalNote : false,
                    priority: role === "admin" ? priority : undefined,
                    replyToMessageId: replyingTo?.id ?? null,
                    replyPreview: replyingTo ? makeReplyPreview(replyingTo) : null,
                  });
                  setReplyingTo(null);
                  qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
                  try { await markSoundRecent(user.id, s.id); } catch {}
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to send sound");
                } finally {
                  setSending(false);
                }
              }}
            />


            {/* Priority selector removed for simplicity. */}

            {/* Textarea */}
            <AutoGrowTextarea
              ref={composerRef}
              value={body}
              onHeightChange={keepLatestVisible}
              onChange={(e) => {
                setBody(e.target.value);
                if (e.target.value.trim().length > 0) broadcastTyping(false);
                else broadcastTyping(true);
              }}
              onBlur={() => broadcastTyping(true)}
              placeholder={role === "client" ? "Message Coach Jared…" : "Reply to client…"}
              enterKeyHint="enter"
              className="min-h-9 max-h-40 flex-1 resize-none rounded-[20px] border-border/60 bg-background/60 px-4 py-[7px] text-base leading-5 md:text-sm md:leading-5 focus-visible:ring-1 focus-visible:ring-border focus-visible:border-border"
              onFocus={() => {
                // When the on-screen keyboard opens (composer focus), the
                // outer chat container shrinks via --vv-h. Pin the scroller
                // to the bottom across the next few frames so the latest
                // message stays glued above the keyboard.
                const el = scrollerRef.current;
                if (!el) return;
                const pin = () => { el.scrollTop = el.scrollHeight; };
                pin();
                requestAnimationFrame(pin);
                setTimeout(pin, 150);
                setTimeout(pin, 350);
              }}
              onKeyDown={(e) => {
                if (shouldSendOnEnter(e)) {
                  e.preventDefault(); onSend();
                }
              }}
            />

            {/* Voice or Send */}
            {body.trim() || attachments.length > 0 || uploads.drafts.length > 0 ? (
              <>
              {role === "admin" && body.trim() && attachments.length === 0 && uploads.drafts.length === 0 && !replyingTo && (
                <ScheduleButton
                  clientId={clientId}
                  body={body}
                  disabled={sending || uploading}
                  onScheduled={() => { setBody(""); }}
                />
              )}
              <Button
                type="button"
                onClick={onSend}
                disabled={sending || uploading}
                aria-busy={sending || uploading || undefined}
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full bg-primary transition-transform active:scale-90"
              >
                {sending || uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full"
                onClick={async () => {
                  try { await recorder.start(); }
                  catch (e: any) { toast.error(e?.message ?? "Mic permission needed"); }
                }}>
                <Mic className="h-5 w-5" />
              </Button>
            )}
          </div>
        )}

        {/* Message-type + internal-note row removed for simplicity. */}
      </div>

      {/* iMessage-style selection action bar — pinned above the composer on mobile/tablet/desktop. */}
      {selectionMode && (
        <div
          className="fixed inset-x-0 z-40 flex items-center gap-2 border-t border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85"
          style={{
            bottom: 0,
            paddingBottom: "calc(max(env(safe-area-inset-bottom), 0.5rem))",
          }}
        >
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={exitSelection}>
            Cancel
          </Button>
          <div className="flex-1 text-center text-sm font-semibold">
            {selectedIds.size} selected
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              if (allMineSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(myIds));
            }}
            disabled={myIds.size === 0}
          >
            {allMineSelected ? "Deselect all" : "Select all"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9 gap-1"
            disabled={selectedDeletable.length === 0}
            onClick={() => {
              const blocked = selectedIds.size - selectedDeletable.length;
              if (blocked > 0) toast.message(`Skipping ${blocked} message${blocked === 1 ? "" : "s"} you can't delete`);
              setConfirmDelete({
                ids: selectedDeletable,
                label: `Delete ${selectedDeletable.length} message${selectedDeletable.length === 1 ? "" : "s"}${isAdmin ? "" : " for everyone"}?`,
              });
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete ({selectedDeletable.length})
          </Button>
        </div>
      )}

      {/* Mobile/tablet long-press action sheet. */}
      <Sheet open={!!sheetForId} onOpenChange={(o) => { if (!o) setSheetForId(null); }}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[calc(max(env(safe-area-inset-bottom),0.75rem))]"
        >
          {(() => {
            const m = visibleMessages.find((x) => x.id === sheetForId);
            if (!m) return null;
            const canEdit = m.sender_role === role && !m.deleted_at && (m.body?.length ?? 0) > 0;
            const canDelete = canDeleteMessage(m);
            const canReact = !m.deleted_at;
            const canReply = !m.deleted_at && !m.is_internal_note && !m.id.startsWith("optimistic-");
            return (
              <>
                <SheetHeader className="text-left">
                  <SheetTitle>Message actions</SheetTitle>
                  <SheetDescription className="line-clamp-2">
                    {m.deleted_at ? "This message was deleted." : m.body || (m.attachments?.length ? "Attachment" : "")}
                  </SheetDescription>
                </SheetHeader>
                {canReact && (
                  <div className="mt-3 flex items-center justify-around rounded-full border border-border bg-secondary/40 px-2 py-2">
                    {REACTION_EMOJIS.map((emoji) => {
                      const minePicked = myReactions.some(
                        (r) => r.message_id === m.id && r.emoji === emoji,
                      );
                      return (
                        <button
                          key={emoji}
                          type="button"
                          className={cn(
                            "rounded-full p-1 text-2xl transition active:scale-90",
                            minePicked && "bg-primary/15 ring-1 ring-primary",
                          )}
                          onClick={() => {
                            void onToggleReaction(m.id, emoji);
                            setSheetForId(null);
                          }}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 grid gap-1">
                  {canReply && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-12 justify-start text-base"
                      onClick={() => startReply(m)}
                    >
                      <Reply className="mr-3 h-5 w-5" /> Reply
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      type="button" variant="ghost" className="h-12 justify-start text-base"
                      onClick={() => {
                        setEditingId(m.id); setEditingBody(m.body); setSheetForId(null);
                      }}
                    >
                      <Pencil className="mr-3 h-5 w-5" /> Edit
                    </Button>
                  )}
                  {!m.deleted_at && (m.body?.length ?? 0) > 0 && (
                    <Button
                      type="button" variant="ghost" className="h-12 justify-start text-base"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(m.body || "");
                          toast.success("Copied to clipboard");
                        } catch {
                          toast.error("Couldn't copy");
                        }
                        setSheetForId(null);
                      }}
                    >
                      <Copy className="mr-3 h-5 w-5" /> Copy Text
                    </Button>
                  )}
                  <Button
                    type="button" variant="ghost" className="h-12 justify-start text-base"
                    onClick={() => {
                      setSheetForId(null);
                      setSelectionMode(true);
                      setSelectedIds(new Set(canDeleteMessage(m) ? [m.id] : []));
                    }}
                  >
                    <CheckSquare className="mr-3 h-5 w-5" /> Select
                  </Button>
                  {canDelete && (
                    <Button
                      type="button" variant="ghost"
                      className="h-12 justify-start text-base text-destructive hover:text-destructive"
                      onClick={() => {
                        setSheetForId(null);
                        setConfirmDelete({ ids: [m.id], label: isAdmin ? "Delete this message?" : "Delete this message for everyone?" });
                      }}
                    >
                      <Trash2 className="mr-3 h-5 w-5" /> {isAdmin ? "Delete" : "Delete for everyone"}
                    </Button>
                  )}
                  {!canEdit && !canDelete && !canReact && (
                    <div className="rounded-md bg-secondary/40 p-3 text-center text-xs text-muted-foreground">
                      No actions available for this message.
                    </div>
                  )}
                  <Button
                    type="button" variant="outline" className="mt-2 h-11"
                    onClick={() => setSheetForId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>


      {/* Single/bulk delete confirmation. */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDelete?.label ?? "Delete?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAdmin
                ? "Removed for everyone with no trace — the client won't see a placeholder or timestamp. Only coaches and admins can see it under “deleted”."
                : "This cannot be undone. Both sides will see a \"This message was deleted\" placeholder."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const ids = confirmDelete?.ids ?? [];
                setConfirmDelete(null);
                if (isAdmin) {
                  await performAdminDelete(ids);
                  return;
                }
                if (ids.length === 1) {
                  try {
                    await deleteMessageForEveryone(ids[0]);
                    qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
                    toast.success("Message deleted");
                  } catch (err: any) {
                    toast.error(err?.message ?? "Failed to delete");
                  }
                  return;
                }
                await performBulkDelete(ids);
              }}
            >
              {isAdmin ? "Delete" : "Delete for everyone"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </SignedUrlContext.Provider>
  );
}

export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return <Badge className="h-5 min-w-5 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{count > 99 ? "99+" : count}</Badge>;
}

export function PriorityChip({ priority }: { priority?: string | null }) {
  if (!priority || priority === "Normal") return null;
  return <Badge variant="outline" className={priorityTone(priority)}>{priority}</Badge>;
}

export { Card };