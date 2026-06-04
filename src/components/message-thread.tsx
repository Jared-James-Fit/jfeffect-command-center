import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  listMessages, sendMessage, markRead, setConversationStatus, setConversationPriority,
  detectAttachmentType, MESSAGE_TYPES, PRIORITIES, QUICK_REPLIES, priorityTone,
  type Message, type MessageAttachment, type SenderRole, type ConversationState,
} from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Paperclip, Send, X, FileText, Image as ImageIcon, Video, Link as LinkIcon, ExternalLink } from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";

function attachIcon(t: MessageAttachment["type"]) {
  if (t === "image") return ImageIcon;
  if (t === "video") return Video;
  if (t === "pdf") return FileText;
  return LinkIcon;
}

function fmtTime(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

export function MessageThread({
  clientId,
  role,
  conversationState,
  hideControls = false,
}: {
  clientId: string;
  role: SenderRole;
  conversationState?: ConversationState | null;
  hideControls?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachUrl, setAttachUrl] = useState("");
  const [messageType, setMessageType] = useState("General");
  const [internalNote, setInternalNote] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", clientId, role],
    enabled: !!clientId,
    queryFn: () => listMessages(clientId, { includeInternal: role === "admin" }),
  });

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

  const addAttachment = () => {
    const url = attachUrl.trim();
    if (!url) return;
    try { new URL(url); } catch { return toast.error("Enter a valid URL"); }
    setAttachments((a) => [...a, { type: detectAttachmentType(url), url }]);
    setAttachUrl("");
  };

  const onSend = async () => {
    if (!user) return;
    if (!body.trim() && attachments.length === 0) return;
    try {
      await sendMessage({
        clientId,
        senderId: user.id,
        senderRole: role,
        body: body.trim(),
        attachments,
        messageType,
        isInternalNote: role === "admin" ? internalNote : false,
      });
      setBody("");
      setAttachments([]);
      setInternalNote(false);
      qc.invalidateQueries({ queryKey: ["messages", clientId, role] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    }
  };

  return (
    <div className="flex h-[600px] flex-col rounded-md border border-border bg-card">
      {role === "admin" && !hideControls && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Status:</span>
          <Select
            value={conversationState?.status ?? "open"}
            onValueChange={(v) => setConversationStatus(clientId, v as any).then(() => qc.invalidateQueries({ queryKey: ["conversation-states"] }))}
          >
            <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="needs_response">Needs Response</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-3 text-muted-foreground">Priority:</span>
          <Select
            value={conversationState?.priority ?? "Normal"}
            onValueChange={(v) => setConversationPriority(clientId, v).then(() => qc.invalidateQueries({ queryKey: ["conversation-states"] }))}
          >
            <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {visibleMessages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            {role === "client" ? "Send your coach a message to start the conversation." : "No messages yet."}
          </div>
        ) : visibleMessages.map((m) => {
          const mine = m.sender_role === role;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                m.is_internal_note
                  ? "border border-warning/40 bg-warning/10"
                  : mine
                  ? "bg-gradient-primary text-primary-foreground"
                  : "bg-secondary text-foreground",
              )}>
                {m.is_internal_note && (
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-warning">Internal Coach Note</div>
                )}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                {m.attachments?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {m.attachments.map((a, i) => {
                      const Icon = attachIcon(a.type);
                      return (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" className={cn(
                          "flex items-center gap-1.5 text-xs underline opacity-90 hover:opacity-100",
                        )}>
                          <Icon className="h-3 w-3" />
                          <span className="truncate">{a.name ?? a.url}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      );
                    })}
                  </div>
                )}
                <div className={cn("mt-1 flex items-center gap-2 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  <span>{fmtTime(m.created_at)}</span>
                  {m.message_type !== "General" && <span>· {m.message_type}</span>}
                  {m.priority && <span>· {m.priority}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        {role === "admin" && (
          <div className="flex flex-wrap gap-1">
            {QUICK_REPLIES.map((q) => (
              <Button key={q} type="button" variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => setBody((b) => b ? `${b}\n${q}` : q)}>
                {q}
              </Button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <Badge key={i} variant="outline" className="gap-1">
                <LinkIcon className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{a.url}</span>
                <button onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder="Paste link or attachment URL…"
            value={attachUrl}
            onChange={(e) => setAttachUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttachment(); } }}
            className="h-8 text-xs"
          />
          <Button type="button" variant="outline" size="sm" onClick={addAttachment}><Paperclip className="h-3 w-3" /></Button>
        </div>

        <div className="flex gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={role === "client" ? "Message Coach Jared…" : "Reply to client…"}
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend(); }
            }}
          />
          <Button onClick={onSend} className="bg-gradient-primary font-bold self-end"><Send className="mr-2 h-3 w-3" />Send</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select value={messageType} onValueChange={setMessageType}>
            <SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MESSAGE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {role === "admin" && (
            <div className="ml-auto flex items-center gap-2">
              <Switch id="internal" checked={internalNote} onCheckedChange={setInternalNote} />
              <Label htmlFor="internal" className="cursor-pointer text-xs">Internal note (admin-only)</Label>
            </div>
          )}
        </div>
      </div>
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