import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getMemberSupport, getMySupportThread, markMyThreadRead, sendSupportMessage } from "@/lib/member-support.functions";
import { useClientImpersonation, useViewingAsClient } from "@/lib/client-impersonation";
import { PREVIEW_ONLY_MESSAGE } from "@/lib/community";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { cn } from "@/lib/utils";
import { listenChannel } from "@/lib/realtime-channel";
import { phoneLayoutNow } from "@/lib/portrait-only";

export const Route = createFileRoute("/_authenticated/portal/support")({ component: SupportPage });

type Msg = { id: string; sender_role: string; body: string; created_at: string; pending?: boolean };

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * A JF member's chat with JF Effect (members have no coach chat). It reads
 * like Messages: theirs on the right, ours on the left, one box to write in.
 * The coach answers from Messages, where this chat is a row like any other;
 * each side gets a push when the other writes.
 */
function SupportPage() {
  const qc = useQueryClient();
  const previewing = useViewingAsClient();
  const { client: povClient } = useClientImpersonation();
  const fetchMine = useServerFn(getMySupportThread);
  const fetchAsCoach = useServerFn(getMemberSupport);
  const send = useServerFn(sendSupportMessage);
  const markRead = useServerFn(markMyThreadRead);

  const key = ["m-support", previewing ? povClient?.id : "me"];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      // A coach previewing a member sees their chat as it is, read-only.
      if (previewing && povClient?.id) {
        const r = await fetchAsCoach({ data: { clientId: povClient.id } });
        return { thread: r.thread, messages: r.messages };
      }
      return fetchMine();
    },
  });
  const thread = data?.thread as { id: string; unread_for_member?: number } | null | undefined;
  const [pending, setPending] = useState<Msg[]>([]);
  const messages: Msg[] = [...((data?.messages ?? []) as Msg[]), ...pending];

  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Reading it clears the Support tab's badge (never while a coach previews).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto", block: "end" });
    if (previewing || !thread?.id || !(thread.unread_for_member ?? 0)) return;
    markRead().then(() => qc.invalidateQueries({ queryKey: ["client-nav-badges"] })).catch(() => {});
  }, [messages.length, thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!thread?.id) return;
    const ch = listenChannel(`m-support-${thread.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "member_support_messages", filter: `thread_id=eq.${thread.id}` },
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
    const temp: Msg = { id: `pending-${Date.now()}`, sender_role: "member", body: message, created_at: new Date().toISOString(), pending: true };
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

  return (
    <div
      className="phone-column fixed inset-x-0 z-30 flex flex-col bg-background md:static md:inset-auto md:z-auto md:mx-auto md:h-full md:w-full md:max-w-3xl md:flex-1 md:border-x md:border-border"
      style={{
        // Like the coach chat: anchored to the visible part of the screen,
        // so the box sits right above the keyboard, under the top bar.
        top: "calc(var(--vv-top, 0px) + var(--app-top-chrome, 0px))",
        height: "calc(var(--vv-h, 100dvh) - var(--app-top-chrome, 0px) - var(--bottom-nav-clearance, 0px))",
      }}
      data-member-support
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2.5">
        <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold leading-5">JF Effect Support</h1>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">Usually replies within a day</p>
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
                Ask anything about the app, your account or your training. Found a bug? Tell us what happened.
                You'll get a notification when we reply.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((m, i) => {
              const mine = m.sender_role === "member";
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
                        m.pending && "opacity-60",
                      )}
                    >
                      {m.body}
                    </div>
                    {lastOfRun && (
                      <div className={cn("mt-0.5 px-1 text-[11px] text-muted-foreground", mine && "text-right")}>
                        {m.pending ? "Sending…" : `${mine ? "" : "JF Effect · "}${timeLabel(m.created_at)}`}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </main>

      <footer
        className="shrink-0 border-t border-border bg-background px-3 pt-2 sm:px-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
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
