import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { fmtTime } from "@/components/chat-shared";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { seenSummary, type SeenState } from "@/lib/group-read-receipts";

type Profile = { full_name: string | null; avatar_url: string | null };

const MAX_FACES = 4;

/** Tappable "Seen by" row: overlapping avatars + names, like Instagram groups. */
export function GroupSeenByRow({
  state, profileById, align, onOpen,
}: {
  state: SeenState;
  profileById: Map<string, Profile>;
  align: "start" | "end";
  onOpen: () => void;
}) {
  const label = seenSummary(state, (id) => profileById.get(id)?.full_name ?? "Member");
  if (!label) return null;
  const faces = state.seen.slice(0, MAX_FACES);
  return (
    <div className={cn("-mt-2 flex", align === "end" ? "justify-end" : "justify-start pl-9")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex max-w-[85%] items-center gap-1.5 rounded-full px-1 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground"
        aria-label={`${label}. Show who has seen this message`}
      >
        <span className="flex -space-x-1.5">
          {faces.map((s) => {
            const p = profileById.get(s.user_id);
            return (
              <UserAvatar
                key={s.user_id}
                src={p?.avatar_url ?? null}
                name={p?.full_name ?? "Member"}
                size={16}
                expandable={false}
                className="ring-2 ring-background"
              />
            );
          })}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

/** Full list for one message: who saw it (and when), who hasn't yet. */
export function GroupSeenBySheet({
  open, onOpenChange, state, profileById, preview,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: SeenState | null;
  profileById: Map<string, Profile>;
  preview?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl pb-[calc(max(env(safe-area-inset-bottom),0.75rem))]">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2"><Eye className="h-4 w-4" /> Seen by</SheetTitle>
          {preview && <SheetDescription className="line-clamp-2">{preview}</SheetDescription>}
        </SheetHeader>
        {state && (
          <div className="mt-3 space-y-4">
            <Section title={`Seen (${state.seen.length})`} empty="Nobody yet.">
              {state.seen.map((s) => (
                <Person key={s.user_id} profile={profileById.get(s.user_id)} detail={fmtTime(s.seen_at)} />
              ))}
            </Section>
            {state.notSeen.length > 0 && (
              <Section title={`Not seen yet (${state.notSeen.length})`}>
                {state.notSeen.map((id) => (
                  <Person key={id} profile={profileById.get(id)} muted />
                ))}
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children.length ? <div className="space-y-1">{children}</div> : <div className="text-sm text-muted-foreground">{empty}</div>}
    </div>
  );
}

function Person({ profile, detail, muted }: { profile?: Profile; detail?: string; muted?: boolean }) {
  const name = profile?.full_name ?? "Member";
  return (
    <div className={cn("flex items-center gap-3 rounded-lg px-1 py-1.5", muted && "opacity-60")}>
      <UserAvatar src={profile?.avatar_url ?? null} name={name} size={32} expandable={false} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      {detail && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{detail}</span>}
    </div>
  );
}
