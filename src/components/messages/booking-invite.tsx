import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarPlus, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtDuration } from "@/lib/booking-cards";
import { locationLabel, type BookingType } from "@/lib/booking-types";
import { fmtClock, fmtDayLabel } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

/**
 * A booking invite in a coach chat: the coach picks a booking type that's
 * taking online bookings and the client gets a card that opens its booking
 * page, signed in as themselves, with the times his availability offers right
 * now. Once they book, the card shows the booking it led to (read live).
 */

export type BookingInviteAttachment = {
  kind: "booking_invite";
  type: "link";
  url: string;
  booking_slug: string;
  booking_card_id: string;
  request_title: string;
  duration_min: number;
  where: string;
  client_id: string;
  sent_at: string;
  request_note?: string;
};

export function bookingInviteAttachment(t: BookingType, clientId: string, note: string): BookingInviteAttachment {
  return {
    kind: "booking_invite",
    type: "link",
    url: `/book/${t.slug}`,
    booking_slug: t.slug!,
    booking_card_id: t.id,
    request_title: t.name,
    duration_min: t.duration_minutes,
    where: locationLabel(t),
    client_id: clientId,
    sent_at: new Date().toISOString(),
    request_note: note.trim() || undefined,
  };
}

export function BookingInvitePicker({
  open,
  onOpenChange,
  clientId,
  onSend,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  onSend: (att: BookingInviteAttachment, body: string) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<BookingType | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const { data: types = [], isLoading } = useQuery({
    queryKey: ["booking-invite-types"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("booking_cards")
        .select("*")
        .eq("is_active", true)
        .eq("online_enabled", true)
        .not("slug", "is", null)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as BookingType[];
    },
  });

  const send = async () => {
    if (!picked) return;
    setSending(true);
    try {
      const att = bookingInviteAttachment(picked, clientId, note);
      await onSend(att, note.trim() || `Book a ${picked.name}: pick a time that works for you.`);
      onOpenChange(false);
      setPicked(null);
      setNote("");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send it");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-3">
          <SheetHeader className="text-left">
            <SheetTitle>Send a booking link</SheetTitle>
            <SheetDescription>They pick a time from what's open right now, and it shows here once they've booked.</SheetDescription>
          </SheetHeader>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
          ) : types.length === 0 ? (
            <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
              Nothing is taking online bookings yet. Turn it on for a type under Calendar → Booking.
            </p>
          ) : (
            <div className="grid gap-2" role="radiogroup" aria-label="What they're booking">
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={picked?.id === t.id}
                  onClick={() => setPicked(t)}
                  className={cn("rounded-xl border p-3 text-left", picked?.id === t.id ? "border-foreground" : "border-border")}
                >
                  <span className="block text-sm font-semibold">{t.name}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {fmtDuration(t.duration_minutes)} · {locationLabel(t)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="text-base" />
          <Button className="h-11 w-full" disabled={!picked || sending} onClick={send}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}
            Send
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type Booked = { kind: "session" | "appointment"; starts_at: string; ends_at: string; timezone: string | null; status: string };

/** The booking this invite led to: the client's first booking of this type made after it was sent. */
function useInviteBooking(att: Partial<BookingInviteAttachment>) {
  return useQuery({
    queryKey: ["booking-invite-result", att.client_id, att.booking_card_id, att.sent_at],
    enabled: !!att.client_id && !!att.booking_card_id && !!att.sent_at,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Booked | null> => {
      const db = supabase as any;
      const [s, a] = await Promise.all([
        db
          .from("pt_sessions")
          .select("starts_at, ends_at, timezone, status, created_at")
          .eq("client_id", att.client_id)
          .eq("booking_card_id", att.booking_card_id)
          .gte("created_at", att.sent_at)
          .order("created_at", { ascending: true })
          .limit(1),
        db
          .from("appointments")
          .select("starts_at, ends_at, timezone, status, created_at")
          .eq("client_id", att.client_id)
          .eq("booking_card_id", att.booking_card_id)
          .gte("created_at", att.sent_at)
          .order("created_at", { ascending: true })
          .limit(1),
      ]);
      const rows: Array<Booked & { created_at: string }> = [
        ...((s.data ?? []) as any[]).map((r) => ({ ...r, kind: "session" as const })),
        ...((a.data ?? []) as any[]).map((r) => ({ ...r, kind: "appointment" as const })),
      ].sort((x, y) => x.created_at.localeCompare(y.created_at));
      return rows[0] ?? null;
    },
  });
}

export function BookingInviteCard({ att, mine }: { att: Partial<BookingInviteAttachment>; mine: boolean }) {
  const { data: booked, isLoading } = useInviteBooking(att);
  const title = att.request_title ?? "a call";
  const cancelled = booked && /cancel|rescheduled/i.test(booked.status);
  const when = booked ? `${fmtDayLabel(new Date(booked.starts_at), booked.timezone)} · ${fmtClock(new Date(booked.starts_at), booked.timezone)}` : null;
  return (
    <div className="w-[270px] max-w-full rounded-2xl border border-border bg-card p-3 text-left text-foreground" data-booking-invite>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
          {booked && !cancelled ? <CalendarCheck className="h-4.5 w-4.5 text-success" /> : <CalendarPlus className="h-4.5 w-4.5 text-muted-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug">Book a {title}</p>
          <p className="text-[13px] text-muted-foreground">
            {[att.duration_min ? fmtDuration(att.duration_min) : null, att.where].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {att.request_note && <p className="mt-2 whitespace-pre-wrap text-[13px]">{att.request_note}</p>}
      <div className="mt-2.5 border-t border-border pt-2.5">
        {isLoading ? (
          <div className="h-9 animate-pulse rounded-lg bg-muted" />
        ) : booked && !cancelled ? (
          <p className="text-sm" data-booking-invite-booked>
            <span className="font-semibold text-success">Booked</span> · {when}
          </p>
        ) : mine ? (
          <p className="text-[13px] text-muted-foreground">{cancelled ? `Was booked ${when}, then cancelled` : "Waiting for them to pick a time"}</p>
        ) : (
          <Button asChild className="h-10 w-full">
            <Link to="/book/$slug" params={{ slug: att.booking_slug ?? "" }} search={{ name: "", email: "", phone: "", application_id: "", i: "" } as any}>
              {cancelled ? "Pick a new time" : "Choose a time"} <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
