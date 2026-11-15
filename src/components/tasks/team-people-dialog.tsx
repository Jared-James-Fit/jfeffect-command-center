/**
 * Who a note is shared with: one sheet for sharing a Quick note (as a team
 * note, or as a task), starting a team note, and changing a team note's people.
 * Tick as many teammates as it's for; a group shared with before is one tap.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, StickyNote, ListChecks } from "lucide-react";
import { QUADRANTS, firstName, type TaskQuadrant, type TeamMember } from "@/lib/tasks";
import { groupKey, groupLabel } from "@/lib/team-notes";
import { cn } from "@/lib/utils";

type QuadStyle = { color: string; title: string; subtitle: string };
export type ShareAs = "note" | "task";
export type PeoplePick = { people: string[]; kind: ShareAs; quadrant: TaskQuadrant };

export function TeamPeopleDialog({
  open, title, description, teamMembers, me, initial, groups = [], taskStyles, confirmLabel, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  teamMembers: TeamMember[];
  me: string | null;
  /** Who's ticked when it opens (never me: I'm always on it). */
  initial: string[];
  /** Groups shared with before, newest first: one tap ticks the whole group. */
  groups?: string[][];
  /** Set to offer "Task" as well as "Team note". */
  taskStyles?: Record<TaskQuadrant, QuadStyle>;
  confirmLabel: string;
  onConfirm: (pick: PeoplePick) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [kind, setKind] = useState<ShareAs>("note");
  const [quadrant, setQuadrant] = useState<TaskQuadrant>("do");
  const initialKey = groupKey(initial);
  useEffect(() => {
    if (!open) return;
    setPicked(initial.filter((u) => u !== me));
    // Nobody to share a note with: it can still go on the Team board as a task.
    setKind(taskStyles && !teamMembers.some((m) => m.user_id !== me) ? "task" : "note");
    setQuadrant("do");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey, me]);

  const others = teamMembers.filter((m) => m.user_id !== me);
  const nameOf = (u: string) => teamMembers.find((m) => m.user_id === u)?.full_name ?? "";
  // A group of one is the same as that person's chip below.
  const groupChips = groups.some((g) => g.length > 1) ? groups : [];
  const toggle = (u: string) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]));
  const pickedKey = groupKey(picked);
  const needsSomeone = kind === "note" && picked.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="z-[90] max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription className="truncate">{description}</DialogDescription>
            : <DialogDescription className="sr-only">Pick who it&apos;s shared with</DialogDescription>}
        </DialogHeader>

        {taskStyles && (
          <div className="grid grid-cols-2 rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Share as">
            {([
              { key: "note" as const, label: "Team note", icon: StickyNote },
              { key: "task" as const, label: "Task", icon: ListChecks },
            ]).map((o) => {
              const on = kind === o.key;
              const Icon = o.icon;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(o.key)}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition-colors",
                    on ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />{o.label}
                </button>
              );
            })}
          </div>
        )}

        {groupChips.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">Recent groups</div>
            <div className="flex flex-wrap gap-1.5">
              {groupChips.map((g) => {
                const on = groupKey(g) === pickedKey;
                return (
                  <button
                    key={groupKey(g)}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(g)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors",
                      on ? "border-foreground/40 bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {groupLabel(g.map(nameOf))}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground">People</div>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody else is on the team yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {others.map((m) => {
                const on = picked.includes(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(m.user_id)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                      on ? "border-foreground/40 bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {on && <Check className="h-4 w-4" />}
                    {firstName(m.full_name) || m.full_name}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {kind === "task"
              ? picked.length
                ? "You and everyone picked get it in My tasks."
                : "Nobody picked: it goes on the Team board for anyone to pick up."
              : "You're on it too. Everyone on it can read and edit it."}
          </p>
        </div>

        {kind === "task" && taskStyles && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">Category</div>
            <div className="grid grid-cols-2 gap-1.5">
              {QUADRANTS.map((q) => {
                const st = taskStyles[q.key];
                const on = quadrant === q.key;
                return (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setQuadrant(q.key)}
                    aria-pressed={on}
                    className={cn("min-h-10 rounded-md border px-1.5 text-xs font-bold transition-shadow", on && "ring-2 ring-offset-1 ring-offset-background")}
                    style={{
                      color: st.color,
                      borderColor: `color-mix(in srgb, ${st.color} 45%, transparent)`,
                      backgroundColor: `color-mix(in srgb, ${st.color} ${on ? 22 : 10}%, transparent)`,
                      ...(on ? { ["--tw-ring-color" as string]: st.color } : {}),
                    }}
                  >
                    {st.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={needsSomeone} onClick={() => onConfirm({ people: picked, kind, quadrant })}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
