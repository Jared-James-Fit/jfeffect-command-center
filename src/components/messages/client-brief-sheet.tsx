import { useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import {
  AlertTriangle, CalendarClock, Check, ChevronRight, ClipboardCheck, Clock, Hourglass, Image as ImageIcon,
  MessageCircle, RefreshCw, Sparkles,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { getClientBriefAi, type ClientBriefAi } from "@/lib/client-brief.functions";
import { briefWaitingLines, waitingCount, type ClientSignals } from "@/lib/inbox-brief";

export type BriefClient = {
  id: string;
  full_name: string | null;
  profile_picture_url?: string | null;
  last_active_at?: string | null;
};

const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  try { return `${formatDistanceToNowStrict(parseISO(iso))} ago`; } catch { return ""; }
};

/**
 * A client at a glance: what's going on (an AI read of the chat, what's
 * waiting and recent training) and every open item, each one tap from the
 * chat. Opened from the client's photo in the inbox or their name in the chat.
 */
export function ClientBriefSheet({
  open, onOpenChange, client, signals, needsReply, waitingOnClient, readReceipt, onOpenChat, onMarkDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: BriefClient | null;
  signals: ClientSignals | undefined;
  needsReply: boolean;
  /** I wrote last and I'm waiting on them: when, and whether they've read it. */
  waitingOnClient?: { since: string; overdue: boolean } | null;
  readReceipt?: string | null;
  onOpenChat: () => void;
  onMarkDone?: () => void;
}) {
  const qc = useQueryClient();
  const briefFn = useServerFn(getClientBriefAi);
  const lines = useMemo(
    () => briefWaitingLines(signals, { waitingOnClientSince: waitingOnClient?.since ?? null }),
    [signals, waitingOnClient?.since],
  );
  const key = ["client-brief-ai", client?.id ?? "", lines.join("|")];
  const ai = useQuery({
    queryKey: key,
    enabled: open && !!client,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: () => briefFn({ data: { clientId: client!.id, waiting: lines } }) as Promise<ClientBriefAi>,
  });
  const refresh = async () => {
    if (!client) return;
    try {
      const fresh = (await briefFn({ data: { clientId: client.id, waiting: lines, refresh: true } })) as ClientBriefAi;
      qc.setQueryData(key, fresh);
    } catch { /* the card keeps the last read */ }
  };

  if (!client) return null;
  const s = signals;
  const count = waitingCount(s);
  const firstName = (client.full_name ?? "Client").split(/\s+/)[0];
  const go = () => { onOpenChange(false); onOpenChat(); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col gap-0 rounded-t-2xl p-0"
        data-client-brief
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" aria-hidden />
        <div className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-3">
          <UserAvatar src={client.profile_picture_url ?? null} name={client.full_name ?? "Client"} size={44} ring expandable={false} />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-base font-black tracking-tight">{client.full_name}</SheetTitle>
            <SheetDescription className="truncate text-xs text-muted-foreground">
              {count ? `${count} thing${count === 1 ? "" : "s"} waiting on you` : "Nothing waiting on you"}
              {client.last_active_at ? ` · in the app ${ago(client.last_active_at)}` : ""}
            </SheetDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {/* The AI read */}
          <section className="rounded-2xl border border-border bg-gradient-to-br from-amber-500/[0.07] via-orange-500/[0.05] to-pink-500/[0.07] p-3.5" data-brief-ai>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-orange-500" /> What's going on
              {ai.data && (
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground hover:text-foreground"
                  aria-label="Write a fresh summary"
                >
                  <RefreshCw className="h-3 w-3" /> {ago(ai.data.generated_at) || "now"}
                </button>
              )}
            </div>
            {ai.isLoading ? (
              <div className="space-y-2 py-1" aria-label="Reading the chat">
                <div className="h-3 w-[92%] animate-pulse rounded bg-muted" />
                <div className="h-3 w-[78%] animate-pulse rounded bg-muted" />
                <div className="h-3 w-[60%] animate-pulse rounded bg-muted" />
              </div>
            ) : ai.isError ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Couldn't read the chat just now.
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void ai.refetch()}>Try again</Button>
              </div>
            ) : ai.data ? (
              <>
                <p className="text-[15px] leading-snug text-foreground">{ai.data.summary}</p>
                {ai.data.next_step && (
                  <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-foreground">
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" /> {ai.data.next_step}
                  </p>
                )}
              </>
            ) : null}
          </section>

          <div className="mt-3 space-y-2">
            {needsReply && s?.needsReply && (
              <BriefRow
                tone="urgent"
                icon={<MessageCircle className="h-4 w-4" />}
                title="Needs your reply"
                detail={[replyReason(s), s.needsReply.since ? `since ${ago(s.needsReply.since)}` : null].filter(Boolean).join(" · ")}
                onClick={go}
              />
            )}
            {s?.pain.map((p) => (
              <BriefRow key={p.messageId} tone="urgent" icon={<AlertTriangle className="h-4 w-4" />} title="Pain flagged" detail={`${p.line} · ${ago(p.at)}`} onClick={go} />
            ))}
            {s?.toReview.map((r, i) => (
              <BriefRow key={`r${i}`} tone="info" icon={<ClipboardCheck className="h-4 w-4" />} title={`${r.title} to review`} detail={`Filled in ${ago(r.at)}`} onClick={go} />
            ))}
            {s?.overdue.map((o, i) => (
              <BriefRow
                key={`o${i}`}
                tone="warn"
                icon={<Clock className="h-4 w-4" />}
                title={`${o.title} overdue`}
                detail={`Sent ${ago(o.since)}, not filled in${s.missed ? ` · ${s.missed} missed before` : ""}`}
                to="/admin/forms"
              />
            ))}
            {s?.media.length ? (
              <BriefRow
                tone="info"
                icon={<ImageIcon className="h-4 w-4" />}
                title="Photos & videos to react to"
                detail={`${mediaCount(s)} · latest ${ago(s.media[0].at)}`}
                onClick={go}
              />
            ) : null}
            {s?.sessionRequests ? (
              <BriefRow
                tone="info"
                icon={<CalendarClock className="h-4 w-4" />}
                title={s.sessionRequests === 1 ? "Session request" : `${s.sessionRequests} session requests`}
                detail="Waiting for your answer"
                onClick={go}
              />
            ) : null}
            {s?.pending.map((p, i) => (
              <BriefRow key={`p${i}`} tone="muted" icon={<Hourglass className="h-4 w-4" />} title={`${p.title} sent`} detail={`${ago(p.since)}, not filled in yet`} onClick={go} />
            ))}
            {waitingOnClient && (
              <BriefRow
                tone={waitingOnClient.overdue ? "warn" : "muted"}
                icon={<Hourglass className="h-4 w-4" />}
                title={waitingOnClient.overdue ? "Follow up" : `Waiting on ${firstName}`}
                detail={[`You wrote ${ago(waitingOnClient.since)}`, readReceipt].filter(Boolean).join(" · ")}
                onClick={go}
              />
            )}
            {!count && !waitingOnClient && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <Check className="h-4 w-4" /> All clear. Nothing's waiting on you.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-border px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <Button className="h-11 flex-1 rounded-xl text-base font-semibold" onClick={go}>
            <MessageCircle className="mr-2 h-4 w-4" /> Open chat
          </Button>
          {needsReply && onMarkDone && (
            <Button variant="outline" className="h-11 rounded-xl px-4 text-base" onClick={() => { onMarkDone(); onOpenChange(false); }}>
              <Check className="mr-1.5 h-4 w-4" /> Done
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function mediaCount(s: ClientSignals): string {
  const v = s.media.reduce((n, m) => n + m.videos, 0);
  const p = s.media.reduce((n, m) => n + m.photos, 0);
  const f = s.media.reduce((n, m) => n + m.files, 0);
  return [v && `${v} video${v === 1 ? "" : "s"}`, p && `${p} photo${p === 1 ? "" : "s"}`, f && `${f} file${f === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}

const TONE: Record<"urgent" | "warn" | "info" | "muted", string> = {
  urgent: "bg-red-500/12 text-red-600 dark:text-red-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

/** Why they need a reply, unless a row below already says it (pain, a form to review). */
function replyReason(s: ClientSignals): string | null {
  const d = s.needsReply?.detail ?? null;
  if (!d) return null;
  if (d === "Pain flagged" && s.pain.length) return null;
  if ((d === "Check-in submitted" || d === "Form submitted") && s.toReview.length) return null;
  return d;
}

function BriefRow({ tone, icon, title, detail, onClick, to }: {
  tone: keyof typeof TONE;
  icon: ReactNode;
  title: string;
  detail?: string;
  onClick?: () => void;
  to?: string;
}) {
  const body = (
    <>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", TONE[tone])}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition hover:bg-secondary/50 active:scale-[0.99]";
  if (to) {
    return <Link to={to as any} search={{ tab: "requests" } as any} className={cls} data-brief-row>{body}</Link>;
  }
  return <button type="button" onClick={onClick} className={cls} data-brief-row>{body}</button>;
}
