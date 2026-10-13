import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowUp, ArrowUpRight, Check, Copy, History, Keyboard, Loader2, Mic, Paperclip, SlidersHorizontal, Sparkles, Square, SquarePen, Volume2, X,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ASSISTANT_NAME } from "@/lib/business-books";
import { askSummer, askSummerVoice, getSummerMessages, summerSpeech } from "@/lib/business-books.functions";
import { chatTitle, isCurrentChat, type CleoChat } from "@/lib/cleo-chats";
import { summerTone } from "@/lib/summer-persona";
import { extractLinks, tokenizeInline } from "@/lib/summer-voice-text";
import { loadVoicePrefs, summerSpeaker, type ServerVoice, type SummerVoicePrefs } from "@/lib/summer-speaker";
import { blobToBase64, micSupported, useSummerMic } from "@/hooks/use-summer-mic";
import { isAudioSessionError } from "@/lib/audio-session";
import { playAppSound, startThinkingSound } from "@/lib/app-sounds";
import { SummerCustomizeDialog, type SummerPersona } from "./summer-customize";
import { CleoActionCard, CleoApprovals, useCleoActions } from "./cleo-action-card";
import { CHATS_KEY, CleoChatHistory } from "./cleo-chat-history";
import { AttachmentTray, MessageAttachments, useAttachmentTray, workingLabel } from "./cleo-attachments-ui";
import { ATTACH_ACCEPT, type CleoAttachment } from "@/lib/cleo-attachments";

type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string; choices?: string[] | null; attachments?: CleoAttachment[] | null };
type ChatData = { chat: CleoChat | null; messages: Msg[] };
/**
 * Which chat is on screen. "current": the latest chat if it's had a message
 * in the last 6 hours, else a fresh one. "new": a fresh chat (made with its
 * first answer). "chat": one opened from History.
 */
type ChatView = { kind: "current" } | { kind: "new" } | { kind: "chat"; id: string };
const chatKey = (v: ChatView) => ["summer-chat", v.kind === "chat" ? v.id : v.kind];
/** "ready" = she answered and it's your turn: one tap keeps the conversation going. */
type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "ready";

const OWNER_STARTERS = [
  "What's on my plate today?",
  "Who missed workouts this week?",
  "Any pain flags in recent check-ins?",
  "Who still owes me money?",
  "How much should I have set aside for taxes right now?",
  "Which check-ins are waiting on me?",
  "What am I probably forgetting to deduct?",
  "Open my Taxes & Books.",
];

const TEAM_STARTERS = [
  "What's on the calendar today?",
  "Who missed workouts this week?",
  "Any pain flags in recent check-ins?",
  "Which check-ins are waiting?",
  "Who has unread messages?",
  "Who still has an unpaid sale?",
  "Any new coaching applications?",
  "Open the client list.",
];

const FINANCE_STARTERS = [
  "How much should be set aside for taxes right now?",
  "Who still owes money?",
  "What were this month's sales?",
  "Which expenses are missing a receipt?",
  "When is the next GST/HST payment due?",
  "Open Taxes & Books.",
];

/** Opens an in-app link from Cleo: router navigation, query string kept. */
function useOpenLink(onNavigated: () => void) {
  const navigate = useNavigate();
  return useCallback(
    (href: string, internal: boolean) => {
      if (!internal) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      const u = new URL(href, window.location.origin);
      navigate({ to: u.pathname as any, search: Object.fromEntries(u.searchParams) as any });
      onNavigated();
    },
    [navigate, onNavigated],
  );
}

function Inline({ text, onLink }: { text: string; onLink: (href: string, internal: boolean) => void }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) =>
        t.type === "bold" ? (
          <strong key={i}>{t.text}</strong>
        ) : t.type === "link" ? (
          <button
            key={i}
            type="button"
            onClick={() => onLink(t.href, t.internal)}
            className="inline font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {t.label}
          </button>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        ),
      )}
    </>
  );
}

// Small, safe Markdown subset (bold, links, lists, tables, headings) rendered
// as React elements; the model's text is never injected as HTML.
function SummerText({ text, onLink, hideLinkOnlyLines = true }: { text: string; onLink: (href: string, internal: boolean) => void; hideLinkOnlyLines?: boolean }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto">
          <table className="w-full text-xs">
            {head && <thead><tr>{head.map((c, j) => <th key={j} className="border-b px-2 py-1 text-left font-semibold"><Inline text={c} onLink={onLink} /></th>)}</tr></thead>}
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-border/50 px-2 py-1 align-top"><Inline text={c} onLink={onLink} /></td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={cn("space-y-0.5 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => <li key={j}><Inline text={it} onLink={onLink} /></li>)}
        </List>,
      );
      continue;
    }
    // A line that is only an in-app link shows as a chip under the message instead.
    if (hideLinkOnlyLines && /^\s*\[[^\]]+\]\(\/admin[^)]*\)\s*$/.test(line)) { i++; continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(<p key={blocks.length} className={heading ? "font-semibold" : undefined}><Inline text={heading ? heading[1] : line} onLink={onLink} /></p>);
    i++;
  }
  return <div className="space-y-2">{blocks}</div>;
}

const DICTATION_MAX_MS = 5 * 60_000;

function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * The voice conversation. The big orb always does the obvious next thing:
 * listening → send, she's talking → cut in and talk, her answer is done →
 * talk again. Nothing listens without a tap.
 */
function DictationPanel({
  state, level, elapsedMs, onSend, onTalk, onStop, onCancel, files = 0,
}: {
  state: VoiceState;
  /** Attachments that go with what's said. */
  files?: number;
  level: number;
  elapsedMs: number;
  /** Listening: send what was said. */
  onSend: () => void;
  /** Speaking or ready: start listening again (cuts her off if she's talking). */
  onTalk: () => void;
  /** Speaking: stop her and wait for your turn. */
  onStop: () => void;
  /** Leave voice and go back to typing. */
  onCancel: () => void;
}) {
  const listening = state === "listening";
  const ready = state === "ready";
  const speaking = state === "speaking";
  const left = DICTATION_MAX_MS - elapsedMs;
  const bars = [0.45, 0.75, 1, 0.8, 0.55, 0.9, 0.65];
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={listening ? onSend : onTalk}
        disabled={state === "thinking"}
        className="relative flex h-24 w-24 items-center justify-center rounded-full focus:outline-none"
        aria-label={listening ? `Send to ${ASSISTANT_NAME}` : state === "thinking" ? "Working" : `Talk to ${ASSISTANT_NAME}`}
      >
        <span
          className={cn(
            "absolute inset-0 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 opacity-25 transition-transform duration-100",
            (listening || speaking) && "animate-pulse",
          )}
          style={{ transform: `scale(${listening ? 1.1 + Math.min(0.3, level * 0.5) : 1.05})` }}
        />
        {ready && <span className="absolute inset-0 animate-ping rounded-full bg-orange-400/30 [animation-duration:2s]" aria-hidden />}
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 text-white shadow-lg">
          {listening ? (
            <span className="flex h-8 items-center gap-[3px]" aria-hidden>
              {bars.map((b, i) => (
                <span key={i} className="w-[3px] rounded-full bg-white transition-[height] duration-100" style={{ height: `${Math.max(12, Math.min(100, 12 + level * 140 * b))}%` }} />
              ))}
            </span>
          ) : state === "thinking" ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : speaking ? (
            <Volume2 className="h-8 w-8" />
          ) : (
            <Mic className="h-8 w-8" />
          )}
        </span>
      </button>
      {listening ? (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            Listening {clock(elapsedMs)}
          </p>
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            {left < 30_000 ? `Sends by itself in ${Math.ceil(left / 1000)}s` : "Take your time. Pauses are fine. Tap Send when you're done."}
            {files > 0 && <span className="mt-0.5 block font-medium text-foreground">Your {files === 1 ? "attachment goes" : `${files} attachments go`} with it.</span>}
          </p>
          <div className="flex w-full max-w-xs gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={onCancel}>
              <X className="mr-1.5 h-4 w-4" /> Cancel
            </Button>
            <Button className="h-11 flex-[2]" onClick={onSend}>
              <ArrowUp className="mr-1.5 h-4 w-4" /> Send to {ASSISTANT_NAME}
            </Button>
          </div>
        </>
      ) : state === "thinking" ? (
        <>
          <p className="text-sm text-muted-foreground">{ASSISTANT_NAME} is on it…</p>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">{speaking ? `${ASSISTANT_NAME} is talking` : "Your turn"}</p>
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            {speaking ? "Tap the circle to cut in and talk." : `Tap to keep talking to ${ASSISTANT_NAME}.`}
          </p>
          <div className="flex w-full max-w-xs gap-2">
            {speaking ? (
              <Button variant="outline" className="h-11 flex-1" onClick={onStop}>
                <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <Button variant="outline" className="h-11 flex-1" onClick={onCancel}>
                <Keyboard className="mr-1.5 h-4 w-4" /> Type
              </Button>
            )}
            <Button className="h-11 flex-[2]" onClick={onTalk}>
              <Mic className="mr-1.5 h-4 w-4" /> {speaking ? "Talk" : "Keep talking"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function SummerChat({
  open, onOpenChange, year, persona, onPersonaSaved, route, isOwner = true, isFinance = false, startDictating, onDictationStarted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  year?: number;
  persona: SummerPersona;
  onPersonaSaved: () => void;
  /** Current page, so "this client" makes sense to her. */
  route?: string;
  /** Owner gets the books; other admins get team starters. */
  isOwner?: boolean;
  /** The finance login: the books plus the app, read-only. */
  isFinance?: boolean;
  /** Start dictating as soon as the sheet opens (long-press on the button, the mic in Messages). */
  startDictating?: boolean;
  onDictationStarted?: () => void;
}) {
  const qc = useQueryClient();
  const load = useServerFn(getSummerMessages);
  const ask = useServerFn(askSummer);
  const askVoice = useServerFn(askSummerVoice);
  const speechFn = useServerFn(summerSpeech);
  const tone = summerTone(persona.tone);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState("");
  // Photos, videos and files waiting to go with the next message (typed or spoken).
  const tray = useAttachmentTray();
  const trayRef = useRef(tray);
  trayRef.current = tray;
  const fileRef = useRef<HTMLInputElement>(null);
  /** What Cleo is doing while it answers ("Watching your video…"). */
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [copied, setCopied] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { level: micLevel, elapsedMs: micElapsed, start: micStart, stop: micStop, cancel: micCancel } = useSummerMic({ dictate: true, maxMs: DICTATION_MAX_MS });
  const speaker = summerSpeaker();
  const prefsRef = useRef<SummerVoicePrefs>(loadVoicePrefs());
  const canTalk = typeof window !== "undefined" && micSupported();
  const cleo = useCleoActions(open);

  const [view, setView] = useState<ChatView>({ kind: "current" });
  const [showHistory, setShowHistory] = useState(false);
  const { data: chatData, isLoading } = useQuery({
    queryKey: chatKey(view),
    queryFn: () => load({ data: { chatId: view.kind === "chat" ? view.id : null } }) as Promise<ChatData>,
    enabled: open && view.kind !== "new",
    staleTime: 60_000,
  });
  const messages: Msg[] = view.kind === "new" ? [] : chatData?.messages ?? [];
  const activeChat = view.kind === "new" ? null : chatData?.chat ?? null;
  // What a reply lands on, read at the moment it lands (voice turns are async).
  const shownRef = useRef<{ chatId: string | null; messages: Msg[]; chat: CleoChat | null }>({ chatId: null, messages: [], chat: null });
  shownRef.current = { chatId: activeChat?.id ?? null, messages, chat: activeChat };

  // Opening Cleo shows the chat you're in (or a fresh one after a 6-hour gap).
  useEffect(() => {
    if (!open) return;
    setShowHistory(false);
    setView({ kind: "current" });
    void qc.invalidateQueries({ queryKey: chatKey({ kind: "current" }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending, open, voiceState]);

  // A soft "working on it" sound while she thinks (typed or spoken).
  const working = open && (!!pending || voiceState === "thinking");
  useEffect(() => (working ? startThinkingSound() : undefined), [working]);

  /** A question and its answer were saved: show them in their chat (a new chat now has an id). */
  const append = (rows: Msg[], chatId: string) => {
    const shown = shownRef.current;
    const key = chatKey({ kind: "chat", id: chatId });
    qc.setQueryData<ChatData>(key, (old) => {
      const base = old?.messages ?? (shown.chatId === chatId ? shown.messages : []);
      const now = rows[rows.length - 1]?.created_at ?? new Date().toISOString();
      const chat = old?.chat ?? (shown.chat?.id === chatId ? shown.chat : null) ?? { id: chatId, title: chatTitle(rows[0]?.content ?? ""), preview: null, created_at: now, last_message_at: now };
      return { chat: { ...chat, last_message_at: now }, messages: [...base, ...rows] };
    });
    setView({ kind: "chat", id: chatId });
    void qc.invalidateQueries({ queryKey: CHATS_KEY });
  };
  /** The chat a new question goes into (null: a fresh one, made with the answer). */
  const sendTo = () => shownRef.current.chatId;

  const serverVoice = useCallback<ServerVoice>((text, ctx) => speechFn({ data: { text, ...ctx } }) as Promise<any>, [speechFn]);

  const speak = useCallback(
    async (msg: Msg) => {
      prefsRef.current = loadVoicePrefs();
      setSpeakingId(msg.id);
      try {
        await speaker.speak(msg.content, prefsRef.current, serverVoice);
      } finally {
        setSpeakingId(null);
      }
    },
    [speaker, serverVoice],
  );

  /** Throw away what's being said, or stop her talking. */
  const turnRef = useRef(0);
  const stopVoice = useCallback(() => {
    turnRef.current += 1; // a reply that lands after this stays quiet
    micCancel();
    speaker.stop();
    setVoiceState("idle");
  }, [micCancel, speaker]);

  /** Dictate: listen until the tap, then she answers (and speaks it if auto-play is on). */
  const dictate = useCallback(async () => {
    const turn = ++turnRef.current;
    setVoiceState("listening");
    let take;
    try {
      take = await micStart();
    } catch (e: any) {
      toast.error(
        e?.name === "NotAllowedError"
          ? "Allow the microphone to talk to Cleo."
          : isAudioSessionError(e)
            ? "Your phone's audio is busy (music or a call?). Pause it and tap the mic again."
            : e?.message ?? "Couldn't use the microphone",
      );
      stopVoice();
      return;
    }
    if (!take || turn !== turnRef.current) {
      if (turn === turnRef.current) setVoiceState("idle");
      return;
    }
    setVoiceState("thinking");
    // Anything in the tray goes with what was said.
    const atts = trayRef.current.busy ? [] : trayRef.current.ready;
    let res: any;
    try {
      res = await askVoice({ data: { audio: await blobToBase64(take.blob), mime: take.mime, year, route, chatId: sendTo(), ...(atts.length ? { attachments: atts } : {}) } });
    } catch (e: any) {
      if (turn === turnRef.current) {
        toast.error(e?.message ?? `${ASSISTANT_NAME} couldn't answer that`);
        setVoiceState("ready");
      }
      return;
    }
    if (!res?.transcript || !res.assistant) {
      if (turn === turnRef.current) {
        toast.message("Didn't catch any words. Tap and try again.");
        setVoiceState("ready");
      }
      return;
    }
    // Saved either way: the question was asked and answered.
    append([res.user, res.assistant], res.chatId);
    if (atts.length) trayRef.current.clear();
    void cleo.refresh();
    if (turn !== turnRef.current) return;
    prefsRef.current = loadVoicePrefs();
    if (!prefsRef.current.autoplay) playAppSound("reply");
    if (prefsRef.current.autoplay) {
      setVoiceState("speaking");
      await speak(res.assistant);
    }
    // Her answer is done (or was stopped): your turn, one tap to keep going.
    if (turn === turnRef.current) setVoiceState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micStart, askVoice, year, route, speak, stopVoice]);

  const startDictation = () => {
    if (!canTalk) {
      toast.error("Voice isn't supported in this browser. Type to Cleo instead.");
      return;
    }
    speaker.stop(); // cutting in: she stops talking
    speaker.unlock(); // this tap is what lets her reply play by itself
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    void dictate();
  };

  // Long-press on the Cleo button, or the mic on her row in Messages: open straight into dictation.
  useEffect(() => {
    if (open && startDictating && (voiceState === "idle" || voiceState === "ready")) {
      onDictationStarted?.();
      startDictation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startDictating]);

  // Closing the sheet drops whatever was being said.
  useEffect(() => {
    if (!open && voiceState !== "idle") stopVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sendDictation = () => {
    if (voiceState === "listening") {
      try { navigator.vibrate?.(10); } catch { /* not supported */ }
      micStop();
    }
  };

  /** Stop her mid-answer and wait for your turn (the reply is still on screen). */
  const stopSpeaking = () => {
    speaker.stop();
  };

  const send = async (text: string) => {
    const message = text.trim();
    const atts = tray.ready;
    if ((!message && !atts.length) || pending) return;
    if (tray.busy) {
      toast.message("Still uploading. Send again in a sec.");
      return;
    }
    // A zero-width space keeps "pending" truthy for an attachments-only message.
    setPending(message || "\u200b");
    setPendingNote(workingLabel(atts));
    setDraft("");
    try {
      const res = (await ask({ data: { message, year, route, chatId: sendTo(), ...(atts.length ? { attachments: atts } : {}) } })) as { user: Msg; assistant: Msg; chatId: string };
      append([res.user, res.assistant], res.chatId);
      if (atts.length) tray.clear();
      void cleo.refresh();
      playAppSound("reply");
    } catch (e: any) {
      setDraft(message);
      toast.error(e?.message ?? `${ASSISTANT_NAME} couldn't answer that`);
    } finally {
      setPending(null);
      setPendingNote(null);
    }
  };

  /**
   * A tap on one of her quick answers. In a voice conversation it stays one:
   * she answers out loud and it's your turn again after.
   */
  const pick = async (choice: string) => {
    if (pending) return;
    if (voiceState !== "ready") return void send(choice);
    const turn = ++turnRef.current;
    speaker.stop();
    speaker.unlock(); // this tap lets her answer play
    setPending(choice);
    setVoiceState("thinking");
    try {
      const res = (await ask({ data: { message: choice, year, route, voice: true, chatId: sendTo() } })) as { user: Msg; assistant: Msg; chatId: string };
      append([res.user, res.assistant], res.chatId);
      void cleo.refresh();
      if (turn !== turnRef.current) return;
      prefsRef.current = loadVoicePrefs();
      if (prefsRef.current.autoplay) {
        setPending(null);
        setVoiceState("speaking");
        await speak(res.assistant);
      } else playAppSound("reply");
    } catch (e: any) {
      if (turn === turnRef.current) toast.error(e?.message ?? `${ASSISTANT_NAME} couldn't answer that`);
    } finally {
      setPending(null);
      if (turn === turnRef.current) setVoiceState("ready");
    }
  };

  /** New chat: a clean slate. The one you were in stays in History. */
  const newChat = () => {
    if (voiceState !== "idle") stopVoice();
    setShowHistory(false);
    setDraft("");
    setView({ kind: "new" });
  };

  const openFromHistory = (chat: CleoChat) => {
    if (voiceState !== "idle") stopVoice();
    setShowHistory(false);
    setView({ kind: "chat", id: chat.id });
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"));
      setCopied(m.id);
      window.setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const openLink = useOpenLink(
    useCallback(() => {
      // On a phone the sheet covers the page, so step aside; on desktop keep chatting.
      if (window.innerWidth < 768) {
        stopVoice();
        onOpenChange(false);
      }
    }, [stopVoice, onOpenChange]),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {/* The default header padding clears the sheet's Back pill. */}
        <SheetHeader className="border-b pb-3 pr-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base">{ASSISTANT_NAME}</SheetTitle>
                <SheetDescription className="sr-only">Chat with {ASSISTANT_NAME}</SheetDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              {canTalk && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => (voiceState === "listening" ? sendDictation() : startDictation())}
                  disabled={!!pending || voiceState === "thinking"}
                  aria-label="Talk to Cleo"
                >
                  <Mic className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="sr-only sm:not-sr-only">Talk</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-8 text-xs", showHistory ? "text-primary" : "text-muted-foreground")}
                onClick={() => {
                  if (!showHistory && voiceState !== "idle") stopVoice();
                  setShowHistory((v) => !v);
                }}
                aria-label="Chat history"
                aria-pressed={showHistory}
              >
                <History className="h-3.5 w-3.5 sm:mr-1" /><span className="sr-only sm:not-sr-only">History</span>
              </Button>
              {(messages.length > 0 || showHistory) && (
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={newChat} aria-label="New chat">
                  <SquarePen className="h-3.5 w-3.5 sm:mr-1" /><span className="sr-only sm:not-sr-only">New chat</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setCustomizing(true)} aria-label="Customize Cleo">
                <SlidersHorizontal className="h-3.5 w-3.5 sm:mr-1" /><span className="sr-only sm:not-sr-only">Customize</span>
              </Button>
            </div>
          </div>
        </SheetHeader>

        {showHistory ? (
          <CleoChatHistory
            activeId={activeChat?.id ?? null}
            onOpen={openFromHistory}
            onBack={() => setShowHistory(false)}
            onDeleted={(id) => {
              if (id === null || id === activeChat?.id) setView({ kind: "new" });
              if (id) qc.removeQueries({ queryKey: chatKey({ kind: "chat", id }) });
              else qc.removeQueries({ queryKey: ["summer-chat"] });
            }}
          />
        ) : (
        <>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
          {isLoading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {cleo.data && <CleoApprovals approvals={cleo.data.approvals} ownerName={cleo.data.ownerName} onOpen={(h) => openLink(h, true)} />}
          {activeChat && messages.length > 0 && !isCurrentChat(activeChat.last_message_at) && (
            <p className="mx-auto w-fit rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
              Chat from {new Date(activeChat.last_message_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}. Reply to pick it back up.
            </p>
          )}
          {!isLoading && messages.length === 0 && !pending && voiceState === "idle" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">{tone.greeting}</p>
              <div className="flex flex-wrap gap-2">
                {(isOwner ? OWNER_STARTERS : isFinance ? FINANCE_STARTERS : TEAM_STARTERS).map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border px-3 py-1.5 text-left text-xs hover:bg-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, idx) => {
            const links = m.role === "assistant" ? extractLinks(m.content).filter((l) => l.internal).slice(0, 4) : [];
            // Her quick question's answers, only while it's still the latest thing she said.
            const choices = m.role === "assistant" && idx === messages.length - 1 && !pending ? (m.choices ?? []).filter(Boolean) : [];
            return (
              <div key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                <div className={cn("max-w-[88%] rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.role === "assistant" ? (
                    <SummerText text={m.content} onLink={openLink} />
                  ) : (
                    <>
                      {m.attachments?.length ? <MessageAttachments attachments={m.attachments} /> : null}
                      {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                    </>
                  )}
                </div>
                {choices.length > 0 && (
                  <div className="mt-2 flex w-full max-w-[88%] flex-col gap-1.5" role="group" aria-label="Quick answers">
                    {choices.map((c, i) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => void pick(c)}
                        disabled={voiceState === "listening" || voiceState === "thinking"}
                        className={cn(
                          "min-h-10 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50",
                          i === 0 ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "hover:bg-accent",
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && cleo.forMessage(m.id).length > 0 && (
                  <div className="mt-1.5 w-full max-w-[88%] space-y-2">
                    {cleo.forMessage(m.id).map((a) => (
                      <CleoActionCard key={a.id} action={a} ownerName={cleo.data?.ownerName ?? "the owner"} onOpen={(h) => openLink(h, true)} />
                    ))}
                  </div>
                )}
                {m.role === "assistant" && (
                  <div className="mt-1 flex max-w-[88%] flex-wrap items-center gap-1">
                    {links.map((l) => (
                      <button
                        key={l.href}
                        type="button"
                        onClick={() => openLink(l.href, true)}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      >
                        {l.label} <ArrowUpRight className="h-3 w-3" />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        if (speakingId === m.id) speaker.stop();
                        else {
                          speaker.unlock();
                          void speak(m);
                        }
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={speakingId === m.id ? "Stop" : "Play"}
                    >
                      {speakingId === m.id ? <Square className="h-3 w-3" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copy(m)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Copy"
                    >
                      {copied === m.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {pending && (
            <>
              {pending.trim() && pending !== "\u200b" && (
                <div className="flex justify-end">
                  <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-primary px-3 py-2 text-primary-foreground">{pending}</div>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pendingNote ?? `${ASSISTANT_NAME} is on it${tone.value === "girly_pop" ? " 💅" : "…"}`}
              </div>
            </>
          )}
          <div ref={endRef} />
        </div>

        {voiceState !== "idle" ? (
          <div className="border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <DictationPanel
              state={voiceState}
              level={micLevel}
              elapsedMs={micElapsed}
              onSend={sendDictation}
              onTalk={startDictation}
              onStop={stopSpeaking}
              onCancel={stopVoice}
              files={tray.ready.length}
            />
          </div>
        ) : (
          <form
            className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onSubmit={(e) => { e.preventDefault(); void send(draft); }}
          >
            <AttachmentTray items={tray.items} onRemove={tray.remove} />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) tray.add(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex items-end gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 shrink-0 rounded-full"
                onClick={() => fileRef.current?.click()}
                disabled={!!pending}
                aria-label="Attach photos, videos or files"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              {canTalk && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={startDictation}
                  disabled={!!pending}
                  aria-label="Talk to Cleo"
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); }
                }}
                onPaste={(e) => {
                  // A pasted screenshot or file goes in the tray.
                  const pasted = Array.from(e.clipboardData?.files ?? []);
                  if (pasted.length) {
                    e.preventDefault();
                    tray.add(pasted);
                  }
                }}
                rows={1}
                placeholder={`Ask ${ASSISTANT_NAME} anything…`}
                className="max-h-32 min-h-10 resize-none"
                disabled={!!pending}
              />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={(!draft.trim() && !tray.ready.length) || !!pending || tray.busy} aria-label="Send">
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Talk, type, or attach photos, videos and files for {ASSISTANT_NAME} to look at. {ASSISTANT_NAME} does things only after you tap Confirm.</p>
          </form>
        )}
        </>
        )}
        <SummerCustomizeDialog open={customizing} onClose={() => setCustomizing(false)} persona={persona} onSaved={onPersonaSaved} />
      </SheetContent>
    </Sheet>
  );
}
