import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Award, Camera, Loader2, Medal, Pencil, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AthleteAvatar,
  ChallengeShell,
  ScoreText,
  StatusPill,
  useMounted,
} from "@/components/challenges/ui";
import { PhotoCapture } from "@/components/challenges/photo-capture";
import {
  errorText,
  fetchAthlete,
  invalidateChallenge,
  myPhotoTicket,
  track,
  updateMyProfile,
  useAthlete,
} from "@/lib/challenges/api";
import { uploadChallengePhoto } from "@/lib/challenges/photo.functions";
import {
  achievementsFor,
  eventWhen,
  personalBests,
  placeLabel,
  type AthleteProfile,
} from "@/lib/challenges/model";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/athletes/$handle")({
  loader: async ({ params }) => {
    try {
      return { athlete: await fetchAthlete(params.handle) };
    } catch {
      return { athlete: null };
    }
  },
  head: ({ loaderData, params }) => {
    const a = loaderData?.athlete;
    const wins = a ? a.entries.filter((e) => e.final && e.rank === 1).length : 0;
    const desc = a
      ? `${a.entries.length} ${a.entries.length === 1 ? "challenge" : "challenges"}${wins ? `, ${wins} ${wins === 1 ? "win" : "wins"}` : ""} on JF Effect.`
      : "An athlete on JF Effect Challenges.";
    return {
      meta: [
        { title: `${a?.name ?? "Athlete"} | JF Effect Challenges` },
        { name: "description", content: desc },
        ...shareMeta({
          title: `${a?.name ?? "Athlete"} on JF Effect`.slice(0, 40),
          description: desc,
          path: `/athletes/${params.handle}`,
        }),
        ...(a?.discoverable ? [] : [{ name: "robots", content: "noindex" }]),
      ],
    };
  },
  component: AthletePage,
});

function AthletePage() {
  const { handle } = Route.useParams();
  const { athlete: initial } = Route.useLoaderData();
  const q = useAthlete(handle, initial);
  const a = q.data;
  const [edit, setEdit] = useState(false);
  const mounted = useMounted();
  useEffect(() => {
    track("profile_view", { handle });
  }, [handle]);

  if (q.isPending && !a) {
    return (
      <ChallengeShell>
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-8 w-1/2" />
      </ChallengeShell>
    );
  }
  if (!a) {
    return (
      <ChallengeShell>
        <p className="py-16 text-center text-sm text-muted-foreground">
          This profile is private or doesn't exist.
        </p>
      </ChallengeShell>
    );
  }
  const achievements = achievementsFor(a.entries);
  const bests = personalBests(a.entries);

  return (
    <ChallengeShell>
      <div className="text-center">
        <div className="flex justify-center">
          <AthleteAvatar name={a.name} photo={a.photo} size={104} />
        </div>
        <h1 className="mt-3 text-2xl font-semibold">{a.name}</h1>
        <p className="text-sm text-muted-foreground">
          Competing since{" "}
          {new Date(a.since).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
        </p>
        {a.is_mine ? (
          <Button variant="outline" className="mt-3 h-10" onClick={() => setEdit(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit profile
          </Button>
        ) : null}
        {a.is_mine && !a.discoverable ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Your profile is hidden. Only you can see this page.
          </p>
        ) : null}
      </div>

      {achievements.length ? (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {achievements.map((x) => (
            <div key={x.key} className="rounded-2xl border border-border p-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {x.key === "winner" ? (
                  <Trophy className="h-4 w-4 text-warning" />
                ) : x.key === "podium" ? (
                  <Medal className="h-4 w-4 text-warning" />
                ) : (
                  <Award className="h-4 w-4 text-muted-foreground" />
                )}
                {x.label}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{x.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      {bests.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Bests</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {bests.map((b) => (
              <li key={b.label} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm">{b.label}</span>
                <ScoreText value={b.score} shape={b.shape} className="text-xl" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">Challenges</h2>
        {a.entries.length ? (
          <ul className="space-y-2">
            {a.entries.map((e) => (
              <li key={e.code}>
                <Link
                  to="/challenges/$slug/r/$code"
                  params={{ slug: e.slug, code: e.code }}
                  className="flex items-center gap-3 rounded-2xl border border-border p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        mounted ? eventWhen(e.starts_at, e.timezone)?.split(" · ")[0] : null,
                        e.division,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="mt-1">
                      <StatusPill status={e.status} final={e.final} className="h-6" />
                    </div>
                  </div>
                  <div className="text-right">
                    {e.score != null ? (
                      <ScoreText value={e.score} shape={e} className="text-2xl" />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {e.entry_status === "disqualified" ? "Not ranked" : "No score yet"}
                      </span>
                    )}
                    {e.rank ? (
                      <p
                        className={
                          e.final && e.rank <= 3
                            ? "text-sm font-semibold text-warning"
                            : "text-sm text-muted-foreground"
                        }
                      >
                        {placeLabel(e.rank, e.tied)} of {e.of}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No challenges yet.</p>
        )}
      </section>

      <Button asChild variant="outline" className="mt-8 h-11 w-full">
        <Link to="/challenges">Find a challenge</Link>
      </Button>

      {a.is_mine ? <EditProfile open={edit} onOpenChange={setEdit} athlete={a} /> : null}
    </ChallengeShell>
  );
}

function EditProfile({
  open,
  onOpenChange,
  athlete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  athlete: AthleteProfile;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(athlete.name);
  const [discoverable, setDiscoverable] = useState(athlete.discoverable);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(uploadChallengePhoto);
  const save = async () => {
    setBusy(true);
    try {
      await updateMyProfile(name, discoverable);
      if (photo) {
        const token = await myPhotoTicket();
        await upload({ data: { token, dataUrl: photo } });
      }
      invalidateChallenge(qc);
      toast.success("Profile saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 h-12 text-base"
              maxLength={40}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Final results keep the name they were won under.
            </p>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Camera className="h-4 w-4" /> New photo
            </p>
            <PhotoCapture value={photo} onChange={setPhoto} />
            <p className="mt-1 text-xs text-muted-foreground">
              It shows only on challenges where you agreed to a photo.
            </p>
          </div>
          <label className="flex items-start gap-3">
            <Switch checked={discoverable} onCheckedChange={setDiscoverable} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Public profile</span>
              <span className="block text-xs text-muted-foreground">
                Off: your profile page is hidden. Leaderboards still show the name you competed
                under.
              </span>
            </span>
          </label>
          <Button
            className="h-12 w-full"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Scores can't be edited here: they're the judges' records.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
