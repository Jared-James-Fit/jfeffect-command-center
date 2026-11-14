import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, ChevronLeft, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listenChannel } from "@/lib/realtime-channel";
import { getMemberSupport, replyMemberSupport, updateMemberSupport } from "@/lib/member-support.functions";
import { SUPPORT_LINE } from "@/lib/member-support";
import { UserAvatar } from "@/components/user-avatar";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Every query a support change should refresh: the open chat, the inbox's rows and the badges. */
export const SUPPORT_REFRESH_KEYS = [["member-support"], ["staff-support-threads"], ["admin-nav-badges"]] as const;

type Msg = { id: string; sender_role: string; body: string; created_at: string; pending?: boolean };

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * A JF member's Support chat, opened in the coach's Messages like any chat:
 * their messages on the left, yours on the right, a reply box at the bottom.
 * They read it on Support in their app and get a push when you write.
 */
export function MemberSupportPane({
  threadId, clientId, fallback, onBack, embedded = false,
}: {
  threadId?: string;
  /** A member with no chat yet: your first message starts it. */
  clientId?: string;
  /** What the inbox row already knows, so the header paints at once. */
  fallback?: { name: string; avatar: string | null };
  onBack: () => void;
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const get = useServerFn(getMemberSupport);
  const reply = useServerFn(replyMemberSupport);
  const update = useServerFn(updateMemberSupport);
  const key = ["member-support", threadId ?? `client:${clientId}`];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => get({ data: threadId ? { threadId } : { clientId } }),
    staleTime: 5_000,
  });
  const [pending, setPending] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const thread: any = data?.thread;
  const liveThreadId: string | undefined = thread?.id ?? threadId;
  const messages: Msg[] = [...((data?.messages ?? []) as Msg[]), ...pending];
  const name = data?.person?.name ?? fallback?.name ?? "Member";
  const first = name.split(" ")[0];
  const avatar = fallback?.avatar ?? data?.person?.avatar ?? null;
  const done = thread?.status === "closed";

  const refresh = () => SUPPORT_REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));

  // Opening it read it: the row's dot and the badge go out.
  useEffect(() => {
    if (!data) return;
    qc.invalidateQueries({ queryKey: ["staff-support-threads"] });
    qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
  }, [qc, data?.thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Their new messages arrive live (and read themselves, since the chat is open).
  useEffect(() => {
    if (!liveThreadId) return;
    const ch = listenChannel(`member-support-${liveThreadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "member_support_messages", filter: `thread_id=eq.${liveThreadId}` },
        () => { qc.invalidateQueries({ queryKey: key }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [liveThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const temp: Msg = { id: `pending-${Date.now()}`, sender_role: "team", body, created_at: new Date().toISOString(), pending: true };
    setPending((p) => [...p, temp]);
    setText("");
    setSending(true);
    try {
      await reply({ data: liveThreadId ? { threadId: liveThreadId, body } : { clientId, body } });
      await qc.invalidateQueries({ queryKey: key });
      refresh();
    } catch (e: any) {
      setText(body);
      toast.error(e?.message ?? "Your reply didn't send. Try again.");
    } finally {
      setPending((p) => p.filter((m) => m.id !== temp.id));
      setSending(false);
      boxRef.current?.focus();
    }
  };

  const change = async (patch: { status?: "open" | "closed"; read?: boolean }, ok: string, leave = false) => {
    if (!liveThreadId) return;
    try {
      await update({ data: { threadId: liveThreadId, ...patch } });
      refresh();
      toast.success(ok);
      if (leave) onBack();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update this chat");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-member-support-pane>
      <header
        className="flex items-center gap-1.5 border-b border-border bg-card px-2 py-2 sm:gap-2 md:px-4"
        style={embedded ? undefined : { paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
      >
        <Button variant="ghost" size="icon" className="-mr-1 h-10 w-10 shrink-0 md:hidden" onClick={onBack} aria-label="Back to inbox">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        {data?.person?.clientId ? (
          <ClientNameLink clientId={data.person.clientId} ariaLabel={`Open ${name} profile`} title="Open profile" className="shrink-0 rounded-full">
            <UserAvatar src={avatar} name={name} size={40} />
          </ClientNameLink>
        ) : (
          <UserAvatar src={avatar} name={name} size={40} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold leading-5">{name}</div>
          <div className="truncate text-[13px] leading-[18px] text-muted-foreground">
            {SUPPORT_LINE}{done ? " · Done" : ""}
          </div>
        </div>
        {liveThreadId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="More">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {done ? (
                <DropdownMenuItem onClick={() => change({ status: "open" }, "Back in your Inbox")}>Move back to Inbox</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => change({ status: "closed" }, "Done. It comes back if they write again.", true)}>
                  Done (nothing more to answer)
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => change({ read: false }, "Marked unread", true)}>Mark as unread</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-6" data-member-support-messages>
        {isLoading ? (
          <div className="grid h-24 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <p className="px-6 py-10 text-center text-[15px] text-muted-foreground">{(error as Error).message || "This chat didn't load."}</p>
        ) : (
          <>
            {/* Who this is, said once at the top (Instagram's header on a new chat). */}
            <div className="mx-auto mb-5 max-w-sm px-4 text-center text-[13px] leading-[18px] text-muted-foreground" data-support-intro>
              {first} is a JF member (no coach). They write to you from Support in their app, and get a push when you reply.
            </div>
            {messages.length === 0 && (
              <p className="text-center text-[15px] text-muted-foreground">No messages yet. Say hi to start the chat.</p>
            )}
            <ul className="space-y-1.5">
              {messages.map((m, i) => {
                const mine = m.sender_role !== "member";
                const next = messages[i + 1];
                const lastOfRun = !next || (next.sender_role !== "member") !== mine
                  || new Date(next.created_at).getTime() - new Date(m.created_at).getTime() > 10 * 60_000;
                return (
                  <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")} data-support-message={mine ? "mine" : "theirs"}>
                    <div className={cn("max-w-[80%]", lastOfRun && "mb-2")}>
                      <div
                        className={cn(
                          "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[15px] leading-5",
                          mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground",
                          m.pending && "opacity-60",
                        )}
                      >
                        {m.body}
                      </div>
                      {lastOfRun && (
                        <div className={cn("mt-0.5 px-1 text-[11px] text-muted-foreground", mine && "text-right")}>
                          {m.pending ? "Sending…" : timeLabel(m.created_at)}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border bg-card px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] md:px-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={boxRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(min-width: 768px)").matches) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Message ${first}…`}
            aria-label={`Message ${first}`}
            className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-[22px] border border-border bg-background px-4 py-[11px] text-[16px] leading-5 outline-none focus:border-foreground/30"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            aria-label="Send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
