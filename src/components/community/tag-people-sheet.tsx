import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { suggestMentions, type CommunityAuthor } from "@/lib/community";
import { useCommunityMembers } from "@/lib/community.queries";
import { MAX_TAGS } from "@/lib/crew-tags";
import { feedback } from "@/lib/feedback";
import { NameMarks } from "@/components/name-marks";

/**
 * Tag people (Instagram's): search the crew by name or @username, tap to
 * tag or untag, the people tagged at the top. Used by the New post screen
 * and the story camera; `dark` over the camera.
 */
export function TagPeopleSheet({
  open,
  onClose,
  tagged,
  onToggle,
  dark = false,
}: {
  open: boolean;
  onClose: () => void;
  tagged: CommunityAuthor[];
  onToggle: (person: CommunityAuthor) => void;
  dark?: boolean;
}) {
  const [q, setQ] = useState("");
  const { data: members, isLoading } = useCommunityMembers(open);
  const people = useMemo(() => (members ?? []).map((m) => ({ ...m.author, username: m.author.username ?? m.username ?? null })), [members]);
  const shown = useMemo(() => {
    const list = q.trim() ? suggestMentions(people, q, 30) : people.slice(0, 60);
    const on = new Set(tagged.map((t) => t.user_id));
    // with nothing typed, the people tagged lead
    return q.trim() ? list : [...list.filter((p) => on.has(p.user_id)), ...list.filter((p) => !on.has(p.user_id))];
  }, [people, q, tagged]);
  const isOn = (p: CommunityAuthor) => tagged.some((t) => t.user_id === p.user_id);
  const full = tagged.length >= MAX_TAGS;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQ("");
          onClose();
        }
      }}
    >
      <SheetContent
        side="bottom"
        swipeToClose
        hideCloseButton
        className={cn("flex max-h-[85dvh] min-h-[60dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[520px]", dark && "dark bg-[#121214] text-white")}
        data-tag-people
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
        <div className="flex items-center gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-[16px] font-semibold">Tag people</SheetTitle>
            <SheetDescription className="text-[12px] text-muted-foreground">
              {tagged.length ? `${tagged.length} tagged · they can tap through to it` : "Their @ shows on it and opens their profile."}
            </SheetDescription>
          </div>
          <button type="button" onClick={onClose} className="h-10 shrink-0 rounded-full px-3 text-[15px] font-semibold text-foreground active:opacity-60" data-tag-people-done>
            Done
          </button>
        </div>
        <div className="px-4 pb-2">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-muted px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value.replace(/^@/, ""))}
              placeholder="Search"
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
              aria-label="Search people to tag"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear" className="grid h-6 w-6 place-items-center rounded-full bg-muted-foreground/25">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {isLoading ? (
            <div className="space-y-3 px-4 py-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : !shown.length ? (
            <p className="px-6 py-10 text-center text-[14px] text-muted-foreground">{q ? `Nobody called "${q}" in the crew` : "Nobody to tag yet"}</p>
          ) : (
            shown.map((p) => {
              const on = isOn(p);
              return (
                <button
                  key={p.user_id}
                  type="button"
                  disabled={!on && full}
                  onClick={() => {
                    feedback("toggle");
                    onToggle(p);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted disabled:opacity-40"
                  aria-pressed={on}
                  data-tag-person={p.username ?? p.user_id}
                >
                  <UserAvatar src={p.avatar_url} name={p.name} size={44} expandable={false} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold">{p.name}</span>
                      <NameMarks person={p as any} userId={(p as any).user_id} size={13} />
                    </span>
                    {p.username && <span className="block truncate text-[13px] text-muted-foreground">@{p.username}</span>}
                  </span>
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-all duration-200",
                      on ? "scale-100 border-foreground bg-foreground text-background" : "border-muted-foreground/50",
                    )}
                    aria-hidden
                  >
                    {on && <Check className="h-3.5 w-3.5 animate-in zoom-in-50 duration-150" strokeWidth={3} />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
