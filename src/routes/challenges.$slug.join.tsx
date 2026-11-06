import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { JoinPage } from "@/components/challenges/join-page";
import { getChallengeFn } from "@/lib/challenges/public.functions";
import { shareMeta } from "@/lib/share-meta";

// Sign up for a challenge: the QR at the venue and every "enter" link land here.
export const Route = createFileRoute("/challenges/$slug/join")({
  validateSearch: z.object({ ref: z.string().optional(), src: z.string().optional() }),
  loader: ({ params }) => getChallengeFn({ data: { slug: params.slug } }),
  head: ({ loaderData, params }) => {
    const title = loaderData?.page?.challenge.title ?? "Challenge";
    return {
      meta: [
        { title: `Enter: ${title} | JF Effect` },
        { name: "robots", content: "noindex" },
        ...shareMeta({ title: `Enter the ${title}`.slice(0, 40), description: "Sign up in a minute. Free.", path: `/challenges/${params.slug}/join` }),
      ],
    };
  },
  component: function JoinRoute() {
    const { slug } = Route.useParams();
    const data = Route.useLoaderData();
    return <JoinPage slug={slug} initial={data.page} search={Route.useSearch()} />;
  },
});
