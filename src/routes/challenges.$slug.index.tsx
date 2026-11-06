import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ChallengePage } from "@/components/challenges/challenge-page";
import { getChallengeFn } from "@/lib/challenges/public.functions";
import { mediaUrl } from "@/lib/challenges/api";
import { objectiveText } from "@/lib/challenges/format";
import { SHARE_TITLE_MAX, shareMeta } from "@/lib/share-meta";

// A challenge's own page: what it is, the live leaderboard, the rules, the prize.
export const Route = createFileRoute("/challenges/$slug/")({
  validateSearch: z.object({ ref: z.string().optional(), src: z.string().optional() }),
  loader: ({ params }) => getChallengeFn({ data: { slug: params.slug } }),
  head: ({ loaderData, params }) => {
    const c = loaderData?.page?.challenge;
    const title = c?.title ?? "Challenge";
    const line = c ? (c.tagline || objectiveText(c)) : "A JF Effect challenge.";
    const cover = mediaUrl(c?.cover_path);
    return {
      meta: [
        { title: `${title} | JF Effect` },
        { name: "description", content: line },
        ...(c && !loaderData?.page?.preview ? [] : [{ name: "robots", content: "noindex" }]),
        ...shareMeta({
          title: title.length > SHARE_TITLE_MAX ? `${title.slice(0, SHARE_TITLE_MAX - 1)}…` : title,
          description: line,
          path: `/challenges/${params.slug}`,
          image: cover ? { url: cover, width: 1600, height: 900, alt: title } : null,
        }),
      ],
    };
  },
  component: function ChallengeRoute() {
    const { slug } = Route.useParams();
    const data = Route.useLoaderData();
    const search = Route.useSearch();
    return <ChallengePage slug={slug} initialPage={data.page} initialBoard={data.board} search={search} />;
  },
});
