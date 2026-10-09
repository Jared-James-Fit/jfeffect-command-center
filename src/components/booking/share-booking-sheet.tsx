import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, ExternalLink, Mail, MessageSquare, Share2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookingUrl, publicOrigin } from "@/lib/booking-types";
import { getClientBookingLink } from "@/lib/booking.functions";

type ClientLite = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

export type ShareTarget = { name: string; slug: string };

/**
 * Send a booking link: copy, share sheet, text or email. Sent to a client, it's
 * their personal link: they book as themselves (their sessions, their
 * calendar) with no form and no sign-in.
 */
export function ShareBookingSheet({
  target: givenTarget,
  choices,
  open,
  onOpenChange,
  client: presetClient,
}: {
  target: ShareTarget | null;
  /** With no target: the types to pick from first (e.g. from a client's profile). */
  choices?: ShareTarget[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Start with this client picked (from a client's profile). */
  client?: ClientLite | null;
}) {
  const [search, setSearch] = useState("");
  const [client, setClient] = useState<ClientLite | null>(presetClient ?? null);
  const [picked, setPicked] = useState<ShareTarget | null>(null);
  useEffect(() => {
    if (open) {
      setClient(presetClient ?? null);
      setSearch("");
      setPicked(choices?.length === 1 ? choices[0] : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetClient?.id]);
  // Only one type to send: skip the picker (choices can arrive after opening).
  useEffect(() => {
    if (open && !picked && choices?.length === 1) setPicked(choices[0]);
  }, [open, picked, choices]);
  const target = givenTarget ?? picked;
  const linkFn = useServerFn(getClientBookingLink);
  const { data: invite, isFetching: inviteLoading } = useQuery({
    queryKey: ["client-booking-invite", client?.id ?? null],
    enabled: open && !!client?.id,
    staleTime: 10 * 60_000,
    queryFn: async () => (await linkFn({ data: { clientId: client!.id } })).invite,
  });

  const { data: clients = [] } = useQuery<ClientLite[]>({
    queryKey: ["clients-contact-min"],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, email, phone")
        .eq("archived", false)
        .order("full_name");
      return (data ?? []) as ClientLite[];
    },
  });

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return clients.filter((c) => (c.full_name ?? "").toLowerCase().includes(q)).slice(0, 6);
  }, [clients, search]);

  if (!target) {
    if (!choices) return null;
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto w-full max-w-lg space-y-3">
            <SheetHeader className="text-left">
              <SheetTitle className="text-left">
                Send a booking link{presetClient?.full_name ? ` to ${presetClient.full_name}` : ""}
              </SheetTitle>
              <SheetDescription className="text-left">Pick what they're booking.</SheetDescription>
            </SheetHeader>
            {choices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No booking types are taking online bookings yet. Turn one on under Calendar →
                Booking.
              </p>
            ) : (
              <div className="grid gap-2">
                {choices.map((c) => (
                  <Button
                    key={c.slug}
                    variant="outline"
                    className="h-12 justify-start font-bold"
                    onClick={() => setPicked(c)}
                  >
                    {c.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  const base = bookingUrl(publicOrigin(), target.slug);
  // A client's link carries their personal invite; until it's ready, the plain link.
  const url = client && invite ? `${base}?i=${encodeURIComponent(invite)}` : base;
  const waiting = !!client && inviteLoading && !invite;
  const first = (client?.full_name ?? "").split(/\s+/)[0];
  const message = client
    ? `Hi ${first}, here's the link to book your ${target.name}: ${url}`
    : `Book a ${target.name} with me here: ${url}`;
  const canShare =
    typeof navigator !== "undefined" && typeof (navigator as any).share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  };
  const share = async () => {
    try {
      await (navigator as any).share({
        title: target.name,
        text: message.replace(url, "").trim(),
        url,
      });
    } catch {
      /* closed the share sheet */
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto w-full max-w-lg space-y-4">
          <SheetHeader className="text-left">
            <SheetTitle className="text-left">Send {target.name}</SheetTitle>
            <SheetDescription className="text-left">
              They pick a time from your open hours. It lands on your calendar and theirs.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-1.5">
            {client ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">To {client.full_name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {[client.phone, client.email].filter(Boolean).join(" · ") ||
                      "No phone or email on file"}
                  </div>
                  <div className="text-[11px] text-primary">
                    Their own link: no form, and it books as them.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setClient(null)}
                  aria-label="Clear client"
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Send to a client (optional)"
                  className="h-11"
                />
                {matches.length > 0 && (
                  <ul className="absolute inset-x-0 top-12 z-10 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setClient(c);
                            setSearch("");
                          }}
                          className="block w-full px-3 py-2.5 text-left text-sm hover:bg-secondary"
                        >
                          {c.full_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={copy}
            disabled={waiting}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-3 text-left"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {waiting ? "Making their link…" : url.replace(/^https?:\/\//, "")}
            </span>
            <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          <div
            className={
              waiting
                ? "pointer-events-none grid grid-cols-2 gap-2 opacity-50"
                : "grid grid-cols-2 gap-2"
            }
            aria-busy={waiting}
          >
            {canShare ? (
              <Button className="h-12 bg-gradient-primary font-bold" onClick={share}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
            ) : (
              <Button className="h-12 bg-gradient-primary font-bold" onClick={copy}>
                <Copy className="mr-2 h-4 w-4" /> Copy link
              </Button>
            )}
            <Button asChild variant="outline" className="h-12 font-bold">
              <a href={`sms:${client?.phone ?? ""}?&body=${encodeURIComponent(message)}`}>
                <MessageSquare className="mr-2 h-4 w-4" /> Text
              </a>
            </Button>
            <Button asChild variant="outline" className="h-12 font-bold">
              <a
                href={`mailto:${client?.email ?? ""}?subject=${encodeURIComponent(`Book your ${target.name}`)}&body=${encodeURIComponent(message)}`}
              >
                <Mail className="mr-2 h-4 w-4" /> Email
              </a>
            </Button>
            <Button asChild variant="outline" className="h-12 font-bold">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Open page
              </a>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
