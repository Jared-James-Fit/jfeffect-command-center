/**
 * OpenIPF in the coach's Messages: the row pinned under the coaching queue
 * while anything is waiting, and the sheet it opens. A match is one of their
 * athletes found on OpenIPF (Add to profile / Not them / Open client); a new
 * meet is one the daily sync brought in (Got it). Every decision has Undo,
 * here and under Recent. Nothing reaches a profile until the coach says so.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ExternalLink, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CHAT_ROW_AVATAR, ChatListRow } from "@/components/messages/chat-list-row";
import { cn } from "@/lib/utils";
import {
  decidedWord, inboxPreview, liftsLine, matchLine, meetDay, plainLifterName, prLine, profileUrl, siteName, suggestionOrder,
  type OpenIpfSuggestion,
} from "@/lib/openipf";
import { useDecideOpenIpf, useOpenIpfSuggestions } from "@/lib/openipf.queries";

export function OpenIpfInboxRow() {
  const { data } = useOpenIpfSuggestions();
  const search = useSearch({ strict: false }) as { openipf?: string };
  const [open, setOpen] = useState(false);
  // a push opens the sheet
  useEffect(() => {
    if (search.openipf) setOpen(true);
  }, [search.openipf]);
  const list = useMemo(() => [...(data ?? [])].sort(suggestionOrder), [data]);
  const waiting = list.filter((s) => s.status === "pending");
  if (!waiting.length && !open) return null;
  const lead = waiting[0];
  return (
    <>
      <ChatListRow
        data-openipf-row
        avatar={
          <span className="flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground" style={{ width: CHAT_ROW_AVATAR, height: CHAT_ROW_AVATAR }}>
            <Trophy className="h-6 w-6" />
          </span>
        }
        name="OpenIPF"
        preview={inboxPreview(list)}
        at={lead?.created_at ?? null}
        unread={waiting.length > 0}
        unreadLabel={`${waiting.length} waiting`}
        after={waiting.length > 1 ? <span className="text-[13px] font-semibold text-muted-foreground">{waiting.length}</span> : undefined}
        onClick={() => setOpen(true)}
      />
      <OpenIpfReviewSheet open={open} onOpenChange={setOpen} list={list} />
    </>
  );
}

type Tab = "waiting" | "recent";

export function OpenIpfReviewSheet({ open, onOpenChange, list }: { open: boolean; onOpenChange: (v: boolean) => void; list: OpenIpfSuggestion[] }) {
  const [tab, setTab] = useState<Tab>("waiting");
  const waiting = list.filter((s) => s.status === "pending");
  const recent = list.filter((s) => s.status !== "pending");
  const shown = tab === "waiting" ? waiting : recent;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="z-[70] flex max-h-[92svh] flex-col gap-0 rounded-t-3xl p-0 sm:mx-auto sm:max-w-xl" data-openipf-sheet>
        <SheetHeader className="shrink-0 space-y-0.5 border-b border-border/60 px-5 pb-3 pt-5 text-left">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <SheetTitle className="text-lg font-semibold">OpenIPF</SheetTitle>
              <SheetDescription className="text-xs">
                Your athletes found on OpenIPF, and new meets for the ones already linked. Nothing goes on a profile until you add it.
              </SheetDescription>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="-mx-1 flex gap-1 pt-2" role="tablist">
            {([["waiting", "Waiting", waiting.length], ["recent", "Recent", 0]] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold", tab === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
                {count ? <span className="tabular-nums text-muted-foreground">{count}</span> : null}
              </button>
            ))}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {shown.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              {tab === "waiting" ? "Nothing waiting. Every month your coaching clients and alumni are looked up again." : "Nothing decided in the last 30 days."}
            </p>
          ) : (
            shown.map((s) => (tab === "waiting" ? <SuggestionCard key={s.id} s={s} onOpenClient={() => onOpenChange(false)} /> : <RecentRow key={s.id} s={s} />))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function first(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/** Open the client's Training tab on their OpenIPF row. */
export function useOpenClientOpenIpf() {
  const navigate = useNavigate();
  return (clientId: string) =>
    void navigate({ to: "/admin/clients/$id", params: { id: clientId }, search: { tab: "training" } as any, hash: "openipf" });
}

export function SuggestionCard({ s, onOpenClient }: { s: OpenIpfSuggestion; onOpenClient: () => void }) {
  const decide = useDecideOpenIpf();
  const openClient = useOpenClientOpenIpf();
  const url = profileUrl(s.host, s.slug);
  const run = (action: "approve" | "dismiss", done: string) =>
    decide.mutate(
      { id: s.id, action, clientId: s.client_id },
      {
        onSuccess: () =>
          toast.success(done, {
            action: { label: "Undo", onClick: () => decide.mutate({ id: s.id, action: "undo", clientId: s.client_id }, { onError: (e: any) => toast.error(e?.message ?? "Couldn't undo") }) },
          }),
        onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
      },
    );
  const busy = decide.isPending;

  if (s.kind === "new_meet") {
    const pr = prLine(s.prs);
    return (
      <article className="rounded-2xl border border-border bg-card p-4" data-openipf-meet>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-semibold">{s.subject_name}</h3>
          <span className="shrink-0 text-[12px] text-muted-foreground">New meet</span>
        </div>
        <p className="mt-0.5 text-sm text-foreground">{[s.meet_name, meetDay(s.meet_date)].filter(Boolean).join(" · ")}</p>
        {liftsLine(s) && <p className="mt-1 text-sm tabular-nums text-muted-foreground">{liftsLine(s)}{s.weight_class ? ` · ${s.weight_class} kg class` : ""}</p>}
        {pr && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-warning" data-openipf-pr>
            <Trophy className="h-4 w-4" aria-hidden /> {pr}
          </p>
        )}
        <p className="mt-1.5 text-[12px] text-muted-foreground">Already in their meets and the Hall of Strength.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="h-10" variant="outline" disabled={busy} onClick={() => run("approve", "Marked seen")}>Got it</Button>
          {s.client_id && (
            <Button size="sm" className="h-10" variant="ghost" onClick={() => { onOpenClient(); openClient(s.client_id!); }}>Open client</Button>
          )}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              {siteName(s.host)} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </article>
    );
  }

  const line = matchLine(s);
  const lifts = liftsLine(s);
  return (
    <article className="rounded-2xl border border-border bg-card p-4" data-openipf-match>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate text-[15px] font-semibold">{s.subject_name}</h3>
        <span className="shrink-0 text-[12px] text-muted-foreground" data-openipf-confidence={s.confidence ?? "possible"}>
          {s.confidence === "likely" ? "Likely them" : "Possibly them"}
        </span>
      </div>
      <p className="mt-0.5 text-sm">
        On {siteName(s.host)}: <span className="font-medium">{plainLifterName(s.lifter_name) || s.slug}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-[13px] text-muted-foreground underline-offset-2 hover:underline">
            View <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </p>
      {line && <p className="mt-1 text-sm text-muted-foreground">{line}</p>}
      {lifts && <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">Best: {lifts}</p>}
      {!!s.reasons?.length && <p className="mt-1.5 text-[12px] text-muted-foreground">{s.reasons.join(" · ")}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" className="h-10" disabled={busy} onClick={() => run("approve", `Added to ${first(s.subject_name)}'s profile. Their meets are coming in.`)}>Add to profile</Button>
        <Button size="sm" className="h-10" variant="outline" disabled={busy} onClick={() => run("dismiss", "Won't be suggested again")}>Not them</Button>
        {s.client_id && (
          <Button size="sm" className="h-10" variant="ghost" onClick={() => { onOpenClient(); openClient(s.client_id!); }}>Open client</Button>
        )}
      </div>
    </article>
  );
}

function RecentRow({ s }: { s: OpenIpfSuggestion }) {
  const decide = useDecideOpenIpf();
  const what = s.kind === "new_meet" ? [s.meet_name, meetDay(s.meet_date)].filter(Boolean).join(" · ") : `${siteName(s.host)}: ${plainLifterName(s.lifter_name) || s.slug}`;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5" data-openipf-recent>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.subject_name}</div>
        <div className="truncate text-[12px] text-muted-foreground">{decidedWord(s)} · {what}</div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={decide.isPending}
        onClick={() =>
          decide.mutate(
            { id: s.id, action: "undo", clientId: s.client_id },
            { onSuccess: () => toast.success(s.status === "approved" ? "Taken off their profile" : "Back in Waiting"), onError: (e: any) => toast.error(e?.message ?? "Couldn't undo") },
          )
        }
      >
        Undo
      </Button>
    </div>
  );
}
