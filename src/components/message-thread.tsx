import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  listMessages, sendMessage, markRead, setConversationStatus, setConversationPriority,
  detectAttachmentType, MESSAGE_TYPES, PRIORITIES, QUICK_REPLIES, priorityTone,
  editMessage, deleteMessageForEveryone,
  listReactions, toggleReaction, REACTION_EMOJIS,
  type Message, type MessageAttachment, type SenderRole, type ConversationState,
  type MessageReaction,
} from "@/lib/messages";
import { transcribeVoiceMessage } from "@/lib/voice-transcribe.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
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
import {
  Paperclip, Send, X, FileText, Image as ImageIcon, Video, Link as LinkIcon, ExternalLink,
  Mic, Trash2, Play, Pause, Camera, File as FileIcon, Flag, AlertCircle, AlertTriangle,
  Gauge, Download, ChevronDown, ChevronUp, Square, Loader2, MoreHorizontal, Pencil, Check,
  CheckCircle2, Circle, CheckSquare, Copy,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";

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

function fileToAttachmentType(file: File): MessageAttachment["type"] {
  const m = file.type.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  return "file";
}

async function uploadAttachment(clientId: string, file: File): Promise<MessageAttachment> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const path = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? "." + ext : ""}`;
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

function useSignedUrl(path?: string) {
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

/* ------------------------------- Attachment Renderers ------------------------------- */

function ImageAttachment({ att }: { att: MessageAttachment }) {
  const signed = useSignedUrl(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block max-w-[280px]">
      <img src={src} alt={att.name ?? ""} className="max-h-80 w-auto rounded-md object-cover" loading="lazy" />
    </a>
  );
}

function VideoAttachment({ att }: { att: MessageAttachment }) {
  const signed = useSignedUrl(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  if (!src) return null;
  return <video src={src} controls playsInline className="max-h-80 w-full max-w-[280px] rounded-md bg-black" />;
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

function FileAttachment({ att, mine }: { att: MessageAttachment; mine: boolean }) {
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

function AttachmentView({ att, mine, message }: { att: MessageAttachment; mine: boolean; message?: Message }) {
  if (att.type === "image") return <ImageAttachment att={att} />;
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

function LiveWaveform({ levels }: { levels: number[] }) {
  const padded = Array.from({ length: 40 }, (_, i) => levels[levels.length - 40 + i] ?? 0);
  return (
    <div className="flex h-7 flex-1 items-center gap-[2px]">
      {padded.map((v, i) => (
        <span
          key={i}
          className="w-[3px] flex-1 rounded-full bg-destructive transition-[height] duration-75"
          style={{ height: `${Math.max(8, v * 100)}%`, opacity: v > 0 ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
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
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageType, setMessageType] = useState("General");
  const [internalNote, setInternalNote] = useState(false);
  const [priority, setPriority] = useState<string>("Normal");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();
  const transcribeFn = useServerFn(transcribeVoiceMessage);
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
        document.body.style.removeProperty("overflow");
        document.body.removeAttribute("data-scroll-locked");
      } catch {}
    }, 350);
    return () => window.clearTimeout(t);
  }, [sheetForId, actionsForId]);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", clientId, role],
    enabled: !!clientId,
    queryFn: () => listMessages(clientId, { includeInternal: role === "admin" }),
  });

  const { data: reactions = [] } = useQuery({
    queryKey: ["message-reactions", clientId],
    enabled: !!clientId,
    queryFn: () => listReactions(clientId),
  });

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
  useEffect(() => {
    if (!clientId) return;
    const ch = supabase
      .channel(`messages-${clientId}-${role}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` }, () => {
        qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
        qc.invalidateQueries({ queryKey: ["conversation-states"] });
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
        qc.invalidateQueries({ queryKey: ["message-reactions", clientId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clientId, role, qc]);

  // Mark read on open / when messages change
  useEffect(() => {
    if (!clientId || !messages.length) return;
    markRead(clientId, role).then(() => {
      qc.invalidateQueries({ queryKey: ["conversation-states"] });
      qc.invalidateQueries({ queryKey: ["unread-counts"] });
    });
  }, [clientId, role, messages.length, qc]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length]);

  const visibleMessages = useMemo(
    () => role === "admin" ? messages : messages.filter((m) => !m.is_internal_note),
    [messages, role],
  );

  // Id of the latest message I sent (for inline "Read/Sent" receipt).
  const lastOwnMessageId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.sender_role === role && !m.is_internal_note) return m.id;
    }
    return null;
  }, [visibleMessages, role]);

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
    swipeRef.current = null;
    setSwipeX(0);
  };

  const myIds = useMemo(
    () => new Set(visibleMessages.filter((m) => m.sender_role === role && !m.deleted_at).map((m) => m.id)),
    [visibleMessages, role],
  );
  const selectedDeletable = useMemo(
    () => Array.from(selectedIds).filter((id) => myIds.has(id)),
    [selectedIds, myIds],
  );
  const allMineSelected = myIds.size > 0 && Array.from(myIds).every((id) => selectedIds.has(id));

  const performBulkDelete = async (ids: string[]) => {
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

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const uploaded: MessageAttachment[] = [];
      for (const f of Array.from(files)) {
        if (f.size > 50 * 1024 * 1024) { toast.error(`${f.name} is over 50MB`); continue; }
        uploaded.push(await uploadAttachment(clientId, f));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
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
      const att = await uploadAttachment(clientId, file);
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
      setUploading(false);
    }
  };

  const doSend = async (opts?: { body?: string; extraAttachments?: MessageAttachment[]; returnMessage?: boolean }) => {
    if (!user) return null;
    const text = (opts?.body ?? body).trim();
    const atts = [...attachments, ...(opts?.extraAttachments ?? [])];
    if (!text && atts.length === 0) return null;
    // Auto-detect plain URLs typed inline → optional link attachments
    const linkAtts: MessageAttachment[] = [];
    const matches = text.match(LINK_RE);
    if (matches) {
      for (const u of matches.slice(0, 3)) {
        if (atts.some((a) => a.url === u)) continue;
        linkAtts.push({ type: detectAttachmentType(u), url: u });
      }
    }
    setSending(true);
    try {
      const sent = await sendMessage({
        clientId,
        senderId: user.id,
        senderRole: role,
        body: text,
        attachments: [...atts, ...linkAtts],
        messageType,
        isInternalNote: role === "admin" ? internalNote : false,
        priority: role === "admin" ? priority : undefined,
      });
      setBody("");
      setAttachments([]);
      setInternalNote(false);
      qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
      return sent;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
      return null;
    } finally {
      setSending(false);
    }
  };

  const onSend = () => doSend();

  const priorityIconTone =
    priority === "High Priority" ? "text-destructive"
    : priority === "Important" ? "text-warning"
    : "text-muted-foreground";

  return (
    <div className={cn(
      "flex flex-col",
      fullBleed
        ? "h-full min-h-0 flex-1 bg-background"
        : "h-[min(80vh,640px)] rounded-md border border-border bg-card",
    )}>
      {/* Admin status/priority controls intentionally removed — kept simple like the client thread.
          Status/priority are managed from the inbox list. */}

      <div
        ref={scrollerRef}
        className={cn(
          "flex-1 min-h-0 space-y-3 overflow-y-auto",
          fullBleed ? "px-3 py-4 sm:px-6" : "p-3 sm:p-4",
        )}
        onTouchStart={onSwipeTouchStart}
        onTouchMove={onSwipeTouchMove}
        onTouchEnd={onSwipeTouchEnd}
        onTouchCancel={onSwipeTouchEnd}
      >
        {visibleMessages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            {role === "client" ? "Send your coach a message to start the conversation." : "No messages yet."}
          </div>
        ) : visibleMessages.map((m) => {
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
            <div
              key={m.id}
              className={cn(
                "relative flex items-end gap-2 will-change-transform",
                mine ? "justify-end" : "justify-start",
                selectionMode && "cursor-pointer",
                (() => {
                  const hasR = (reactionsByMsg.get(m.id)?.length ?? 0) > 0;
                  const hasReceipt = mine && !isDeleted && m.id === lastOwnMessageId && !selectionMode;
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
                onContextMenu={(e) => { if (!isDeleted) e.preventDefault(); }}
                onPointerDown={(e) => {
                  if (isEditing || isDeleted) return;
                  if ((e.target as HTMLElement).closest("a,button,textarea,input,audio,video")) return;
                  startLongPress(m.id, e.clientX, e.clientY);
                }}
                onPointerMove={onPointerMoveDuringHold}
                onPointerUp={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onClickCapture={(e) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    e.stopPropagation();
                    e.preventDefault();
                  }
                }}
              >
                {m.is_internal_note && (
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-warning">Internal Coach Note</div>
                )}
                {isDeleted ? (
                  <div className="flex items-center gap-1.5 whitespace-pre-wrap break-words">
                    <Trash2 className="h-3 w-3 opacity-70" />
                    <span>This message was deleted</span>
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
                  m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>
                )}
                {!isDeleted && !isEditing && m.attachments?.length > 0 && (
                  <div className={cn("mt-2 space-y-2", m.body ? "" : "")}>
                    {m.attachments.map((a, i) => (
                      <AttachmentView key={i} att={a} mine={mine} message={m} />
                    ))}
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
                              "inline-flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[11px] shadow-sm transition",
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
                {/* Read receipt (only under my latest message) */}
                {mine && !isDeleted && m.id === lastOwnMessageId && !selectionMode && (() => {
                  const readAt = role === "admin" ? m.read_by_client_at : m.read_by_admin_at;
                  const hasReactions = (reactionsByMsg.get(m.id)?.length ?? 0) > 0;
                  return (
                    <div className={cn(
                      "absolute right-1 text-[10px] text-muted-foreground",
                      hasReactions ? "-bottom-8" : "-bottom-4",
                    )}>
                      {readAt ? `Read ${format(parseISO(readAt), "h:mm a")}` : "Sent"}
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
                      <DropdownMenuContent align="end" className="w-44">
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
                            setConfirmDelete({ ids: [m.id], label: "Delete this message for everyone?" });
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete for everyone
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {/* Desktop hover quick-react for incoming messages */}
                {!mine && !isDeleted && !isEditing && !selectionMode && (
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "space-y-2 border-t border-border",
          fullBleed
            ? "bg-background/95 px-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 sm:pt-3 pb-[calc(var(--bottom-nav-clearance,0px)+max(env(safe-area-inset-bottom),0.5rem))]"
            : "bg-card p-2 sm:p-3",
        )}
      >
        {/* Quick replies removed — keeping the composer minimal. */}

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

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
        <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
          onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
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
                if (a.paused) { a.play(); setPreviewPlaying(true); } else { a.pause(); setPreviewPlaying(false); }
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
            {/* Attachment menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={uploading}>
                  <Paperclip className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel className="text-xs">Attach</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
                  <Camera className="mr-2 h-4 w-4" /> Take photo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => photoInputRef.current?.click()}>
                  <ImageIcon className="mr-2 h-4 w-4" /> Photo or video
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <FileIcon className="mr-2 h-4 w-4" /> File / document
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Priority selector removed for simplicity. */}

            {/* Textarea */}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={role === "client" ? "Message Coach Jared…" : "Reply to client…"}
              rows={1}
              className="min-h-10 max-h-40 flex-1 resize-none rounded-2xl border-input bg-background px-3 py-2 text-base sm:text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault(); onSend();
                }
              }}
            />

            {/* Voice or Send */}
            {body.trim() || attachments.length > 0 ? (
              <Button
                type="button"
                onClick={onSend}
                disabled={sending || uploading}
                aria-busy={sending || uploading || undefined}
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full bg-primary transition-transform active:scale-90"
              >
                {sending || uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full"
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
                label: `Delete ${selectedDeletable.length} message${selectedDeletable.length === 1 ? "" : "s"} for everyone?`,
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
            const canDelete = m.sender_role === role && !m.deleted_at;
            const canReact = !m.deleted_at;
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
                      setSelectedIds(new Set(m.sender_role === role && !m.deleted_at ? [m.id] : []));
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
                        setConfirmDelete({ ids: [m.id], label: "Delete this message for everyone?" });
                      }}
                    >
                      <Trash2 className="mr-3 h-5 w-5" /> Delete for everyone
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
              This cannot be undone. Both sides will see a "This message was deleted" placeholder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const ids = confirmDelete?.ids ?? [];
                setConfirmDelete(null);
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
              Delete for everyone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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