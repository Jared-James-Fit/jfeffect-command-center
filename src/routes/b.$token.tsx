import { createFileRoute } from "@tanstack/react-router";
import { BookingPage } from "@/components/booking/booking-page";
import { shareMeta } from "@/lib/share-meta";

/**
 * A personal booking link the coach sent one client (jfeffect.com/b/<token>):
 * the token names nobody; the server resolves it to the client, the booking
 * type and the length he picked (booking-invite.server.ts), so they open it
 * anywhere, signed in or not, and just pick a time. `?pv=1` is the coach's
 * View as client: everything shows, nothing books.
 */
export const Route = createFileRoute("/b/$token")({
  head: () => ({
    meta: [
      { title: "Book a time · JF Effect" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
      ...shareMeta({
        title: "Book a time with JF Effect",
        description: "Pick a time that works for you.",
      }),
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { pv?: 1 } =>
    search.pv === 1 || search.pv === "1" ? { pv: 1 } : {},
  component: InviteBookingRoute,
});

function InviteBookingRoute() {
  const { token } = Route.useParams();
  const { pv } = Route.useSearch();
  return (
    <BookingPage
      slug={null}
      preview={pv === 1}
      prefill={{ name: "", email: "", phone: "", applicationId: "", invite: token, duration: null }}
    />
  );
}
