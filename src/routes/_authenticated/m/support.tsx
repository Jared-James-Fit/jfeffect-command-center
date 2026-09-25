import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMySupportThread, sendSupportMessage, markMyThreadRead, getLiveSupportStatus } from "@/lib/member-support.functions";
import { formatTicket } from "@/lib/support-ticket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Bug, Lightbulb, HelpCircle, Headphones, Radio, Ticket } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/m/support")({ component: SupportPage });

type Category = "question" | "bug" | "suggestion";

const CAT_META: Record<Category, { label: string; icon: any; tone: string }> = {
  question: { label: "Question", icon: HelpCircle, tone: "border-blue-500/30 bg-blue-500/10 text-blue-500" },
  bug: { label: "Bug", icon: Bug, tone: "border-rose-500/30 bg-rose-500/10 text-rose-500" },
  suggestion: { label: "Suggestion", icon: Lightbulb, tone: "border-amber-500/30 bg-amber-500/10 text-amber-500" },
};

function SupportPage() {
  const qc = useQueryClient();
  const fetchThread = useServerFn(getMySupportThread);
  const send = useServerFn(sendSupportMessage);
  const markRead = useServerFn(markMyThreadRead);
  const liveStatusFn = useServerFn(getLiveSupportStatus);

  const { data } = useQuery({ queryKey: ["m-support"], queryFn: () => fetchThread() });
  const messages = (data?.messages ?? []) as any[];
  const thread = data?.thread as any;
  const { data: liveStatus } = useQuery({
    queryKey: ["live-support-status"],
    queryFn: () => liveStatusFn(),
    refetchInterval: 30_000,
  });
  const liveCount = liveStatus?.availableCount ?? 0;

  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("question");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto" });
    markRead().catch(() => {});
  }, [messages.length]);

  useEffect(() => {
    if (!thread?.id) return;
    const ch = supabase
      .channel(`m-support-${thread.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "member_support_messages", filter: `thread_id=eq.${thread.id}` },
        () => qc.invalidateQueries({ queryKey: ["m-support"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [thread?.id, qc]);

  const submit = async () => {
    const message = body.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      await send({ data: { body: message, category } });
      setBody("");
      await qc.invalidateQueries({ queryKey: ["m-support"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-4.25rem)] w-full max-w-3xl flex-col overflow-hidden border-x border-border/50 bg-background md:my-4 md:h-[calc(100dvh-6rem)] md:rounded-2xl md:border">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Headphones className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-black">JF Effect Support</h1>
            {thread?.status && (
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px] capitalize">
                {thread.status}
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>App, account and billing help</span>
            <span>·</span>
            <span className={cn("inline-flex items-center gap-1", liveCount > 0 && "text-emerald-500")}>
              <Radio className={cn("h-2.5 w-2.5", liveCount > 0 && "animate-pulse")} />
              {liveCount > 0 ? "Team online" : "Usually replies within 24–48h"}
            </span>
          </div>
        </div>
        {thread?.ticket_number != null && (
          <Badge variant="outline" className="shrink-0 gap-1 font-mono text-[10px]">
            <Ticket className="h-3 w-3" />
            {formatTicket(thread.ticket_number)}
          </Badge>
        )}
      </header>

      <div className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
        Support is for app, billing, account issues and suggestions. Coaching questions belong in your coaching messages.
      </div>

      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
        {messages.length === 0 && (
          <div className="grid h-full min-h-48 place-items-center px-6 text-center">
            <div>
              <Headphones className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
              <div className="text-sm font-semibold">How can we help?</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Send a message below. Your conversation stays together here just like Messages.
              </div>
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isMember = m.sender_role === "member";
          const cat = (m.category as Category) || "question";
          const Meta = CAT_META[cat] ?? CAT_META.question;
          const Icon = Meta.icon;
          return (
            <div key={m.id} className={cn("flex", isMember ? "justify-end" : "justify-start")}>
              <div className="max-w-[86%] space-y-1 sm:max-w-[75%]">
                {!isMember && (
                  <div className="px-1 text-[10px] font-semibold text-muted-foreground">JF Effect Support</div>
                )}
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap shadow-sm",
                    isMember
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md border border-border bg-card text-foreground",
                  )}
                >
                  {m.body}
                </div>
                <div className={cn("flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground", isMember && "justify-end")}>
                  {isMember && m.category !== "reply" && (
                    <span className="inline-flex items-center gap-1">
                      <Icon className="h-2.5 w-2.5" />
                      {Meta.label}
                    </span>
                  )}
                  <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </main>

      <footer
        className="shrink-0 border-t border-border bg-card/95 px-3 pt-2 backdrop-blur sm:px-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {(Object.entries(CAT_META) as Array<[Category, (typeof CAT_META)[Category]]>).map(([key, meta]) => {
            const Icon = meta.icon;
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition",
                  active ? meta.tone : "border-border bg-background text-muted-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            rows={1}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Message support…"
            className="max-h-28 min-h-11 resize-none rounded-2xl bg-background"
          />
          <Button
            onClick={() => void submit()}
            disabled={busy || !body.trim()}
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            aria-label="Send support message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
