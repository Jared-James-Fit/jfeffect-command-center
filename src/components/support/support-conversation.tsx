import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowUp, ChevronLeft, LifeBuoy, Loader2, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { askForPerson, getMemberSupport, getMySupportThread, markMyThreadRead, sendSupportMessage } from "@/lib/member-support.functions";
import { CLEO_SUPPORT_LABEL, supportSegments } from "@/lib/support-cleo/rules";
import { useClientImpersonation, useViewingAsClient } from "@/lib/client-impersonation";
import { PREVIEW_ONLY_MESSAGE } from "@/lib/community";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listenChannel } from "@/lib/realtime-channel";
import { phoneLayoutNow } from "@/lib/portrait-only";
import { SUPPORT_CHAT_NAME, supportSeenLine, type SupportMsg } from "@/lib/member-support";

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The JF Effect Support chat's data: the person's own, or (View as client) theirs, read-only. */
export function useSupportConversation() {
  const previewing = useViewingAsClient();
  const { client: povClient } = useClientImpersonation();
  const fetchMine = useServerFn(getMySupportThread);
  const fetchAsCoach = useServerFn(getMemberSupport);
  const key = ["m-support", previewing ? povClient?.id ?? "pov" : "me"] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (previewing && povClient?.id) {
        const r = await fetchAsCoach({ data: { clientId: povClient.id } });
        return { thread: r.thread, messages: r.messages, tier: r.person?.tier ?? null };
      }
      return fetchMine();
    },
  });
  const messages = (q.data?.messages ?? []) as SupportMsg[];
  const thread = q.data?.thread as { id: string; unread_for_member?: number; handler?: string; status?: string } | null | undefined;
  return { ...q, key, previewing, thread, messages };
}

/**
 * Everyone's chat with JF Effect, a conversation in Messages like any other
 * (members and coaching clients alike): theirs on the right, ours on the
 * left, one box to write in. The team answers from the coach's Messages; each
 * side gets a push when the other writes, and "Seen" shows once the team read it.
 */
/** A message's words with its in-app paths as taps (only the help answers' paths). */
function SupportBody({ body }: { body: string }) {
  return (
    <>
      {supportSegments(body).map((seg, i) => {
        if ("text" in seg) return <span key={i}>{seg.text}</span>;
        const [path, hash] = seg.to.split("#");
        return (
          <Link key={i} to={path as any} hash={hash} className="font-semibold underline underline-offset-2" data-support-link={seg.to}>
            {seg.label}
          </Link>
        );
      })}
    </>
  );
}

export function SupportConversation({ onBack }: { onBack?: () => void }) {
  const qc = useQueryClient();
  const send = useServerFn(sendSupportMessage);
  const askPerson = useServerFn(askForPerson);
  const markRead = useServerFn(markMyThreadRead);
  const { key, previewing, thread, messages: saved, isLoading } = useSupportConversation();
  const [pending, setPending] = useState<SupportMsg[]>([]);
  const messages: SupportMsg[] = [...saved, ...pending];

  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  // Cleo answers first on a new chat, or one Cleo has (never once the team has it)
  const cleoFirst = !thread || thread.handler === "cleo" || thread.status === "closed";
  const teamHasIt = !!thread && thread.handler === "human" && thread.status !== "closed";
  const endRef = useRef<HTMLDivElement>(null);

  // Reading it clears the Messages badge (never while a coach previews).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto", block: "end" });
    if (previewing || !thread?.id) return;
    const unseen = (thread.unread_for_member ?? 0) > 0 || saved.some((m) => m.sender_role !== "member" && !m.read_at);
    if (!unseen) return;
    markRead().then(() => qc.invalidateQueries({ queryKey: ["client-nav-badges"] })).catch(() => {});
  }, [messages.length, thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!thread?.id) return;
    const ch = listenChannel(`m-support-${thread.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "member_support_messages", filter: `thread_id=eq.${thread.id}` },
        () => qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [thread?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const message = body.trim();
    if (!message || busy) return;
    if (previewing) {
      toast(PREVIEW_ONLY_MESSAGE);
      return;
    }
    const temp: SupportMsg = { id: `pending-${Date.now()}`, sender_role: "member", body: message, created_at: new Date().toISOString(), pending: true };
    setPending((p) => [...p, temp]);
    setBody("");
    setBusy(true);
    try {
      await send({ data: { body: message } });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      setBody(message);
      toast.error(e?.message ?? "Your message didn't send. Try again.");
    } finally {
      setPending((p) => p.filter((m) => m.id !== temp.id));
      setBusy(false);
    }
  };

  const talkToPerson = async () => {
    if (previewing) { toast(PREVIEW_ONLY_MESSAGE); return; }
    if (teamHasIt) { toast("The JF Effect team has this chat. They'll reply right here."); return; }
    setAsking(true);
    try {
      await askPerson();
      await qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't go through. Try again.");
    } finally {
      setAsking(false);
    }
  };

  const seen = supportSeenLine(saved);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-support-conversation>
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-3 py-2.5 md:px-4">
        {onBack && (
          <Button type="button" variant="ghost" size="icon" className="-mr-1 h-10 w-10 shrink-0 md:hidden" onClick={onBack} aria-label="All chats">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold leading-5">{SUPPORT_CHAT_NAME}</h1>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground" data-support-who>
            {teamHasIt ? "The JF Effect team · usually replies within a day" : "Cleo answers first · the team replies within a day"}
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4">
        {isLoading ? (
          <div className="grid h-24 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="grid h-full min-h-48 place-items-center px-8 text-center" data-support-empty>
            <div>
              <img src="/icon-192.png" alt="" className="mx-auto mb-3 h-16 w-16 rounded-full border border-border object-cover" />
              <div className="text-[16px] font-semibold">How can we help?</div>
              <p className="mt-1 text-[15px] leading-5 text-muted-foreground">
                Ask anything about the app or your account. Cleo, JF Effect's assistant, answers first;
                the team takes anything Cleo can't. Found a bug? Tell us what happened.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((m, i) => {
              const mine = m.sender_role === "member";
              const cleo = m.sender_role === "cleo";
              const next = messages[i + 1];
              const lastOfRun = !next || (next.sender_role === "member") !== mine
                || new Date(next.created_at).getTime() - new Date(m.created_at).getTime() > 10 * 60_000;
              return (
                <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")} data-support-message={mine ? "mine" : "theirs"}>
                  <div className={cn("max-w-[80%]", lastOfRun && "mb-2")}>
                    <div
                      className={cn(
                        "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[15px] leading-5",
                        mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground",
                        cleo && "border border-border bg-background",
                        m.pending && "opacity-60",
                      )}
                      data-support-sender={m.sender_role}
                    >
                      {mine ? m.body : <SupportBody body={m.body} />}
                    </div>
                    {lastOfRun && (
                      <div className={cn("mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground", mine && "justify-end")}>
                        {cleo && <Sparkles className="h-3 w-3" aria-hidden />}
                        {m.pending ? "Sending…" : `${mine ? "" : cleo ? `${CLEO_SUPPORT_LABEL} · ` : "JF Effect · "}${timeLabel(m.created_at)}`}
                        {!m.pending && seen && seen.id === m.id ? " · Seen" : ""}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {busy && cleoFirst && !previewing && (
          <div className="mt-1 flex items-center gap-1.5 px-1 text-[13px] text-muted-foreground" data-support-cleo-typing>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Cleo is typing…
          </div>
        )}
        <div ref={endRef} />
      </main>

      <footer
        className="shrink-0 border-t border-border bg-background px-3 pt-2 sm:px-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        {/* Always there: a person, and the help hub (never a button on every screen). */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => void talkToPerson()}
            disabled={asking}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-semibold disabled:opacity-50"
            data-support-talk-to-person
          >
            {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
            Talk to a person
          </button>
          <Link
            to="/portal/account"
            hash="help"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-semibold"
            data-support-help-hub
          >
            <LifeBuoy className="h-3.5 w-3.5" /> Help & Tutorials
          </Link>
        </div>
        <div className="flex items-end gap-2">
          <AutoGrowTextarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !phoneLayoutNow()) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Message support…"
            aria-label="Message support"
            className="max-h-36 min-h-11 flex-1 resize-none rounded-[22px] border border-border bg-background px-4 py-[11px] text-base leading-5"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !body.trim()}
            aria-label="Send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </footer>
    </div>
  );
}
