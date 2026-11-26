/**
 * The coach's read of a client's pain: every place they've reported in the
 * last 12 weeks, what's changing, what lines up with it, the warning signs,
 * what to consider, and a reply drafted in the coach's voice for him to edit
 * and send. Nothing here reaches the client by itself: "Use in chat" puts the
 * words in his composer, and he sends them.
 *
 * Opened from the pain card in the chat, Home's "Pain to look at" and the
 * client's Health card. History, patterns and suggestions are worked out in
 * code (src/lib/pain/); the AI only drafts the words, on the coach_write
 * route (OpenAI key), and only when he asks.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Check, Dumbbell, Loader2, MessageCircle, PenLine, RotateCcw, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { draftPainReplyFn, getClientPainFn } from "@/lib/pain/pain.functions";
import { areaSummary, buildPainHistory, reasonWords, shortDay, sidesLine, type PainArea } from "@/lib/pain/history";
import { recoverySuggestions } from "@/lib/pain/recovery";
import { associations, associationLine, blockShift, blockShiftLine, sessionContext } from "@/lib/pain/sessions";
import { redFlags, URGENT_SIGNS } from "@/lib/pain/safety";
import { FEELS, TIMINGS, placeLabel, severityLabel } from "@/lib/pain/report";
import { siteAnatomy } from "@/lib/pain/sites";
import { areaLabel } from "@/lib/pain/regions";
import { insertIntoComposer, queueComposerInsert } from "@/lib/composer-insert";
import { approveRecoveryItemFn, dismissRecoveryItemFn, getClientRecoveryFn, setClientRecoveryModeFn } from "@/lib/recovery-automation/queue.functions";
import { CATEGORIES, MODES, modeAllowed, type AutomationCategory, type AutomationMode } from "@/lib/recovery-automation/rules";
import { lazyWithRetry } from "@/lib/lazy-chunk";

const EditWithAiSheet = lazyWithRetry(() => import("@/components/program-ai/edit-with-ai").then((m) => ({ default: m.EditWithAiSheet })));

/** What Adjust program starts with: the places, and only proposals, never applied by itself. */
export function adjustInstruction(first: string, areas: PainArea[]): string {
  const lines = areas.slice(0, 3).map((a) => `${a.label}: ${areaSummary(a)}${a.named.length ? ` (named: ${a.named.map((n) => n.name).join(", ")})` : ""}`);
  return [
    `${first} reported pain: ${lines.join("; ")}.`,
    "Look at their next two weeks only. Where an exercise loads that area, propose the smallest change that keeps the training goal: less load or fewer sets, a shorter range, a different grip or stance, or a swap for a close variation that doesn't aggravate it.",
    "Don't change anything that doesn't load that area, and nothing already done.",
  ].join(" ");
}

export const PAIN_SHEET_KEY = "client-pain";

const feelWord = (f: string) => FEELS.find((x) => x.v === f)?.label.toLowerCase() ?? f;

function AreaCard({ a, sessions }: { a: PainArea; sessions: Parameters<typeof associations>[1] }) {
  const assoc = associations(a, sessions);
  const shift = blockShift(a, sessions);
  const ctx = sessionContext(a, sessions);
  const recent = [...a.entries].reverse().slice(0, 5);
  const tone = a.reasons.includes("red_flag") || a.reasons.includes("severe") || a.reasons.includes("worse") ? "text-warning" : "text-muted-foreground";
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-pain-area={a.region}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold">{a.label}</span>
        {a.status === "quiet" ? <span className="text-[12px] text-muted-foreground">quiet since {shortDay(a.last)}</span> : null}
      </div>
      <p className={cn("text-[13px] leading-snug", tone)}>{areaSummary(a)}</p>
      {a.reasons.length > 0 && <p className="text-[12px] text-muted-foreground">Why it's here: {a.reasons.map(reasonWords).join(", ")}</p>}
      {sidesLine(a) && <p className="text-[12px] text-muted-foreground">{sidesLine(a)}</p>}
      {assoc.map((x, i) => (
        <p key={i} className="text-[12px] text-muted-foreground">
          {associationLine(x).replace(/^came/, "Came")}.
        </p>
      ))}
      {shift && (
        <p className={cn("text-[12px]", shift.direction === "more" ? "text-warning" : "text-muted-foreground")} data-pain-block-shift>
          {blockShiftLine(shift).replace(/^came/, "Came")}.
        </p>
      )}
      {ctx.sessions >= 2 && (ctx.shortSleep >= 2 || ctx.veryHard >= 2) && (
        <p className="text-[12px] text-muted-foreground">
          Of the {ctx.sessions} sessions it came up in: {[ctx.shortSleep ? `${ctx.shortSleep} after under 6h sleep` : null, ctx.veryHard ? `${ctx.veryHard} rated very hard` : null].filter(Boolean).join(", ")}.
        </p>
      )}
      <ul className="space-y-1 border-t border-border/60 pt-2">
        {recent.map((e) => (
          <li key={e.id} className="text-[12px] leading-snug">
            <span className="font-medium">{shortDay(e.date)}</span>
            <span className="text-muted-foreground">
              {" · "}
              {[
                e.site ? `${placeLabel(e)}${siteAnatomy(e.site) ? ` (${siteAnatomy(e.site)!.toLowerCase()})` : ""}` : e.side && a.region !== "other" ? areaLabel(e.region, e.side) : null,
                e.score != null ? `${e.score}/10` : severityLabel(e.severity)?.toLowerCase() ?? (e.unsure ? "not sure how bad" : null),
                e.timing.length ? e.timing.map((t) => TIMINGS.find((x) => x.v === t)?.label.toLowerCase() ?? t).join(", ") : null,
                e.sameIssue && e.change ? `${e.change} (their word)` : e.sameIssue === false ? "said it's new" : null,
                e.exerciseName,
                e.feel.length ? e.feel.map(feelWord).join(", ") : null,
                e.impact === "stopped" ? "had to stop" : e.impact === "modified" ? "changed the session" : null,
                e.source === "checkin" ? "weekly check-in" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {e.note && <span className="block text-muted-foreground">“{e.note}”{e.inferred ? " (place read from this)" : ""}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PainReviewSheet({ clientId, onClose, inChat = false }: { clientId: string | null; onClose: () => void; inChat?: boolean }) {
  const get = useServerFn(getClientPainFn);
  const draftFn = useServerFn(draftPainReplyFn);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: [PAIN_SHEET_KEY, clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => get({ data: { clientId: clientId! } }),
  });
  const history = useMemo(() => (data ? buildPainHistory(data.entries, data.today) : null), [data]);
  const suggestions = useMemo(() => (data && history ? recoverySuggestions(history, data.sessions, data.given) : []), [data, history]);
  const flags = useMemo(() => (history ? redFlags(history.areas.filter((a) => a.status !== "quiet").flatMap((a) => a.entries)) : []), [history]);
  const [draft, setDraft] = useState<{ message: string; insights: string[]; keys: string[]; itemId?: string } | null>(null);
  const [text, setText] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const recoveryFn = useServerFn(getClientRecoveryFn);
  const approveFn = useServerFn(approveRecoveryItemFn);
  const dismissFn = useServerFn(dismissRecoveryItemFn);
  const ruleFn = useServerFn(setClientRecoveryModeFn);
  const { data: auto } = useQuery({
    queryKey: ["client-recovery", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    retry: false,
    queryFn: () => recoveryFn({ data: { clientId: clientId! } }),
  });
  // a reply automation drafted and is waiting on the coach
  const waiting =
    auto?.items.find((i: any) => (i.category === "recovery_reply" || i.category === "recovery_follow_up") && (i.status === "awaiting_approval" || i.status === "draft") && i.draft) ?? null;

  // the reply waiting for approval, else the last draft while it still covers the latest report
  useEffect(() => {
    if (!data || !history) return;
    if (waiting) {
      setDraft({ message: waiting.draft, insights: [], keys: [], itemId: waiting.id });
      setText(waiting.draft);
      return;
    }
    const d = data.draft;
    if (d && d.text && (!history.latestAt || (d.through ?? "") >= history.latestAt)) {
      setDraft({ message: d.text, insights: [], keys: d.keys });
      setText(d.text);
    } else {
      setDraft(null);
      setText("");
    }
  }, [data, history, waiting?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const write = useMutation({
    mutationFn: () => draftFn({ data: { clientId: clientId! } }),
    onSuccess: (r) => {
      setDraft({ message: r.message, insights: r.insights, keys: r.suggestionKeys });
      setText(r.message);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't write a draft"),
  });

  const record = async (kind: "reviewed" | "used", keys: string[] = []) => {
    if (!clientId || !history) return;
    const { data: auth } = await supabase.auth.getUser();
    const { error: e } = await (supabase as any).from("pain_coach_reviews").insert({
      client_id: clientId,
      kind,
      through_at: history.latestAt,
      regions: history.flagged.map((a) => a.region),
      suggestion_keys: keys,
      created_by: auth.user?.id,
    });
    if (e) throw e;
    qc.invalidateQueries({ queryKey: ["pain-watch"] });
    qc.invalidateQueries({ queryKey: [PAIN_SHEET_KEY, clientId] });
  };

  const markReviewed = useMutation({
    mutationFn: () => record("reviewed"),
    onSuccess: () => {
      toast.success("Marked reviewed. It comes back when they report something new.");
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const sendNow = useMutation({
    mutationFn: () => approveFn({ data: { id: draft!.itemId!, text: text.trim() } }),
    onSuccess: () => {
      toast.success(`Sent to ${first}`);
      qc.invalidateQueries({ queryKey: ["client-recovery", clientId] });
      qc.invalidateQueries({ queryKey: ["recovery-queue"] });
      qc.invalidateQueries({ queryKey: ["pain-watch"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send it"),
  });

  const setRule = useMutation({
    mutationFn: (v: { category: AutomationCategory; mode: AutomationMode | null }) => ruleFn({ data: { clientId: clientId!, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-recovery", clientId] }),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const useInChat = useMutation({
    mutationFn: async () => {
      const words = text.trim();
      if (!words) throw new Error("Nothing to send");
      await record("used", draft?.keys ?? []);
      // they'll send it from the chat themselves: the queued one goes
      if (draft?.itemId) await dismissFn({ data: { id: draft.itemId } }).catch(() => undefined);
      return words;
    },
    onSuccess: (words) => {
      onClose();
      if (inChat) insertIntoComposer(clientId!, words);
      else {
        queueComposerInsert(clientId!, words);
        void navigate({ to: "/admin/messages", search: { client: clientId! } as any });
      }
      toast.success("In your message box. Edit it and send when you're happy.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't use it"),
  });

  const first = data?.firstName ?? "them";
  const reviewedSinceLatest = !!(data?.reviewedAt && history?.latestAt && data.reviewedAt >= history.latestAt);

  return (
    <Sheet open={!!clientId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="z-[80] flex max-h-[92svh] flex-col gap-0 rounded-t-3xl p-0" data-pain-review-sheet>
        <SheetHeader className="shrink-0 flex-row items-start gap-2 space-y-0 border-b border-border/60 px-5 pb-3 pt-5 text-left">
          <div className="min-w-0 flex-1 space-y-0.5">
            <SheetTitle className="text-lg font-semibold">{data ? `${first}'s pain` : "Pain history"}</SheetTitle>
            <SheetDescription className="text-xs">What they reported in the last 12 weeks. Their reports, not a diagnosis.</SheetDescription>
          </div>
          <button type="button" onClick={onClose} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4" data-sheet-scroll>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading their reports…
            </div>
          )}
          {error && <p className="text-sm text-destructive">{(error as any)?.message ?? "Couldn't load their pain history."}</p>}
          {history && !history.areas.length && <p className="text-sm text-muted-foreground">No pain reported in the last 12 weeks.</p>}

          {flags.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[13px] leading-snug" data-pain-red-flags>
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warning signs
              </p>
              {flags.map((f) => (
                <p key={`${f.area}-${f.key}`}>
                  <span className="font-medium">{f.area}</span> ({shortDay(f.date)}): {f.text}
                </p>
              ))}
              {flags.some((f) => f.urgent) && <p className="text-muted-foreground">Urgent, get medical help now: {URGENT_SIGNS.join("; ")}.</p>}
            </div>
          )}

          {history?.areas
            .filter((a) => !a.minor && a.status !== "quiet")
            .map((a) => <AreaCard key={`${a.region}-${a.latest.id}`} a={a} sessions={data?.sessions ?? []} />)}

          {/* one-off mild reports and places gone quiet: on file, nothing to act on */}
          {history && history.areas.some((a) => a.minor || a.status === "quiet") && (
            <div className="space-y-1" data-pain-minor>
              <p className="text-[12px] font-semibold text-muted-foreground">Also on file, nothing to act on</p>
              {history.areas
                .filter((a) => a.minor || a.status === "quiet")
                .map((a) => (
                  <p key={`${a.region}-${a.latest.id}`} className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">{a.label}</span> · {a.status === "quiet" ? `quiet since ${shortDay(a.last)}` : `once, ${shortDay(a.last)}`}
                    {a.latestSeverity ? ` · ${severityLabel(a.latestSeverity)!.toLowerCase()}` : a.latestUnsure ? " · not sure how bad" : ""}
                  </p>
                ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-2" data-pain-consider>
              <h3 className="text-[15px] font-semibold">What to consider</h3>
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <li key={`${s.key}-${s.region}`} className="text-[13px] leading-snug">
                    <span className="font-medium">{s.area ? `${s.area}: ` : ""}{s.title}</span>
                    <span className="block text-muted-foreground">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {history && history.areas.some((a) => a.status !== "quiet") && (
            <div className="space-y-2 border-t border-border pt-4" data-pain-draft>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold">Reply to {first}</h3>
                {draft && (
                  <button type="button" onClick={() => write.mutate()} disabled={write.isPending} className="inline-flex h-8 items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
                    <RotateCcw className="h-3.5 w-3.5" /> Write again
                  </button>
                )}
              </div>
              {draft ? (
                <>
                  {draft.insights.length > 0 && (
                    <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted-foreground">
                      {draft.insights.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  )}
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="resize-none text-base" aria-label="Your reply" />
                  <p className="text-[11px] text-muted-foreground">
                    {draft.itemId ? "Drafted when the report came in." : "Drafted for you to edit."} Nothing goes to {first} until you send it.
                  </p>
                </>
              ) : (
                <Button type="button" variant="outline" className="w-full" onClick={() => write.mutate()} disabled={write.isPending} data-pain-draft-button>
                  {write.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PenLine className="mr-1.5 h-4 w-4" />}
                  {write.isPending ? "Writing it in your voice…" : "Draft a reply"}
                </Button>
              )}
            </div>
          )}
          {history && history.flagged.length > 0 && (
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted/50"
              data-pain-adjust
            >
              <Dumbbell className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">Adjust their next sessions</span>
                <span className="block text-[12px] text-muted-foreground">See proposed changes around it first. Nothing changes until you apply it.</span>
              </span>
            </button>
          )}

          {auto && (
            <div className="space-y-2 border-t border-border pt-4" data-pain-automation>
              <h3 className="text-[15px] font-semibold">Automation for {first}</h3>
              {CATEGORIES.map((c) => {
                const own = (auto.rules as any)[c.key] as AutomationMode | undefined;
                const general = (auto.settings.modes as any)[c.key] ?? "approval";
                const options = MODES.filter((m) => modeAllowed(auto.caps.features, c.key, m.key));
                return (
                  <label key={c.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="min-w-0">{c.label}</span>
                    <select
                      value={own ?? ""}
                      onChange={(e) => setRule.mutate({ category: c.key, mode: (e.target.value || null) as AutomationMode | null })}
                      className="h-9 max-w-[55%] rounded-lg border border-border bg-background px-2 text-[13px]"
                      aria-label={`${c.label} for ${first}`}
                    >
                      <option value="">Your default ({MODES.find((m) => m.key === general)?.label ?? general})</option>
                      {options.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              {auto.settings.paused && <p className="text-[12px] text-warning">Paused for everyone in your coaching queue settings.</p>}
            </div>
          )}
        </div>

        {adjustOpen && clientId && history && (
          <Suspense fallback={null}>
            <EditWithAiSheet
              open
              onOpenChange={(v) => !v && setAdjustOpen(false)}
              target={{ kind: "client", clientId }}
              title={`${first} · around their pain`}
              initialText={adjustInstruction(first, history.flagged)}
            />
          </Suspense>
        )}

        {history && history.areas.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 border-t bg-background px-5 py-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
            <Button variant="outline" className="flex-1" onClick={() => markReviewed.mutate()} disabled={markReviewed.isPending || reviewedSinceLatest}>
              <Check className="mr-1.5 h-4 w-4" /> {reviewedSinceLatest ? "Reviewed" : "Mark reviewed"}
            </Button>
            {draft && draft.itemId ? (
              <>
                <Button variant="outline" className="flex-1" onClick={() => useInChat.mutate()} disabled={useInChat.isPending || !text.trim()} data-pain-use-draft>
                  <MessageCircle className="mr-1.5 h-4 w-4" /> Edit in chat
                </Button>
                <Button className="flex-1" onClick={() => sendNow.mutate()} disabled={sendNow.isPending || !text.trim()} data-pain-send-now>
                  {sendNow.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Send
                </Button>
              </>
            ) : draft ? (
              <Button className="flex-1" onClick={() => useInChat.mutate()} disabled={useInChat.isPending || !text.trim()} data-pain-use-draft>
                <MessageCircle className="mr-1.5 h-4 w-4" /> Use in chat
              </Button>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
