import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUp, Bug, Check, CheckCircle2, ChevronLeft, HelpCircle, Inbox, Lightbulb, Loader2,
  MessageCircle, MoreHorizontal, RotateCcw, ServerCog, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getLiveSupportStatus, getSupportThread, listSupportThreads, replySupportMessage,
  setLiveSupportAvailability, setSupportThreadStatus,
} from "@/lib/member-support.functions";
import { formatTicket } from "@/lib/support-ticket";
import {
  SUPPORT_FILTERS, alertItem, filterSupportItems, parseSupportSub, supportCounts, supportSub, ticketItem,
  type SupportFilter, type SupportItem,
} from "@/lib/support-inbox";
import { summaryFor, titleFor } from "@/lib/support-alert-text";
import { UserAvatar } from "@/components/user-avatar";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const FILTER_KEY = "jf-support-filter";
const ago = (iso: string) => {
  try { return formatDistanceToNowStrict(new Date(iso), { addSuffix: false }).replace(/ (\w)\w+$/, "$1"); } catch { return ""; }
};

/**
 * Support, as a messenger: member tickets and app alerts in one list, tap one to open it
 * full-screen like a chat. "Needs you" is the default, so the coach only sees what's waiting.
 */
export function SupportMessenger({ sub, onOpen }: { sub?: string; onOpen: (sub: string | undefined) => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listSupportThreads);
  const liveFn = useServerFn(getLiveSupportStatus);
  const setLive = useServerFn(setLiveSupportAvailability);
  const [filter, setFilterState] = useState<SupportFilter>(() => {
    try { const v = localStorage.getItem(FILTER_KEY); return SUPPORT_FILTERS.some((f) => f.value === v) ? (v as SupportFilter) : "needs"; } catch { return "needs"; }
  });
  const setFilter = (f: SupportFilter) => { setFilterState(f); try { localStorage.setItem(FILTER_KEY, f); } catch { /* storage off */ } };

  const { data: threads, isLoading: tLoading } = useQuery({
    queryKey: ["admin-support-threads", ""],
    queryFn: () => list({ data: undefined }),
    refetchInterval: 60_000,
  });
  const { data: alerts, isLoading: aLoading } = useQuery({
    queryKey: ["support_alerts", "messenger"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const cols = "*, clients:client_id(id, full_name, profile_picture_url)";
      const [openRes, doneRes] = await Promise.all([
        supabase.from("support_alerts").select(cols).neq("status", "resolved").order("created_at", { ascending: false }).limit(200),
        supabase.from("support_alerts").select(cols).eq("status", "resolved").order("updated_at", { ascending: false }).limit(40),
      ]);
      if (openRes.error) throw openRes.error;
      const byId = new Map<string, any>();
      for (const a of [...(openRes.data ?? []), ...(doneRes.data ?? [])] as any[]) if (!byId.has(a.id)) byId.set(a.id, a);
      return [...byId.values()];
    },
  });
  const { data: live } = useQuery({ queryKey: ["live-support-status"], queryFn: () => liveFn(), refetchInterval: 30_000 });

  useEffect(() => {
    const ch = supabase
      .channel("support-messenger")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "member_support_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-support-threads"] });
        qc.invalidateQueries({ queryKey: ["admin-support-thread"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_alerts" }, () => {
        qc.invalidateQueries({ queryKey: ["support_alerts"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const items = useMemo<SupportItem[]>(() => [
    ...((threads?.threads ?? []) as any[]).map(ticketItem),
    ...(alerts ?? []).map((a) => alertItem(a, titleFor(a), summaryFor(a))),
  ], [threads, alerts]);
  const counts = supportCounts(items);
  const visible = filterSupportItems(items, filter);
  const open = parseSupportSub(sub);
  const loading = tLoading || aLoading;

  const toggleLive = async (next: boolean) => {
    try {
      await setLive({ data: { available: next } });
      await qc.invalidateQueries({ queryKey: ["live-support-status"] });
      toast.success(next ? "You're live — members see you're online" : "Live support off");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't change live status"); }
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className={cn("flex w-full min-h-0 flex-col border-r border-border bg-card md:w-[360px] md:shrink-0", open ? "hidden md:flex" : "flex")}>
        <header className="space-y-2 border-b border-border px-3 py-2.5 md:px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-black tracking-tight md:text-lg">Support</h1>
            {counts.needs > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold leading-4 text-destructive-foreground">{counts.needs}</span>
            )}
            <label className="ml-auto flex items-center gap-1.5 rounded-full bg-secondary/60 py-1 pl-2.5 pr-1.5 text-[11px] font-semibold">
              <span className={cn("h-2 w-2 rounded-full", live?.isAvailable ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70" : "bg-muted-foreground/50")} />
              {live?.isAvailable ? "Live" : "Offline"}
              <Switch checked={!!live?.isAvailable} onCheckedChange={toggleLive} className="scale-75" aria-label="Live support" />
            </label>
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SUPPORT_FILTERS.map((f) => {
              const n = counts[f.value];
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95",
                    active ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}{f.value !== "done" && n > 0 ? ` · ${n}` : ""}
                </button>
              );
            })}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="grid h-32 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : visible.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul>
              {visible.map((i) => (
                <li key={`${i.kind}:${i.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(supportSub(i.kind, i.id))}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition hover:bg-secondary/40 active:bg-secondary/60 md:px-4",
                      open?.id === i.id && "bg-secondary/60",
                    )}
                  >
                    <ItemAvatar item={i} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn("truncate text-sm", i.needsYou ? "font-bold" : "font-semibold")}>{i.name}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{ago(i.at)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <KindPill item={i} />
                        <span className={cn("truncate text-xs", i.needsYou ? "text-foreground/80" : "text-muted-foreground")}>{i.preview}</span>
                        {i.unread > 0 && (
                          <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">{i.unread}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={cn("min-h-0 flex-1 flex-col bg-background", open ? "flex" : "hidden md:flex")}>
        {!open ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
            <div>
              <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Pick a conversation. Member tickets and app alerts both land here.
            </div>
          </div>
        ) : open.kind === "ticket" ? (
          <TicketThread key={open.id} id={open.id} onBack={() => onOpen(undefined)} />
        ) : (
          <AlertThread key={open.id} alert={(alerts ?? []).find((a) => a.id === open.id)} loading={aLoading} onBack={() => onOpen(undefined)} />
        )}
      </section>
    </div>
  );
}

function EmptyState({ filter }: { filter: SupportFilter }) {
  const copy: Record<SupportFilter, [string, string]> = {
    needs: ["You're all caught up", "New member tickets and app problems show up here."],
    members: ["No open tickets", "When a member asks a question or reports a bug, it shows up here."],
    alerts: ["No app problems", "If a client's workout fails to load or sync, you'll see it here."],
    done: ["Nothing closed yet", "Finished tickets and resolved alerts are kept here."],
  };
  return (
    <div className="px-6 py-12 text-center">
      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500/70" />
      <div className="text-sm font-semibold">{copy[filter][0]}</div>
      <div className="mt-1 text-xs text-muted-foreground">{copy[filter][1]}</div>
    </div>
  );
}

function ItemAvatar({ item }: { item: SupportItem }) {
  if (item.kind === "alert" && item.name === "System check") {
    return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><ServerCog className="h-5 w-5" /></span>;
  }
  return (
    <span className="relative shrink-0">
      <UserAvatar src={item.avatar ?? undefined} name={item.name} size={40} />
      {item.kind === "alert" && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-white ring-2 ring-card">
          <TriangleAlert className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}

function KindPill({ item }: { item: SupportItem }) {
  const tone = item.kind === "alert"
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
    : item.title === "Bug report" ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
    : item.title === "Suggestion" ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
    : "bg-sky-500/15 text-sky-600 dark:text-sky-300";
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-bold", tone)}>
      {item.kind === "alert" ? "App alert" : item.title}
    </span>
  );
}

const CAT_ICON: Record<string, any> = { question: HelpCircle, bug: Bug, suggestion: Lightbulb };

function ThreadHeader({ onBack, title, subtitle, avatar, children }: {
  onBack: () => void; title: string; subtitle?: React.ReactNode; avatar: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-border bg-card/80 px-2 py-2 backdrop-blur md:px-4">
      <button type="button" onClick={onBack} aria-label="Back to support" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-secondary md:hidden">
        <ChevronLeft className="h-5 w-5" />
      </button>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      {children}
    </header>
  );
}

function Composer({ placeholder, busy, onSend }: { placeholder: string; busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (await onSend(t)) { setText(""); ref.current?.focus(); }
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);
  return (
    <div className="border-t border-border bg-card/80 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur md:px-4">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 768px)").matches) { e.preventDefault(); void send(); }
          }}
          placeholder={placeholder}
          className="max-h-[140px] min-h-[40px] flex-1 resize-none rounded-2xl border border-border bg-background px-3.5 py-2 text-[16px] leading-snug outline-none focus:border-primary/50 md:text-sm"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

function TicketThread({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const get = useServerFn(getSupportThread);
  const reply = useServerFn(replySupportMessage);
  const setStatus = useServerFn(setSupportThreadStatus);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ["admin-support-thread", id], queryFn: () => get({ data: { threadId: id } }) });
  const thread: any = data?.thread;
  const messages: any[] = data?.messages ?? [];

  useEffect(() => { qc.invalidateQueries({ queryKey: ["admin-support-threads"] }); }, [qc, data?.thread?.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["admin-support-thread", id] }),
    qc.invalidateQueries({ queryKey: ["admin-support-threads"] }),
  ]);
  const changeStatus = async (s: "open" | "answered" | "closed") => {
    try {
      await setStatus({ data: { threadId: id, status: s } });
      await refresh();
      toast.success(s === "closed" ? "Done — moved to Done" : s === "open" ? "Reopened" : "Marked answered");
      if (s === "closed") onBack();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); }
  };
  const name = thread?.member?.full_name || thread?.member?.email || "Member";

  return (
    <>
      <ThreadHeader
        onBack={onBack}
        title={name}
        subtitle={thread ? <><span className="font-mono text-primary">{formatTicket(thread.ticket_number)}</span>{thread.member?.email ? ` · ${thread.member.email}` : ""}</> : undefined}
        avatar={<UserAvatar src={thread?.member?.avatar_url ?? undefined} name={name} size={34} />}
      >
        {thread?.status === "closed" ? (
          <button type="button" onClick={() => changeStatus("open")} className="inline-flex h-9 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-semibold active:scale-95">
            <RotateCcw className="h-3.5 w-3.5" /> Reopen
          </button>
        ) : (
          <button type="button" onClick={() => changeStatus("closed")} className="inline-flex h-9 items-center gap-1 rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white active:scale-95">
            <Check className="h-3.5 w-3.5" /> Done
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More" className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary"><MoreHorizontal className="h-4 w-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => changeStatus("answered")}>Mark answered (waiting on them)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => changeStatus("open")}>Mark as needs reply</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ThreadHeader>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4 md:px-6">
        {isLoading && <div className="grid h-24 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {messages.map((m) => {
          const mine = m.sender_role !== "member";
          const Icon = CAT_ICON[m.category];
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className="max-w-[82%] space-y-1">
                {!mine && Icon && (
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <Icon className="h-3 w-3" /> {m.category}
                  </div>
                )}
                <div className={cn(
                  "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] leading-snug",
                  mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground",
                )}>{m.body}</div>
                <div className={cn("text-[10px] text-muted-foreground", mine && "text-right")}>
                  {new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <Composer
        placeholder={`Reply to ${name.split(" ")[0]}…`}
        busy={busy}
        onSend={async (text) => {
          setBusy(true);
          try { await reply({ data: { threadId: id, body: text } }); await refresh(); return true; }
          catch (e: any) { toast.error(e?.message ?? "Reply failed"); return false; }
          finally { setBusy(false); }
        }}
      />
    </>
  );
}

function AlertThread({ alert, loading, onBack }: { alert: any; loading: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!alert) {
    return (
      <>
        <ThreadHeader onBack={onBack} title="App alert" avatar={<span className="grid h-9 w-9 place-items-center rounded-full bg-muted"><ServerCog className="h-4 w-4" /></span>} />
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "This alert was cleared."}
        </div>
      </>
    );
  }
  const notes: { note: string; at: string }[] = alert.details?.notes ?? [];
  const resolved = alert.status === "resolved";
  const who = alert.client_id ? alert.clients?.full_name || "Client" : "System check";

  const update = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("support_alerts").update({ ...patch, updated_at: new Date().toISOString() } as any).eq("id", alert.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["support_alerts"] });
      toast.success(ok);
      return true;
    } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); return false; }
    finally { setBusy(false); }
  };
  const resolve = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (await update({ status: "resolved", resolved_by: user?.id ?? null, resolved_at: new Date().toISOString() }, "Resolved — moved to Done")) onBack();
  };

  return (
    <>
      <ThreadHeader
        onBack={onBack}
        title={who}
        subtitle={titleFor(alert)}
        avatar={alert.client_id
          ? <UserAvatar src={alert.clients?.profile_picture_url ?? undefined} name={who} size={34} />
          : <span className="grid h-9 w-9 place-items-center rounded-full bg-muted"><ServerCog className="h-4 w-4" /></span>}
      >
        {resolved ? (
          <button type="button" disabled={busy} onClick={() => update({ status: "open", resolved_at: null, resolved_by: null }, "Reopened")} className="inline-flex h-9 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-semibold active:scale-95">
            <RotateCcw className="h-3.5 w-3.5" /> Reopen
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={resolve} className="inline-flex h-9 items-center gap-1 rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white active:scale-95">
            <Check className="h-3.5 w-3.5" /> Resolved
          </button>
        )}
      </ThreadHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 md:px-6">
        <div className="mx-auto max-w-lg rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <TriangleAlert className="h-4 w-4 text-amber-500" /> {titleFor(alert)}
          </div>
          <p className="mt-1.5 text-sm text-foreground/80">{summaryFor(alert)}</p>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {new Date(alert.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {alert.page_route ? ` · ${alert.page_route}` : ""}
          </div>
          {alert.client_id && (
            <button
              type="button"
              onClick={() => navigate({ to: "/admin/communication", search: { tab: "messages", client: alert.client_id } as any })}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground active:scale-95"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Message {who.split(" ")[0]}
            </button>
          )}
        </div>
        {notes.map((n, i) => (
          <div key={i} className="flex justify-end">
            <div className="max-w-[82%] space-y-1">
              <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] leading-snug text-primary-foreground">{n.note}</div>
              <div className="text-right text-[10px] text-muted-foreground">Note · {new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            </div>
          </div>
        ))}
      </div>
      <Composer
        placeholder="Add a private note (only staff see this)…"
        busy={busy}
        onSend={(text) => update(
          { details: { ...(alert.details ?? {}), notes: [...notes, { note: text, at: new Date().toISOString() }] }, ...(alert.status === "open" ? { status: "in_progress" } : {}) },
          "Note saved",
        )}
      />
    </>
  );
}
