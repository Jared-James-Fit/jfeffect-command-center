import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MoreHorizontal, ShieldOff, Flag, Inbox } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GroupMessageThread } from "@/components/group-message-thread";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { listGroupMessages } from "@/lib/group-chats";
import { fmtTime } from "@/components/chat-shared";
import { isUnread, previewLine, useRespondToChat, type DirectThread, type RequestAction } from "@/lib/direct-chats";

/** A request holds this many messages until it's answered (chat_request_cap()). */
export const REQUEST_CAP = 3;

/**
 * One member-to-member chat. Three states:
 *   - a request to me: read it all, then Accept / Delete (and Block / Report).
 *     Previewing never shows as "Seen" or "active now".
 *   - my request: a few lines of text until they answer. It looks the same
 *     whether they haven't opened it or quietly deleted it.
 *   - a chat: like any other, with Block / Report in the menu.
 */
export function DirectChatView({ thread, onBack }: { thread: DirectThread; onBack: () => void }) {
  const { user } = useAuth();
  const respond = useRespondToChat();
  const [confirm, setConfirm] = useState<RequestAction | null>(null);
  const name = thread.other.name;

  // Same cache as the thread itself: how many lines my request has used.
  const { data: messages = [] } = useQuery({
    queryKey: ["group-messages", thread.group_id],
    queryFn: () => listGroupMessages(thread.group_id),
  });
  const mineCount = messages.filter((m) => m.sender_id === user?.id).length;
  const left = thread.outgoing ? Math.max(0, REQUEST_CAP - mineCount) : null;
  const active = thread.status === "active";

  const act = async (action: RequestAction) => {
    setConfirm(null);
    try {
      await respond.mutateAsync({ groupId: thread.group_id, action });
      if (action === "accept") return;
      toast.success(
        action === "decline" ? "Request deleted" : action === "block" ? `${name} is blocked` : "Reported. Your coach has it.",
      );
      onBack();
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
    }
  };

  const footer = thread.incoming ? (
    <RequestBar name={name} busy={respond.isPending} onAction={(a) => (a === "accept" ? act("accept") : setConfirm(a))} />
  ) : left === 0 ? (
    <div className="border-t border-border bg-secondary/30 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-[13px] text-muted-foreground">
      You can send more once {name} replies.
    </div>
  ) : undefined;

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack} aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <UserAvatar src={thread.other.avatar_url} name={name} size={36} expandable={false} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{name}</div>
          {!active && (
            <div className="truncate text-[11px] text-muted-foreground">{thread.incoming ? "Message request" : "Request sent"}</div>
          )}
        </div>
        {!thread.incoming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Chat options">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setConfirm("block")}>
                <ShieldOff className="mr-2 h-4 w-4" /> Block
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConfirm("report")} className="text-destructive focus:text-destructive">
                <Flag className="mr-2 h-4 w-4" /> Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {thread.outgoing && (
        <div className="border-b border-border bg-secondary/40 px-4 py-2 text-center text-[12px] text-muted-foreground">
          Sent as a message request. {name} can reply when they see it.
        </div>
      )}

      <GroupChatErrorBoundary key={`direct-${thread.group_id}`}>
        <GroupMessageThread
          groupId={thread.group_id}
          groupName={name}
          placeholder={`Message ${name}…`}
          canPost={!thread.incoming && left !== 0}
          canManage={false}
          canReact={active}
          textOnly={thread.outgoing}
          hidePresence={!active}
          oneToOne
          footer={footer}
        />
      </GroupChatErrorBoundary>

      <AlertDialog open={confirm !== null && confirm !== "accept"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "decline" ? "Delete this request?" : confirm === "block" ? `Block ${name}?` : "Report this chat?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "decline"
                ? `It disappears from your requests. ${name} won't be told.`
                : confirm === "block"
                  ? `${name} won't be able to message you, and won't be told you blocked them.`
                  : `Your coach gets a copy of this chat so they can step in, and ${name} won't be able to message you. ${name} won't be told.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(confirm !== "decline" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              onClick={() => confirm && act(confirm)}
            >
              {confirm === "decline" ? "Delete" : confirm === "block" ? "Block" : "Report"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** In place of the composer on a request to me. */
function RequestBar({ name, busy, onAction }: { name: string; busy: boolean; onAction: (a: RequestAction) => void }) {
  return (
    <div className="space-y-2.5 border-t border-border bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="text-center">
        <div className="text-[14px] font-bold">{name} wants to message you</div>
        <div className="text-[12px] text-muted-foreground">They won't know you've seen this unless you accept.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="h-11 rounded-xl font-bold" disabled={busy} onClick={() => onAction("decline")}>
          Delete
        </Button>
        <Button type="button" className="h-11 rounded-xl font-bold" disabled={busy} onClick={() => onAction("accept")}>
          Accept
        </Button>
      </div>
      <div className="flex items-center justify-center gap-5 text-[12px] font-semibold text-muted-foreground">
        <button type="button" className="py-1 hover:text-foreground" disabled={busy} onClick={() => onAction("block")}>Block</button>
        <button type="button" className="py-1 hover:text-destructive" disabled={busy} onClick={() => onAction("report")}>Report</button>
      </div>
    </div>
  );
}

/** A direct chat in the Chats list. */
export function DirectRow({ thread, me, selected, onClick }: { thread: DirectThread; me: string | null | undefined; selected: boolean; onClick: () => void }) {
  const unread = isUnread(thread, me);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-secondary/40",
        selected && "bg-secondary/60",
      )}
    >
      <UserAvatar src={thread.other.avatar_url} name={thread.other.name} size={36} expandable={false} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "font-bold" : "font-semibold")}>{thread.other.name}</span>
          {thread.last && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(thread.last.created_at)}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("flex-1 truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
            {thread.incoming ? `${thread.other.name} wants to message you` : previewLine(thread, me)}
          </span>
          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
        </div>
      </div>
    </button>
  );
}

/** The "Message requests" row at the top of Chats. */
export function RequestsEntry({ count, fresh, onClick }: { count: number; fresh: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-secondary/40"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Inbox className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", fresh ? "font-bold" : "font-semibold")}>Message requests</span>
        <span className="block truncate text-xs text-muted-foreground">{count === 1 ? "1 person wants to message you" : `${count} people want to message you`}</span>
      </span>
      <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{count}</span>
    </button>
  );
}

/** Requests, on their own screen. */
export function RequestsList({
  threads, me, selectedId, onOpen, onBack,
}: {
  threads: DirectThread[];
  me: string | null | undefined;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <header className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Back to chats">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-sm font-bold tracking-tight">Message requests</div>
      </header>
      <p className="border-b border-border/60 px-4 py-2.5 text-[12px] text-muted-foreground">
        From people you haven't chatted with yet. Open one to read it. They won't know you've seen it unless you accept.
      </p>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No requests.</div>
        ) : threads.map((t) => (
          <DirectRow key={t.group_id} thread={t} me={me} selected={selectedId === t.group_id} onClick={() => onOpen(t.group_id)} />
        ))}
      </div>
    </>
  );
}
