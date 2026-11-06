import { createFileRoute } from "@tanstack/react-router";
import { fetchChallenge } from "@/lib/challenges/api";
import { shareMeta } from "@/lib/share-meta";
import { ChallengePage } from "@/components/challenges/challenge-page";

/**
 * A challenge's public page: what it is, the live leaderboard, the rules and
 * how to enter. Readable without an account; drafts only for staff.
 * ?ref=<entry code> is a friend's challenge link, ?src=qr a scan.
 */
export const Route = createFileRoute("/challenges/$slug/")({
  validateSearch: (s: Record<string, unknown>): { ref?: string; src?: "qr" | "display" } => ({
    ref: typeof s.ref === "string" && /^[a-z0-9]{8,16}$/.test(s.ref) ? s.ref : undefined,
    src: s.src === "qr" || s.src === "display" ? (s.src as "qr" | "display") : undefined,
  }),
  loader: async ({ params }) => {
    try {
      return { challenge: await fetchChallenge(params.slug) };
    } catch {
      return { challenge: null };
    }
  },
  head: ({ loaderData, params }) => {
    const c = loaderData?.challenge;
    const title = c?.title ?? "Challenge";
    const desc = c
      ? [
          c.tagline,
          c.prize_summary ? `Prize: ${c.prize_summary}.` : null,
          c.status === "live" ? "Live leaderboard now." : null,
        ]
          .filter(Boolean)
          .join(" ")
      : "A JF Effect challenge.";
    const event =
      c && c.starts_at && c.venue_name
        ? {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            name: c.title,
            description: c.tagline ?? undefined,
            startDate: c.starts_at,
            endDate: c.ends_at ?? undefined,
            eventStatus:
              c.status === "cancelled"
                ? "https://schema.org/EventCancelled"
                : "https://schema.org/EventScheduled",
            location: {
              "@type": "Place",
              name: c.venue_name,
              address: c.address ?? c.city ?? undefined,
            },
            organizer: { "@type": "Organization", name: "JF Effect", url: "https://jfeffect.com" },
            isAccessibleForFree: (c.entry_fee_label ?? "").toLowerCase() === "free",
            url: `https://jfeffect.com/challenges/${params.slug}`,
          }
        : null;
    return {
      meta: [
        { title: `${title} | JF Effect Challenges` },
        { name: "description", content: desc },
        ...shareMeta({
          title: title.length > 40 ? title.slice(0, 39) + "…" : title,
          description: desc,
          path: `/challenges/${params.slug}`,
        }),
        ...(c && !c.is_test && c.status !== "draft"
          ? []
          : [{ name: "robots", content: "noindex" }]),
      ],
      links: [{ rel: "canonical", href: `https://jfeffect.com/challenges/${params.slug}` }],
      scripts: event ? [{ type: "application/ld+json", children: JSON.stringify(event) }] : [],
    };
  },
  component: Page,
});

function Page() {
  const { slug } = Route.useParams();
  const { challenge } = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <ChallengePage
      slug={slug}
      initial={challenge}
      refCode={search.ref ?? null}
      src={search.src ?? null}
    />
  );
}
