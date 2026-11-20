import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, CalendarPlus, ChevronRight, Copy, Loader2, Mail, MessageSquare, Send, Video } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClientSessionSheet, type ClientSession } from "@/components/schedule/client-session-sheet";
import { fmtDuration } from "@/lib/booking-cards";
import { INVITE_DAYS, inviteWaitingLine, tokenFromInviteUrl } from "@/lib/booking-invite";
import { createBookingInvite, revokeBookingInvite } from "@/lib/booking.functions";
import { clientsOnly, durationChoices, durationLabel, locationLabel, publicOrigin, type BookingType } from "@/lib/booking-types";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { sendMessage } from "@/lib/messages";
import { fmtClock, fmtDayLabel } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

/**
 * Scheduling with one client, from their chat (the + menu's Schedule) or their
 * profile: send a personal booking link and they pick a time from what's open
 * right now, or book it yourself. The link (jfeffect.com/b/<token>) books as
 * them anywhere, signed in or not, at the length picked here; in the chat it's
 * a card that shows the booking it led to (read live), and the coach can copy
 * or cancel it from the card.
 */

export type BookingInviteAttachment = {
  kind: "booking_invite";
  type: "link";
  /** /b/<token> (older cards: /book/<slug>). */
  url: string;
  booking_slug: string;
  booking_card_id: string;
  request_title: string;
  duration_min: number;
  where: string;
  client_id: string;
  sent_at: string;
  request_note?: string;
  /** The length the coach picked (the page opens on it, not a choice). */
  duration_fixed?: number;
  /** The link's row (booking_invites): the coach's card reads opened / cancelled / expired from it. */
  invite_id?: string;
  expires_at?: string;
};

/** A minted personal link (createBookingInvite). */
export type MintedLink = { inviteId: string; path: string; expiresAt: string; durationMin: number };

/**
 * What a coach sends an existing client: calls for clients first (General
 * Call), then anything else they can book; types made for new people (the
 * discovery call: open to anyone, kept out of clients' apps) last.
 */
export function inviteTypeGroups(types: BookingType[]): { forClients: BookingType[]; forNew: BookingType[] } {
  const forNew = (t: BookingType) => !clientsOnly(t) && !t.show_in_app;
  return {
    forClients: [...types.filter((t) => !forNew(t) && clientsOnly(t)), ...types.filter((t) => !forNew(t) && !clientsOnly(t))],
    forNew: types.filter(forNew),
  };
}

/** The same order as one list. */
export function inviteOrder(types: BookingType[]): BookingType[] {
  const g = inviteTypeGroups(types);
  return [...g.forClients, ...g.forNew];
}

/** The length a link is for: the coach's pick when the type offers several, else null (the type's own). */
export function fixedLength(t: BookingType, length: number | null | undefined): number | null {
  const choices = durationChoices(t);
  return choices.length > 1 && length && choices.includes(length) ? length : null;
}

export function bookingInviteAttachment(
  t: BookingType,
  clientId: string,
  note: string,
  /** The length the coach picked, for a type that offers several (a General Call). */
  length: number | null | undefined,
  /** The personal link minted for it. */
  link: MintedLink,
): BookingInviteAttachment {
  const fixed = fixedLength(t, length);
  return {
    kind: "booking_invite",
    type: "link",
    url: link.path,
    booking_slug: t.slug!,
    booking_card_id: t.id,
    request_title: t.name,
    duration_min: fixed ?? t.duration_minutes,
    duration_fixed: fixed ?? undefined,
    where: locationLabel(t),
    client_id: clientId,
    sent_at: new Date().toISOString(),
    request_note: note.trim() || undefined,
    invite_id: link.inviteId,
    expires_at: link.expiresAt,
  };
}

/** "Book a 30-min General Call: pick a time that works for you." (the chat line under the card). */
export function inviteBody(t: BookingType, length: number | null | undefined, note: string): string {
  const fixed = fixedLength(t, length);
  return note.trim() || `Book a ${fixed ? `${fixed}-min ` : ""}${t.name}: pick a time that works for you.`;
}

/** The text or email that carries the link outside the app. */
export function inviteShareText(first: string, t: BookingType, length: number | null | undefined, note: string, url: string): string {
  const fixed = fixedLength(t, length);
  const what = `${fixed ? `${fixed}-min ` : ""}${t.name}`;
  return note.trim() ? `${note.trim()}\n${url}` : `Hi${first ? ` ${first}` : ""}, here's a link to book your ${what}. Pick a time that works for you: ${url}`;
}

function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  } catch {
    /* fall through */
  }
  return Promise.resolve(false);
}

/** Live types taking online bookings, in the order a coach sends them. */
function useInviteTypes(enabled: boolean) {
  return useQuery({
    queryKey: ["booking-invite-types"],
    enabled,
    staleTime: 60_000,
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
}

/**
 * The personal link for this client, type and length, made once the coach has
 * picked them (so Copy and Text work inside the tap, which iOS requires).
 */
function useMintedLink(clientId: string, t: BookingType | null, length: number | null, enabled: boolean) {
  const mint = useServerFn(createBookingInvite);
  return useQuery({
    queryKey: ["booking-link", clientId, t?.id ?? null, length],
    enabled: enabled && !!t,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async (): Promise<MintedLink> =>
      (await mint({ data: { clientId, bookingCardId: t!.id, duration: length } })) as MintedLink,
  });
}

export function ScheduleSheet({
  open,
  onOpenChange,
  clientId,
  onSendInChat,
  onBookYourself,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  /** Posts the card in their coach chat. */
  onSendInChat: (att: BookingInviteAttachment, body: string) => void | Promise<void>;
  /** Book it for them instead (the booking dialog on this type and length). */
  onBookYourself?: (t: BookingType) => void;
}) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<BookingType | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const { data: types = [], isLoading } = useInviteTypes(open);
  const { data: client } = useQuery({
    queryKey: ["schedule-sheet-client", clientId],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await supabase.from("clients").select("id, full_name, phone, email").eq("id", clientId).maybeSingle()).data as
        | { id: string; full_name: string | null; phone: string | null; email: string | null }
        | null,
  });
  const first = (client?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  const groups = inviteTypeGroups(types);
  // A call for clients is what a coach sends most: picked to start with.
  const picked = chosen ?? groups.forClients[0] ?? null;
  const lengths = picked ? durationChoices(picked) : [];
  const pickedLength = picked && length && lengths.includes(length) ? length : picked?.duration_minutes ?? null;
  const linkLength = picked ? fixedLength(picked, pickedLength) : null;
  const { data: link, isFetching: making, error: linkError } = useMintedLink(clientId, picked, linkLength, open);
  const url = link ? `${publicOrigin()}${link.path}` : null;
  const shareText = picked && url ? inviteShareText(first, picked, linkLength, note, url) : "";

  const reset = () => {
    setChosen(null);
    setLength(null);
    setNote("");
  };

  const send = async () => {
    if (!picked || !link) return;
    setSending(true);
    try {
      await onSendInChat(bookingInviteAttachment(picked, clientId, note, linkLength, link), inviteBody(picked, linkLength, note));
      // The next send gets its own link (and its own card).
      qc.removeQueries({ queryKey: ["booking-link", clientId] });
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send it");
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!url) return;
    if (await copy(url)) toast.success("Link copied", { description: `It books as ${first || "them"} for ${INVITE_DAYS} days.` });
    else toast.error("Couldn't copy. Press and hold the link to copy it.");
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <SheetContent
        side="bottom"
        swipeToClose
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        data-schedule-sheet
      >
        <div className="mx-auto w-full max-w-lg space-y-3">
          <SheetHeader className="text-left">
            <SheetTitle>Schedule{first ? ` with ${first}` : ""}</SheetTitle>
            <SheetDescription>
              Send a link and {first || "they"} {first ? "picks" : "pick"} a time from your open hours. No sign-in needed.
            </SheetDescription>
          </SheetHeader>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
          ) : types.length === 0 ? (
            <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
              Nothing is taking online bookings yet. Turn it on for a type under Calendar → Booking.
            </p>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="What they're booking">
              {[...groups.forClients, ...groups.forNew].map((t, i) => (
                <div key={t.id}>
                  {i === groups.forClients.length && groups.forNew.length > 0 && (
                    <p className="px-1 pb-1.5 pt-1 text-xs text-muted-foreground">For new people</p>
                  )}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={picked?.id === t.id}
                    onClick={() => {
                      setChosen(t);
                      setLength(null);
                    }}
                    className={cn("w-full rounded-xl border p-3 text-left", picked?.id === t.id ? "border-foreground" : "border-border")}
                    data-invite-type={t.slug ?? undefined}
                  >
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {durationLabel(t)} · {locationLabel(t)}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {picked && lengths.length > 1 && (
            <div className="space-y-1.5" data-invite-length>
              <p className="text-sm font-semibold">How long?</p>
              <div
                className={cn("grid gap-2", lengths.length === 4 ? "grid-cols-4" : "grid-cols-3")}
                role="radiogroup"
                aria-label="Call length"
              >
                {lengths.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={pickedLength === n}
                    onClick={() => setLength(n)}
                    className={cn(
                      "h-11 rounded-full border px-2 text-sm font-semibold tabular-nums",
                      pickedLength === n ? "border-foreground bg-foreground text-background" : "border-border text-foreground",
                    )}
                  >
                    {n} min
                  </button>
                ))}
              </div>
            </div>
          )}
          {picked && (
            <>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="text-base" />
              <Button className="h-11 w-full" disabled={!link || sending} onClick={send} data-schedule-send>
                {sending || (making && !link) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send link in chat
              </Button>
              <div className="grid grid-cols-3 gap-2" aria-busy={!link}>
                <Button variant="outline" className="h-11" disabled={!url} onClick={copyLink} data-schedule-copy>
                  <Copy className="mr-1.5 h-4 w-4" /> Copy
                </Button>
                <Button asChild variant="outline" className={cn("h-11", !url && "pointer-events-none opacity-50")}>
                  <a href={url ? `sms:${client?.phone ?? ""}?&body=${encodeURIComponent(shareText)}` : undefined} data-schedule-text>
                    <MessageSquare className="mr-1.5 h-4 w-4" /> Text
                  </a>
                </Button>
                <Button asChild variant="outline" className={cn("h-11", !url && "pointer-events-none opacity-50")}>
                  <a
                    href={
                      url
                        ? `mailto:${client?.email ?? ""}?subject=${encodeURIComponent(`Book your ${picked.name}`)}&body=${encodeURIComponent(shareText)}`
                        : undefined
                    }
                  >
                    <Mail className="mr-1.5 h-4 w-4" /> Email
                  </a>
                </Button>
              </div>
              {linkError ? (
                <p className="text-xs text-destructive">{(linkError as Error).message || "Couldn't make the link."}</p>
              ) : (
                <p className="text-xs text-muted-foreground" data-schedule-link-note>
                  Their own link: it books as {first || "them"} with no sign-in, and works for {INVITE_DAYS} days.
                </p>
              )}
              {onBookYourself && (
                <button
                  type="button"
                  onClick={() => {
                    const t = lengths.length > 1 && pickedLength ? { ...picked, duration_minutes: pickedLength } : picked;
                    onOpenChange(false);
                    reset();
                    onBookYourself(t);
                  }}
                  className="flex min-h-11 w-full items-center justify-between rounded-xl px-1 text-left text-sm"
                  data-schedule-book-yourself
                >
                  <span>
                    <span className="block font-semibold">Pick the time yourself</span>
                    <span className="block text-[13px] text-muted-foreground">Book it now; they get it in their chat</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Schedule from outside the chat (the client's profile): the card still goes to their chat. */
export function ClientScheduleSheet({
  clientId,
  open,
  onOpenChange,
  onBookYourself,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onBookYourself?: (t: BookingType) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return (
    <ScheduleSheet
      open={open}
      onOpenChange={onOpenChange}
      clientId={clientId}
      onBookYourself={onBookYourself}
      onSendInChat={async (att, body) => {
        if (!user) throw new Error("Sign in again to send it.");
        await sendMessage({ clientId, senderId: user.id, senderRole: "admin", body, attachments: [att as any] });
        await qc.invalidateQueries({ queryKey: ["messages", clientId] });
        toast.success("Sent in their chat");
      }}
    />
  );
}

type Booked = {
  kind: "session" | "appointment";
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  status: string;
  session: (ClientSession & { wants_meet?: boolean | null }) | null;
};

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
          .select(
            "id, title, session_type, session_date, start_time, end_time, starts_at, ends_at, timezone, location, notes, client_visible_notes, meet_link, wants_meet, status, created_at",
          )
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
        ...((s.data ?? []) as any[]).map((r) => ({ ...r, kind: "session" as const, session: r })),
        ...((a.data ?? []) as any[]).map((r) => ({ ...r, kind: "appointment" as const, session: null })),
      ].sort((x, y) => x.created_at.localeCompare(y.created_at));
      return rows[0] ?? null;
    },
  });
}

/** The coach's view of the link itself (staff RLS): opened, cancelled, run out. */
function useInviteRow(inviteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["booking-invite-row", inviteId],
    enabled: enabled && !!inviteId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (
        await (supabase as any)
          .from("booking_invites")
          .select("id, expires_at, revoked_at, first_opened_at")
          .eq("id", inviteId)
          .maybeSingle()
      ).data as { id: string; expires_at: string; revoked_at: string | null; first_opened_at: string | null } | null,
  });
}

export function BookingInviteCard({ att, mine }: { att: Partial<BookingInviteAttachment>; mine: boolean }) {
  const qc = useQueryClient();
  const previewing = useViewingAsClient();
  const { data: booked, isLoading } = useInviteBooking(att);
  const { data: row } = useInviteRow(att.invite_id, mine && !booked);
  const revoke = useServerFn(revokeBookingInvite);
  const cancel = useMutation({
    mutationFn: async () => revoke({ data: { inviteId: att.invite_id! } }),
    onSuccess: () => {
      toast.success("Link cancelled");
      void qc.invalidateQueries({ queryKey: ["booking-invite-row", att.invite_id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't cancel it"),
  });
  const [openSession, setOpenSession] = useState<ClientSession | null>(null);
  const title = att.request_title ?? "a call";
  const cancelled = booked && /cancel|rescheduled/i.test(booked.status);
  const live = booked && !cancelled;
  const when = booked ? `${fmtDayLabel(new Date(booked.starts_at), booked.timezone)} · ${fmtClock(new Date(booked.starts_at), booked.timezone)}` : null;
  const token = tokenFromInviteUrl(att.url);
  const linkDead = !!row && (!!row.revoked_at || Date.parse(row.expires_at) <= Date.now());
  const join =
    live && booked?.session?.meet_link && booked.status === "Scheduled" && Date.parse(booked.ends_at) > Date.now()
      ? booked.session.meet_link
      : null;
  return (
    <div className="w-[270px] max-w-full rounded-2xl border border-border bg-card p-3 text-left text-foreground" data-booking-invite>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
          {live ? <CalendarCheck className="h-4.5 w-4.5 text-success" /> : <CalendarPlus className="h-4.5 w-4.5 text-muted-foreground" />}
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
        ) : live ? (
          <div className="space-y-2">
            {!mine && booked?.session ? (
              <button
                type="button"
                onClick={() => setOpenSession(booked.session)}
                className="flex min-h-10 w-full items-center justify-between gap-2 text-left text-sm"
                data-booking-invite-booked
              >
                <span>
                  <span className="font-semibold text-success">Booked</span> · {when}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <p className="text-sm" data-booking-invite-booked>
                <span className="font-semibold text-success">Booked</span> · {when}
              </p>
            )}
            {join && !mine && (
              <a
                href={join}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-sm font-medium text-foreground"
              >
                <Video className="h-4 w-4" /> Join video call
              </a>
            )}
          </div>
        ) : mine ? (
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground" data-booking-invite-status>
              {cancelled
                ? `Was booked ${when}, then cancelled`
                : row
                  ? inviteWaitingLine({ revokedAt: row.revoked_at, expiresAt: row.expires_at, firstOpenedAt: row.first_opened_at })
                  : "Waiting for them to pick a time"}
            </p>
            {token && !linkDead && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1"
                  onClick={async () => {
                    if (await copy(`${publicOrigin()}/b/${token}`)) toast.success("Link copied");
                    else toast.error("Couldn't copy it");
                  }}
                  data-booking-invite-copy
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link
                </Button>
                {att.invite_id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 flex-1 text-muted-foreground"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate()}
                    data-booking-invite-cancel
                  >
                    Cancel link
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <Button asChild className="h-10 w-full">
            {token ? (
              <Link to="/b/$token" params={{ token }} search={previewing ? { pv: 1 as const } : {}}>
                {cancelled ? "Pick a new time" : "Choose a time"} <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            ) : (
              <Link
                to="/book/$slug"
                params={{ slug: att.booking_slug ?? "" }}
                search={{ name: "", email: "", phone: "", application_id: "", i: "", ...(att.duration_fixed ? { d: att.duration_fixed } : {}) }}
              >
                {cancelled ? "Pick a new time" : "Choose a time"} <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            )}
          </Button>
        )}
      </div>
      {!mine && <ClientSessionSheet clientId={att.client_id ?? ""} session={openSession} onClose={() => setOpenSession(null)} />}
    </div>
  );
}
