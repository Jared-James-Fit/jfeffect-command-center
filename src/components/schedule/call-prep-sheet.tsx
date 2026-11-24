import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { sendMessage } from "@/lib/messages";
import { getCallPrep, markCallReviewShared, saveCallReview } from "@/lib/coaching-packages/call-prep.functions";
import { actionItemsMessage, shortDay } from "@/lib/coaching-packages/call-prep";

/**
 * Before a call: what the client wants to cover, what to follow up on from
 * last time, what's on file and, kept apart, the app's read of it. After:
 * action items and next priorities, sent to the client only when the coach
 * taps Send (as a chat message). The coach's private note is the session's
 * own note and never leaves.
 */
export function CallPrepSheet({ sessionId, open, onOpenChange }: { sessionId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fetchPrep = useServerFn(getCallPrep);
  const saveReview = useServerFn(saveCallReview);
  const markShared = useServerFn(markCallReviewShared);
  const q = useQuery({
    queryKey: ["call-prep", sessionId],
    enabled: open && !!sessionId,
    queryFn: () => fetchPrep({ data: { sessionId: sessionId! } }),
  });
  const p = q.data;
  const [items, setItems] = useState<string[]>([""]);
  const [priorities, setPriorities] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (p) {
      setItems(p.review?.actionItems.length ? [...p.review.actionItems] : [""]);
      setPriorities(p.review?.nextPriorities ?? "");
    }
  }, [p]);

  const save = useMutation({
    mutationFn: () => saveReview({ data: { sessionId: sessionId!, actionItems: items, nextPriorities: priorities || null } }),
    onSuccess: () => {
      toast.success("Saved. Only you see it until you send it.");
      void qc.invalidateQueries({ queryKey: ["call-prep", sessionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (!p || !user) throw new Error("Not ready yet.");
      await saveReview({ data: { sessionId: sessionId!, actionItems: items, nextPriorities: priorities || null } });
      const body = actionItemsMessage({
        firstName: p.firstName,
        date: p.sessionDate,
        actionItems: items.map((i) => i.trim()).filter(Boolean),
        nextPriorities: priorities,
      });
      const msg = await sendMessage({ clientId: p.clientId, senderId: user.id, senderRole: "admin", body });
      await markShared({ data: { sessionId: sessionId!, messageId: (msg as any)?.id ?? null } });
    },
    onSuccess: () => {
      toast.success(`Sent to ${p?.firstName ?? "them"} in your chat`);
      void qc.invalidateQueries({ queryKey: ["call-prep", sessionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filled = items.some((i) => i.trim()) || !!priorities.trim();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-call-prep>
        <SheetHeader>
          <SheetTitle>Call with {p?.clientName ?? "…"}</SheetTitle>
          <SheetDescription>
            {p?.when
              ? new Date(p.when).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : ""}
          </SheetDescription>
        </SheetHeader>
        {q.isLoading && <div className="mt-4 h-40 jf-skeleton rounded-xl bg-muted" />}
        {q.error && <p className="mt-4 text-[14px] text-destructive">{(q.error as Error).message}</p>}
        {p && (
          <div className="mt-4 space-y-6">
            <Section title="In their words">
              {p.theirWords.length ? (
                p.theirWords.map((t) => (
                  <p key={t} className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-[14px]">
                    {t}
                  </p>
                ))
              ) : (
                <p className="text-[14px] text-muted-foreground">They haven't said what they want to cover.</p>
              )}
            </Section>

            {p.followUp && (p.followUp.actionItems.length > 0 || p.followUp.nextPriorities) && (
              <Section title={`Follow up from ${shortDay(p.followUp.date)}`}>
                <ul className="list-disc space-y-1 pl-5 text-[14px]">
                  {p.followUp.actionItems.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                {p.followUp.nextPriorities && <p className="mt-1 text-[14px]">{p.followUp.nextPriorities}</p>}
                {!p.followUp.shared && <p className="mt-1 text-[12px] text-muted-foreground">You didn't send these to them.</p>}
              </Section>
            )}

            <Section title="On file" sub="From their records.">
              <ul className="space-y-1.5 text-[14px]" data-prep-facts>
                {p.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {p.missing.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">Nothing on file for: {p.missing.join(", ")}.</p>}
            </Section>

            {p.reads.length > 0 && (
              <Section title="The app's read" sub={`Interpretations from the numbers, not something ${p.firstName ?? "they"} said. Check them on the call.`}>
                <ul className="space-y-1.5 text-[14px]" data-prep-reads>
                  {p.reads.map((r) => (
                    <li key={r} className="rounded-lg border border-dashed border-border p-2.5">
                      {r}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="After the call" sub="Your private note is the session's own note. These stay yours until you send them.">
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={it}
                      maxLength={300}
                      placeholder={i === 0 ? "e.g. Film your top squat set on Monday" : "Another action item"}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : [""])}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {items.length < 12 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setItems([...items, ""])}>
                    <Plus className="mr-1 h-4 w-4" /> Add an action item
                  </Button>
                )}
                <Textarea rows={3} maxLength={1000} placeholder="Next priorities" value={priorities} onChange={(e) => setPriorities(e.target.value)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {p.review?.sharedAt && <span className="mr-auto text-[12px] text-muted-foreground">Sent {shortDay(p.review.sharedAt.slice(0, 10))}</span>}
                <Button variant="outline" onClick={() => save.mutate()} disabled={!filled || save.isPending}>
                  Save
                </Button>
                <Button onClick={() => setConfirm(true)} disabled={!filled || send.isPending} data-send-action-items>
                  Send to {p.firstName ?? "them"}
                </Button>
              </div>
            </Section>
          </div>
        )}
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send these to {p?.firstName ?? "them"}?</AlertDialogTitle>
              <AlertDialogDescription>
                The action items and next priorities go to your chat with them as a message. Your private note isn't included.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not yet</AlertDialogCancel>
              <AlertDialogAction onClick={() => send.mutate()}>Send</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {sub && <p className="mb-2 text-[12px] text-muted-foreground">{sub}</p>}
      <div className={sub ? "" : "mt-2"}>{children}</div>
    </section>
  );
}
