import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMySupportThread, sendSupportMessage, markMyThreadRead } from "@/lib/member-support.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Info, Clock, Bug, Lightbulb, HelpCircle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/m/support")({ component: SupportPage });

type Category = "question" | "bug" | "suggestion";

const CAT_META: Record<Category, { label: string; icon: any; tone: string }> = {
  question: { label: "Question", icon: HelpCircle, tone: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  bug: { label: "Bug report", icon: Bug, tone: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  suggestion: { label: "Suggestion", icon: Lightbulb, tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

function SupportPage() {
  const qc = useQueryClient();
  const fetchThread = useServerFn(getMySupportThread);
  const send = useServerFn(sendSupportMessage);
  const markRead = useServerFn(markMyThreadRead);

  const { data } = useQuery({ queryKey: ["m-support"], queryFn: () => fetchThread() });
  const messages = (data?.messages ?? []) as any[];
  const thread = data?.thread as any;

  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("question");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    markRead().catch(() => {});
  }, [messages.length]);

  // Realtime
  useEffect(() => {
    if (!thread?.id) return;
    const ch = supabase
      .channel(`m-support-${thread.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "member_support_messages", filter: `thread_id=eq.${thread.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["m-support"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [thread?.id, qc]);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await send({ data: { body: body.trim(), category } });
      setBody("");
      await qc.invalidateQueries({ queryKey: ["m-support"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] max-w-3xl flex-col gap-3 px-3 py-4 md:px-6">
      <PageHeader
        title="Support"
        subtitle="Jared's team is here to help with the app, billing, and reports."
      />

      <Card className="border-primary/30 bg-primary/5 p-3 text-xs">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <div className="font-semibold text-foreground">This is a support channel — not coaching.</div>
            <p className="text-muted-foreground">
              Use this to ask questions about the app, report bugs, or share suggestions. Our team monitors it but it is not 1:1 coaching.
            </p>
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3" />
              Typical response: <span className="font-medium text-foreground">within 24–48 hours</span> (longer on weekends).
            </p>
          </div>
        </div>
      </Card>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold">Conversation with Jared's team</span>
          </div>
          {thread?.status && (
            <Badge variant="outline" className="capitalize">{thread.status}</Badge>
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 && (
            <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
              Send your first message — questions, bug reports, or suggestions all welcome.
            </div>
          )}
          {messages.map((m) => {
            const isMember = m.sender_role === "member";
            const cat = (m.category as Category) || "question";
            const Meta = CAT_META[cat] ?? CAT_META.question;
            const Icon = Meta.icon;
            return (
              <div key={m.id} className={cn("flex", isMember ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] space-y-1")}>
                  {isMember && m.category !== "reply" && (
                    <Badge variant="outline" className={cn("gap-1 text-[10px]", Meta.tone)}>
                      <Icon className="h-3 w-3" /> {Meta.label}
                    </Badge>
                  )}
                  {!isMember && (
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Jared's team</div>
                  )}
                  <div className={cn(
                    "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    isMember
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground",
                  )}>
                    {m.body}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="border-t p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Tag this message:</span>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="question">Question</SelectItem>
                <SelectItem value="bug">Bug report</SelectItem>
                <SelectItem value="suggestion">Suggestion</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
              }}
              placeholder="Type your message… (Cmd/Ctrl+Enter to send)"
              className="min-h-[44px] resize-none"
            />
            <Button onClick={submit} disabled={busy || !body.trim()} className="h-11">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}