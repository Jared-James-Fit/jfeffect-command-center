import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listSupportThreads, getSupportThread, replySupportMessage, setSupportThreadStatus,
} from "@/lib/member-support.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Bug, Lightbulb, HelpCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/membership/support")({ component: SupportInbox });

const CAT: Record<string, { icon: any; tone: string; label: string }> = {
  question: { icon: HelpCircle, tone: "bg-blue-500/15 text-blue-300 border-blue-500/30", label: "Question" },
  bug: { icon: Bug, tone: "bg-rose-500/15 text-rose-300 border-rose-500/30", label: "Bug" },
  suggestion: { icon: Lightbulb, tone: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Suggestion" },
  reply: { icon: HelpCircle, tone: "bg-secondary text-foreground border-border", label: "Reply" },
};

function SupportInbox() {
  const qc = useQueryClient();
  const list = useServerFn(listSupportThreads);
  const get = useServerFn(getSupportThread);
  const reply = useServerFn(replySupportMessage);
  const setStatus = useServerFn(setSupportThreadStatus);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: threads = { threads: [] } } = useQuery({
    queryKey: ["admin-support-threads", statusFilter],
    queryFn: () => list({ data: statusFilter ? { status: statusFilter } : undefined }),
    refetchInterval: 15_000,
  });
  const { data: detail } = useQuery({
    queryKey: ["admin-support-thread", selected],
    queryFn: () => get({ data: { threadId: selected! } }),
    enabled: !!selected,
  });

  useEffect(() => {
    const ch = supabase
      .channel("admin-msm")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "member_support_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-support-threads"] });
        if (selected) qc.invalidateQueries({ queryKey: ["admin-support-thread", selected] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, selected]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages?.length]);

  const submit = async () => {
    if (!body.trim() || !selected || busy) return;
    setBusy(true);
    try {
      await reply({ data: { threadId: selected, body: body.trim() } });
      setBody("");
      await qc.invalidateQueries({ queryKey: ["admin-support-thread", selected] });
      await qc.invalidateQueries({ queryKey: ["admin-support-threads"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Reply failed");
    } finally { setBusy(false); }
  };

  const changeStatus = async (s: "open" | "answered" | "closed") => {
    if (!selected) return;
    try {
      await setStatus({ data: { threadId: selected, status: s } });
      await qc.invalidateQueries({ queryKey: ["admin-support-thread", selected] });
      await qc.invalidateQueries({ queryKey: ["admin-support-threads"] });
      toast.success(`Marked ${s}`);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Member Support Inbox" subtitle="Questions, bug reports, and suggestions from JF members." />
      <div className="grid gap-3 md:grid-cols-[320px,1fr]">
        <Card className="flex h-[calc(100dvh-12rem)] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b p-2">
            <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="answered">Answered</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {(threads.threads as any[]).length === 0 && (
              <div className="p-4 text-xs text-muted-foreground">No threads.</div>
            )}
            {(threads.threads as any[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={cn(
                  "block w-full border-b px-3 py-2 text-left hover:bg-muted/40",
                  selected === t.id && "bg-muted/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold">{t.member?.full_name ?? t.member?.email ?? "Member"}</div>
                  {t.unread_for_team > 0 && (
                    <Badge variant="default" className="h-5 px-1.5 text-[10px]">{t.unread_for_team}</Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="h-4 px-1 text-[10px] capitalize">{t.status}</Badge>
                  <span className="truncate">{t.last_member_message_at ? new Date(t.last_member_message_at).toLocaleString() : "—"}</span>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex h-[calc(100dvh-12rem)] flex-col overflow-hidden">
          {!selected ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Select a thread.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <div>
                  <div className="font-semibold">{detail?.thread?.member?.full_name ?? detail?.thread?.member?.email}</div>
                  <div className="text-xs text-muted-foreground">{detail?.thread?.member?.email} · {detail?.thread?.member?.phone ?? "no phone"}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => changeStatus("answered")}>Mark answered</Button>
                  <Button size="sm" variant="outline" onClick={() => changeStatus("closed")}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Close
                  </Button>
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {(detail?.messages ?? []).map((m: any) => {
                  const isMember = m.sender_role === "member";
                  const meta = CAT[m.category] ?? CAT.reply;
                  const Icon = meta.icon;
                  return (
                    <div key={m.id} className={cn("flex", isMember ? "justify-start" : "justify-end")}>
                      <div className="max-w-[80%] space-y-1">
                        {isMember && m.category !== "reply" && (
                          <Badge variant="outline" className={cn("gap-1 text-[10px]", meta.tone)}>
                            <Icon className="h-3 w-3" /> {meta.label}
                          </Badge>
                        )}
                        <div className={cn(
                          "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                          isMember ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground",
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
              <div className="border-t p-2">
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={2}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
                    }}
                    placeholder="Reply as Jared's team… (Cmd/Ctrl+Enter)"
                    className="min-h-[44px] resize-none"
                  />
                  <Button onClick={submit} disabled={busy || !body.trim()} className="h-11">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}