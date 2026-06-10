import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  type GroupAttachment, type GroupMessage, type GroupReaction,
  listGroupMessages, listGroupReactions, listGroupMembers,
  sendGroupMessage, editGroupMessage, deleteGroupMessageForEveryone,
  toggleGroupReaction, markGroupRead, listGroupMemberProfiles,
  GROUP_REACTION_EMOJIS,
} from "@/lib/group-chats";
import { useGroupPresence } from "@/hooks/use-group-presence";
import { getChatSettings, DEFAULT_REACTION } from "@/lib/chat-settings";
import { GifPicker } from "@/components/gif-picker";
import { markRecent } from "@/lib/chat-gifs";
import { markRecent as markSoundRecent } from "@/lib/chat-sounds";
import { fallbackEmoji } from "@/lib/gif-fallback";
import {
  AttachmentView, LiveWaveform, WaveformBars, useVoiceRecorder,
  attachIcon, fakePeaks, fmtDuration, fmtTime,
  uploadAttachmentToPath, LINK_RE, renderBodyWithMeet, type SharedAttachment,
} from "@/components/chat-shared";
import { MeetQuickAction } from "@/components/meet-quick-action";
import {
  Paperclip, Send, X, Image as ImageIcon, Camera, File as FileIcon,
  Mic, Trash2, Play, Pause, Square, Loader2, MoreHorizontal, Pencil, Check,
  CheckCircle2, Circle, CheckSquare, Copy,
} from "lucide-react";
import { toast } from "sonner";

async function uploadGroupFile(groupId: string, file: File): Promise<GroupAttachment> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const path = `group/${groupId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? "." + ext : ""}`;
  const att = await uploadAttachmentToPath(path, file);
  return att as GroupAttachment;
}

export function GroupMessageThread({
  groupId, canPost, canManage, groupName,
}: {
  groupId: string;
  canPost: boolean;
  canManage: boolean;
  groupName: string;
}) {
  const { user, role: authRole } = useAuth();
  const qc = useQueryClient();

  // Composer state
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<GroupAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useVoiceRecorder();
  const [preview, setPreview] = useState<{ blob: Blob; url: string; duration: number; peaks: number[] } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  // Editing / actions
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [actionsForId, setActionsForId] = useState<string | null>(null);
  const [sheetForId, setSheetForId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);

  // Long-press + swipe gesture
  const longPressRef = useRef<{ id: string; t: any; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [swipeX, setSwipeX] = useState(0);
  const swipeRef = useRef<{ x: number; y: number; decided: boolean; horizontal: boolean } | null>(null);

  // Pointer-events safety net (Radix Sheet quirk)
  useEffect(() => {
    if (sheetForId || actionsForId) return;
    const t = window.setTimeout(() => {
      try {
        if (document.body.style.pointerEvents === "none") document.body.style.pointerEvents = "";
        document.body.style.removeProperty("overflow");
        document.body.removeAttribute("data-scroll-locked");
      } catch {}
    }, 350);
    return () => window.clearTimeout(t);
  }, [sheetForId, actionsForId]);

  /* ---------------- Data ---------------- */

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

  const { data: chatSettings } = useQuery({
    queryKey: ["chat-settings"],
    queryFn: getChatSettings,
    staleTime: 60_000,
  });
  const defaultReaction = chatSettings?.defaultReaction || DEFAULT_REACTION;
  const canSendGifs = authRole === "admin" ? true : authRole === "coach" ? true : !!chatSettings?.clientsCanSendGifs;
  const canSendSounds = authRole === "admin" ? true : authRole === "coach" ? true : !!chatSettings?.clientsCanSendSounds;

  const myPresenceRole: "admin" | "coach" | "client" | "member" =
    authRole === "admin" ? "admin" : authRole === "coach" ? "coach" : "client";
  const { others: livePeers } = useGroupPresence(groupId, myPresenceRole);
  const liveUserIds = useMemo(() => new Set(livePeers.map((p) => p.user_id)), [livePeers]);

  /* ---------------- Realtime ---------------- */

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
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length]);

  /* ---------------- Derived ---------------- */

  const memberById = useMemo(() => new Map(members.map((mb) => [mb.user_id, mb])), [members]);

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

  // First-incoming-unread divider
  const initialUnreadFirstIdRef = useRef<string | null>(null);
  const initialUnreadCapturedRef = useRef(false);
  useEffect(() => {
    if (initialUnreadCapturedRef.current) return;
    if (!messages.length || !user) return;
    initialUnreadCapturedRef.current = true;
    const myMembership = members.find((mb) => mb.user_id === user.id);
    const lastRead = myMembership?.last_read_at ? new Date(myMembership.last_read_at).getTime() : 0;
    const first = messages.find((m) =>
      m.sender_id !== user.id &&
      !m.deleted_at &&
      new Date(m.created_at).getTime() > lastRead,
    );
    initialUnreadFirstIdRef.current = first?.id ?? null;
  }, [messages, members, user?.id]);
  useEffect(() => {
    initialUnreadCapturedRef.current = false;
    initialUnreadFirstIdRef.current = null;
  }, [groupId]);

  const lastOwnMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === user?.id && !messages[i].deleted_at) return messages[i].id;
    }
    return null;
  }, [messages, user?.id]);

  /* ---------------- Reactions (optimistic) ---------------- */

  const onToggleReaction = (messageId: string, emoji: string) => {
    if (!user) return;
    const key = ["group-reactions", groupId] as const;
    const prev = qc.getQueryData<GroupReaction[]>(key) ?? reactions;
    const mineOnMsg = prev.filter((r) => r.user_id === user.id && r.message_id === messageId);
    const samePicked = mineOnMsg.find((r) => r.emoji === emoji);

    let next: GroupReaction[];
    if (samePicked) {
      next = prev.filter((r) => r.id !== samePicked.id);
    } else {
      const mineIds = new Set(mineOnMsg.map((r) => r.id));
      next = prev.filter((r) => !mineIds.has(r.id));
      next.push({
        id: `optimistic-${messageId}-${user.id}-${Date.now()}`,
        message_id: messageId,
        user_id: user.id,
        emoji,
        created_at: new Date().toISOString(),
      });
    }
    qc.setQueryData(key, next);

    void (async () => {
      try {
        await toggleGroupReaction(messageId, user.id, emoji, mineOnMsg);
        qc.invalidateQueries({ queryKey: key });
      } catch (e: any) {
        qc.setQueryData(key, prev);
        toast.error(e?.message ?? "Reaction failed. Try again.");
      }
    })();
  };

  /* ---------------- Long-press + swipe + selection ---------------- */

  const startLongPress = (id: string, x: number, y: number) => {
    if (longPressRef.current?.t) clearTimeout(longPressRef.current.t);
    const t = setTimeout(() => {
      suppressClickRef.current = true;
      try { (navigator as any).vibrate?.(10); } catch {}
      if (selectionMode) toggleSelected(id);
      else setSheetForId(id);
    }, 450);
    longPressRef.current = { id, t, x, y };
  };
  const cancelLongPress = () => {
    if (longPressRef.current?.t) clearTimeout(longPressRef.current.t);
    longPressRef.current = null;
  };
  const onPointerMoveDuringHold = (e: React.PointerEvent) => {
    const lp = longPressRef.current;
    if (!lp) return;
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLongPress();
  };
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const onSwipeTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, decided: false, horizontal: false };
  };
  const onSwipeTouchMove = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      s.horizontal = dx < -6 && Math.abs(dx) > Math.abs(dy) * 1.4;
      s.decided = true;
      if (s.horizontal) cancelLongPress();
    }
    if (s.horizontal) {
      const clamped = Math.max(-72, Math.min(0, dx));
      setSwipeX(clamped);
    }
  };
  const onSwipeTouchEnd = () => { swipeRef.current = null; setSwipeX(0); };

  const myIds = useMemo(
    () => new Set(messages.filter((m) => m.sender_id === user?.id && !m.deleted_at).map((m) => m.id)),
    [messages, user?.id],
  );
  const deletableIds = useMemo(
    () => new Set(messages
      .filter((m) => (m.sender_id === user?.id || canManage) && !m.deleted_at)
      .map((m) => m.id)),
    [messages, user?.id, canManage],
  );
  const selectedDeletable = useMemo(
    () => Array.from(selectedIds).filter((id) => deletableIds.has(id)),
    [selectedIds, deletableIds],
  );
  const allMineSelected = myIds.size > 0 && Array.from(myIds).every((id) => selectedIds.has(id));

  const performBulkDelete = async (ids: string[]) => {
    let failed = 0;
    for (const id of ids) {
      try { await deleteGroupMessageForEveryone(id); } catch { failed++; }
    }
    qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
    if (failed) toast.error(`${failed} message${failed === 1 ? "" : "s"} could not be deleted`);
    else toast.success(`${ids.length} message${ids.length === 1 ? "" : "s"} deleted`);
    exitSelection();
  };

  /* ---------------- Composer actions ---------------- */

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const uploaded: GroupAttachment[] = [];
      for (const f of Array.from(files)) {
        if (f.size > 50 * 1024 * 1024) { toast.error(`${f.name} is over 50MB`); continue; }
        uploaded.push(await uploadGroupFile(groupId, f));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const stopForPreview = async () => {
    const result = await recorder.stop();
    if (!result) return;
    if (result.duration < 0.5) { toast.message("Voice message too short"); return; }
    const url = URL.createObjectURL(result.blob);
    setPreview({ blob: result.blob, url, duration: result.duration, peaks: result.peaks });
  };

  const discardPreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPreviewPlaying(false);
  };

  const sendPreview = async () => {
    if (!preview || !user) return;
    setUploading(true);
    try {
      const ext = preview.blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([preview.blob], `voice-${Date.now()}.${ext}`, { type: preview.blob.type });
      const att = await uploadGroupFile(groupId, file);
      att.type = "audio";
      att.duration = preview.duration;
      att.peaks = preview.peaks;
      await sendGroupMessage({
        groupId,
        senderId: user.id,
        senderRole: canManage ? "admin" : "member",
        body: "",
        attachments: [att],
      });
      URL.revokeObjectURL(preview.url);
      setPreview(null);
      setPreviewPlaying(false);
      qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send voice message");
    } finally {
      setUploading(false);
    }
  };

  const doSend = async () => {
    if (!user) return;
    const text = body.trim();
    if (!text && attachments.length === 0) return;
    // Auto-detect plain URLs typed inline
    const linkAtts: GroupAttachment[] = [];
    const matches = text.match(LINK_RE);
    if (matches) {
      for (const u of matches.slice(0, 3)) {
        if (attachments.some((a) => a.url === u)) continue;
        linkAtts.push({ type: "link", url: u });
      }
    }
    setSending(true);
    try {
      await sendGroupMessage({
        groupId,
        senderId: user.id,
        senderRole: canManage ? "admin" : "member",
        body: text,
        attachments: [...attachments, ...linkAtts],
      });
      setBody("");
      setAttachments([]);
      qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  /* ---------------- Render ---------------- */

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] px-3 py-4 sm:px-6"
        onTouchStart={onSwipeTouchStart}
        onTouchMove={onSwipeTouchMove}
        onTouchEnd={onSwipeTouchEnd}
        onTouchCancel={onSwipeTouchEnd}
      >
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No messages yet — say hi 👋
          </div>
        ) : messages.map((m) => {
          const mine = m.sender_id === user?.id;
          const isDeleted = !!m.deleted_at;
          const isEditing = editingId === m.id;
          const isSelected = selectedIds.has(m.id);
          const canModify = mine && !isDeleted;
          const mem = m.sender_id ? memberById.get(m.sender_id) : undefined;
          const profile = m.sender_id ? profileById.get(m.sender_id) : undefined;
          const isManagerSender =
            mem?.role === "admin" || m.sender_role === "admin" || m.sender_role === "coach";
          const otherName = mine ? null : (profile?.full_name ?? (isManagerSender ? "Coach" : "Member"));
          const otherAvatar = mine ? null : (profile?.avatar_url ?? null);
          const isLive = m.sender_id ? liveUserIds.has(m.sender_id) : false;

          return (
            <Fragment key={m.id}>
              {initialUnreadFirstIdRef.current === m.id && (
                <div className="my-1 flex items-center gap-2 px-1">
                  <span className="h-px flex-1 bg-primary/40" />
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                    New
                  </span>
                  <span className="h-px flex-1 bg-primary/40" />
                </div>
              )}
              <div
                className={cn(
                  "relative flex w-full min-w-0 items-end gap-2 will-change-transform",
                  mine ? "justify-end" : "justify-start",
                  selectionMode && "cursor-pointer",
                  (() => {
                    const hasR = (reactionsByMsg.get(m.id)?.length ?? 0) > 0;
                    if (hasR) return "pb-3";
                    return "";
                  })(),
                )}
                style={{
                  transform: swipeX !== 0 ? `translate3d(${swipeX}px,0,0)` : undefined,
                  transition: swipeX === 0 ? "transform 220ms cubic-bezier(.2,.8,.2,1)" : "none",
                }}
                onClick={() => { if (selectionMode && canModify) toggleSelected(m.id); }}
              >
                {/* swipe-revealed timestamp */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                  style={{
                    right: -64, width: 56,
                    opacity: Math.min(1, Math.abs(swipeX) / 48),
                    transition: swipeX === 0 ? "opacity 220ms ease" : "none",
                  }}
                >
                  {fmtTime(m.created_at)}
                </div>

                {selectionMode && (
                  <div className={cn("self-center shrink-0", mine && "order-last")}>
                    {canModify ? (
                      isSelected
                        ? <CheckCircle2 className="h-5 w-5 text-primary" />
                        : <Circle className="h-5 w-5 text-muted-foreground/60" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/20" />
                    )}
                  </div>
                )}

                {!mine && (
                  <div className="relative shrink-0 mb-1">
                    <UserAvatar
                      src={otherAvatar}
                      name={otherName}
                      size={28}
                      tone="neutral"
                    />
                    {isLive && (
                      <span
                        aria-label="Active now"
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
                      />
                    )}
                  </div>
                )}

                <div
                  className={cn(
                    "group relative select-none touch-manipulation",
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm transition-shadow",
                    mine
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-secondary text-foreground rounded-bl-md",
                    isDeleted && "italic opacity-70",
                    selectionMode && isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                  style={{
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                    WebkitTapHighlightColor: "transparent",
                  }}
                  onContextMenu={(e) => { if (!isDeleted) e.preventDefault(); }}
                  onPointerDown={(e) => {
                    if (isEditing || isDeleted) return;
                    if ((e.target as HTMLElement).closest("a,button,textarea,input,audio,video")) return;
                    startLongPress(m.id, e.clientX, e.clientY);
                  }}
                  onPointerMove={onPointerMoveDuringHold}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onTouchEnd={(e) => {
                    if (isDeleted || isEditing || selectionMode) return;
                    const lp = longPressRef.current;
                    if (lp) return;
                    const t = e.changedTouches[0];
                    if (!t) return;
                    if ((t.target as HTMLElement).closest("a,button,textarea,input,audio,video,img,[data-no-doubletap]")) return;
                    const now = Date.now();
                    const last = (m as any).__lastTap as { t: number; x: number; y: number } | undefined;
                    if (last && now - last.t < 320 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 14) {
                      (m as any).__lastTap = undefined;
                      e.preventDefault();
                      suppressClickRef.current = true;
                      void onToggleReaction(m.id, defaultReaction);
                    } else {
                      (m as any).__lastTap = { t: now, x: t.clientX, y: t.clientY };
                    }
                  }}
                  onDoubleClick={(e) => {
                    if (isDeleted || isEditing || selectionMode) return;
                    if ((e.target as HTMLElement).closest("a,button,textarea,input,audio,video,img")) return;
                    try {
                      const sel = window.getSelection();
                      if (sel && !sel.isCollapsed) return;
                    } catch {}
                    void onToggleReaction(m.id, defaultReaction);
                  }}
                  onClickCapture={(e) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      e.stopPropagation();
                      e.preventDefault();
                    }
                  }}
                >
                  {/* Sender label (incoming only) */}
                  {!mine && !isDeleted && (
                    <div className={cn(
                      "mb-0.5 flex items-center gap-1 text-[10px] font-semibold",
                      "text-muted-foreground",
                    )}>
                      <span className="truncate">{otherName}</span>
                      {isManagerSender && (
                        <span className="rounded bg-primary/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                          Coach
                        </span>
                      )}
                    </div>
                  )}

                  {isDeleted ? (
                    <div className="flex items-center gap-1.5 whitespace-pre-wrap break-words">
                      <Trash2 className="h-3 w-3 opacity-70" />
                      <span>This message was deleted</span>
                    </div>
                  ) : isEditing ? (
                    <div className="space-y-1.5">
                      <Textarea
                        value={editingBody}
                        onChange={(e) => setEditingBody(e.target.value)}
                        rows={2}
                        className={cn(
                          "min-h-[60px] resize-none rounded-md border-0 bg-background/20 px-2 py-1 text-sm",
                          mine ? "text-primary-foreground placeholder:text-primary-foreground/60" : "text-foreground",
                        )}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void (async () => {
                              const next = editingBody.trim();
                              if (!next || next === m.body) { setEditingId(null); return; }
                              try {
                                await editGroupMessage(m.id, next);
                                setEditingId(null);
                                qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
                              } catch (err: any) {
                                toast.error(err?.message ?? "Failed to edit");
                              }
                            })();
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                          onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        <Button type="button" size="sm" className="h-7 px-2 text-[11px]"
                          onClick={async () => {
                            const next = editingBody.trim();
                            if (!next || next === m.body) { setEditingId(null); return; }
                            try {
                              await editGroupMessage(m.id, next);
                              setEditingId(null);
                              qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to edit");
                            }
                          }}
                        >
                          <Check className="mr-1 h-3 w-3" /> Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    m.body && renderBodyWithMeet(m.body, mine)
                  )}

                  {!isDeleted && !isEditing && m.attachments?.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {m.attachments.map((a, i) => (
                        <AttachmentView key={i} att={a as SharedAttachment} mine={mine} />
                      ))}
                    </div>
                  )}

                  <div className={cn(
                    "mt-1 flex items-center gap-2 text-[10px]",
                    mine ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}>
                    <span>{fmtTime(m.created_at)}</span>
                    {m.edited_at && !isDeleted && <span>· edited</span>}
                  </div>

                  {/* Reaction chips */}
                  {!isDeleted && (() => {
                    const list = reactionsByMsg.get(m.id) ?? [];
                    if (list.length === 0) return null;
                    const groups = new Map<string, GroupReaction[]>();
                    for (const r of list) {
                      const g = groups.get(r.emoji) ?? [];
                      g.push(r);
                      groups.set(r.emoji, g);
                    }
                    return (
                      <div className={cn(
                        "absolute -bottom-3 flex flex-wrap gap-1",
                        mine ? "right-2" : "left-2",
                      )}>
                        {Array.from(groups.entries()).map(([emoji, rs]) => {
                          const minePicked = rs.some((r) => r.user_id === user?.id);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void onToggleReaction(m.id, emoji); }}
                              className={cn(
                                "inline-flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[11px] shadow-sm transition animate-reaction-pop",
                                minePicked ? "border-primary bg-primary/10" : "border-border hover:bg-secondary",
                              )}
                            >
                              <span>{emoji}</span>
                              {rs.length > 1 && <span className="text-[10px] font-medium">{rs.length}</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Desktop hover quick-react / actions */}
                  {!isDeleted && !isEditing && !selectionMode && (
                    <div className={cn(
                      "absolute -top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                      mine ? "right-1" : "left-1",
                      actionsForId === m.id && "opacity-100",
                    )}>
                      <DropdownMenu open={actionsForId === m.id} onOpenChange={(o) => setActionsForId(o ? m.id : null)}>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" size="icon" variant="secondary"
                            className="h-8 w-8 rounded-full border border-border shadow-sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={mine ? "end" : "start"} className="w-44">
                          <div className="flex items-center justify-around px-1 py-1.5">
                            {GROUP_REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="rounded-full p-1 text-lg hover:bg-secondary"
                                onClick={() => {
                                  void onToggleReaction(m.id, emoji);
                                  setActionsForId(null);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                          {mine && (m.body?.length ?? 0) > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => { setEditingId(m.id); setEditingBody(m.body); setActionsForId(null); }}
                              >
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                            </>
                          )}
                          {deletableIds.has(m.id) && (
                            <>
                              {!(mine && (m.body?.length ?? 0) > 0) && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                onClick={() => { setActionsForId(null); setSelectionMode(true); setSelectedIds(new Set([m.id])); }}
                              >
                                <CheckSquare className="mr-2 h-4 w-4" /> Select
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  setActionsForId(null);
                                  setConfirmDelete({ ids: [m.id], label: "Delete this message for everyone?" });
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete for everyone
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* Composer */}
      {canPost ? (
        <div
          className="space-y-2 border-t border-border bg-background/95 px-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 sm:pt-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {attachments.map((a, i) => (
                <Badge key={i} variant="outline" className="gap-1">
                  {(() => { const Icon = attachIcon(a.type); return <Icon className="h-3 w-3" />; })()}
                  <span className="max-w-[180px] truncate">{a.name ?? a.url}</span>
                  <button onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          )}

          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
          <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
            onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />

          {recorder.recording ? (
            <div className="flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-2">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
              <span className="shrink-0 text-xs font-medium tabular-nums">{fmtDuration(recorder.elapsed)}</span>
              <LiveWaveform levels={recorder.liveLevels} />
              <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-muted-foreground" onClick={() => recorder.cancel()} title="Discard">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" className="h-8 shrink-0 bg-primary" onClick={stopForPreview} title="Stop">
                <Square className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : preview ? (
            <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-2">
              <Button
                type="button" size="icon" variant="default"
                className="h-9 w-9 shrink-0 rounded-full"
                onClick={() => {
                  const a = previewAudioRef.current; if (!a) return;
                  if (a.paused) { a.play(); setPreviewPlaying(true); } else { a.pause(); setPreviewPlaying(false); }
                }}
              >
                {previewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
              </Button>
              <div className="flex-1">
                <WaveformBars peaks={preview.peaks.length ? preview.peaks : fakePeaks(40, preview.duration * 9)} progress={0} mine={false} />
                <div className="mt-0.5 text-[10px] text-muted-foreground">Preview · {fmtDuration(preview.duration)}</div>
              </div>
              <audio
                ref={previewAudioRef} src={preview.url} preload="metadata"
                onEnded={() => setPreviewPlaying(false)}
                onPause={() => setPreviewPlaying(false)}
                onPlay={() => setPreviewPlaying(true)}
              />
              <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-muted-foreground" onClick={discardPreview} title="Discard">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" className="h-8 shrink-0 bg-primary" onClick={sendPreview} disabled={uploading}>
                <Send className="mr-1 h-3.5 w-3.5" /> Send
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={uploading}>
                    <Paperclip className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-xs">Attach</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
                    <Camera className="mr-2 h-4 w-4" /> Take photo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => photoInputRef.current?.click()}>
                    <ImageIcon className="mr-2 h-4 w-4" /> Photo or video
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                    <FileIcon className="mr-2 h-4 w-4" /> File / document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {canSendGifs && (
                <GifPicker
                  disabled={sending || uploading}
                  showSounds
                  onPickSound={!canSendSounds ? undefined : async (s) => {
                    if (!user) return;
                    setSending(true);
                    try {
                      await sendGroupMessage({
                        groupId,
                        senderId: user.id,
                        senderRole: canManage ? "admin" : "member",
                        body: "",
                        attachments: [{
                          type: "audio",
                          kind: "sound",
                          url: s.media_url,
                          name: s.title,
                          mime: s.mime,
                          duration: s.duration_ms ? s.duration_ms / 1000 : undefined,
                        }],
                      });
                      qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
                      try { await markSoundRecent(user.id, s.id); } catch {}
                    } catch (e: any) {
                      toast.error(e?.message ?? "Failed to send sound");
                    } finally {
                      setSending(false);
                    }
                  }}
                  onPick={async (g) => {
                    if (!user) return;
                    setSending(true);
                    try {
                      await sendGroupMessage({
                        groupId,
                        senderId: user.id,
                        senderRole: canManage ? "admin" : "member",
                        body: "",
                        attachments: [{
                          type: g.media_type.startsWith("video") ? "video" : "image",
                          url: g.media_url,
                          name: g.title,
                          mime: g.media_type,
                          kind: "gif",
                          category: g.category,
                          fallback_emoji: fallbackEmoji(g.title, g.category),
                        }],
                      });
                      qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
                      try { await markRecent(user.id, g.id); } catch {}
                    } catch (e: any) {
                      toast.error(e?.message ?? "Failed to send GIF");
                    } finally {
                      setSending(false);
                    }
                  }}
                />
              )}

              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Message ${groupName}…`}
                rows={1}
                className="min-h-10 max-h-40 flex-1 resize-none rounded-2xl border-input bg-background px-3 py-2 text-base sm:text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void doSend();
                  }
                }}
              />

              {body.trim() || attachments.length > 0 ? (
                <Button
                  type="button"
                  onClick={doSend}
                  disabled={sending || uploading}
                  aria-busy={sending || uploading || undefined}
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full bg-primary transition-transform active:scale-90"
                >
                  {sending || uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full"
                  onClick={async () => {
                    try { await recorder.start(); }
                    catch (e: any) { toast.error(e?.message ?? "Mic permission needed"); }
                  }}>
                  <Mic className="h-5 w-5" />
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border bg-secondary/30 px-4 py-3 text-center text-xs text-muted-foreground">
          Only the coach can post in this group.
        </div>
      )}

      {/* Bulk selection action bar */}
      {selectionMode && (
        <div
          className="fixed inset-x-0 z-40 flex items-center gap-2 border-t border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85"
          style={{ bottom: 0, paddingBottom: "calc(max(env(safe-area-inset-bottom), 0.5rem))" }}
        >
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={exitSelection}>
            Cancel
          </Button>
          <div className="flex-1 text-center text-sm font-semibold">{selectedIds.size} selected</div>
          <Button
            type="button" variant="ghost" size="sm" className="h-9"
            onClick={() => {
              if (allMineSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(myIds));
            }}
            disabled={myIds.size === 0}
          >
            {allMineSelected ? "Deselect all" : "Select all"}
          </Button>
          <Button
            type="button" variant="destructive" size="sm" className="h-9 gap-1"
            disabled={selectedDeletable.length === 0}
            onClick={() => {
              const blocked = selectedIds.size - selectedDeletable.length;
              if (blocked > 0) toast.message(`Skipping ${blocked} message${blocked === 1 ? "" : "s"} you can't delete`);
              setConfirmDelete({
                ids: selectedDeletable,
                label: `Delete ${selectedDeletable.length} message${selectedDeletable.length === 1 ? "" : "s"} for everyone?`,
              });
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete ({selectedDeletable.length})
          </Button>
        </div>
      )}

      {/* Mobile long-press action sheet */}
      <Sheet open={!!sheetForId} onOpenChange={(o) => { if (!o) setSheetForId(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(max(env(safe-area-inset-bottom),0.75rem))]">
          {(() => {
            const m = messages.find((x) => x.id === sheetForId);
            if (!m) return null;
            const mine = m.sender_id === user?.id;
            const canEdit = mine && !m.deleted_at && (m.body?.length ?? 0) > 0;
            const canDelete = (mine || canManage) && !m.deleted_at;
            const canReact = !m.deleted_at;
            return (
              <>
                <SheetHeader className="text-left">
                  <SheetTitle>Message actions</SheetTitle>
                  <SheetDescription className="line-clamp-2">
                    {m.deleted_at ? "This message was deleted." : m.body || (m.attachments?.length ? "Attachment" : "")}
                  </SheetDescription>
                </SheetHeader>
                {canReact && (
                  <div className="mt-3 flex items-center justify-around rounded-full border border-border bg-secondary/40 px-2 py-2">
                    {GROUP_REACTION_EMOJIS.map((emoji) => {
                      const minePicked = myReactions.some((r) => r.message_id === m.id && r.emoji === emoji);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          className={cn(
                            "rounded-full p-1 text-2xl transition active:scale-90",
                            minePicked && "bg-primary/15 ring-1 ring-primary",
                          )}
                          onClick={() => { void onToggleReaction(m.id, emoji); setSheetForId(null); }}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 grid gap-1">
                  {canEdit && (
                    <Button
                      type="button" variant="ghost" className="h-12 justify-start text-base"
                      onClick={() => { setEditingId(m.id); setEditingBody(m.body); setSheetForId(null); }}
                    >
                      <Pencil className="mr-3 h-5 w-5" /> Edit
                    </Button>
                  )}
                  {!m.deleted_at && (m.body?.length ?? 0) > 0 && (
                    <Button
                      type="button" variant="ghost" className="h-12 justify-start text-base"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(m.body || "");
                          toast.success("Copied to clipboard");
                        } catch { toast.error("Couldn't copy"); }
                        setSheetForId(null);
                      }}
                    >
                      <Copy className="mr-3 h-5 w-5" /> Copy Text
                    </Button>
                  )}
                  <Button
                    type="button" variant="ghost" className="h-12 justify-start text-base"
                    onClick={() => {
                      setSheetForId(null);
                      setSelectionMode(true);
                      setSelectedIds(new Set(deletableIds.has(m.id) ? [m.id] : []));
                    }}
                  >
                    <CheckSquare className="mr-3 h-5 w-5" /> Select
                  </Button>
                  {canDelete && (
                    <Button
                      type="button" variant="ghost"
                      className="h-12 justify-start text-base text-destructive hover:text-destructive"
                      onClick={() => {
                        setSheetForId(null);
                        setConfirmDelete({ ids: [m.id], label: "Delete this message for everyone?" });
                      }}
                    >
                      <Trash2 className="mr-3 h-5 w-5" /> Delete for everyone
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="mt-2 h-11" onClick={() => setSheetForId(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Confirm delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDelete?.label ?? "Delete?"}</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Everyone in the group will see a "This message was deleted" placeholder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const ids = confirmDelete?.ids ?? [];
                setConfirmDelete(null);
                if (ids.length === 1) {
                  try {
                    await deleteGroupMessageForEveryone(ids[0]);
                    qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
                    toast.success("Message deleted");
                  } catch (err: any) {
                    toast.error(err?.message ?? "Failed to delete");
                  }
                  return;
                }
                await performBulkDelete(ids);
              }}
            >
              Delete for everyone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}