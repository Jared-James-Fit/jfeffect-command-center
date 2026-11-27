/**
 * What Cleo remembers about a client, compact (coach only): what's waiting for
 * review first (new lines from meetings, conflicts with something already
 * remembered, lines past their date), each a one-line row with a checkbox for
 * Keep / Let go in bulk, then everything kept, grouped (Goals, Preferences,
 * Constraints, Decisions, Coaching insights) and folded. A row opens to its
 * source quote and its controls. Every change has Undo. Only kept, current
 * lines reach Cleo's other work.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, Plus, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  intelligenceBulkFn,
  intelligenceFn,
  intelligenceRestoreFn,
} from "@/lib/coaching-sessions/sessions.functions";
import {
  CATEGORY_ORDER,
  CATEGORY_WORDS,
  categoryOf,
  memoryBoard,
  scopeOf,
  type MemoryCategory,
  type MemoryRow,
} from "@/lib/coaching-sessions/memory";
import { billingDay } from "@/lib/date-range";

const KIND_FOR: Record<MemoryCategory, string> = {
  goals: "goal",
  preferences: "preference",
  constraints: "constraint",
  decisions: "decision",
  insights: "approach",
};

export function MemoryPanel({
  clientId,
  rows,
  today,
  onChange,
  title = "What Cleo remembers",
  compact = false,
  onOpenSource,
}: {
  clientId: string;
  rows: MemoryRow[];
  today: string;
  onChange: () => void;
  title?: string;
  /** a meeting's own lines: no add row, no kept groups */
  compact?: boolean;
  onOpenSource?: (sessionId: string) => void;
}) {
  const board = useMemo(() => memoryBoard(rows, today), [rows, today]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [openCat, setOpenCat] = useState<Set<MemoryCategory>>(() => new Set());
  const [open, setOpen] = useState<string | null>(null);
  const bulk = useServerFn(intelligenceBulkFn);
  const restore = useServerFn(intelligenceRestoreFn);
  const act = useServerFn(intelligenceFn);
  const qc = useQueryClient();
  void qc;

  const undoable = (snapshot: any[], words: string) =>
    toast.success(words, {
      action: {
        label: "Undo",
        onClick: () =>
          void restore({ data: { clientId, rows: snapshot } }).then(onChange, (e: any) =>
            toast.error(e?.message ?? "Couldn't undo"),
          ),
      },
    });

  const runBulk = useMutation({
    mutationFn: (v: {
      ids: string[];
      action: "confirm" | "remove" | "archive" | "dismiss_conflict";
    }) => bulk({ data: { clientId, ...v } }),
    onSuccess: (r, v) => {
      setPicked(new Set());
      onChange();
      const n = v.ids.length;
      undoable(
        r.snapshot,
        v.action === "confirm"
          ? `Kept ${n}`
          : v.action === "remove"
            ? `Let go of ${n}`
            : v.action === "archive"
              ? `Marked ${n} no longer true`
              : "Conflict cleared",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });

  const pending = [...board.pending, ...board.outdated.filter((o) => !board.pending.includes(o))];
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allPicked = pending.length > 0 && pending.every((r) => picked.has(r.id));

  return (
    <section className="rounded-2xl border border-border" data-memory-panel>
      <header className="flex items-center gap-2 px-3 py-2.5">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {pending.length ? (
          <span
            className="rounded-full bg-warning/15 px-2 py-0.5 text-[12px] font-medium text-warning"
            data-memory-pending
          >
            {pending.length} to review
          </span>
        ) : null}
        <span className="ml-auto text-[12px] text-muted-foreground">{board.total} kept</span>
      </header>

      {pending.length ? (
        <div className="border-t border-border">
          <div className="flex items-center gap-2 px-3 py-2">
            <Checkbox
              checked={allPicked}
              onCheckedChange={(v) =>
                setPicked(v === true ? new Set(pending.map((r) => r.id)) : new Set())
              }
              aria-label="Select all to review"
            />
            <span className="text-[13px] text-muted-foreground">
              {picked.size ? `${picked.size} selected` : "Select to keep or let go together"}
            </span>
            {picked.size ? (
              <div className="ml-auto flex gap-1.5">
                <Button
                  size="sm"
                  className="h-8"
                  loading={runBulk.isPending}
                  onClick={() => runBulk.mutate({ ids: [...picked], action: "confirm" })}
                  data-memory-keep
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Keep
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => runBulk.mutate({ ids: [...picked], action: "remove" })}
                >
                  Let go
                </Button>
              </div>
            ) : null}
          </div>
          <ul className="pb-1">
            {pending.map((r) => (
              <MemoryLine
                key={r.id}
                r={r}
                today={today}
                checked={picked.has(r.id)}
                onCheck={() => toggle(r.id)}
                open={open === r.id}
                onOpen={() => setOpen(open === r.id ? null : r.id)}
                clash={r.conflicts_with ? (byId.get(r.conflicts_with) ?? null) : null}
                clientId={clientId}
                onChange={onChange}
                act={act}
                undoable={undoable}
                restore={restore}
                onOpenSource={onOpenSource}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {!compact ? (
        <div className="border-t border-border">
          {board.groups.length ? (
            board.groups.map((g) => {
              const isOpen = openCat.has(g.category);
              return (
                <div key={g.category} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenCat((s) => {
                        const n = new Set(s);
                        if (n.has(g.category)) n.delete(g.category);
                        else n.add(g.category);
                        return n;
                      })
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        !isOpen && "-rotate-90",
                      )}
                    />
                    <span className="text-[14px] font-medium">{g.title}</span>
                    <span className="text-[12px] text-muted-foreground">{g.rows.length}</span>
                  </button>
                  {isOpen ? (
                    <ul className="pb-1">
                      {g.rows.map((r) => (
                        <MemoryLine
                          key={r.id}
                          r={r}
                          today={today}
                          open={open === r.id}
                          onOpen={() => setOpen(open === r.id ? null : r.id)}
                          clientId={clientId}
                          onChange={onChange}
                          act={act}
                          undoable={undoable}
                          restore={restore}
                onOpenSource={onOpenSource}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="px-3 py-2.5 text-[13px] text-muted-foreground">
              Nothing kept yet. Meetings add to it, and you can add anything worth remembering.
            </p>
          )}
          <AddMemory clientId={clientId} onChange={onChange} act={act} />
        </div>
      ) : null}
    </section>
  );
}

function MemoryLine({
  r,
  today,
  checked,
  onCheck,
  open,
  onOpen,
  clash,
  clientId,
  onChange,
  act,
  undoable,
  restore,
  onOpenSource,
}: {
  r: MemoryRow;
  today: string;
  checked?: boolean;
  onCheck?: () => void;
  open: boolean;
  onOpen: () => void;
  clash?: MemoryRow | null;
  clientId: string;
  onChange: () => void;
  act: any;
  undoable: (snapshot: any[], words: string) => void;
  restore: any;
  onOpenSource?: (sessionId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.text);
  const scope = scopeOf(r);
  const outdated =
    r.status === "confirmed" &&
    ((r.permanence === "temporary" && r.expires_on && r.expires_on < today) ||
      (r.event_date && r.event_date < today));
  const go = useMutation({
    mutationFn: (v: {
      action: "confirm" | "edit" | "archive" | "remove";
      permanence?: "lasting" | "temporary";
      text?: string;
    }) =>
      act({
        data: {
          clientId,
          id: r.id,
          action: v.action,
          ...(v.text ? { text: v.text } : {}),
          ...(v.permanence ? { permanence: v.permanence } : {}),
        },
      }),
    onSuccess: (_x: unknown, v) => {
      setEditing(false);
      onChange();
      if (v.action === "remove" || v.action === "archive")
        undoable([r], v.action === "remove" ? "Let go" : "Marked no longer true");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  void restore;
  return (
    <li className="px-3" data-memory={r.id}>
      <div className="flex items-start gap-2 py-1.5">
        {onCheck ? (
          <Checkbox
            className="mt-0.5"
            checked={!!checked}
            onCheckedChange={onCheck}
            aria-label="Select"
          />
        ) : (
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onOpen}
          aria-expanded={open}
        >
          <span className="text-[14px] leading-snug">{r.text}</span>
          <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle text-[10.5px]">
            {onCheck ? (
              <span className="rounded bg-muted px-1 text-muted-foreground">
                {CATEGORY_WORDS[categoryOf(r.kind)]}
              </span>
            ) : null}
            {scope === "temporary" && r.expires_on ? (
              <span className="rounded bg-muted px-1 text-muted-foreground">
                until {billingDay(r.expires_on)}
              </span>
            ) : null}
            {scope === "event" ? (
              <span className="rounded bg-muted px-1 text-muted-foreground">
                {r.event_title ?? "Event"}
              </span>
            ) : null}
            {r.auto_kept ? (
              <span className="rounded bg-muted px-1 text-muted-foreground">
                Kept automatically
              </span>
            ) : null}
            {r.conflicts_with ? (
              <span className="rounded bg-warning/15 px-1 text-warning">Conflicts</span>
            ) : null}
            {outdated ? (
              <span className="rounded bg-warning/15 px-1 text-warning">Outdated</span>
            ) : null}
            {(r.merged_count ?? 1) > 1 ? (
              <span className="rounded bg-muted px-1 text-muted-foreground">
                said {r.merged_count}×
              </span>
            ) : null}
          </span>
        </button>
      </div>
      {open ? (
        <div className="mb-2 ml-6 space-y-2 rounded-xl bg-muted/50 p-3">
          {clash ? (
            <p className="text-[13px]">
              <span className="text-warning">Conflicts with:</span> {clash.text}
            </p>
          ) : null}
          {r.source_session_id ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Source: coaching meeting{r.created_at ? ` · ${billingDay(r.created_at.slice(0, 10))}` : ""}</span>
              {onOpenSource ? <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onOpenSource(r.source_session_id!)}>Open meeting</Button> : null}
            </div>
          ) : null}
          {r.source_quote ? (
            <p className="flex gap-1.5 text-[12.5px] italic text-muted-foreground">
              <Quote className="mt-0.5 h-3 w-3 shrink-0" />“{r.source_quote}”
            </p>
          ) : null}
          {r.review_reason && r.status === "proposed" ? (
            <p className="text-[12px] text-muted-foreground">{r.review_reason}</p>
          ) : null}
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim().length >= 3)
                  go.mutate({
                    action: r.status === "proposed" ? "confirm" : "edit",
                    text: text.trim(),
                  });
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-9" loading={go.isPending}>
                Save
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {r.status === "proposed" ? (
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => go.mutate({ action: "confirm" })}
                  loading={go.isPending}
                >
                  Keep
                </Button>
              ) : null}
              <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() =>
                  go.mutate({
                    action: r.status === "proposed" ? "confirm" : "edit",
                    permanence: r.permanence === "temporary" ? "lasting" : "temporary",
                  })
                }
              >
                {r.permanence === "temporary" ? "Make ongoing" : "Only for now"}
              </Button>
              {r.status === "confirmed" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => go.mutate({ action: "archive" })}
                >
                  No longer true
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                onClick={() => go.mutate({ action: "remove" })}
              >
                {r.status === "proposed" ? "Let go" : "Remove"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function AddMemory({
  clientId,
  onChange,
  act,
}: {
  clientId: string;
  onChange: () => void;
  act: any;
}) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState<MemoryCategory>("preferences");
  const add = useMutation({
    mutationFn: () =>
      act({ data: { clientId, action: "add", text: text.trim(), kind: KIND_FOR[cat] } }),
    onSuccess: () => {
      setText("");
      onChange();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  return (
    <form
      className="flex gap-2 border-t border-border px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim().length >= 3) add.mutate();
      }}
    >
      <select
        value={cat}
        onChange={(e) => setCat(e.target.value as MemoryCategory)}
        className="h-9 shrink-0 rounded-lg border border-input bg-background px-2 text-[13px]"
        aria-label="Category"
      >
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_WORDS[c]}
          </option>
        ))}
      </select>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Something worth remembering"
        className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="h-9"
        loading={add.isPending}
        aria-label="Add"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </form>
  );
}
