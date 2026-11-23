/**
 * Coaching automation, the coach's side: one queue pinned in Messages while
 * anything is waiting or happened lately, and the sheet it opens. To do is in
 * priority order (anything that could be serious, then what needs his
 * judgment, then routine replies: pain before check-ins before workouts before
 * missed sessions), Coming up (what's being written or planned), Sent (what
 * went, with Take back for one that went by itself) and Settings (each kind's
 * mode, Pause). Every item can set its own client's rule in one tap.
 *
 * Only for someone whose level includes the approval queue (the owner today;
 * nobody else has automation). The server checks every action again.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Check, Inbox, Loader2, MessageCircle, RotateCcw, Undo2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CHAT_ROW_AVATAR, ChatListRow } from "@/components/messages/chat-list-row";
import { PainReviewSheet } from "@/components/pain/pain-review-sheet";
import {
  approveRecoveryItemFn,
  dismissRecoveryItemFn,
  getRecoveryQueueFn,
  retryRecoveryItemFn,
  saveRecoverySettingsFn,
  setClientRecoveryModeFn,
  unsendRecoveryItemFn,
  type RecoveryItem,
  type RecoveryQueue,
} from "@/lib/recovery-automation/queue.functions";
import { CATEGORIES, MODES, STATUS_WORDS, modeAllowed, riskReasonWords, type AutomationCategory, type AutomationMode } from "@/lib/recovery-automation/rules";
import { queueOrder } from "@/lib/recovery-automation/categories";
import { regionOf } from "@/lib/pain/regions";

export const RECOVERY_QUEUE_KEY = ["recovery-queue"] as const;

const TODO = new Set(["awaiting_approval", "draft", "failed"]);
const COMING = new Set(["queued", "working", "sending"]);

const isPain = (c: AutomationCategory) => c === "recovery_reply" || c === "recovery_follow_up";

function whenWords(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins >= 0 && mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  if (mins < 0 && mins > -60 * 24) {
    const h = Math.round(-mins / 60);
    return h < 1 ? "in a few minutes" : `in ${h}h`;
  }
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** What an item is, in a few words ("Reply to their weekly check-in"). */
export function itemTitle(item: Pick<RecoveryItem, "category" | "regions" | "context">): string {
  const areas = item.regions.map((r) => regionOf(r)?.label ?? r).join(", ");
  switch (item.category) {
    case "recovery_follow_up": {
      const s = item.context?.session;
      return [s ? `Follow-up before ${s.title ?? "their session"} (${shortDay(s.date)})` : "Follow-up", areas].filter(Boolean).join(" · ");
    }
    case "workout_reply":
      return "Reply to their workout review";
    case "checkin_reply":
      return "Reply to their weekly check-in";
    case "missed_session": {
      const w = item.context?.workout;
      return w ? `Missed ${w.title ?? "a workout"} (${shortDay(w.date)})` : "Missed a planned workout";
    }
    default:
      return ["Reply to a pain report", areas].filter(Boolean).join(" · ");
  }
}

/** The inbox row's one line for the item leading the queue. */
function previewOf(i: RecoveryItem): string {
  const who = i.first_name;
  const what =
    i.category === "recovery_follow_up"
      ? `follow-up for ${who}`
      : i.category === "workout_reply"
        ? `reply to ${who}'s workout`
        : i.category === "checkin_reply"
          ? `reply to ${who}'s check-in`
          : i.category === "missed_session"
            ? `check-in for ${who} (missed session)`
            : `reply to ${who}'s pain report`;
  return `${i.risk === "urgent" ? "Needs you: " : ""}${what}`;
}

export function useRecoveryQueue(enabled = true) {
  const get = useServerFn(getRecoveryQueueFn);
  return useQuery({ queryKey: RECOVERY_QUEUE_KEY, queryFn: () => get(), enabled, staleTime: 30_000, refetchInterval: 60_000, retry: false });
}

/** The row pinned in Messages (admin), shown while something is waiting or happened in the last two weeks. */
export function RecoveryInboxRow() {
  const { data } = useRecoveryQueue();
  const search = useSearch({ strict: false }) as { recovery?: string };
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // a push about one item opens the queue on it
  useEffect(() => {
    if (search.recovery) {
      setFocusId(search.recovery);
      setOpen(true);
    }
  }, [search.recovery]);
  if (!data || !data.enabled) return null;
  const todo = data.items.filter((i) => TODO.has(i.status)).sort(queueOrder);
  const urgent = todo.some((i) => i.risk === "urgent");
  if (!todo.length && !data.items.length && !open) return null;
  const lead = todo[0] ?? data.items[0];
  const preview = lead ? (todo.length ? previewOf(lead) : `${STATUS_WORDS[lead.status] ?? lead.status}: ${lead.first_name}`) : "Nothing waiting";
  return (
    <>
      <ChatListRow
        data-recovery-row
        avatar={
          <span className={cn("flex shrink-0 items-center justify-center rounded-full", urgent ? "bg-warning/15 text-warning" : "bg-muted text-foreground")} style={{ width: CHAT_ROW_AVATAR, height: CHAT_ROW_AVATAR }}>
            <Inbox className="h-6 w-6" />
          </span>
        }
        name="Coaching queue"
        preview={data.settings.paused ? `Paused · ${preview}` : preview}
        at={lead?.updated_at ?? null}
        unread={todo.length > 0}
        unreadLabel={`${todo.length} waiting`}
        after={todo.length > 1 ? <span className="text-[13px] font-semibold text-muted-foreground">{todo.length}</span> : undefined}
        onClick={() => {
          setFocusId(null);
          setOpen(true);
        }}
      />
      <RecoveryQueueSheet open={open} onOpenChange={setOpen} queue={data} focusId={focusId} />
    </>
  );
}

type Tab = "todo" | "coming" | "sent" | "settings";

export function RecoveryQueueSheet({ open, onOpenChange, queue, focusId, initialTab }: { open: boolean; onOpenChange: (v: boolean) => void; queue: RecoveryQueue | undefined; focusId?: string | null; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "todo");
  const [painFor, setPainFor] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open || !queue?.enabled) return;
    if (initialTab) return setTab(initialTab);
    const f = focusId ? queue.items.find((i) => i.id === focusId) : null;
    setTab(f ? (TODO.has(f.status) ? "todo" : COMING.has(f.status) ? "coming" : "sent") : "todo");
  }, [open, focusId, initialTab, queue?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => (queue?.enabled ? queue.items : []), [queue]);
  const todo = useMemo(() => items.filter((i) => TODO.has(i.status)).sort(queueOrder), [items]);
  const coming = useMemo(() => items.filter((i) => COMING.has(i.status)).sort((a, b) => a.due_at.localeCompare(b.due_at)), [items]);
  const done = useMemo(() => items.filter((i) => !TODO.has(i.status) && !COMING.has(i.status)), [items]);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "todo", label: "To do", count: todo.length },
    { key: "coming", label: "Coming up", count: coming.length },
    { key: "sent", label: "Sent" },
    { key: "settings", label: "Settings" },
  ];
  const openChat = (clientId: string) => {
    onOpenChange(false);
    void navigate({ to: "/admin/messages", search: { client: clientId } as any });
  };
  const rules = queue?.enabled ? queue.rules : [];
  const list = tab === "todo" ? todo : tab === "coming" ? coming : done;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" swipeToClose hideCloseButton className="z-[70] flex max-h-[92svh] flex-col gap-0 rounded-t-3xl p-0" data-recovery-sheet>
          <SheetHeader className="shrink-0 space-y-0.5 border-b border-border/60 px-5 pb-3 pt-5 text-left">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <SheetTitle className="text-lg font-semibold">Coaching queue</SheetTitle>
                <SheetDescription className="text-xs">Replies to pain reports, check-ins and workout reviews, follow-ups and missed sessions, most important first. Anything that needs your judgment always waits for you.</SheetDescription>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto pt-2" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold", tab === t.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                  {t.count ? <span className="tabular-nums text-muted-foreground">{t.count}</span> : null}
                </button>
              ))}
            </div>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-6 pt-4" data-sheet-scroll>
            {!queue?.enabled ? (
              <p className="text-sm text-muted-foreground">Automation isn't part of your plan.</p>
            ) : tab === "settings" ? (
              <RecoverySettings queue={queue} />
            ) : list.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {tab === "todo" ? "Nothing waiting on you." : tab === "coming" ? "Nothing being written or planned." : "Nothing sent in the last two weeks."}
              </p>
            ) : (
              list.map((i) => (
                <ItemCard
                  key={i.id}
                  item={i}
                  queue={queue}
                  rule={(rules.find((r) => r.client_id === i.client_id && r.category === i.category)?.mode as AutomationMode | undefined) ?? null}
                  focused={i.id === focusId}
                  onOpenChat={() => openChat(i.client_id)}
                  onOpenReport={() => setPainFor(i.client_id)}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
      <PainReviewSheet clientId={painFor} onClose={() => setPainFor(null)} />
    </>
  );
}

function ItemCard({
  item,
  queue,
  rule,
  focused,
  onOpenChat,
  onOpenReport,
}: {
  item: RecoveryItem;
  queue: Extract<RecoveryQueue, { enabled: true }>;
  rule: AutomationMode | null;
  focused: boolean;
  onOpenChat: () => void;
  onOpenReport: () => void;
}) {
  const qc = useQueryClient();
  const approveFn = useServerFn(approveRecoveryItemFn);
  const dismissFn = useServerFn(dismissRecoveryItemFn);
  const retryFn = useServerFn(retryRecoveryItemFn);
  const unsendFn = useServerFn(unsendRecoveryItemFn);
  const ruleFn = useServerFn(setClientRecoveryModeFn);
  const [text, setText] = useState(item.draft ?? "");
  useEffect(() => setText(item.draft ?? ""), [item.draft]);
  const refresh = () => qc.invalidateQueries({ queryKey: RECOVERY_QUEUE_KEY });
  const send = useMutation({
    mutationFn: () => approveFn({ data: { id: item.id, text: text.trim() } }),
    onSuccess: () => {
      toast.success(`Sent to ${item.first_name}`);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send it"),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissFn({ data: { id: item.id } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't dismiss it"),
  });
  const retry = useMutation({
    mutationFn: () => retryFn({ data: { id: item.id } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't try again"),
  });
  const unsend = useMutation({
    mutationFn: () => unsendFn({ data: { id: item.id } }),
    onSuccess: () => {
      toast.success("Taken back");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't take it back"),
  });
  const setRule = useMutation({
    mutationFn: (mode: AutomationMode | null) => ruleFn({ data: { clientId: item.client_id, category: item.category, mode } }),
    onSuccess: () => {
      toast.success("Saved for " + item.first_name);
      refresh();
      qc.invalidateQueries({ queryKey: ["client-recovery", item.client_id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
  });
  const ref = (el: HTMLDivElement | null) => {
    if (el && focused) el.scrollIntoView({ block: "nearest" });
  };
  const waiting = item.status === "awaiting_approval" || item.status === "draft";
  const autoSent = item.status === "sent" && !item.decided_by;
  const canTakeBack = autoSent && !!item.sent_at && Date.now() - Date.parse(item.sent_at) < 24 * 3_600_000;
  const facts = item.context?.facts ?? [];
  const general = (queue.settings.modes[item.category] ?? "approval") as AutomationMode;
  const options = MODES.filter((m) => modeAllowed(queue.caps.features, item.category, m.key));
  const kind = CATEGORIES.find((c) => c.key === item.category)?.short ?? "this";

  return (
    <div ref={ref} className={cn("space-y-2.5 rounded-xl border p-3.5", item.risk === "urgent" && waiting ? "border-warning/60" : "border-border", focused && "ring-2 ring-foreground/20")} data-recovery-item={item.id} data-recovery-status={item.status} data-recovery-category={item.category}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight">{item.client_name}</p>
          <p className="text-[12px] text-muted-foreground">{itemTitle(item)}</p>
        </div>
        <span className={cn("shrink-0 text-right text-[12px] font-semibold", item.status === "failed" ? "text-destructive" : waiting ? "text-warning" : "text-muted-foreground")}>
          {item.status === "sent" ? `${autoSent ? "Sent automatically" : "Sent"} ${whenWords(item.sent_at)}` : COMING.has(item.status) ? `${STATUS_WORDS[item.status]} · ${whenWords(item.due_at)}` : STATUS_WORDS[item.status] ?? item.status}
        </span>
      </div>

      {item.risk && item.risk !== "routine" && waiting && (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug" data-recovery-risk={item.risk}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-semibold">{item.risk === "urgent" ? (isPain(item.category) ? "Warning sign. " : "May need medical help. ") : "Needs your judgment. "}</span>
            {sentenceCase(item.risk_reasons.filter((r) => !(r === "red_flag" && item.risk_reasons.includes("urgent"))).map(riskReasonWords).join(", "))}.
          </span>
        </p>
      )}
      {!!item.context?.reports?.length && <p className="text-[13px] text-muted-foreground">{item.context.reports.join("; ")}</p>}
      {facts.length > 0 && (
        <details className="text-[13px]" data-recovery-facts>
          <summary className="cursor-pointer select-none text-muted-foreground">What it's written from</summary>
          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
            {facts.map((f, n) => (
              <li key={n}>{f}</li>
            ))}
          </ul>
        </details>
      )}
      {item.why && <p className="text-[12px] text-muted-foreground">{item.why}</p>}
      {item.status === "failed" && item.error && <p className="text-[12px] text-destructive">Couldn't write it: {item.error}</p>}

      {waiting ? (
        <>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="resize-none text-base" aria-label={`Message to ${item.first_name}`} />
          <p className="text-[11px] text-muted-foreground">Written for you from what they sent and their records. Nothing goes to {item.first_name} until you send it.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send.mutate()} disabled={send.isPending || !text.trim()} data-recovery-send>
              {send.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Send to {item.first_name}
            </Button>
            {isPain(item.category) && (
              <Button size="sm" variant="outline" onClick={onOpenReport}>
                Open report
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
              Dismiss
            </Button>
          </div>
        </>
      ) : item.draft && item.status !== "queued" && item.status !== "working" ? (
        <p className="whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 text-[14px] leading-snug">{item.draft}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {item.status === "failed" && (
          <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />} Try again
          </Button>
        )}
        {(item.status === "queued" || item.status === "working") && (
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
            Don't send this
          </Button>
        )}
        {canTakeBack && (
          <Button size="sm" variant="ghost" onClick={() => unsend.mutate()} disabled={unsend.isPending} data-recovery-unsend>
            <Undo2 className="mr-1.5 h-4 w-4" /> Take it back
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpenChat}>
          <MessageCircle className="mr-1.5 h-4 w-4" /> Chat
        </Button>
      </div>
      <label className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5 text-[12px] text-muted-foreground">
        <span className="min-w-0">
          <span className="block">{`${kind} for ${item.first_name}`}</span>
          <span className="block text-[11px]">{`Your default: ${MODES.find((m) => m.key === general)?.label ?? general}`}</span>
        </span>
        <select
          value={rule ?? ""}
          onChange={(e) => setRule.mutate((e.target.value || null) as AutomationMode | null)}
          disabled={setRule.isPending}
          className="h-10 w-[9.5rem] shrink-0 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground"
          aria-label={`${kind} for ${item.first_name}`}
          data-recovery-client-rule
        >
          <option value="">Default</option>
          {options.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function RecoverySettings({ queue }: { queue: Extract<RecoveryQueue, { enabled: true }> }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveRecoverySettingsFn);
  const [paused, setPaused] = useState(queue.settings.paused);
  const [modes, setModes] = useState<Partial<Record<AutomationCategory, AutomationMode>>>(queue.settings.modes as any);
  const save = useMutation({
    mutationFn: (next: { paused: boolean; modes: Partial<Record<AutomationCategory, AutomationMode>> }) => saveFn({ data: next }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: RECOVERY_QUEUE_KEY });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });
  const set = (cat: AutomationCategory, mode: AutomationMode) => {
    const next = { ...modes, [cat]: mode };
    setModes(next);
    save.mutate({ paused, modes: next });
  };
  const owner = queue.caps.features.includes("owner.controls");
  const counts = queue.rules.length;
  // a kind his level doesn't allow at all (every mode but Off) isn't offered
  const kinds = CATEGORIES.filter((c) => modeAllowed(queue.caps.features, c.key, "approval"));

  return (
    <div className="space-y-5" data-recovery-settings>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5">
        <div>
          <p className="text-[15px] font-semibold">Pause everything</p>
          <p className="text-[12px] text-muted-foreground">Nothing is drafted or sent while it's paused.</p>
        </div>
        <Switch
          checked={paused}
          onCheckedChange={(v) => {
            setPaused(v);
            save.mutate({ paused: v, modes });
          }}
          aria-label="Pause coaching automation"
        />
      </div>
      <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-[12px] text-muted-foreground" data-recovery-modes-legend>
        {MODES.filter((m) => kinds.some((c) => modeAllowed(queue.caps.features, c.key, m.key))).map((m) => (
          <p key={m.key}>
            <span className="font-semibold text-foreground">{m.label}:</span> {m.line}
          </p>
        ))}
      </div>
      {kinds.map((c) => {
        const current = (modes[c.key] ?? "approval") as AutomationMode;
        return (
          <div key={c.key} className="space-y-2">
            <div>
              <p className="text-[15px] font-semibold">{c.label}</p>
              <p className="text-[12px] text-muted-foreground">{c.line}</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={c.label}>
              {MODES.filter((m) => modeAllowed(queue.caps.features, c.key, m.key)).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={current === m.key}
                  onClick={() => current !== m.key && set(c.key, m.key)}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-lg border px-2 text-[13px] font-semibold",
                    current === m.key ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted/50",
                  )}
                  data-recovery-mode={`${c.key}:${m.key}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[12px] text-muted-foreground">
        {counts ? `${counts} client ${counts === 1 ? "rule" : "rules"} override this. ` : ""}Change one client's from any of their items in the queue, or in their pain report. A message sent by itself says "Sent automatically" under it, and you can take it back for a day.
      </p>
      {owner && queue.record.length > 0 && (
        <div className="space-y-1.5" data-recovery-record>
          <p className="text-[13px] font-semibold text-muted-foreground">Record</p>
          <ul className="space-y-1 text-[12px] text-muted-foreground">
            {queue.record.slice(0, 30).map((r) => (
              <li key={r.id}>
                <span className="tabular-nums">{new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> · {r.kind.replace(/_/g, " ")}
                {r.detail?.why ? ` (${r.detail.why})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
