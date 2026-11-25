/**
 * The meeting plan, compact (coach only): six coach-led stages, each a few
 * talking points as one-line rows. A tap opens a point: how to say it, why it
 * matters, where it came from, and the coach's controls (edit, skip, reorder,
 * move to another stage, show or hide on the shared screen). In the meeting
 * the same rows tick off as addressed. Every edit is applied on the server to
 * the plan on file (applyAgendaOp), shown at once here.
 */
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  SECTION_KEYS,
  SECTION_PURPOSE,
  SECTION_TITLES,
  type Agenda,
  type AgendaOp,
  type Basis,
  type SectionKey,
  type TalkingPoint,
} from "@/lib/coaching-sessions/prepare";
import { spoken } from "@/lib/coaching-sessions/script";

export const BASIS_WORDS: Record<Basis, string> = {
  verified: "On file",
  reported: "Their words",
  observed: "Yours",
  interpretation: "Cleo's read",
  unknown: "Unclear",
};
const BASIS_DOT: Record<Basis, string> = {
  verified: "bg-foreground/60",
  reported: "bg-sky-500/70",
  observed: "bg-foreground",
  interpretation: "bg-muted-foreground/50",
  unknown: "bg-warning",
};

const newId = (section: SectionKey) => `${section}:c-${Math.random().toString(36).slice(2, 9)}`;

export function PlanEditor({
  agenda,
  mode,
  reviewedBefore,
  onOps,
  busy,
  current,
  covered,
}: {
  agenda: Agenda;
  mode: "prepare" | "meeting";
  /** points added after this show as New */
  reviewedBefore: string | null;
  onOps: (ops: AgendaOp[]) => void;
  busy?: boolean;
  /** the stage on the shared screen now (meeting mode) */
  current?: SectionKey | null;
  /** points that sound covered in the recording so far */
  covered?: Set<string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<SectionKey>>(() => new Set());
  const [adding, setAdding] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState("");
  const sections = SECTION_KEYS.map((k) => agenda.sections.find((s) => s.key === k)).filter(
    Boolean,
  ) as Agenda["sections"];
  const isNew = (p: TalkingPoint) =>
    !!reviewedBefore && !!p.addedAt && p.addedAt > reviewedBefore && !p.custom;

  return (
    <div
      className="divide-y divide-border rounded-2xl border border-border"
      data-plan-editor={mode}
    >
      {sections.map((sec) => {
        const shown = sec.items.filter((i) => mode === "prepare" || i.status !== "skipped");
        const done = sec.items.filter((i) => i.status === "addressed").length;
        const live = sec.items.filter((i) => i.status !== "skipped").length;
        const isFolded = folded.has(sec.key);
        return (
          <section
            key={sec.key}
            className={cn(current === sec.key && "bg-secondary/40")}
            data-plan-section={sec.key}
          >
            <button
              type="button"
              onClick={() =>
                setFolded((f) => {
                  const n = new Set(f);
                  if (n.has(sec.key)) n.delete(sec.key);
                  else n.add(sec.key);
                  return n;
                })
              }
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              aria-expanded={!isFolded}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  isFolded && "-rotate-90",
                )}
              />
              <span className="text-[15px] font-semibold">{SECTION_TITLES[sec.key]}</span>
              <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground sm:inline">
                {SECTION_PURPOSE[sec.key]}
              </span>
              <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {mode === "meeting" && live ? `${done}/${live} · ` : ""}
                {sec.minutes} min
              </span>
            </button>
            {!isFolded ? (
              <ul className="pb-1.5">
                {shown.map((p, idx) => (
                  <PointRow
                    key={p.id}
                    p={p}
                    section={sec.key}
                    mode={mode}
                    open={open === p.id}
                    onToggle={() => setOpen(open === p.id ? null : p.id)}
                    isNew={isNew(p)}
                    covered={!!covered?.has(p.id)}
                    first={idx === 0}
                    last={idx === shown.length - 1}
                    onOps={onOps}
                    busy={busy}
                  />
                ))}
                {adding === sec.key ? (
                  <li className="px-3 py-1.5">
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!draft.trim()) return;
                        onOps([
                          { op: "add", section: sec.key, id: newId(sec.key), text: draft.trim() },
                        ]);
                        setDraft("");
                        setAdding(null);
                      }}
                    >
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="A talking point, in your words"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
                        onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
                      />
                      <Button type="submit" size="sm" className="h-9">
                        Add
                      </Button>
                    </form>
                  </li>
                ) : (
                  <li className="px-3">
                    <button
                      type="button"
                      onClick={() => setAdding(sec.key)}
                      className="flex h-8 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
                      data-add-point={sec.key}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add a point
                    </button>
                  </li>
                )}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function PointRow({
  p,
  section,
  mode,
  open,
  onToggle,
  isNew,
  covered,
  first,
  last,
  onOps,
  busy,
}: {
  p: TalkingPoint;
  section: SectionKey;
  mode: "prepare" | "meeting";
  open: boolean;
  onToggle: () => void;
  isNew: boolean;
  covered: boolean;
  first: boolean;
  last: boolean;
  onOps: (ops: AgendaOp[]) => void;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.text);
  const [say, setSay] = useState(p.say ?? p.cleoSay ?? "");
  const skipped = p.status === "skipped";
  const addressed = p.status === "addressed";
  const line = spoken(p, section);
  return (
    <li className={cn("group px-3", skipped && "opacity-50")} data-point={p.id}>
      <div className="flex items-start gap-2 py-1.5">
        {mode === "meeting" ? (
          <button
            type="button"
            aria-label={addressed ? "Mark not addressed" : "Mark addressed"}
            onClick={() =>
              onOps([{ op: "status", id: p.id, status: addressed ? "open" : "addressed" }])
            }
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
              addressed
                ? "border-success bg-success text-white"
                : covered
                  ? "border-success/60"
                  : "border-border",
            )}
          >
            {addressed ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        ) : (
          <span
            className={cn("mt-[7px] h-2 w-2 shrink-0 rounded-full", BASIS_DOT[p.basis])}
            title={BASIS_WORDS[p.basis]}
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <span
            className={cn(
              "text-[14px] leading-snug",
              addressed && "text-muted-foreground line-through",
              p.kind === "question" && "italic",
            )}
          >
            {p.text}
          </span>
          <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
            {isNew ? (
              <span className="rounded bg-warning/15 px-1 text-[10.5px] font-medium text-warning">
                New
              </span>
            ) : null}
            {p.custom ? (
              <span className="rounded bg-muted px-1 text-[10.5px] text-muted-foreground">
                Yours
              </span>
            ) : null}
            {covered && !addressed ? (
              <span className="rounded bg-success/10 px-1 text-[10.5px] text-success">
                Sounds covered
              </span>
            ) : null}
            {skipped ? (
              <span className="rounded bg-muted px-1 text-[10.5px] text-muted-foreground">
                Skipped
              </span>
            ) : null}
          </span>
        </button>
        {p.share && !skipped ? (
          <Eye
            className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="On the shared screen"
          />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Point options"
              disabled={busy}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onClick={() => {
                setEditing(true);
                if (!open) onToggle();
              }}
            >
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOps([{ op: "share", id: p.id, share: !p.share }])}>
              {p.share ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}{" "}
              {p.share ? "Hide from shared screen" : "Show on shared screen"}
            </DropdownMenuItem>
            {!first ? (
              <DropdownMenuItem onClick={() => onOps([{ op: "move", id: p.id, dir: "up" }])}>
                <ArrowUp className="mr-2 h-4 w-4" /> Move up
              </DropdownMenuItem>
            ) : null}
            {!last ? (
              <DropdownMenuItem onClick={() => onOps([{ op: "move", id: p.id, dir: "down" }])}>
                <ArrowDown className="mr-2 h-4 w-4" /> Move down
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
            {SECTION_KEYS.filter((k) => k !== section).map((k) => (
              <DropdownMenuItem key={k} onClick={() => onOps([{ op: "section", id: p.id, to: k }])}>
                {SECTION_TITLES[k]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {skipped ? (
              <DropdownMenuItem onClick={() => onOps([{ op: "status", id: p.id, status: "open" }])}>
                <RotateCcw className="mr-2 h-4 w-4" /> Bring back
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() =>
                  onOps([
                    {
                      op: p.custom ? "remove" : "status",
                      id: p.id,
                      ...(p.custom ? {} : { status: "skipped" }),
                    } as AgendaOp,
                  ])
                }
              >
                <SkipForward className="mr-2 h-4 w-4" /> {p.custom ? "Remove" : "Skip"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open ? (
        <div className="mb-2 ml-4 space-y-2 rounded-xl bg-muted/50 p-3" data-point-detail>
          {editing ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                onOps([
                  { op: "edit", id: p.id, text: text.trim() || p.text, say: say.trim() || null },
                ]);
                setEditing(false);
              }}
            >
              <Textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Talking point"
              />
              <Textarea
                rows={2}
                value={say}
                onChange={(e) => setSay(e.target.value)}
                placeholder="How you'll say it (optional)"
                aria-label="How to say it"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-8">
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed">“{line}”</p>
              {p.detail ? <p className="text-[13px] text-muted-foreground">{p.detail}</p> : null}
              <p className="text-[12px] text-muted-foreground">
                {BASIS_WORDS[p.basis]}
                {p.ref ? ` · ${p.ref}` : ""}
                {p.cleoSay && !p.edited ? " · phrasing by Cleo" : ""}
                {p.share ? " · on the shared screen" : " · only you see it"}
              </p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[13px] text-muted-foreground underline-offset-2 hover:underline"
              >
                Edit
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
