import { createFileRoute, redirect } from "@tanstack/react-router";
import { AthletePage } from "@/components/challenges/athlete-page";
import { getAthleteFn } from "@/lib/challenges/public.functions";
import { mediaUrl } from "@/lib/challenges/api";
import { shareMeta } from "@/lib/share-meta";

// An athlete's challenge profile: every event, podiums, personal bests.
export const Route = createFileRoute("/athletes/$handle")({
  loader: async ({ params }) => {
    const a = await getAthleteFn({ data: { handle: params.handle } });
    if (a?.redirect) throw redirect({ to: "/athletes/$handle", params: { handle: a.redirect }, replace: true });
    return a;
  },
  head: ({ loaderData: a, params }) => {
    const photo = mediaUrl(a?.photo);
    const n = a?.history.filter((h) => h.rank != null).length ?? 0;
    return {
      meta: [
        { title: `${a?.name ?? "Athlete"} | JF Effect Challenges` },
        { name: "description", content: `${a?.name ?? "This athlete"} has competed in ${n} JF Effect challenge${n === 1 ? "" : "s"}.` },
        ...(a?.listed ? [] : [{ name: "robots", content: "noindex" }]),
        ...shareMeta({ title: (a?.name ?? "Athlete").slice(0, 40), description: "Challenge results on JF Effect.", path: `/athletes/${params.handle}`, image: photo ? { url: photo, width: 720, height: 720, alt: a?.name ?? "" } : null }),
      ],
    };
  },
  component: function AthleteRoute() {
    const { handle } = Route.useParams();
    return <AthletePage handle={handle} initial={Route.useLoaderData()} />;
  },
});
