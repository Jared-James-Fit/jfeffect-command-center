import { useEffect, useMemo, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { cn } from "@/lib/utils";
import { mentionQuery, splitMentions, suggestMentions, type CommunityAuthor, type CommunityMention } from "@/lib/community";
import { useCommunityMembers } from "@/lib/community.queries";

/** A caption with the people it names tappable (bold, like Instagram). */
export function MentionText({ text, mentions, onOpen }: { text: string; mentions?: CommunityMention[] | null; onOpen?: (a: CommunityAuthor) => void }) {
  const parts = useMemo(() => splitMentions(text, mentions), [text, mentions]);
  return (
    <>
      {parts.map((p, i) =>
        p.mention && onOpen ? (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(p.mention!);
            }}
            className="inline p-0 font-bold text-foreground underline-offset-2 hover:underline"
          >
            {p.text}
          </button>
        ) : p.mention ? (
          <span key={i} className="font-bold">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Type "@" and the crew shows up under the box: tap a name and it's in
 * ("@Dwayne "). Name 1-3 people and the post is a collab with them; name
 * more and it's a shout-out. Only fetches the crew once "@" is typed.
 */
export function MentionSuggestBar({
  value,
  onChange,
  inputRef,
  dark = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  dark?: boolean;
  className?: string;
}) {
  const [caret, setCaret] = useState<number | null>(null);
  // follow the caret (typing, tapping, arrow keys)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const sync = () => setCaret(el.selectionStart ?? el.value.length);
    sync();
    el.addEventListener("keyup", sync);
    el.addEventListener("click", sync);
    el.addEventListener("input", sync);
    el.addEventListener("select", sync);
    return () => {
      el.removeEventListener("keyup", sync);
      el.removeEventListener("click", sync);
      el.removeEventListener("input", sync);
      el.removeEventListener("select", sync);
    };
  }, [inputRef]);
  const q = caret == null ? null : mentionQuery(value, caret);
  const { data: members = [] } = useCommunityMembers(!!q || value.includes("@"));
  const people = useMemo(() => members.map((m) => m.author), [members]);
  const picks = q ? suggestMentions(people, q.query) : [];
  if (!q || !picks.length) return null;

  const pick = (a: CommunityAuthor) => {
    const end = q.start + 1 + q.query.length;
    const next = `${value.slice(0, q.start)}@${a.name} ${value.slice(end).replace(/^ /, "")}`;
    onChange(next);
    const at = q.start + a.name.length + 2;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
      setCaret(at);
    });
  };

  return (
    <div className={cn("flex gap-1.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)} role="listbox" aria-label="Mention someone">
      {picks.map((a) => (
        <button
          key={a.user_id}
          type="button"
          role="option"
          aria-selected={false}
          // keep the keyboard up
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => pick(a)}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-[13px] font-bold active:scale-95",
            dark ? "bg-white/12 text-white" : "bg-muted text-foreground",
          )}
        >
          <UserAvatar src={a.avatar_url} name={a.name} size={26} expandable={false} />
          {a.name}
          {a.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
        </button>
      ))}
    </div>
  );
}

/** Everyone on a collab post (author first): tap one for their profile. */
export function CollaboratorsSheet({
  people,
  open,
  onClose,
  onOpen,
}: {
  people: CommunityAuthor[];
  open: boolean;
  onClose: () => void;
  onOpen?: (a: CommunityAuthor) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[70dvh] gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-black">On this post</SheetTitle>
              <SheetDescription className="text-xs">It shows on each of their profiles.</SheetDescription>
            </div>
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="py-1" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
          {people.map((a) => (
            <button
              key={a.user_id}
              type="button"
              onClick={() => {
                onClose();
                onOpen?.(a);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-muted"
            >
              <UserAvatar src={a.avatar_url} name={a.name} size={40} expandable={false} />
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[15px] font-bold">{a.name}</span>
                {a.is_coach && <CoachBadge />}
              </span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
