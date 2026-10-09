import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowUp, ArrowUpRight, Check, Copy, Loader2, Mic, Phone, PhoneOff, RotateCcw, SlidersHorizontal, Sparkles, Square, Volume2,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ASSISTANT_NAME } from "@/lib/business-books";
import { askSummer, askSummerVoice, clearSummer, getSummerMessages, summerSpeech } from "@/lib/business-books.functions";
import { summerTone } from "@/lib/summer-persona";
import { extractLinks, tokenizeInline } from "@/lib/summer-voice-text";
import { loadVoicePrefs, summerSpeaker, type SummerVoicePrefs } from "@/lib/summer-speaker";
import { blobToBase64, micSupported, useSummerMic } from "@/hooks/use-summer-mic";
import { isAudioSessionError } from "@/lib/audio-session";
import { SummerCustomizeDialog, type SummerPersona } from "./summer-customize";

type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string };
type VoiceState = "idle" | "listening" | "thinking" | "speaking";

const OWNER_STARTERS = [
  "What's on my plate today?",
  "Who still owes me money?",
  "How much should I have set aside for taxes right now?",
  "Which check-ins are waiting on me?",
  "What am I probably forgetting to deduct?",
  "Open my Taxes & Books.",
];

const TEAM_STARTERS = [
  "What's on the calendar today?",
  "Which check-ins are waiting?",
  "Who has unread messages?",
  "Who still has an unpaid sale?",
  "Any new coaching applications?",
  "Open the client list.",
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

function VoiceOrb({ state, level, onTap }: { state: VoiceState; level: number; onTap: () => void }) {
  const scale = state === "listening" ? 1 + Math.min(0.35, level * 0.6) : 1;
  const label =
    state === "listening" ? "Listening… tap when you're done" : state === "thinking" ? `${ASSISTANT_NAME} is thinking…` : state === "speaking" ? "Speaking… tap to cut in" : "";
  return (
    <button type="button" onClick={onTap} className="flex flex-col items-center gap-3 focus:outline-none" aria-label={label}>
      <span className="relative flex h-24 w-24 items-center justify-center">
        <span
          className={cn("absolute inset-0 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 opacity-30 transition-transform duration-100", state !== "idle" && "animate-pulse")}
          style={{ transform: `scale(${scale * 1.15})` }}
        />
        <span
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 text-white shadow-lg transition-transform duration-100"
          style={{ transform: `scale(${scale})` }}
        >
          {state === "thinking" ? <Loader2 className="h-8 w-8 animate-spin" /> : state === "speaking" ? <Volume2 className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
        </span>
      </span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </button>
  );
}

export function SummerChat({
  open, onOpenChange, year, persona, onPersonaSaved, route, isOwner = true, startCall, onCallStarted,
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
  /** Start a voice call as soon as the sheet opens (long-press on the button). */
  startCall?: boolean;
  onCallStarted?: () => void;
}) {
  const qc = useQueryClient();
  const load = useServerFn(getSummerMessages);
  const ask = useServerFn(askSummer);
  const askVoice = useServerFn(askSummerVoice);
  const speechFn = useServerFn(summerSpeech);
  const clear = useServerFn(clearSummer);
  const tone = summerTone(persona.tone);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [inCall, setInCall] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const inCallRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { level: micLevel, start: micStart, stop: micStop, cancel: micCancel } = useSummerMic();
  const speaker = summerSpeaker();
  const prefsRef = useRef<SummerVoicePrefs>(loadVoicePrefs());
  const canTalk = typeof window !== "undefined" && micSupported();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["summer-messages"],
    queryFn: () => load() as Promise<Msg[]>,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending, open, voiceState]);

  const append = (rows: Msg[]) => qc.setQueryData<Msg[]>(["summer-messages"], (prev = []) => [...prev, ...rows]);

  const serverVoice = useCallback((text: string) => speechFn({ data: { text } }) as Promise<any>, [speechFn]);

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

  const endCall = useCallback(() => {
    inCallRef.current = false;
    setInCall(false);
    micCancel();
    speaker.stop();
    setVoiceState("idle");
  }, [micCancel, speaker]);

  /** One spoken turn: listen, answer, speak. Loops while a call is on. */
  const talk = useCallback(async () => {
    let misses = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
        endCall();
        return;
      }
      if (!take) {
        if (inCallRef.current && ++misses < 2) continue;
        if (inCallRef.current) toast.message("Call ended. Tap the phone to talk again.");
        endCall();
        return;
      }
      misses = 0;
      setVoiceState("thinking");
      let res: any;
      try {
        res = await askVoice({ data: { audio: await blobToBase64(take.blob), mime: take.mime, year, route } });
      } catch (e: any) {
        toast.error(e?.message ?? `${ASSISTANT_NAME} couldn't answer that`);
        endCall();
        return;
      }
      if (!res?.transcript || !res.assistant) {
        toast.message("Didn't catch that. Try again?");
        if (inCallRef.current) continue;
        setVoiceState("idle");
        return;
      }
      append([res.user, res.assistant]);
      prefsRef.current = loadVoicePrefs();
      if (prefsRef.current.autoplay || inCallRef.current) {
        setVoiceState("speaking");
        await speak(res.assistant);
      }
      if (!inCallRef.current) {
        setVoiceState("idle");
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micStart, askVoice, year, route, speak, endCall]);

  const startTalking = (call: boolean) => {
    if (!canTalk) {
      toast.error("Voice isn't supported in this browser. Type to Cleo instead.");
      return;
    }
    speaker.unlock(); // this tap is what lets her reply play by itself
    speaker.stop();
    inCallRef.current = call;
    setInCall(call);
    void talk();
  };

  // Long-press on the Cleo button: open straight into a call.
  useEffect(() => {
    if (open && startCall && voiceState === "idle") {
      onCallStarted?.();
      startTalking(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startCall]);

  // Closing the sheet hangs up.
  useEffect(() => {
    if (!open && (inCallRef.current || voiceState !== "idle")) endCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tapOrb = () => {
    if (voiceState === "listening") micStop();
    else if (voiceState === "speaking") speaker.stop();
    else if (voiceState === "idle") startTalking(inCall);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setPending(message);
    setDraft("");
    try {
      const res = (await ask({ data: { message, year, route } })) as { user: Msg; assistant: Msg };
      append([res.user, res.assistant]);
    } catch (e: any) {
      setDraft(message);
      toast.error(e?.message ?? `${ASSISTANT_NAME} couldn't answer that`);
    } finally {
      setPending(null);
    }
  };

  const reset = async () => {
    try {
      await clear();
      qc.setQueryData(["summer-messages"], []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not clear");
    }
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
        endCall();
        onOpenChange(false);
      }
    }, [endCall, onOpenChange]),
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
                  variant={inCall ? "destructive" : "ghost"}
                  size="sm"
                  className={cn("h-8 text-xs", !inCall && "text-muted-foreground")}
                  onClick={() => (inCall ? endCall() : startTalking(true))}
                  aria-label={inCall ? "End call" : "Call Cleo"}
                >
                  {inCall ? <PhoneOff className="h-3.5 w-3.5 sm:mr-1" /> : <Phone className="h-3.5 w-3.5 sm:mr-1" />}
                  <span className="sr-only sm:not-sr-only">{inCall ? "End" : "Call"}</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setCustomizing(true)} aria-label="Customize Cleo">
                <SlidersHorizontal className="h-3.5 w-3.5 sm:mr-1" /><span className="sr-only sm:not-sr-only">Customize</span>
              </Button>
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => void reset()} aria-label="New chat">
                  <RotateCcw className="h-3.5 w-3.5 sm:mr-1" /><span className="sr-only sm:not-sr-only">New chat</span>
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
          {isLoading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!isLoading && messages.length === 0 && !pending && voiceState === "idle" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">{tone.greeting}</p>
              <div className="flex flex-wrap gap-2">
                {(isOwner ? OWNER_STARTERS : TEAM_STARTERS).map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border px-3 py-1.5 text-left text-xs hover:bg-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => {
            const links = m.role === "assistant" ? extractLinks(m.content).filter((l) => l.internal).slice(0, 4) : [];
            return (
              <div key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                <div className={cn("max-w-[88%] rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.role === "assistant" ? <SummerText text={m.content} onLink={openLink} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                </div>
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
              <div className="flex justify-end">
                <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-primary px-3 py-2 text-primary-foreground">{pending}</div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {ASSISTANT_NAME} is on it{tone.value === "girly_pop" ? " 💅" : "…"}
              </div>
            </>
          )}
          <div ref={endRef} />
        </div>

        {voiceState !== "idle" || inCall ? (
          <div className="border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <div className="flex flex-col items-center gap-3">
              <VoiceOrb state={voiceState} level={micLevel} onTap={tapOrb} />
              {inCall ? (
                <Button variant="destructive" size="sm" onClick={endCall}><PhoneOff className="mr-1.5 h-4 w-4" /> End call</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={endCall}>Cancel</Button>
              )}
            </div>
          </div>
        ) : (
          <form
            className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onSubmit={(e) => { e.preventDefault(); void send(draft); }}
          >
            <div className="flex items-end gap-2">
              {canTalk && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={() => startTalking(false)}
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
                rows={1}
                placeholder={`Ask ${ASSISTANT_NAME} anything…`}
                className="max-h-32 min-h-10 resize-none"
                disabled={!!pending}
              />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={!draft.trim() || !!pending} aria-label="Send">
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Mic to talk, phone for a hands-free call. {ASSISTANT_NAME} can look things up and link you, but she can't change anything.</p>
          </form>
        )}
        <SummerCustomizeDialog open={customizing} onClose={() => setCustomizing(false)} persona={persona} onSaved={onPersonaSaved} />
      </SheetContent>
    </Sheet>
  );
}
