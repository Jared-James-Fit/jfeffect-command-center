import { createFileRoute } from "@tanstack/react-router";
import { BookingPage } from "@/components/booking/booking-page";

/**
 * Public booking page for a booking type (Calendar → Booking → Send link).
 * Accepts prefill from a coach's "send to a client" link and the coaching
 * application flow: ?name=&email=&phone=&application_id=
 */
export const Route = createFileRoute("/book/$slug")({
  head: () => ({
    meta: [{ title: "Book a time · JF Effect" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    name: typeof search.name === "string" ? search.name : "",
    email: typeof search.email === "string" ? search.email : "",
    phone: typeof search.phone === "string" ? search.phone : "",
    application_id: typeof search.application_id === "string" ? search.application_id : "",
    // Personal link from the coach: books as that client.
    i: typeof search.i === "string" ? search.i : "",
  }),
  component: BookingRoute,
});

function BookingRoute() {
  const { slug } = Route.useParams();
  const s = Route.useSearch();
  return (
    <BookingPage
      slug={slug}
      prefill={{
        name: s.name,
        email: s.email,
        phone: s.phone,
        applicationId: s.application_id,
        invite: s.i,
      }}
    />
  );
}
