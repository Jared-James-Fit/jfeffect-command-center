import { createFileRoute } from "@tanstack/react-router";
import { LiveDisplay } from "@/components/challenges/live-display";
import { getChallengeFn } from "@/lib/challenges/public.functions";

// The venue's big screen: open it on a TV or projector and leave it running.
export const Route = createFileRoute("/challenges/$slug/live")({
  loader: ({ params }) => getChallengeFn({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.page?.challenge.title ?? "Challenge"} · Live` }, { name: "robots", content: "noindex" }],
  }),
  component: function LiveRoute() {
    const { slug } = Route.useParams();
    const data = Route.useLoaderData();
    return <LiveDisplay slug={slug} initialPage={data.page} initialBoard={data.board} />;
  },
});
