import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Flag, Loader2, LogOut, MoreHorizontal, Pencil, Search, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { markGroupRead } from "@/lib/group-chats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GroupMessageThread } from "@/components/group-message-thread";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { fmtTime } from "@/components/chat-shared";
import { useCommunityMembers } from "@/lib/community.queries";
import type { CommunityAuthor } from "@/lib/community";
import {
  crewPreview, crewSubtitle, isCrewUnread, useCreateCrew, useCrewPeople, useCrewRespond,
  useInviteToCrew, useRemoveFromCrew, useRenameCrew, type CrewAction, type CrewPerson, type CrewThread,
} from "@/lib/crew-chats";

/** Most people a member-made chat can hold (chat_crew_cap()). */
export const CREW_CAP = 30;

/** Two overlapping faces, or a group icon. No "active now" here: that would tell an inviter you're looking. */
export function CrewFaces({ faces, size = 36 }: { faces: Pick<CommunityAuthor, "user_id" | "name" | "avatar_url">[]; size?: number }) {
  const two = faces.slice(0, 2);
  if (two.length === 0) {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-primary/10 text-primary" style={{ width: size, height: size }}>
        <Users className="h-4 w-4" />
      </span>
    );
  }
  if (two.length === 1) return <UserAvatar src={two[0].avatar_url} name={two[0].name} size={size} expandable={false} />;
  const s = Math.round(size * 0.72);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span className="absolute right-0 top-0"><UserAvatar src={two[0].avatar_url} name={two[0].name} size={s} expandable={false} /></span>
      <span className="absolute bottom-0 left-0 rounded-full ring-2 ring-card"><UserAvatar src={two[1].avatar_url} name={two[1].name} size={s} expandable={false} /></span>
    </span>
  );
}

/** A member-made group chat in the Chats list (or an invite in Requests). */
export function CrewRow({ thread, me, selected, onClick }: { thread: CrewThread; me: string | null | undefined; selected: boolean; onClick: () => void }) {
  const unread = isCrewUnread(thread, me);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-secondary/40",
        selected && "bg-secondary/60",
      )}
    >
      <CrewFaces faces={thread.faces} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "font-bold" : "font-semibold")}>{thread.name}</span>
          {thread.last && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(thread.last.created_at)}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("flex-1 truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>{crewPreview(thread, me)}</span>
          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
        </div>
      </div>
    </button>
  );
}

/** Pick people from the community (members only, never coaches). */
function PeoplePicker({ exclude, room, picked, onChange }: { exclude: Set<string>; room: number; picked: string[]; onChange: (ids: string[]) => void }) {
  const { data: members = [], isLoading } = useCommunityMembers(true);
  const [q, setQ] = useState("");
  const people = useMemo(
    () => members.map((m) => m.author).filter((a) => !a.is_coach && !exclude.has(a.user_id)),
    [members, exclude],
  );
  const shown = q.trim() ? people.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())) : people;
  const toggle = (id: string) => {
    if (picked.includes(id)) onChange(picked.filter((x) => x !== id));
    else if (picked.length < room) onChange([...picked, id]);
    else toast.message(`A chat holds up to ${CREW_CAP} people`);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-4 pb-2">
        <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-[60%] text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="h-10 rounded-xl pl-9 text-base sm:text-sm" />
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {picked.map((id) => {
            const a = people.find((p) => p.user_id === id);
            return (
              <button key={id} type="button" onClick={() => toggle(id)} className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-1 pr-2 text-[12px] font-semibold text-primary">
                <UserAvatar src={a?.avatar_url ?? null} name={a?.name ?? "?"} size={20} expandable={false} />
                {a?.name ?? "Someone"}
                <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="grid place-items-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : shown.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{q ? "Nobody by that name." : "Nobody else to add yet."}</div>
        ) : shown.map((a) => {
          const on = picked.includes(a.user_id);
          return (
            <button key={a.user_id} type="button" onClick={() => toggle(a.user_id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/60" aria-pressed={on}>
              <UserAvatar src={a.avatar_url} name={a.name} size={40} expandable={false} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{a.name}</span>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TallSheet({ open, onOpenChange, title, sub, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; sub: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="mx-auto flex h-[88dvh] max-w-lg flex-col gap-0 rounded-t-3xl p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted" aria-hidden />
        <div className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-2">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-[17px] font-bold">{title}</SheetTitle>
            <SheetDescription className="text-[12px]">{sub}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="Close"><X className="h-5 w-5" /></Button>
          </SheetClose>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** "New group": pick people, name it if you want. Everyone gets an invite. */
export function CreateCrewSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (groupId: string) => void }) {
  const create = useCreateCrew();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const none = useMemo(() => new Set<string>(), []);
  const reset = (o: boolean) => {
    if (!o) { setName(""); setPicked([]); }
    onOpenChange(o);
  };
  const submit = async () => {
    try {
      const r = await create.mutateAsync({ name, userIds: picked });
      reset(false);
      onCreated(r.group_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start the chat. Try again.");
    }
  };
  return (
    <TallSheet open={open} onOpenChange={reset} title="New group chat" sub="Everyone you pick gets an invite. They can see who's in it before they join.">
      <div className="shrink-0 px-4 pb-3">
        <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Name it (optional)" className="h-11 rounded-xl text-base sm:text-sm" />
      </div>
      <PeoplePicker exclude={none} room={CREW_CAP - 1} picked={picked} onChange={setPicked} />
      <div className="shrink-0 border-t border-border px-4 pt-3">
        <Button className="h-12 w-full rounded-xl text-[15px] font-bold" disabled={picked.length === 0 || create.isPending} onClick={submit}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : picked.length === 0 ? "Pick people" : `Start chat · invite ${picked.length}`}
        </Button>
      </div>
    </TallSheet>
  );
}

function InviteSheet({ groupId, open, onOpenChange, people }: { groupId: string; open: boolean; onOpenChange: (o: boolean) => void; people: CrewPerson[] }) {
  const invite = useInviteToCrew(groupId);
  const [picked, setPicked] = useState<string[]>([]);
  const inIt = useMemo(() => new Set(people.map((p) => p.user_id)), [people]);
  const close = (o: boolean) => { if (!o) setPicked([]); onOpenChange(o); };
  const submit = async () => {
    try {
      const r = await invite.mutateAsync(picked);
      close(false);
      toast.success(r.invited.length === 1 ? "Invite sent" : `${r.invited.length} invites sent`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the invites. Try again.");
    }
  };
  return (
    <TallSheet open={open} onOpenChange={close} title="Invite people" sub="They'll see who's in the chat and what's been said, then decide.">
      <PeoplePicker exclude={inIt} room={Math.max(0, CREW_CAP - people.length)} picked={picked} onChange={setPicked} />
      <div className="shrink-0 border-t border-border px-4 pt-3">
        <Button className="h-12 w-full rounded-xl text-[15px] font-bold" disabled={picked.length === 0 || invite.isPending} onClick={submit}>
          {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : picked.length === 0 ? "Pick people" : `Invite ${picked.length}`}
        </Button>
      </div>
    </TallSheet>
  );
}

/** Who's in it and who's invited. Whoever started it can remove people (silently). */
function PeopleSheet({ thread, open, onOpenChange, onInvite }: { thread: CrewThread; open: boolean; onOpenChange: (o: boolean) => void; onInvite: () => void }) {
  const { data: people = [], isLoading } = useCrewPeople(open ? thread.group_id : null);
  const remove = useRemoveFromCrew(thread.group_id);
  const [removing, setRemoving] = useState<CrewPerson | null>(null);
  const joined = people.filter((p) => p.status === "joined");
  const invited = people.filter((p) => p.status === "invited");
  const canRemove = thread.is_owner && thread.status === "joined";
  const row = (p: CrewPerson) => (
    <div key={p.user_id} className="flex items-center gap-3 px-4 py-2">
      <UserAvatar src={p.avatar_url} name={p.name} size={40} expandable={false} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{p.is_me ? `${p.name} (you)` : p.name}</div>
        <div className="truncate text-[12px] text-muted-foreground">
          {p.is_owner ? "Started the chat" : p.status === "invited" ? (p.invited_by ? `Invited by ${p.invited_by}` : "Invited") : "In the chat"}
        </div>
      </div>
      {canRemove && !p.is_me && (
        <button type="button" onClick={() => setRemoving(p)} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] font-bold text-muted-foreground hover:text-foreground">
          Remove
        </button>
      )}
    </div>
  );
  return (
    <>
      <TallSheet open={open} onOpenChange={onOpenChange} title={thread.name} sub={crewSubtitle({ joined: joined.length || thread.joined, invited: invited.length })}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {thread.status === "joined" && (
            <button type="button" onClick={onInvite} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></span>
              <span className="text-[15px] font-bold text-primary">Invite people</span>
            </button>
          )}
          {isLoading ? (
            <div className="grid place-items-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="px-4 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">In the chat · {joined.length}</div>
              {joined.map(row)}
              {invited.length > 0 && (
                <>
                  <div className="px-4 pb-1 pt-4 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Invited · {invited.length}</div>
                  {invited.map(row)}
                </>
              )}
            </>
          )}
        </div>
      </TallSheet>
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.status === "invited" ? `Take back ${removing?.name}'s invite?` : `Remove ${removing?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.name} won't be told. The chat just disappears from their list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const p = removing;
                setRemoving(null);
                if (!p) return;
                try {
                  await remove.mutateAsync(p.user_id);
                  toast.success(`${p.name} is out`);
                } catch (e: any) {
                  toast.error(e?.message ?? "Couldn't remove them. Try again.");
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** In place of the composer on an invite. */
function InviteBar({ thread, busy, onAction, onPeople }: { thread: CrewThread; busy: boolean; onAction: (a: CrewAction) => void; onPeople: () => void }) {
  return (
    <div className="space-y-2.5 border-t border-border bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="text-center">
        <div className="text-[14px] font-bold">{thread.invited_by ?? "Someone"} invited you to join</div>
        <button type="button" onClick={onPeople} className="text-[12px] font-semibold text-primary">
          {crewSubtitle(thread)} · See who's in it
        </button>
        <div className="text-[12px] text-muted-foreground">They won't know you've seen this unless you join.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="h-11 rounded-xl font-bold" disabled={busy} onClick={() => onAction("decline")}>Decline</Button>
        <Button type="button" className="h-11 rounded-xl font-bold" disabled={busy} onClick={() => onAction("join")}>Join</Button>
      </div>
      <div className="flex justify-center">
        <button type="button" className="py-1 text-[12px] font-semibold text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => onAction("report")}>Report</button>
      </div>
    </div>
  );
}

/**
 * A member-made group chat. Invited: read it all first, then Join or
 * Decline (silent). Joined: chat, see who's in it, invite people; whoever
 * started it can rename it and remove people.
 */
export function CrewChatView({ thread, onBack }: { thread: CrewThread; onBack: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const respond = useCrewRespond(thread.group_id);
  const rename = useRenameCrew(thread.group_id);
  const { data: people = [] } = useCrewPeople(thread.status === "joined" ? thread.group_id : null);
  const [confirm, setConfirm] = useState<CrewAction | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const joined = thread.status === "joined";

  // Opening an invite counts as having looked (privately: the inviter can't
  // tell), even when nobody's said anything yet.
  useEffect(() => {
    if (thread.status !== "invited" || thread.read_at || !user) return;
    void markGroupRead(thread.group_id, user.id).then(() => qc.invalidateQueries({ queryKey: ["crew-threads"] }));
  }, [thread.group_id, thread.status, thread.read_at, user, qc]);

  const act = async (action: CrewAction) => {
    setConfirm(null);
    try {
      await respond.mutateAsync({ action });
      if (action === "join") return;
      toast.success(action === "decline" ? "Invite declined" : action === "leave" ? "You left the chat" : "Reported. Your coach has it.");
      onBack();
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
    }
  };

  const doRename = async () => {
    const next = window.prompt("Name this chat", thread.name)?.trim();
    if (!next || next === thread.name) return;
    try {
      await rename.mutateAsync(next);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't rename it.");
    }
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack} aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <button type="button" onClick={() => setPeopleOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <CrewFaces faces={thread.faces} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{thread.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{joined ? crewSubtitle(thread) : "Group chat invite"}</span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Chat options"><MoreHorizontal className="h-5 w-5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setPeopleOpen(true)}><Users className="mr-2 h-4 w-4" /> People</DropdownMenuItem>
            {joined && <DropdownMenuItem onClick={() => setInviteOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> Invite people</DropdownMenuItem>}
            {joined && thread.is_owner && <DropdownMenuItem onClick={doRename}><Pencil className="mr-2 h-4 w-4" /> Rename</DropdownMenuItem>}
            <DropdownMenuSeparator />
            {joined && <DropdownMenuItem onClick={() => setConfirm("leave")}><LogOut className="mr-2 h-4 w-4" /> Leave</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => setConfirm("report")} className="text-destructive focus:text-destructive"><Flag className="mr-2 h-4 w-4" /> Report</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <GroupChatErrorBoundary key={`crew-${thread.group_id}`}>
        <GroupMessageThread
          groupId={thread.group_id}
          groupName={thread.name}
          canPost={joined}
          canManage={false}
          canReact={joined}
          hidePresence={!joined}
          footer={joined ? undefined : (
            <InviteBar thread={thread} busy={respond.isPending} onPeople={() => setPeopleOpen(true)} onAction={(a) => (a === "join" ? act("join") : setConfirm(a))} />
          )}
        />
      </GroupChatErrorBoundary>

      <PeopleSheet thread={thread} open={peopleOpen} onOpenChange={setPeopleOpen} onInvite={() => { setPeopleOpen(false); setInviteOpen(true); }} />
      {joined && <InviteSheet groupId={thread.group_id} open={inviteOpen} onOpenChange={setInviteOpen} people={people} />}

      <AlertDialog open={confirm !== null && confirm !== "join"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "decline" ? "Decline this invite?" : confirm === "leave" ? `Leave ${thread.name}?` : "Report this chat?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "decline"
                ? "It disappears from your requests. Nobody's told."
                : confirm === "leave"
                  ? thread.is_owner
                    ? "You started it, so the person who's been in it longest takes it over. You can be invited back."
                    : "You can be invited back."
                  : "Your coach gets a copy of this chat so they can step in, and you're out of it for good. Nobody in it is told."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(confirm === "report" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              onClick={() => confirm && act(confirm)}
            >
              {confirm === "decline" ? "Decline" : confirm === "leave" ? "Leave" : "Report"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
