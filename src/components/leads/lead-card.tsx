/**
 * One coaching lead: who they are, the AI's read on them, and the text to
 * send (Copy, or Text / Instagram / Call straight from the phone), then the
 * follow-up if they go quiet. Copy is the one primary action.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Instagram, Loader2, MessageSquare, MoreHorizontal, Phone, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  LEAD_INSTRUCTIONS_MAX,
  dialable,
  draftNudge,
  firstNameOf,
  goalLabel,
  igDmHref,
  leadLine,
  leadNeeds,
  leadStage,
  smsHref,
  type LeadApplication,
  type LeadDraft,
  type LeadReplyRow,
} from "@/lib/coaching-leads";
import { markLeadFn, queueLeadReplyFn, type LeadAction } from "@/lib/coaching-leads.functions";
import { dismissApplicationDraft } from "@/lib/coaching-applications.functions";
import { LEADS_QUERY_KEY } from "@/components/leads/use-leads";

const REWRITE_CHIPS = ["Shorter", "More casual", "Mention in-person training", "Ask them to DM me instead of a call"];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function initials(name: string | null | undefined) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function useLeadActions(applicationId: string) {
  const qc = useQueryClient();
  const mark = useServerFn(markLeadFn);
  const queue = useServerFn(queueLeadReplyFn);
  const refresh = () => qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
  return {
    async act(action: LeadAction, done?: string) {
      try {
        await mark({ data: { applicationId, action } });
        if (done) toast.success(done);
        await refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't update the lead");
      }
    },
    async rewrite(instructions?: string) {
      try {
        await queue({ data: { applicationId, instructions: instructions?.trim() || undefined } });
        await refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't start it");
      }
    },
  };
}

/** The text box with its ways out: Copy (primary), Text, Instagram, Call. */
function SendBox({
  text,
  app,
  onSent,
  primary = true,
}: {
  text: string;
  app: Pick<LeadApplication, "phone" | "instagram">;
  onSent: () => void;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const sms = smsHref(app.phone, text);
  const ig = igDmHref(app.instagram);
  const tel = dialable(app.phone);
  const copy = async () => {
    const ok = await copyText(text);
    if (!ok) {
      toast.error("Couldn't copy. Press and hold the text to copy it.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
    toast.success("Copied. Paste it in your texts or DMs.");
    onSent();
  };
  return (
    <div className="space-y-2">
      <div className="select-text whitespace-pre-wrap rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[15px] leading-[1.45]" data-lead-text>
        {text}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={primary ? "default" : "outline"} className="h-10 min-w-[7.5rem]" onClick={copy}>
          {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
          {copied ? "Copied" : "Copy text"}
        </Button>
        {sms && (
          <Button asChild type="button" variant="outline" className="h-10">
            <a href={sms} onClick={onSent}>
              <MessageSquare className="mr-1.5 h-4 w-4" /> Text
            </a>
          </Button>
        )}
        {ig && (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={async () => {
              // Instagram can't take the words in its link, so copy them first.
              await copyText(text);
              onSent();
              toast.success("Copied. Paste it in the DM.");
              window.open(ig, "_blank", "noopener");
            }}
          >
            <Instagram className="mr-1.5 h-4 w-4" /> DM
          </Button>
        )}
        {tel && (
          <Button asChild type="button" variant="outline" className="h-10 w-10 px-0" aria-label="Call">
            <a href={`tel:${tel}`}>
              <Phone className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function RewriteDialog({ open, onOpenChange, onWrite }: { open: boolean; onOpenChange: (v: boolean) => void; onWrite: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Write it again</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {REWRITE_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNote((n) => (n ? `${n}. ${c}` : c))}
                className="min-h-10 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-secondary"
              >
                {c}
              </button>
            ))}
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, LEAD_INSTRUCTIONS_MAX))}
            placeholder="What to change (optional)"
            className="min-h-[88px] text-[16px]"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => {
              onWrite(note);
              setNote("");
              onOpenChange(false);
            }}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Write it again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadCard({ app, reply, focused = false }: { app: LeadApplication; reply: LeadReplyRow | null; focused?: boolean }) {
  const { act, rewrite } = useLeadActions(app.id);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const needs = leadNeeds(app);
  const stage = leadStage(app);
  const writing = reply?.status === "pending" || reply?.status === "generating";
  const brief = reply?.status === "ready" || reply?.reply ? reply?.brief ?? null : null;
  const first = firstNameOf(app) || "them";
  const followUpOpen = needs === "follow_up" || showFollowUp;

  return (
    <Card id={`lead-${app.id}`} className={cn("scroll-mt-24 overflow-hidden", focused && "ring-2 ring-foreground/20")} data-lead-card>
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-[15px] font-semibold">{initials(app.full_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold">{app.full_name || "Someone"}</span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                needs === "follow_up"
                  ? "bg-warning/15 text-warning"
                  : stage.tone === "new"
                    ? "bg-secondary text-foreground"
                    : stage.tone === "done"
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground",
              )}
            >
              {needs === "follow_up" ? "Follow up" : stage.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {[leadLine(app), `applied ${formatDistanceToNow(new Date(app.created_at), { addSuffix: true })}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className="h-10 w-10 shrink-0 px-0" aria-label="More">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRewriteOpen(true)}>Write it again…</DropdownMenuItem>
            {stage.label !== "Texted" && needs !== "follow_up" && (
              <DropdownMenuItem onSelect={() => act("texted", "Marked texted. Follow-up's due tomorrow.")}>Mark texted</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => act("booked", "Call booked")}>Call booked</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act("not_a_fit", "Set aside")}>Not a fit</DropdownMenuItem>
            {stage.label !== "New" && <DropdownMenuItem onSelect={() => act("reopen", "Back to new")}>Back to new</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/admin/forms" search={{ tab: "applications" } as any}>Full application</Link>
            </DropdownMenuItem>
            {app.client_id && (
              <DropdownMenuItem asChild>
                <Link to="/admin/clients/$id" params={{ id: app.client_id }}>Their record</Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {app.target_outcome?.trim() && (
        <p className="px-4 pb-3 text-[15px] leading-snug">“{app.target_outcome.trim()}”</p>
      )}

      <div className="space-y-4 border-t border-border p-4">
        {writing ? (
          <div className="space-y-2" data-lead-writing>
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Writing your read on {first} and a text to send…
            </div>
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-9/12" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : !reply || (reply.status === "error" && !reply.reply) ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14px] text-muted-foreground">
              {reply?.status === "error" ? "Couldn't write the text this time." : "No text written for this one yet."}
            </span>
            <Button type="button" variant="outline" className="h-10" onClick={() => rewrite()}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> {reply ? "Try again" : "Write a text"}
            </Button>
          </div>
        ) : (
          <>
            {brief && (
              <section className="space-y-2" data-lead-brief>
                <h3 className="text-[13px] font-semibold text-muted-foreground">Your read</h3>
                {brief.read && <p className="text-[15px] leading-snug">{brief.read}</p>}
                {brief.signals.length > 0 && (
                  <div className="text-[14px] leading-snug">
                    <span className="font-semibold text-success">Ready: </span>
                    {brief.signals.join(" · ")}
                  </div>
                )}
                {brief.watch.length > 0 && (
                  <div className="text-[14px] leading-snug">
                    <span className="font-semibold text-warning">Watch for: </span>
                    {brief.watch.join(" · ")}
                  </div>
                )}
                {brief.angle && (
                  <div className="text-[14px] leading-snug">
                    <span className="font-semibold">Angle: </span>
                    {brief.angle}
                  </div>
                )}
              </section>
            )}

            {reply.reply && needs !== "follow_up" && (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-muted-foreground">Text to send {first}</h3>
                <SendBox text={reply.reply} app={app} onSent={() => void act("copied")} primary={needs === "reply"} />
                {needs === "reply" && (
                  <Button type="button" variant="ghost" className="h-10 px-2 text-[14px]" onClick={() => act("texted", "Marked texted. Follow-up's due tomorrow.")}>
                    <Check className="mr-1.5 h-4 w-4" /> I sent it
                  </Button>
                )}
              </section>
            )}

            {reply.follow_up && (
              <section className="space-y-2">
                {followUpOpen ? (
                  <>
                    <h3 className="text-[13px] font-semibold text-muted-foreground">
                      {needs === "follow_up" ? `No answer yet: follow up with ${first}` : "If they go quiet"}
                    </h3>
                    <SendBox text={reply.follow_up} app={app} onSent={() => void act("copied")} primary={needs === "follow_up"} />
                    {needs === "follow_up" && (
                      <Button type="button" variant="ghost" className="h-10 px-2 text-[14px]" onClick={() => act("followed_up", "Follow-up sent")}>
                        <Check className="mr-1.5 h-4 w-4" /> I sent it
                      </Button>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => setShowFollowUp(true)} className="min-h-10 text-[14px] font-medium text-muted-foreground hover:text-foreground">
                    If they go quiet: the follow-up ›
                  </button>
                )}
              </section>
            )}
            {reply.instructions && <p className="text-[12px] text-muted-foreground">Written with your note: {reply.instructions}</p>}
          </>
        )}
      </div>
      <RewriteDialog open={rewriteOpen} onOpenChange={setRewriteOpen} onWrite={(note) => void rewrite(note)} />
    </Card>
  );
}

/** Someone who started applying and stopped: the nudge to send, no AI needed. */
export function DraftLeadCard({ draft, bookingUrl }: { draft: LeadDraft; bookingUrl: string | null }) {
  const qc = useQueryClient();
  const dismiss = useServerFn(dismissApplicationDraft);
  const text = draftNudge(draft, bookingUrl);
  const reachable = !!(draft.phone || draft.instagram || draft.email);
  return (
    <Card className="overflow-hidden" data-lead-draft>
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-[15px] font-semibold">{initials(draft.full_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{draft.full_name || draft.email || draft.phone || "Someone"}</div>
          <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {[goalLabel(draft.main_goal), `stopped at question ${(draft.step ?? 0) + 1} of 7`, formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-10 shrink-0 px-3 text-[13px]"
          onClick={async () => {
            try {
              await dismiss({ data: { id: draft.id } });
              await qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
              toast.success("Set aside");
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't set it aside");
            }
          }}
        >
          Done
        </Button>
      </div>
      <div className="border-t border-border p-4">
        {reachable ? (
          <SendBox text={text} app={draft} onSent={() => {}} primary={false} />
        ) : (
          <p className="text-[14px] text-muted-foreground">They didn't leave a phone, Instagram or email.</p>
        )}
      </div>
    </Card>
  );
}
