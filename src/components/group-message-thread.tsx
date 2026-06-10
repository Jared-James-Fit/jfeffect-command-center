import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  type GroupAttachment, type GroupMessage, type GroupReaction,
  listGroupMessages, listGroupReactions, listGroupMembers,
  sendGroupMessage, editGroupMessage, deleteGroupMessageForEveryone,
  toggleGroupReaction, markGroupRead, uploadGroupAttachment, signedAttachmentUrl,
  GROUP_REACTION_EMOJIS, listGroupMemberProfiles,
} from "@/lib/group-chats";
import { useGroupPresence } from "@/hooks/use-group-presence";
import {
  Paperclip, Send, Loader2, MoreHorizontal, Pencil, Trash2, Check, X,
  Image as ImageIcon, FileText, Video as VideoIcon, Download, File as FileIcon,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";

function fmtTime(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

function useSigned(path?: string) {
  const q = useQuery({
    queryKey: ["group-attach", path],
    enabled: !!path,
    staleTime: 1000 * 60 * 50,
    queryFn: () => signedAttachmentUrl(path!),
  });
  return q.data;
}

function Attachment({ att }: { att: GroupAttachment }) {
  const signed = useSigned(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  if (!src) return <div className="text-[11px] opacity-70">Loading…</div>;
  if (att.type === "image") {
    return <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={att.name ?? ""} className="max-h-72 max-w-[260px] rounded-md object-cover" /></a>;
  }
  if (att.type === "video") {
    return <video src={src} controls playsInline className="max-h-72 w-full max-w-[260px] rounded-md bg-black" />;
  }
  const Icon = att.type === "pdf" ? FileText : att.type === "audio" ? VideoIcon : FileIcon;
  return (
    <a href={src} target="_blank" rel="noreferrer" download={att.name}
      className="flex max-w-[280px] items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs hover:bg-foreground/5">
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 truncate font-medium">{att.name ?? "File"}</div>
      <Download className="h-3 w-3 shrink-0 opacity-70" />
    </a>
  );
}

export function GroupMessageThread({
  groupId, canPost, canManage, groupName,
}: {
  groupId: string;
  canPost: boolean;
  canManage: boolean;
  groupName: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["group-messages", groupId],
    queryFn: () => listGroupMessages(groupId),
    refetchInterval: 30_000,
  });

  const { data: reactions = [] } = useQuery({
    queryKey: ["group-reactions", groupId],
    queryFn: () => listGroupReactions(groupId),
    refetchInterval: 45_000,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["group-members", groupId],
    queryFn: () => listGroupMembers(groupId),
  });

  const { data: memberProfiles = [] } = useQuery({
    queryKey: ["group-member-profiles", groupId],
    queryFn: () => listGroupMemberProfiles(groupId),
    staleTime: 5 * 60_000,
  });

  const { role: authRole } = useAuth();
  const myPresenceRole: "admin" | "coach" | "client" | "member" =
    authRole === "admin" ? "admin" : authRole === "coach" ? "coach" : "client";
  const { others: livePeers } = useGroupPresence(groupId, myPresenceRole);
  const liveUserIds = useMemo(() => new Set(livePeers.map((p) => p.user_id)), [livePeers]);

  // realtime
  useEffect(() => {
    const ch = supabase
      .channel(`group-thread:${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` }, () => {
        qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
        qc.invalidateQueries({ queryKey: ["group-unread"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_message_reactions" }, () => {
        qc.invalidateQueries({ queryKey: ["group-reactions", groupId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [groupId, qc]);

  // mark read
  useEffect(() => {
    if (!user || messages.length === 0) return;
    markGroupRead(groupId, user.id).then(() => {
      qc.invalidateQueries({ queryKey: ["group-unread"] });
      qc.invalidateQueries({ queryKey: ["group-memberships"] });
    });
  }, [groupId, user?.id, messages.length, qc]);

  // autoscroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const memberById = useMemo(() => {
    const m = new Map(members.map((mb) => [mb.user_id, mb]));
    return m;
  }, [members]);

  const profileById = useMemo(() => {
    const m = new Map<string, { full_name: string | null; avatar_url: string | null; role: string }>();
    for (const p of memberProfiles) m.set(p.user_id, { full_name: p.full_name, avatar_url: p.avatar_url, role: p.role });
    return m;
  }, [memberProfiles]);

  const reactionsByMsg = useMemo(() => {
    const m = new Map<string, GroupReaction[]>();
    for (const r of reactions) {
      const arr = m.get(r.message_id) ?? [];
      arr.push(r);
      m.set(r.message_id, arr);
    }
    return m;
  }, [reactions]);

  const myReactions = useMemo(
    () => reactions.filter((r) => r.user_id === user?.id),
    [reactions, user?.id],
  );

  const doSend = async () => {
    if (!user) return;
    const text = body.trim();
    if (!text && files.length === 0) return;
    setSending(true);
    try {
      const attachments: GroupAttachment[] = [];
      for (const f of files) attachments.push(await uploadGroupAttachment(groupId, f));
      await sendGroupMessage({
        groupId,
        senderId: user.id,
        senderRole: canManage ? "admin" : "member",
        body: text,
        attachments,
      });
      setBody(""); setFiles([]);
      qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const startEdit = (m: GroupMessage) => { setEditingId(m.id); setEditText(m.body); };
  const cancelEdit = () => { setEditingId(null); setEditText(""); };
  const saveEdit = async () => {
    if (!editingId) return;
    await editGroupMessage(editingId, editText.trim());
    setEditingId(null); setEditText("");
    qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await deleteGroupMessageForEveryone(deleteId);
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
  };

  const handleReact = async (mid: string, emoji: string) => {
    if (!user) return;
    await toggleGroupReaction(mid, user.id, emoji, myReactions);
    qc.invalidateQueries({ queryKey: ["group-reactions", groupId] });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-3 py-4 md:px-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No messages yet — say hi 👋
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const mine = m.sender_id === user?.id;
              const mem = m.sender_id ? memberById.get(m.sender_id) : undefined;
              const isManagerSender = mem?.role === "admin" || m.sender_role === "admin" || m.sender_role === "coach";
              const msgReacts = reactionsByMsg.get(m.id) ?? [];
              const byEmoji = new Map<string, number>();
              for (const r of msgReacts) byEmoji.set(r.emoji, (byEmoji.get(r.emoji) ?? 0) + 1);
              const editing = editingId === m.id;
              const isDeleted = !!m.deleted_at;
              const canEditThis = mine && !isDeleted;
              const canDeleteThis = (mine || canManage) && !isDeleted;

              return (
                <li key={m.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
                  {!mine && (
                    <div className="relative shrink-0">
                      <UserAvatar
                        size={32}
                        name={profileById.get(m.sender_id ?? "")?.full_name ?? (isManagerSender ? "Coach" : "Member")}
                        src={profileById.get(m.sender_id ?? "")?.avatar_url ?? null}
                        ring
                      />
                      {m.sender_id && liveUserIds.has(m.sender_id) && (
                        <span
                          aria-label="Active now"
                          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
                        />
                      )}
                    </div>
                  )}
                  <div className={cn("group max-w-[78%] min-w-0", mine && "items-end")}>
                    {!mine && (
                      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="font-semibold">
                          {profileById.get(m.sender_id ?? "")?.full_name
                            ?? (isManagerSender ? "Coach" : "Member")}
                          {isManagerSender && (
                            <span className="ml-1 rounded bg-primary/10 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                              Coach
                            </span>
                          )}
                        </span>
                        <span>· {fmtTime(m.created_at)}</span>
                      </div>
                    )}
                    <div
                      className={cn(
                        "relative rounded-2xl px-3 py-2 text-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-secondary",
                        isDeleted && "italic opacity-60",
                      )}
                    >
                      {isDeleted ? (
                        <span>Message deleted</span>
                      ) : editing ? (
                        <div className="flex flex-col gap-2">
                          <Textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={2}
                            className="bg-background text-foreground"
                          />
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="h-3 w-3" /></Button>
                            <Button size="sm" onClick={saveEdit}><Check className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                          {m.attachments && m.attachments.length > 0 && (
                            <div className={cn("mt-1.5 flex flex-col gap-1.5", m.body && "border-t border-current/10 pt-1.5")}>
                              {m.attachments.map((a, i) => <Attachment key={i} att={a} />)}
                            </div>
                          )}
                          {m.edited_at && (
                            <div className="mt-0.5 text-[10px] opacity-70">edited</div>
                          )}
                        </>
                      )}

                      {/* Action menu */}
                      {!isDeleted && !editing && (canEditThis || canDeleteThis) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className={cn(
                                "absolute -top-2 opacity-0 transition group-hover:opacity-100 focus:opacity-100",
                                mine ? "-left-7" : "-right-7",
                                "rounded-full bg-card p-1 shadow ring-1 ring-border",
                              )}
                              aria-label="Message actions"
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align={mine ? "start" : "end"}>
                            {canEditThis && (
                              <DropdownMenuItem onClick={() => startEdit(m)}>
                                <Pencil className="mr-2 h-3 w-3" /> Edit
                              </DropdownMenuItem>
                            )}
                            {canDeleteThis && (
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(m.id)}>
                                <Trash2 className="mr-2 h-3 w-3" /> Delete for everyone
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {/* Reactions row */}
                    {!isDeleted && (
                      <div className={cn("mt-1 flex flex-wrap items-center gap-1", mine ? "justify-end" : "justify-start")}>
                        {[...byEmoji.entries()].map(([emoji, count]) => {
                          const mineReact = msgReacts.some((r) => r.user_id === user?.id && r.emoji === emoji);
                          return (
                            <button
                              key={emoji}
                              onClick={() => handleReact(m.id, emoji)}
                              className={cn(
                                "rounded-full border px-1.5 py-0.5 text-[10px]",
                                mineReact ? "border-primary bg-primary/10" : "border-border bg-secondary/40",
                              )}
                            >
                              {emoji} {count}
                            </button>
                          );
                        })}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="opacity-0 group-hover:opacity-100 transition rounded-full border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px]">
                              +
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="flex">
                            {GROUP_REACTION_EMOJIS.map((e) => (
                              <button
                                key={e}
                                onClick={() => handleReact(m.id, e)}
                                className="rounded p-1 text-lg hover:bg-accent"
                              >
                                {e}
                              </button>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}

                    {mine && (
                      <div className="mt-0.5 text-right text-[10px] text-muted-foreground">
                        {fmtTime(m.created_at)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      {canPost ? (
        <div
          className="border-t border-border bg-card px-3 py-2 md:px-4"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
        >
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {files.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  <ImageIcon className="mr-1 h-3 w-3" />
                  {f.name}
                  <button className="ml-1" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])])}
            />
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              ref={taRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Message ${groupName}…`}
              rows={1}
              className="min-h-[36px] resize-none text-base sm:text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSend(); }
              }}
            />
            <Button onClick={doSend} disabled={sending || (!body.trim() && files.length === 0)} size="icon" className="h-9 w-9 shrink-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border bg-secondary/30 px-4 py-3 text-center text-xs text-muted-foreground">
          Only the coach can post in this group.
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              This message will be removed for everyone in the group. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}