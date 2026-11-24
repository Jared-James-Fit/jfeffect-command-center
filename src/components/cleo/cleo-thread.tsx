/**
 * A Cleo conversation on screen (Nov 24 2026). Questions on the right in a
 * quiet bubble, Cleo's answers as plain text with its mark; under an answer:
 * Copy, Read it aloud, Try again (the latest), its in-app links and any cards it
 * set up. A question can be copied, or edited and sent again (the answers after
 * it step aside, kept). An answer being written shows what Cleo is doing; one
 * that failed or was stopped says so with Try again.
 *
 * Scrolling: it follows the conversation while you're at the bottom and never
 * pulls you down while you're reading further up (a "Newest" pill appears
 * instead); sending always brings you down; scrolling to the top loads older
 * messages without the view jumping.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight, Check, Copy, Loader2, Pencil, RotateCcw, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CleoMark } from "@/components/summer/cleo-mark";
import { extractLinks } from "@/lib/summer-voice-text";
import { CleoText, plainText } from "./cleo-text";
import { isOpenTurn, type CleoMsg } from "./use-cleo-conversation";
import { MessageAttachments } from "@/components/admin/books/cleo-attachments-ui";
import { CleoActionCard } from "@/components/admin/books/cleo-action-card";
import type { CleoActionView } from "@/lib/cleo-actions";

const NEAR_BOTTOM_PX = 96;

function Working({ msg }: { msg: CleoMsg }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const since = Date.parse(msg.created_at);
  const secs = Number.isFinite(since) ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status" aria-live="polite" data-cleo-working>
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/50 [animation-duration:1s]" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
      <span>{msg.progress || (msg.status === "pending" ? "Starting…" : "Thinking…")}</span>
      {secs >= 8 && <span className="tabular-nums text-muted-foreground/70">{secs}s</span>}
    </div>
  );
}

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function CleoThread({
  messages,
  hasOlder,
  loadOlder,
  onLink,
  onRegenerate,
  onEdit,
  onPick,
  answering,
  actionsFor,
  ownerName,
  speakingId,
  onSpeak,
  empty,
  top,
  className,
}: {
  messages: CleoMsg[];
  hasOlder: boolean;
  loadOlder: () => Promise<void>;
  onLink: (href: string, internal: boolean) => void;
  onRegenerate: (assistantId: string) => void;
  onEdit: (userMsgId: string, text: string) => Promise<boolean>;
  onPick: (choice: string) => void;
  answering: boolean;
  actionsFor: (messageId: string) => CleoActionView[];
  ownerName: string;
  speakingId: string | null;
  onSpeak: (m: CleoMsg) => void;
  /** Shown with no messages. */
  empty?: ReactNode;
  /** Above the messages (approvals waiting on the owner). */
  top?: ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const toBottom = useCallback((smooth = true) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(false);
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current) setNewBelow(false);
  };

  // what changed at the end of the conversation: a new message, an answer filling in, its progress
  const last = messages[messages.length - 1];
  const signature = `${messages.length}:${last?.id ?? ""}:${last?.status ?? ""}:${last?.content.length ?? 0}:${last?.progress ?? ""}`;
  const firstId = messages[0]?.id;
  const lastUserLocal = !![...messages].reverse().find((m) => m.role === "user")?.local;
  const prevFirst = useRef<string | undefined>(firstId);
  const heightBefore = useRef(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // older messages came in above: keep the view where it was
    if (prevFirst.current && firstId !== prevFirst.current && heightBefore.current) {
      el.scrollTop += el.scrollHeight - heightBefore.current;
      heightBefore.current = 0;
      prevFirst.current = firstId;
      return;
    }
    prevFirst.current = firstId;
    if (atBottom.current || lastUserLocal) toBottom(messages.length > 0 && !lastUserLocal ? true : false);
    else if (messages.length) setNewBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // the first paint of a conversation lands at its end
  const shownChat = messages.find((m) => m.chat_id)?.chat_id ?? null;
  useLayoutEffect(() => {
    atBottom.current = true;
    toBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownChat]);

  // the top: load older messages
  useEffect(() => {
    const node = topSentinel.current;
    const root = scroller.current;
    if (!node || !root || !hasOlder) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || loadingOlder) return;
        heightBefore.current = root.scrollHeight;
        setLoadingOlder(true);
        loadOlder()
          .catch(() => toast.error("Couldn't load older messages."))
          .finally(() => setLoadingOlder(false));
      },
      { root, rootMargin: "200px 0px 0px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasOlder, loadOlder, loadingOlder]);

  const copy = async (m: CleoMsg) => {
    try {
      await navigator.clipboard.writeText(plainText(m.content));
      setCopied(m.id);
      window.setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const lastAnswerId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastQuestionId = [...messages].reverse().find((m) => m.role === "user")?.id;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4", className)} data-cleo-thread>
        {top}
        {hasOlder && (
          <div ref={topSentinel} className="flex justify-center py-2 text-muted-foreground">
            {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-[11px]">Earlier messages</span>}
          </div>
        )}
        {!messages.length && empty}
        <div className="space-y-5">
          {messages.map((m) => {
            if (m.role === "user") {
              const isEditing = editing?.id === m.id;
              return (
                <div key={m.id} className="group flex flex-col items-end" data-cleo-msg="user">
                  {isEditing ? (
                    <div className="w-full max-w-[92%] rounded-2xl border border-border bg-background p-2">
                      <textarea
                        value={editing.text}
                        autoFocus
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void onEdit(m.id, editing.text).then((ok) => ok && setEditing(null));
                          }
                        }}
                        rows={Math.min(8, Math.max(2, editing.text.split("\n").length))}
                        className="w-full resize-none bg-transparent px-1.5 py-1 text-[15px] leading-6 outline-none"
                        aria-label="Edit your message"
                      />
                      <div className="mt-1 flex justify-end gap-1.5">
                        <button type="button" onClick={() => setEditing(null)} className="h-9 cursor-pointer rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted">
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!editing.text.trim() || answering}
                          onClick={() => void onEdit(m.id, editing.text).then((ok) => ok && setEditing(null))}
                          className="h-9 cursor-pointer rounded-lg bg-foreground px-3 text-sm font-medium text-background disabled:opacity-40"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={cn("max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-[15px] leading-6", m.local && "opacity-70")}>
                        {m.attachments?.length ? <MessageAttachments attachments={m.attachments} /> : null}
                        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                      </div>
                      {!m.local && (
                        <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
                          <IconButton label={copied === m.id ? "Copied" : "Copy"} onClick={() => void copy(m)}>
                            {copied === m.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </IconButton>
                          {!answering && (
                            <IconButton label="Edit and send again" onClick={() => setEditing({ id: m.id, text: m.content })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            }
            const open = isOpenTurn(m);
            const links = m.status === "done" ? extractLinks(m.content).filter((l) => l.internal).slice(0, 4) : [];
            const isLast = m.id === lastAnswerId;
            const choices = isLast && m.status === "done" && !answering ? (m.choices ?? []).filter(Boolean) : [];
            const cards = m.local ? [] : actionsFor(m.id);
            return (
              <div key={m.id} className="flex gap-2.5" data-cleo-msg="assistant">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-background" aria-hidden>
                  <CleoMark size={14} />
                </span>
                <div className="min-w-0 flex-1 text-[15px] leading-6">
                  {open ? (
                    <Working msg={m} />
                  ) : m.status === "failed" ? (
                    <div className="space-y-1.5" role="alert">
                      {m.content && <CleoText text={m.content} onLink={onLink} />}
                      <p className="text-[13px] text-muted-foreground">{m.error || "Cleo couldn't answer that."}</p>
                      {isLast && (
                        <button type="button" onClick={() => onRegenerate(m.id)} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
                          <RotateCcw className="h-3.5 w-3.5" /> Try again
                        </button>
                      )}
                    </div>
                  ) : m.status === "stopped" ? (
                    <div className="space-y-1.5">
                      {m.content && <CleoText text={m.content} onLink={onLink} />}
                      <p className="text-[13px] text-muted-foreground">Stopped.</p>
                      {isLast && (
                        <button type="button" onClick={() => onRegenerate(m.id)} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
                          <RotateCcw className="h-3.5 w-3.5" /> Answer it
                        </button>
                      )}
                    </div>
                  ) : (
                    <CleoText text={m.content} onLink={onLink} />
                  )}
                  {choices.length > 0 && (
                    <div className="mt-2.5 flex flex-col gap-1.5" role="group" aria-label="Quick answers">
                      {choices.map((c, i) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => onPick(c)}
                          className={cn(
                            "min-h-10 cursor-pointer rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted",
                            i === 0 ? "border-foreground/30" : "border-border",
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  {cards.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {cards.map((a) => (
                        <CleoActionCard key={a.id} action={a} ownerName={ownerName} onOpen={(h) => onLink(h, true)} />
                      ))}
                    </div>
                  )}
                  {m.status === "done" && (
                    <div className="mt-1 flex flex-wrap items-center gap-0.5">
                      {links.map((l) => (
                        <button
                          key={l.href}
                          type="button"
                          onClick={() => onLink(l.href, true)}
                          className="mr-1 inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-border px-2.5 text-[12px] font-medium hover:bg-muted"
                        >
                          {l.label} <ArrowUpRight className="h-3 w-3" />
                        </button>
                      ))}
                      <IconButton label={copied === m.id ? "Copied" : "Copy"} onClick={() => void copy(m)}>
                        {copied === m.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </IconButton>
                      <IconButton label={speakingId === m.id ? "Stop reading" : "Read it aloud"} onClick={() => onSpeak(m)} active={speakingId === m.id}>
                        {speakingId === m.id ? <Square className="h-3 w-3" /> : <Volume2 className="h-3.5 w-3.5" />}
                      </IconButton>
                      {isLast && !answering && (
                        <IconButton label="Try again" onClick={() => onRegenerate(m.id)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {lastQuestionId && <div className="h-2" aria-hidden />}
      </div>
      {newBelow && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          className="absolute bottom-3 left-1/2 inline-flex h-9 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-[13px] font-medium shadow-sm hover:bg-muted"
          data-cleo-newest
        >
          <ArrowDown className="h-3.5 w-3.5" /> Newest
        </button>
      )}
    </div>
  );
}
