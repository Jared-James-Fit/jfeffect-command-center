/**
 * Competition Handling for the coach: setting it up (from a meeting's
 * opportunity, with what's known filled in, or by hand) and managing it (the
 * personalized link, the price and payment, the athlete's own coach, notes,
 * completing or cancelling). Nothing is sent by itself: the link goes out from
 * the coach's own phone (copy, text, email, share) on his tap.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Mail, MessageSquare, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  createHandlingFn,
  handlingLinkFn,
  handlingPaymentFn,
  markInviteSentFn,
  updateHandlingFn,
} from "@/lib/competition/handling.functions";
import { HANDLING_WORD, PAYMENT_WORD, priceText } from "@/lib/competition/handling";
import { referrerAsk, type HandlingOpportunity } from "@/lib/competition/opportunities";
import { dayWords } from "./prep-ui";

const dollars = (s: string): number | null => {
  const v = Number(String(s).replace(/[^\d.]/g, ""));
  return s.trim() && Number.isFinite(v) && v >= 0.5 ? Math.round(v * 100) : null;
};

/** The link's actions: copy, text, email, the phone's share sheet. Each marks the link sent. */
export function LinkActions({ handlingId, onSent }: { handlingId: string; onSent?: () => void }) {
  const link = useServerFn(handlingLinkFn);
  const mark = useServerFn(markInviteSentFn);
  const [got, setGot] = useState<{ url: string; message: string; email: string | null; phone: string | null } | null>(null);
  const load = useMutation({
    mutationFn: (renew: boolean) => link({ data: { handlingId, renew } }),
    onSuccess: (r) => setGot(r),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't get the link"),
  });
  const sent = (via: "copy" | "text" | "email" | "share") =>
    void mark({ data: { handlingId, via } }).then(() => onSent?.(), () => undefined);
  if (!got)
    return (
      <Button size="sm" loading={load.isPending} onClick={() => load.mutate(false)} data-get-link>
        Get their link
      </Button>
    );
  const smsHref = `sms:${got.phone ? got.phone.replace(/[^\d+]/g, "") : ""}${/iPhone|iPad/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(got.message)}`;
  const mailHref = `mailto:${got.email ?? ""}?subject=${encodeURIComponent("Your meet details")}&body=${encodeURIComponent(got.message)}`;
  return (
    <div className="space-y-2" data-link-actions>
      <p className="break-all rounded-xl bg-muted px-3 py-2 text-[12.5px]">{got.url}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(got.message);
              toast.success("Copied with a short message");
              sent("copy");
            } catch {
              toast.error("Couldn't copy it");
            }
          }}
        >
          <Copy className="h-4 w-4" /> Copy
        </Button>
        <Button size="sm" variant="outline" asChild onClick={() => sent("text")}>
          <a href={smsHref}>
            <MessageSquare className="h-4 w-4" /> Text
          </a>
        </Button>
        <Button size="sm" variant="outline" asChild onClick={() => sent("email")}>
          <a href={mailHref}>
            <Mail className="h-4 w-4" /> Email
          </a>
        </Button>
        {typeof navigator !== "undefined" && "share" in navigator ? (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.share({ text: got.message });
                sent("share");
              } catch {
                /* closed */
              }
            }}
          >
            <Share2 className="h-4 w-4" /> Share
          </Button>
        ) : null}
      </div>
      <button type="button" className="text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => load.mutate(true)}>
        Make a new link (the old one stops working)
      </button>
    </div>
  );
}

/** Managing an existing handling. */
export function HandlingSheet({ open, onClose, prep, onChanged }: { open: boolean; onClose: () => void; prep: any; onChanged: () => void }) {
  const h = prep.handling;
  const pay = useServerFn(handlingPaymentFn);
  const upd = useServerFn(updateHandlingFn);
  const [price, setPrice] = useState(h?.priceCents ? String(h.priceCents / 100) : "");
  const [notes, setNotes] = useState(h?.notes ?? "");
  const [coachName, setCoachName] = useState(h?.existingCoach?.name ?? "");
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const payRun = useMutation({
    mutationFn: (waive: boolean) => pay({ data: { handlingId: h.id, priceCents: waive ? null : dollars(price), waive } }),
    onSuccess: (r) => {
      onChanged();
      setPayUrl(r.url);
      toast.success(r.payment === "waived" ? "No charge for this handling" : "Payment link ready");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't set the payment"),
  });
  const updRun = useMutation({
    mutationFn: (d: any) => upd({ data: { handlingId: h.id, ...d } }),
    onSuccess: (_r, d) => {
      onChanged();
      toast.success(d.action === "cancel" ? "Handling cancelled. Their account stays as it is." : d.action === "complete" ? "Handling completed. Their account and history stay." : "Saved");
      if (d.action) onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
  });
  if (!h) return null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-handling-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>Competition handling</SheetTitle>
          <SheetDescription>
            {HANDLING_WORD[h.status as keyof typeof HANDLING_WORD]} · {prep.competition.name} · {dayWords(String(prep.competition.meet_date))}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold">Their link</h3>
            <p className="text-[12.5px] text-muted-foreground">
              {h.invite.openedAt ? `Opened ${dayWords(h.invite.openedAt.slice(0, 10))}` : h.invite.sentAt ? `Sent ${dayWords(h.invite.sentAt.slice(0, 10))}, not opened yet` : "Not sent yet"}
              {h.invite.state !== "ok" ? ` · ${h.invite.state === "expired" ? "expired" : "not active"}` : ""}. It signs them in or sets up their account, then asks only what's left.
            </p>
            <LinkActions handlingId={h.id} onSent={onChanged} />
          </section>

          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold">Payment</h3>
            <p className="text-[12.5px] text-muted-foreground">
              {PAYMENT_WORD[h.payment as keyof typeof PAYMENT_WORD] ?? "No price set"}
              {h.priceCents ? ` · ${priceText(h.priceCents, h.currency)} + tax` : ""}. A one-time payment through Stripe; it's never a subscription.
            </p>
            {h.payment !== "paid" ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="hp">Price (before tax)</Label>
                  <Input id="hp" inputMode="decimal" className="w-32" placeholder="150" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                <Button size="sm" disabled={!dollars(price)} loading={payRun.isPending} onClick={() => payRun.mutate(false)} data-make-pay-link>
                  {h.saleId ? "Update the payment link" : "Make a payment link"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => payRun.mutate(true)}>
                  No charge
                </Button>
              </div>
            ) : null}
            {payUrl ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2 text-[12.5px]">{payUrl}</p>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(payUrl).then(() => toast.success("Copied"))}>
                  Copy
                </Button>
              </div>
            ) : h.payment === "link" ? (
              <p className="text-[12.5px] text-muted-foreground">They'll see Pay on their meet page (on the web).</p>
            ) : null}
          </section>

          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold">Their coach</h3>
            <p className="text-[12.5px] text-muted-foreground">
              Their coach keeps their training. {h.shareWithCoach === "yes" ? "They said their coach may see the plan." : h.shareWithCoach === "no" ? "They said their coach may not see the plan." : "They haven't said whether their coach may see the plan; nothing is shared until they do."}
            </p>
            <div className="flex gap-2">
              <Input value={coachName} onChange={(e) => setCoachName(e.target.value)} placeholder="Their coach's name" />
              <Button size="sm" variant="outline" onClick={() => updRun.mutate({ existingCoach: coachName.trim() ? { name: coachName.trim(), clientId: h.existingCoach?.clientId ?? null } : null })}>
                Save
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold">Private notes</h3>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => updRun.mutate({ notes })}>
              Save notes
            </Button>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <p className="text-[12.5px] text-muted-foreground">
              Ending the handling never changes their account, membership, coach or history. Access for whoever handles them ends {h.access?.ends ? dayWords(h.access.ends) : "a week after the meet"}.
            </p>
            <div className="flex flex-wrap gap-2">
              {h.status !== "completed" && h.status !== "cancelled" ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => updRun.mutate({ action: "complete" })}>
                    Mark completed
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updRun.mutate({ action: "cancel" })}>
                    Cancel handling
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => updRun.mutate({ action: "reopen" })}>
                  Reopen
                </Button>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Setting up handling: from a meeting's opportunity (the name, the meet and the
 * referrer filled in from what was said) or by hand. Prepare makes the service
 * and the link; nothing is sent until the coach sends it.
 */
export function HandlingInviteSheet({
  open,
  onClose,
  opportunity,
  defaults,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  opportunity?: (HandlingOpportunity & { sessionId?: string }) | null;
  defaults?: { clientId?: string | null; competitionId?: string | null; first?: string; last?: string; email?: string; phone?: string; event?: { name: string; meet_date: string } | null } | null;
  onCreated?: (r: { handlingId: string; clientId: string; competitionId: string }) => void;
}) {
  const create = useServerFn(createHandlingFn);
  const parts = (opportunity?.athleteName ?? defaults?.first ?? "").split(" ");
  const [first, setFirst] = useState(parts[0] ?? "");
  const [last, setLast] = useState(parts.slice(1).join(" ") || defaults?.last || "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [meetName, setMeetName] = useState(opportunity?.competition?.name ?? defaults?.event?.name ?? "");
  const [meetDate, setMeetDate] = useState(opportunity?.competition?.date ?? defaults?.event?.meet_date ?? "");
  const [coach, setCoach] = useState(opportunity?.existingCoachGuess ?? "");
  const [price, setPrice] = useState("");
  const [made, setMade] = useState<{ handlingId: string; clientId: string; competitionId: string; payUrl: string | null; payError: string | null } | null>(null);
  const run = useMutation({
    mutationFn: () =>
      create({
        data: {
          clientId: defaults?.clientId ?? null,
          person: defaults?.clientId ? null : { first: first.trim(), last: last.trim() || null, email: email.trim() || null, phone: phone.trim() || null },
          competitionId: defaults?.competitionId ?? null,
          copyFromCompetitionId: opportunity?.competition?.id && meetName === opportunity.competition.name ? opportunity.competition.id : null,
          event: defaults?.competitionId ? null : { name: meetName.trim(), meet_date: meetDate },
          referrerClientId: opportunity?.referrer.clientId ?? null,
          sessionId: opportunity?.sessionId ?? null,
          sourceNote: opportunity?.evidence?.[0]?.text ?? null,
          existingCoach: coach.trim() ? { name: coach.trim(), clientId: opportunity && coach.trim() === opportunity.existingCoachGuess ? opportunity.referrer.clientId : null } : null,
          priceCents: dollars(price),
        } as any,
      }),
    onSuccess: (r) => {
      setMade(r);
      onCreated?.(r);
      toast.success(r.created ? "Handling is set up. Send the link when you're ready." : "They already have handling for this meet");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't set it up"),
  });
  const ready = (defaults?.clientId || first.trim()) && (defaults?.competitionId || (meetName.trim() && /^\d{4}-\d{2}-\d{2}$/.test(meetDate)));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-handling-invite-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>{made ? "Send their link" : "Handle someone at a meet"}</SheetTitle>
          <SheetDescription>
            {made
              ? "One link: it signs them in or sets up their JF Effect account, then asks only what's left. Nothing goes out until you send it."
              : "Uses what's already known. Anything missing, they fill in from the link."}
          </SheetDescription>
        </SheetHeader>
        {made ? (
          <div className="mt-4 space-y-4">
            <LinkActions handlingId={made.handlingId} />
            {made.payError ? <p className="text-[13px] text-warning">Payment link not made: {made.payError}</p> : null}
            {opportunity ? (
              <div className="rounded-2xl border border-border p-3 text-[13px]">
                <p className="font-medium">Or send it through {opportunity.referrer.name.split(" ")[0]}</p>
                <p className="mt-1 text-muted-foreground">If you don't have {first}'s details, {opportunity.referrer.name.split(" ")[0]} can forward it.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={async () => {
                    try {
                      const { handlingLinkFn: f } = await import("@/lib/competition/handling.functions");
                      const r = await f({ data: { handlingId: made.handlingId, renew: false } });
                      await navigator.clipboard.writeText(referrerAsk({ referrerFirst: opportunity.referrer.name.split(" ")[0], athleteFirst: first, meetName, url: r.url }));
                      toast.success(`Copied a note for ${opportunity.referrer.name.split(" ")[0]}`);
                    } catch (e: any) {
                      toast.error(e?.message ?? "Couldn't copy it");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" /> Copy a note for {opportunity.referrer.name.split(" ")[0]}
                </Button>
              </div>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) run.mutate();
            }}
          >
            {opportunity ? (
              <div className="rounded-2xl bg-muted px-3 py-2 text-[13px]" data-opportunity-source>
                <p className="font-medium">From your meeting with {opportunity.referrer.name}</p>
                {opportunity.evidence.slice(0, 2).map((ev, i) => (
                  <p key={i} className="mt-0.5 text-muted-foreground">
                    {ev.text}
                  </p>
                ))}
                {opportunity.waitingOn.length ? <p className="mt-1">Waiting on: {opportunity.waitingOn.join("; ")}</p> : null}
              </div>
            ) : null}
            {!defaults?.clientId ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="hf">First name</Label>
                  <Input id="hf" value={first} onChange={(e) => setFirst(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="hl">Last name</Label>
                  <Input id="hl" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Not known yet" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="he">Email</Label>
                  <Input id="he" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="hph">Phone</Label>
                  <Input id="hph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                </div>
              </div>
            ) : null}
            {!defaults?.competitionId ? (
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1">
                  <Label htmlFor="hm">Competition</Label>
                  <Input id="hm" value={meetName} onChange={(e) => setMeetName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="hd">Date</Label>
                  <Input id="hd" type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} required />
                </div>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="hc">Their coach</Label>
              <Input id="hc" value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="If they have one" />
              <p className="text-[12px] text-muted-foreground">They confirm it, and say whether their coach may see the plan.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hpr">Price (before tax)</Label>
              <Input id="hpr" inputMode="decimal" className="w-36" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Set it later" />
            </div>
            {opportunity?.missing.length ? (
              <p className="text-[12.5px] text-muted-foreground">Not known yet: {opportunity.missing.join(", ")}. They fill it in from the link.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!ready} loading={run.isPending} data-prepare-handling>
                Prepare the invitation
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
