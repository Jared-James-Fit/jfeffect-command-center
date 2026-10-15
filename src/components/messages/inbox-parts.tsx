/**
 * The Messages list, iMessage style: pinned chats as big faces on top (the
 * coach always first), hold a chat for Pin / Mark as Unread / Hide Alerts /
 * Delete, swipe for the same, and a compose button for "New message".
 *
 * New people only ever get a message request (chat_direct_start): they can
 * read it without the sender knowing, accept, leave it pending, or delete or
 * block it without the sender ever being told. Training partners (people who
 * follow each other) are the exception: their new chat opens straight away.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell, BellOff, ChevronLeft, Loader2, Mail, MailOpen, Pin, PinOff, Search, Send, ShieldOff, Trash2, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SwipeableRow, type SwipeAction } from "@/components/ui/swipeable-row";
import { UserAvatar } from "@/components/user-avatar";
import { LiveAvatar } from "@/components/live-indicator";
import { useLongPress } from "@/hooks/use-long-press";
import { useCommunityMembers } from "@/lib/community.queries";
import type { CommunityAuthor } from "@/lib/community";
import { useBlockedPeople, useBlockPerson, useStartDirect, type DirectThread } from "@/lib/direct-chats";
import { isPartner, useFollowState } from "@/lib/community-social";
import type { CrewThread } from "@/lib/crew-chats";
import { TallSheet } from "@/components/crew-chat";

/* ------------------------------ hold menu ------------------------------ */

export type ChatMenuAction = "pin" | "unpin" | "unread" | "read" | "mute" | "unmute" | "delete";

export type ChatMenuTarget = {
  key: string;
  title: string;
  avatar: ReactNode;
  preview?: string;
  /** The coach chat: always pinned first, can't be muted or deleted. */
  fixed?: boolean;
  pinned: boolean;
  muted: boolean;
  unread: boolean;
  canPin: boolean;
  canMute: boolean;
  canDelete: boolean;
};

/** What a held (or right-clicked) chat offers, in iMessage's order. */
export function chatMenuItems(t: ChatMenuTarget): ChatMenuAction[] {
  const out: ChatMenuAction[] = [];
  if (t.canPin && !t.fixed) out.push(t.pinned ? "unpin" : "pin");
  out.push(t.unread ? "read" : "unread");
  if (t.canMute && !t.fixed) out.push(t.muted ? "unmute" : "mute");
  if (t.canDelete && !t.fixed) out.push("delete");
  return out;
}

const MENU: Record<ChatMenuAction, { label: string; icon: ReactNode; danger?: boolean }> = {
  pin: { label: "Pin", icon: <Pin className="h-5 w-5" /> },
  unpin: { label: "Unpin", icon: <PinOff className="h-5 w-5" /> },
  unread: { label: "Mark as Unread", icon: <Mail className="h-5 w-5" /> },
  read: { label: "Mark as Read", icon: <MailOpen className="h-5 w-5" /> },
  mute: { label: "Hide Alerts", icon: <BellOff className="h-5 w-5" /> },
  unmute: { label: "Show Alerts", icon: <Bell className="h-5 w-5" /> },
  delete: { label: "Delete", icon: <Trash2 className="h-5 w-5" />, danger: true },
};

export function ChatActionsSheet({
  target, onClose, onAction,
}: {
  target: ChatMenuTarget | null;
  onClose: () => void;
  onAction: (a: ChatMenuAction, t: ChatMenuTarget) => void;
}) {
  // Keep showing the chat while the sheet animates closed.
  const last = useRef<ChatMenuTarget | null>(null);
  if (target) last.current = target;
  const t = target ?? last.current;
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="mx-auto max-w-lg rounded-t-3xl p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" aria-hidden />
        {t && (
          <>
            <div className="flex items-center gap-3 px-4 pb-3 pt-3">
              <span className="shrink-0">{t.avatar}</span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-[16px] font-bold">{t.title}</SheetTitle>
                <SheetDescription className="line-clamp-2 text-[13px]">
                  {t.fixed ? "Your coach is always pinned at the top." : t.preview || "No messages yet"}
                </SheetDescription>
              </div>
            </div>
            <div className="mx-3 overflow-hidden rounded-2xl border border-border bg-secondary/30">
              {chatMenuItems(t).map((a, i) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onAction(a, t)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px] font-medium active:bg-secondary",
                    i > 0 && "border-t border-border/70",
                    MENU[a].danger && "text-destructive",
                  )}
                >
                  {MENU[a].label}
                  <span className={cn("text-muted-foreground", MENU[a].danger && "text-destructive")}>{MENU[a].icon}</span>
                </button>
              ))}
            </div>
            <div className="px-3 pt-2">
              <Button type="button" variant="ghost" className="h-12 w-full rounded-2xl text-[16px] font-semibold" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Swipe left on a chat: the same as holding it, minus Pin. */
export function swipeActionsFor(t: ChatMenuTarget, run: (a: ChatMenuAction) => void): SwipeAction[] {
  const out: SwipeAction[] = [{
    key: "unread",
    label: t.unread ? "Read" : "Unread",
    color: "primary",
    icon: t.unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />,
    onSelect: () => run(t.unread ? "read" : "unread"),
  }];
  if (t.canMute && !t.fixed) {
    out.push({
      key: "alerts",
      label: t.muted ? "Alerts" : "Hide",
      color: "muted",
      icon: t.muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />,
      onSelect: () => run(t.muted ? "unmute" : "mute"),
    });
  }
  if (t.canDelete && !t.fixed) {
    out.push({ key: "delete", label: "Delete", color: "destructive", icon: <Trash2 className="h-4 w-4" />, onSelect: () => run("delete") });
  }
  return out;
}

/** A row in the list: hold or right-click for the menu, swipe for quick actions. */
export function ChatRowShell({
  children, onHold, swipe,
}: {
  children: ReactNode;
  onHold?: () => void;
  swipe?: SwipeAction[];
}) {
  const press = useLongPress(() => onHold?.());
  const body = (
    <div {...(onHold ? press : {})} className="select-none [-webkit-touch-callout:none]">
      {children}
    </div>
  );
  if (!swipe?.length) return body;
  return <SwipeableRow actions={swipe}>{body}</SwipeableRow>;
}

/* ------------------------------ pinned faces ------------------------------ */

export function PinTile({
  name, avatar, unread, preview, muted, live, selected, onOpen, onHold,
}: {
  name: string;
  avatar: ReactNode;
  unread: boolean;
  /** What's new, shown in a bubble over the face while unread (iMessage pins). */
  preview?: string | null;
  muted?: boolean;
  live?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onHold?: () => void;
}) {
  const press = useLongPress(() => onHold?.());
  const bubble = unread ? preview?.trim() || null : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      {...(onHold ? press : {})}
      aria-label={`${name}${unread ? `, unread${bubble ? `: ${bubble}` : ""}` : ""}`}
      className={cn(
        "flex w-1/3 select-none flex-col items-center gap-1.5 rounded-2xl px-1 py-2 transition [-webkit-touch-callout:none] active:scale-95",
        selected && "bg-secondary/70",
      )}
    >
      {bubble && (
        <span className="relative mb-0.5 max-w-full rounded-2xl bg-secondary px-2.5 py-1.5 shadow-sm" data-pin-preview aria-hidden>
          <span className="line-clamp-2 break-words text-left text-[11px] leading-snug text-foreground">{bubble}</span>
          <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-secondary" />
        </span>
      )}
      <span className="relative">
        {/* one signal at a time: live is the turning ring and LIVE tag (an unread
            chat still shows in the bold name); otherwise the unread dot */}
        <LiveAvatar live={live} size={60}>{avatar}</LiveAvatar>
        {unread && !live && <span className="absolute -left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden />}
        {muted && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border">
            <BellOff className="h-3 w-3" />
          </span>
        )}
      </span>
      <span className={cn("max-w-full truncate text-[12px]", unread ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>
        {name}
      </span>
    </button>
  );
}

/* ------------------------------ new message ------------------------------ */

type PersonState = "chat" | "sent" | "incoming" | "blocked" | "new";

/** How "New message" treats someone: open the chat you have, or start a request. */
export function personState(
  userId: string,
  directs: DirectThread[],
  blocked: ReadonlySet<string>,
): { state: PersonState; thread: DirectThread | null } {
  if (blocked.has(userId)) return { state: "blocked", thread: null };
  const t = directs.find((d) => d.other?.user_id === userId) ?? null;
  if (!t) return { state: "new", thread: null };
  if (t.incoming) return { state: "incoming", thread: t };
  if (t.outgoing) return { state: "sent", thread: t };
  return { state: "chat", thread: t };
}

const STATE_HINT: Record<PersonState, string> = {
  chat: "Open your chat",
  sent: "Request sent",
  incoming: "Wants to message you",
  blocked: "Blocked",
  new: "Sends a message request",
};

/**
 * People you already talk to come first. Anyone else in the community is
 * found by name, never listed: you have to know who you're looking for.
 */
export function NewMessageSheet({
  open, onOpenChange, me, directs, crews, onOpenThread, onDraft, onNewGroup,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  me: string | null;
  directs: DirectThread[];
  crews: CrewThread[];
  onOpenThread: (t: DirectThread) => void;
  onDraft: (to: CommunityAuthor) => void;
  onNewGroup: () => void;
}) {
  const { data: members = [], isLoading } = useCommunityMembers(open);
  const { data: blockedList = [] } = useBlockedPeople(open);
  const unblock = useBlockPerson();
  const [q, setQ] = useState("");
  const [askUnblock, setAskUnblock] = useState<CommunityAuthor | null>(null);
  const blocked = useMemo(() => new Set(blockedList.map((b) => b.user_id)), [blockedList]);
  const { data: follows } = useFollowState(open);

  const everyone = useMemo(
    () => members.map((m) => m.author).filter((a) => a && !a.is_coach && a.user_id !== me),
    [members, me],
  );
  const suggested = useMemo(() => {
    const seen = new Set<string>();
    const out: CommunityAuthor[] = [];
    const add = (a: CommunityAuthor | null | undefined) => {
      if (!a || a.is_coach || a.user_id === me || seen.has(a.user_id) || blocked.has(a.user_id)) return;
      seen.add(a.user_id);
      out.push(a);
    };
    for (const t of directs) if (!t.incoming) add(t.other);
    for (const a of everyone) if (isPartner(follows, a.user_id)) add(a);
    for (const c of crews) if (c.status === "joined") for (const f of c.faces ?? []) add(f as CommunityAuthor);
    return out.slice(0, 12);
  }, [directs, crews, me, blocked, everyone, follows]);

  const term = q.trim().toLowerCase();
  const shown = term ? everyone.filter((a) => a.name.toLowerCase().includes(term)).slice(0, 40) : suggested;

  const close = (o: boolean) => {
    if (!o) setQ("");
    onOpenChange(o);
  };
  const pick = (a: CommunityAuthor) => {
    const { state, thread } = personState(a.user_id, directs, blocked);
    if (state === "blocked") { setAskUnblock(a); return; }
    close(false);
    if (thread) onOpenThread(thread);
    else onDraft(a);
  };
  const doUnblock = async () => {
    const a = askUnblock;
    setAskUnblock(null);
    if (!a) return;
    try {
      await unblock.mutateAsync({ userId: a.user_id, blocked: false });
      toast.success(`${a.name} is unblocked`);
      close(false);
      const { thread } = personState(a.user_id, directs, new Set());
      if (thread && !thread.incoming) onOpenThread(thread);
      else onDraft(a);
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
    }
  };

  return (
    <>
      <TallSheet open={open} onOpenChange={close} title="New message" sub="People you haven't chatted with get a message request. They decide if they want to chat.">
        <div className="relative shrink-0 px-4 pb-2">
          <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-[60%] text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="To: type a name"
            aria-label="Who to message"
            className="h-10 w-full rounded-xl border border-border bg-secondary/40 pl-9 pr-3 text-base outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!term && (
            <button type="button" onClick={() => { close(false); onNewGroup(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Users className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">New group</span>
                <span className="block text-[12px] text-muted-foreground">Everyone you pick gets an invite</span>
              </span>
            </button>
          )}
          {!term && suggested.length > 0 && (
            <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">People you talk to</div>
          )}
          {isLoading && term ? (
            <div className="grid place-items-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : shown.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {term ? "Nobody in the community by that name." : "Type a name to find someone in the community."}
            </div>
          ) : shown.map((a) => {
            const { state } = personState(a.user_id, directs, blocked);
            return (
              <button key={a.user_id} type="button" onClick={() => pick(a)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/60">
                <UserAvatar src={a.avatar_url} name={a.name} size={40} expandable={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{a.name}</span>
                  <span className={cn("block truncate text-[12px]", state === "blocked" ? "text-destructive" : "text-muted-foreground")}>{state === "new" && isPartner(follows, a.user_id) ? "Training partner · opens a chat" : STATE_HINT[state]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </TallSheet>
      <AlertDialog open={!!askUnblock} onOpenChange={(o) => !o && setAskUnblock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {askUnblock?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be able to send you message requests and group invites again. They won't be told.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doUnblock}>Unblock</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Writing to someone new: what a request means, then the first message. */
export function NewRequestView({
  to, onBack, onSent,
}: {
  to: CommunityAuthor;
  onBack: () => void;
  onSent: (groupId: string) => void | Promise<void>;
}) {
  const start = useStartDirect();
  const { data: follows } = useFollowState();
  const partner = isPartner(follows, to.user_id);
  const [text, setText] = useState("");
  const send = async () => {
    const body = text.trim();
    if (!body || start.isPending) return;
    try {
      const r = await start.mutateAsync({ userId: to.user_id, body });
      setText("");
      await onSent(r.group_id);
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't send. Try again.");
    }
  };
  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack} aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <UserAvatar src={to.avatar_url} name={to.name} size={36} expandable={false} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{to.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{partner ? "Training partner" : "New message request"}</div>
        </div>
        <Button variant="ghost" size="icon" className="hidden h-8 w-8 md:inline-flex" onClick={onBack} aria-label="Cancel">
          <X className="h-5 w-5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
        <UserAvatar src={to.avatar_url} name={to.name} size={72} expandable={false} />
        <div className="mt-3 text-[17px] font-bold">{to.name}</div>
        {partner ? (
          <div className="mt-4 max-w-sm rounded-2xl border border-border bg-secondary/30 p-4 text-left text-[13px] text-muted-foreground">
            <p><span className="font-semibold text-foreground">You and {to.name} follow each other,</span> so this opens a chat straight away. No request to accept.</p>
          </div>
        ) : (
          <div className="mt-4 max-w-sm space-y-2 rounded-2xl border border-border bg-secondary/30 p-4 text-left text-[13px] text-muted-foreground">
            <p><span className="font-semibold text-foreground">This goes to {to.name} as a message request.</span> They can read it and decide whether to chat.</p>
            <p>They can open it without you knowing, so you won't see "Seen" until they reply.</p>
            <p>Until they accept you can send up to 3 messages, text only. Keep it friendly.</p>
          </div>
        )}
      </div>
      <div className="flex items-end gap-2 border-t border-border bg-card px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia?.("(hover: hover)").matches) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          autoFocus
          placeholder={`Message ${to.name}…`}
          aria-label={`Message ${to.name}`}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-border bg-background px-3.5 py-2 text-base outline-none focus:border-primary/50 sm:text-sm"
        />
        <Button type="button" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={!text.trim() || start.isPending} onClick={send} aria-label={partner ? "Send" : "Send request"}>
          {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------ blocked people ------------------------------ */

export function BlockedPeopleSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: people = [], isLoading } = useBlockedPeople(open);
  const block = useBlockPerson();
  const [ask, setAsk] = useState<CommunityAuthor | null>(null);
  const doUnblock = async () => {
    const a = ask;
    setAsk(null);
    if (!a) return;
    try {
      await block.mutateAsync({ userId: a.user_id, blocked: false });
      toast.success(`${a.name} is unblocked`);
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
    }
  };
  return (
    <>
      <TallSheet open={open} onOpenChange={onOpenChange} title="Blocked" sub="They can't message you or add you to group chats, and they were never told.">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="grid place-items-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : people.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <ShieldOff className="h-6 w-6" />
              Nobody's blocked.
            </div>
          ) : people.map((a) => (
            <div key={a.user_id} className="flex items-center gap-3 px-4 py-2">
              <UserAvatar src={a.avatar_url} name={a.name} size={40} expandable={false} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{a.name}</span>
              <Button type="button" size="sm" variant="secondary" className="rounded-full" disabled={block.isPending} onClick={() => setAsk(a)}>
                Unblock
              </Button>
            </div>
          ))}
        </div>
      </TallSheet>
      <AlertDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {ask?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be able to send you message requests and group invites again. They won't be told.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doUnblock}>Unblock</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
