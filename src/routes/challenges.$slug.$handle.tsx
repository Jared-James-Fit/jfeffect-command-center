import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { ResultPage } from "@/components/challenges/result-page";
import { getResultFn } from "@/lib/challenges/public.functions";
import { mediaUrl } from "@/lib/challenges/api";
import { formatScore } from "@/lib/challenges/format";
import { shareMeta } from "@/lib/share-meta";

// One athlete's result in one challenge: what every share card links to.
export const Route = createFileRoute("/challenges/$slug/$handle")({
  validateSearch: z.object({ ref: z.string().optional(), src: z.string().optional() }),
  loader: async ({ params }) => {
    const r = await getResultFn({ data: { slug: params.slug, handle: params.handle } });
    if (r?.redirect) throw redirect({ to: "/challenges/$slug/$handle", params: { slug: params.slug, handle: r.redirect }, replace: true });
    return r;
  },
  head: ({ loaderData: r, params }) => {
    const c = r?.challenge;
    const scored = r && r.rank != null && r.score != null;
    const title = r ? (scored ? `${r.athlete.name}: ${formatScore(r.score, c!)}` : `${r.athlete.name} is in`) : "Result";
    const line = r && c
      ? scored
        ? `${r.final ? "Finished" : "Currently"} #${r.rank} of ${r.ranked} at the ${c.title}. Think you can beat it?`
        : `${r.athlete.name} entered the ${c.title}. You in?`
      : "A JF Effect challenge result.";
    const photo = mediaUrl(r?.athlete.photo);
    return {
      meta: [
        { title: `${title} | ${c?.title ?? "JF Effect"}` },
        { name: "description", content: line },
        { name: "robots", content: "noindex" },
        ...shareMeta({ title: title.slice(0, 40), description: line, path: `/challenges/${params.slug}/${params.handle}`, image: photo ? { url: photo, width: 720, height: 720, alt: r!.athlete.name } : null }),
      ],
    };
  },
  component: function ResultRoute() {
    const { slug, handle } = Route.useParams();
    return <ResultPage slug={slug} handle={handle} initial={Route.useLoaderData()} search={Route.useSearch()} />;
  },
});
