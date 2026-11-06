import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChallengeShell, QrImage, useMounted } from "@/components/challenges/ui";
import { RegisterForm, type RegisterDone } from "@/components/challenges/register-form";
import {
  fetchChallenge,
  rememberEntry,
  resultUrl,
  track,
  useChallenge,
} from "@/lib/challenges/api";
import { eventWhen, selfSignupOpen } from "@/lib/challenges/model";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/challenges/$slug/join")({
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
  head: ({ loaderData, params }) => ({
    meta: [
      { title: `Enter · ${loaderData?.challenge?.title ?? "Challenge"} | JF Effect` },
      { name: "robots", content: "noindex" },
      ...shareMeta({
        title: `Enter the ${loaderData?.challenge?.title ?? "challenge"}`.slice(0, 40),
        description: "Sign up in under a minute.",
        path: `/challenges/${params.slug}/join`,
      }),
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { challenge: initial } = Route.useLoaderData();
  const q = useChallenge(slug, initial);
  const c = q.data;
  const [done, setDone] = useState<RegisterDone | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    track("join_start", { slug });
    if (search.src === "qr") track("qr_visit", { slug });
  }, [slug, search.src]);

  if (q.isPending && !c) {
    return (
      <ChallengeShell back={{ to: `/challenges/${slug}`, label: "Back" }}>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </ChallengeShell>
    );
  }
  if (!c) {
    return (
      <ChallengeShell>
        <p className="py-16 text-center text-sm text-muted-foreground">
          This challenge isn't open.
        </p>
      </ChallengeShell>
    );
  }

  if (done) {
    const link = resultUrl(slug, done.code);
    return (
      <ChallengeShell back={{ to: `/challenges/${slug}`, label: c.title }}>
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <h1 className="mt-3 text-2xl font-semibold">You're in, {done.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Show this number at the judging table.
          </p>
          <div className="mx-auto mt-5 w-40 rounded-2xl border border-border py-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your number
            </div>
            <div className="font-display text-7xl leading-none tabular-nums">{done.bib}</div>
          </div>
          {done.photoError ? (
            <p className="mx-auto mt-4 max-w-sm text-sm text-warning">
              Your photo didn't upload ({done.photoError}). Staff can take it at the table.
            </p>
          ) : null}
          <p className="mx-auto mt-6 max-w-sm text-sm">
            Your result page fills in the moment the judge records your set, with a card to share.
            Keep this tab open or come back to it any time.
          </p>
          <Button asChild className="mt-4 h-12 w-full max-w-sm text-base">
            <Link to="/challenges/$slug/r/$code" params={{ slug, code: done.code }}>
              Open my result page
            </Link>
          </Button>
          <div className="mt-6 flex flex-col items-center gap-1">
            <QrImage value={link} size={140} label="Your result page" />
            <span className="text-xs text-muted-foreground">
              Screenshot this to find your result later
            </span>
          </div>
        </div>
      </ChallengeShell>
    );
  }

  const open = selfSignupOpen(c);
  return (
    <ChallengeShell back={{ to: `/challenges/${slug}`, label: "Back" }}>
      <p className="text-sm font-medium text-muted-foreground">Enter</p>
      <h1 className="mt-1 font-display text-3xl uppercase leading-none tracking-wide">{c.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {[c.load_label, mounted ? eventWhen(c.starts_at, c.timezone) : null, c.venue_name]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {!open ? (
        <div className="mt-8 rounded-2xl border border-border p-6 text-center text-sm">
          {c.max_participants != null && c.registered >= c.max_participants
            ? "This challenge is full."
            : "Sign-ups aren't open right now. Find event staff to register at the table."}
          <Button asChild variant="outline" className="mt-4 h-11 w-full">
            <Link to="/challenges/$slug" params={{ slug }}>
              Back to the challenge
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <RegisterForm
            challenge={c}
            mode="self"
            refCode={search.ref ?? null}
            refSource={
              search.ref
                ? "friend"
                : search.src === "qr"
                  ? "qr"
                  : search.src === "display"
                    ? "display"
                    : "link"
            }
            onDone={(r) => {
              rememberEntry(slug, r.code);
              setDone(r);
              window.scrollTo({ top: 0 });
            }}
          />
          <p className="mt-6 text-xs text-muted-foreground">
            Your full name, email and phone are only seen by the organizer. The leaderboard shows
            the name you pick, and your photo only if you add one.
          </p>
        </div>
      )}
    </ChallengeShell>
  );
}
