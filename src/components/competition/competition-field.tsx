/**
 * The field: every competitor with their record (OpenPowerlifting, matched
 * carefully: a name alone is only a candidate), their projected range, their
 * attempt patterns and training seen outside meets, plus the ways to add them
 * (one at a time, a pasted or photographed roster) and to add what they've
 * posted (a caption, a screenshot, a link, by hand). What Cleo reads from a
 * post or a roster is shown for the coach to confirm before it's saved; the
 * app never reads Instagram for itself (it can't without the account's
 * permission), so a post's text or picture is what's given to it.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Link2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  addCompetitorsFn,
  discoverFieldFn,
  extractCompetitionFn,
  readLinkFn,
  saveObservationsFn,
  updateCompetitionFn,
  updateCompetitorFn,
} from "@/lib/competition/competition.functions";
import type { ClassOption } from "@/lib/competition/brief";
import type { MeetInfo } from "@/lib/competition/research";
import { attemptPatternWords, type CompetitorRead } from "@/lib/competition/competitor";
import type { Landscape } from "@/lib/competition/landscape";
import { LIFT_LABEL, type Observation } from "@/lib/competition/types";
import { RangeText } from "./plan-views";
import { cn } from "@/lib/utils";

type CompetitorRow = {
  id: string;
  name: string;
  sex: "M" | "F" | null;
  weight_class: string | null;
  federation: string | null;
  opl_slug: string | null;
  instagram: string | null;
  identity: "unverified" | "matched" | "ambiguous" | "not_found" | "manual";
  contenders: Array<{ slug: string; score: number; why: string[]; meets: number; url: string }>;
  meets: unknown[];
  meets_fetched_at: string | null;
  fetch_error: string | null;
  observations: Observation[];
  notes: string | null;
  field_status?: "suggested" | "confirmed" | "registered" | null;
  source?: string | null;
};

const STATUS_WORD: Record<"suggested" | "confirmed" | "registered", string> = {
  suggested: "Likely, from rankings: not confirmed",
  confirmed: "Likely entrant",
  registered: "On the start list",
};

const IDENTITY_WORD: Record<CompetitorRow["identity"], string> = {
  unverified: "Not looked up yet",
  matched: "Matched on OpenPowerlifting",
  manual: "Profile linked by you",
  ambiguous: "More than one possible profile: pick one",
  not_found: "No OpenPowerlifting profile found",
};

async function fileToImage(
  file: File,
): Promise<{ mime: "image/png" | "image/jpeg" | "image/webp"; base64: string }> {
  const mime = (
    ["image/png", "image/jpeg", "image/webp"].includes(file.type) ? file.type : "image/jpeg"
  ) as "image/png" | "image/jpeg" | "image/webp";
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime, base64: btoa(bin) };
}

export function CompetitionField({
  clientId,
  competitionId,
  competitors,
  reads,
  landscape,
  research = null,
  weightClass = null,
  classOptions = [],
}: {
  clientId: string;
  competitionId: string;
  competitors: CompetitorRow[];
  reads: Map<string, CompetitorRead>;
  landscape: Landscape | null;
  research?: any;
  weightClass?: string | null;
  classOptions?: ClassOption[];
}) {
  const qc = useQueryClient();
  const add = useServerFn(addCompetitorsFn);
  const update = useServerFn(updateCompetitorFn);
  const extract = useServerFn(extractCompetitionFn);
  const saveObs = useServerFn(saveObservationsFn);
  const discover = useServerFn(discoverFieldFn);
  const readLink = useServerFn(readLinkFn);
  const updateComp = useServerFn(updateCompetitionFn);
  const [link, setLink] = useState<null | {
    url: string;
    kind: "roster" | "meet_info";
    meet: MeetInfo | null;
    title: string | null;
  }>(null);
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", weight_class: "", oplUrl: "", instagram: "" });
  const [roster, setRoster] = useState<null | {
    text: string;
    rows: Array<{
      name: string;
      weightClass: string | null;
      federation: string | null;
      country: string | null;
      sex: "M" | "F" | null;
      keep: boolean;
    }> | null;
  }>(null);
  const [post, setPost] = useState<null | {
    competitorId: string;
    text: string;
    url: string;
    lifts: Array<Observation & { keep: boolean }> | null;
  }>(null);

  const addOne = useMutation({
    mutationFn: () =>
      add({
        data: {
          competitionId,
          source: "manual",
          competitors: [
            {
              name: form.name.trim(),
              weight_class: form.weight_class.trim() || null,
              oplUrl: form.oplUrl.trim() || null,
              instagram: form.instagram.trim() || null,
            },
          ],
        },
      }),
    onSuccess: (r) => {
      refresh();
      setForm({ name: "", weight_class: "", oplUrl: "", instagram: "" });
      setAdding(false);
      const one = r.added[0];
      toast.success(
        one
          ? `${one.name}: ${IDENTITY_WORD[one.identity as CompetitorRow["identity"]] ?? one.identity}`
          : "Already on the list",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add them"),
  });
  const act = useMutation({
    mutationFn: (x: {
      competitorId: string;
      oplUrl?: string;
      archive?: boolean;
      resync?: boolean;
      status?: "suggested" | "confirmed" | "registered";
    }) => update({ data: x }),
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "That didn't work"),
  });
  const readRoster = useMutation({
    mutationFn: async (x: { text: string | null; file: File | null }) =>
      extract({
        data: {
          competitionId,
          kind: "roster",
          text: x.text,
          image: x.file ? await fileToImage(x.file) : null,
        },
      }),
    onSuccess: (r) =>
      setRoster((s) => ({
        text: s?.text ?? "",
        rows: r.roster.map((x) => ({ ...x, keep: true })),
      })),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't read the roster"),
  });
  const addRoster = useMutation({
    mutationFn: (rows: NonNullable<NonNullable<typeof roster>["rows"]>) =>
      add({
        data: {
          competitionId,
          source: "roster",
          competitors: rows
            .filter((r) => r.keep)
            .slice(0, 60)
            .map((r) => ({
              name: r.name,
              weight_class: r.weightClass,
              federation: r.federation,
              country: r.country,
              sex: r.sex,
            })),
        },
      }),
    onSuccess: (r) => {
      refresh();
      setRoster(null);
      toast.success(`${r.added.length} added. Their records are being looked up.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add them"),
  });
  const readPost = useMutation({
    mutationFn: async (x: { text: string | null; file: File | null; url: string | null }) =>
      extract({
        data: {
          competitionId,
          kind: "training",
          text: x.text,
          image: x.file ? await fileToImage(x.file) : null,
          url: x.url,
        },
      }),
    onSuccess: (r) =>
      setPost((s) => (s ? { ...s, lifts: r.lifts.map((l) => ({ ...l, keep: true })) } : s)),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't read it"),
  });
  const savePost = useMutation({
    mutationFn: (x: { competitorId: string; lifts: Observation[] }) =>
      saveObs({
        data: { competitorId: x.competitorId, add: x.lifts.map(({ id: _id, ...o }) => o as any) },
      }),
    onSuccess: () => {
      refresh();
      setPost(null);
      toast.success("Saved to their training");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const threat = (id: string) => landscape?.ranked.find((t) => t.id === id);
  const findField = useMutation({
    mutationFn: () => discover({ data: { competitionId } }),
    onSuccess: (r) => {
      refresh();
      if (r.status === "added")
        toast.success(
          `${r.added} likely entrant${r.added === 1 ? "" : "s"} found from the rankings`,
        );
      else if (r.status === "nothing_new") toast.success("Nobody new in the rankings");
      else toast.error(r.error ?? "Couldn't read the rankings");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't read the rankings"),
  });
  const fetchLink = useMutation({
    mutationFn: (x: { url: string; kind: "roster" | "meet_info" }) =>
      readLink({ data: { competitionId, url: x.url, kind: x.kind } }),
    onSuccess: (r, x) => {
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (x.kind === "roster") {
        setLink(null);
        setRoster({ text: "", rows: r.roster.map((row) => ({ ...row, keep: true })) });
        if (!r.roster.length) toast.error("No lifters found on that page");
      } else setLink({ url: r.url, kind: "meet_info", meet: r.meet, title: r.title });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't read the page"),
  });
  const applyMeet = useMutation({
    mutationFn: (m: MeetInfo) => {
      const q = m.qualifyingTotals.find(
        (x) =>
          weightClass &&
          x.weightClass.replace(/[^0-9+]/g, "") === weightClass.replace(/[^0-9+]/g, ""),
      );
      return updateComp({
        data: {
          competitionId,
          fields: {
            ...(m.location ? { location: m.location } : {}),
            ...(m.liftingStart ? { lifting_start: m.liftingStart } : {}),
            ...(m.weighIn ? { weigh_in_at: m.weighIn } : {}),
            ...(q ? { qualification_total_kg: q.totalKg } : {}),
          },
        } as any,
      });
    },
    onSuccess: () => {
      refresh();
      setLink(null);
      toast.success("Meet details saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  return (
    <div className="space-y-4" data-competition-field>
      {landscape?.answers?.length ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-[16px] font-semibold">The landscape</h3>
          <dl className="mt-2 space-y-2 text-[14px]">
            {landscape.answers.map((a, i) => (
              <div key={i}>
                <dt className="text-[12px] text-muted-foreground">{a.q}</dt>
                <dd>{a.a}</dd>
              </div>
            ))}
          </dl>
          {landscape.overestimate ? (
            <p className="mt-3 rounded-lg bg-warning/10 p-2 text-[13px]">
              {landscape.overestimate}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-4" data-field-research>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold">Research</h3>
            <p className="text-[12px] text-muted-foreground">
              {research?.field?.fetched_at
                ? research.field.error
                  ? `Rankings: ${research.field.error}`
                  : `Rankings read ${new Date(research.field.fetched_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}: ${research.field.considered ?? 0} results, ${research.field.added ?? 0} added`
                : "Cleo reads OpenPowerlifting's rankings for this class by itself; you confirm who's coming."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            loading={findField.isPending}
            onClick={() => findField.mutate()}
          >
            <Search className="h-4 w-4" /> Find the likely field
          </Button>
        </div>
        {research?.field?.sources?.length ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Source:{" "}
            {research.field.sources.map((u: string, i: number) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                {i ? ", " : ""}OpenPowerlifting {u.match(/\/(\d{4})$/)?.[1] ?? "rankings"}
              </a>
            ))}
          </p>
        ) : null}
        {classOptions.map((o) => (
          <div
            key={o.weightClass}
            className="mt-3 rounded-xl bg-muted/50 p-3 text-[13px]"
            data-class-option
          >
            <p className="font-medium">
              The {o.weightClass} kg class ({o.reason})
              {o.ourPlace != null
                ? `: at ${o.ours?.kg ?? "today's expected"}${o.ours?.kg != null ? " kg" : ""} they'd place about ${o.ourPlace}`
                : ""}
            </p>
            {o.ours?.own.length || o.ours?.scaled != null ? (
              <p className="text-muted-foreground">
                {o.ours?.own.length
                  ? `Their own totals at ${o.weightClass} since ${o.ours.ownSince}: ${o.ours.own.join(", ")} kg`
                  : ""}
                {o.ours?.own.length && o.ours?.scaled != null ? " · " : ""}
                {o.ours?.scaled != null
                  ? `today's expected scaled to ${o.weightClass} kg: about ${o.ours.scaled} kg`
                  : ""}
              </p>
            ) : null}
            <p className="text-muted-foreground">
              {o.lifters
                .slice(0, 5)
                .map((l) => `${l.name} ${l.total}`)
                .join(" · ")}
            </p>
          </div>
        ))}
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const url = String(fd.get("url") ?? "").trim();
            const kind = String(fd.get("kind") ?? "roster") as "roster" | "meet_info";
            if (url) fetchLink.mutate({ url, kind });
          }}
        >
          <div className="relative min-w-[14rem] flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="url"
              type="url"
              inputMode="url"
              placeholder="Paste a link: nominations, start list, meet page, PDF"
              className="pl-8"
              autoComplete="off"
            />
          </div>
          <select
            name="kind"
            className="h-10 rounded-lg border border-input bg-background px-2 text-[14px]"
            aria-label="What the link is"
            defaultValue="roster"
          >
            <option value="roster">Lifters on it</option>
            <option value="meet_info">Meet details</option>
          </select>
          <Button size="sm" type="submit" variant="outline" loading={fetchLink.isPending}>
            Read it
          </Button>
        </form>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The server fetches public pages, Google Sheets and PDFs. A page behind a login, or
          Instagram, can't be read: paste its text or a screenshot below.
        </p>
        {link?.meet ? (
          <div
            className="mt-3 space-y-1 rounded-xl border border-border p-3 text-[13px]"
            data-meet-info
          >
            <p className="font-medium">{link.title ?? "Meet details"}</p>
            {link.meet.date ? <p>Date: {link.meet.date}</p> : null}
            {link.meet.location ? <p>Venue: {link.meet.location}</p> : null}
            {link.meet.weighIn ? <p>Weigh-in: {link.meet.weighIn}</p> : null}
            {link.meet.liftingStart ? <p>Lifting starts: {link.meet.liftingStart}</p> : null}
            {link.meet.registrationDeadline ? (
              <p>Registration closes: {link.meet.registrationDeadline}</p>
            ) : null}
            {link.meet.qualifyingTotals.length ? (
              <p>
                Qualifying totals:{" "}
                {link.meet.qualifyingTotals
                  .slice(0, 12)
                  .map((q) => `${q.weightClass}${q.sex ? ` ${q.sex}` : ""} ${q.totalKg}`)
                  .join(" · ")}
              </p>
            ) : null}
            {link.meet.notes.map((x, i) => (
              <p key={i} className="text-muted-foreground">
                · {x}
              </p>
            ))}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                loading={applyMeet.isPending}
                onClick={() => applyMeet.mutate(link.meet!)}
              >
                Use these
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLink(null)}>
                Discard
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Copied from the page, never guessed: anything not written there is left out.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add competitor
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRoster({ text: "", rows: null })}>
          Import a roster
        </Button>
      </div>

      {adding ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoComplete="off"
            />
            <Input
              placeholder="Weight class (kg)"
              value={form.weight_class}
              onChange={(e) => setForm({ ...form, weight_class: e.target.value })}
            />
            <Input
              placeholder="OpenPowerlifting link (optional)"
              value={form.oplUrl}
              onChange={(e) => setForm({ ...form, oplUrl: e.target.value })}
            />
            <Input
              placeholder="Instagram @handle (optional)"
              value={form.instagram}
              onChange={(e) => setForm({ ...form, instagram: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={form.name.trim().length < 2}
              loading={addOne.isPending}
              onClick={() => addOne.mutate()}
            >
              Add and look them up
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!competitors.length ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-[14px] text-muted-foreground">
          Nobody on the field yet. Add the competitors you know about, or import the meet's
          nominations or start list: their OpenPowerlifting records are looked up for you.
        </p>
      ) : (
        <ul className="space-y-3">
          {competitors.map((c) => {
            const r = reads.get(c.id);
            const t = threat(c.id);
            return (
              <li
                key={c.id}
                className="rounded-2xl border border-border bg-card p-4"
                data-competitor={c.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-[15px] font-semibold">{c.name}</h4>
                      {t ? (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px]",
                            t.level === "favourite"
                              ? "border-destructive/40 text-destructive"
                              : t.overlaps
                                ? "border-warning/50 text-warning"
                                : "border-border text-muted-foreground",
                          )}
                        >
                          {t.level === "favourite"
                            ? "Favourite"
                            : t.overlaps
                              ? "In range"
                              : "Outside our range"}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {[
                        STATUS_WORD[c.field_status ?? "confirmed"],
                        c.weight_class ? `${c.weight_class} kg` : null,
                        c.federation,
                        IDENTITY_WORD[c.identity],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {c.fetch_error ? ` · ${c.fetch_error}` : ""}
                    </p>
                    {c.instagram ? (
                      <a
                        href={`https://www.instagram.com/${c.instagram}/`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[12px] text-muted-foreground underline underline-offset-2"
                      >
                        @{c.instagram}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {c.opl_slug ? (
                      <a
                        href={`https://www.openpowerlifting.org/u/${c.opl_slug}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                        aria-label="OpenPowerlifting profile"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                      aria-label="Look up again"
                      onClick={() => act.mutate({ competitorId: c.id, resync: true })}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                      aria-label="Remove"
                      onClick={() => act.mutate({ competitorId: c.id, archive: true })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {c.field_status === "suggested" ? (
                  <div
                    className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2 text-[13px]"
                    data-suggested
                  >
                    <span className="text-muted-foreground">Coming?</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act.mutate({ competitorId: c.id, status: "registered" })}
                    >
                      On the start list
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act.mutate({ competitorId: c.id, status: "confirmed" })}
                    >
                      Likely
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act.mutate({ competitorId: c.id, archive: true })}
                    >
                      Not coming
                    </Button>
                  </div>
                ) : null}
                {c.identity === "ambiguous" && c.contenders.length ? (
                  <div className="mt-2 space-y-1.5 rounded-xl bg-muted/50 p-2">
                    <p className="text-[12px] text-muted-foreground">
                      Which one is the competitor?
                    </p>
                    {c.contenders.map((x) => (
                      <div
                        key={x.slug}
                        className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
                      >
                        <a
                          className="underline-offset-2 hover:underline"
                          href={x.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {x.slug} · {x.meets} meets · {x.why.slice(0, 2).join(", ")}
                        </a>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => act.mutate({ competitorId: c.id, oplUrl: x.url })}
                        >
                          This one
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {c.identity === "not_found" || c.identity === "unverified" ? (
                  <LinkProfile onLink={(url) => act.mutate({ competitorId: c.id, oplUrl: url })} />
                ) : null}

                {r?.projection ? (
                  <div className="mt-3 grid gap-2 text-[14px] sm:grid-cols-2">
                    <div>
                      <p className="text-[12px] text-muted-foreground">
                        Projected total ({r.confidence} confidence)
                      </p>
                      <RangeText r={r.projection} />
                    </div>
                    <div>
                      <p className="text-[12px] text-muted-foreground">Record</p>
                      <p>
                        {r.recentTotal
                          ? `Last ${r.recentTotal.kg} kg (${r.recentTotal.date})`
                          : "No total"}
                        {r.bestTotal && r.bestTotal.date !== r.recentTotal?.date
                          ? ` · best ${r.bestTotal.kg}`
                          : ""}
                        {r.trendPerYear != null
                          ? ` · ${r.trendPerYear > 0 ? "+" : ""}${r.trendPerYear} kg/yr`
                          : ""}
                      </p>
                    </div>
                  </div>
                ) : r ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {r.basis.join(" · ") || "No record to project from"}
                  </p>
                ) : null}
                {r ? (
                  attemptPatternWords(r.stats).length ? (
                    <ul className="mt-2 space-y-0.5 text-[13px] text-muted-foreground">
                      {attemptPatternWords(r.stats).map((w, i) => (
                        <li key={i}>· {w}</li>
                      ))}
                    </ul>
                  ) : null
                ) : null}

                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium">Training seen outside meets</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPost({ competitorId: c.id, text: "", url: "", lifts: null })
                      }
                    >
                      Add a post
                    </Button>
                  </div>
                  {c.observations.length ? (
                    <ul className="mt-1 space-y-1 text-[13px]">
                      {c.observations
                        .slice(-6)
                        .reverse()
                        .map((o, i) => (
                          <li key={o.id ?? i} className="flex flex-wrap gap-x-2">
                            <span className="tabular-nums">{o.date}</span>
                            <span className="font-medium">
                              {o.exercise} {o.loadKg} kg × {o.reps}
                              {o.rpe ? ` @ ${o.rpe}` : ""}
                            </span>
                            <span className="text-muted-foreground">
                              {o.standard === "competition"
                                ? "competition standard"
                                : o.standard === "variation"
                                  ? "variation (not compared)"
                                  : "unclear"}{" "}
                              · {o.confidence}
                            </span>
                            {o.url ? (
                              <a
                                href={o.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-muted-foreground underline-offset-2 hover:underline"
                              >
                                source
                              </a>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {c.instagram
                        ? `@${c.instagram}: paste a caption, add a screenshot or a post link to record a lift.`
                        : "Paste a caption, add a screenshot or a post link to record a lift."}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!roster} onOpenChange={(o) => !o && setRoster(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>Import a roster</SheetTitle>
            <SheetDescription>
              Paste the nominations, start list or results text, or add a picture of it. You confirm
              who's added.
            </SheetDescription>
          </SheetHeader>
          {roster ? (
            <div className="mt-4 space-y-3">
              {!roster.rows ? (
                <>
                  <Textarea
                    rows={8}
                    value={roster.text}
                    onChange={(e) => setRoster({ ...roster, text: e.target.value })}
                    placeholder="Paste the roster here"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!roster.text.trim()}
                      loading={readRoster.isPending}
                      onClick={() => readRoster.mutate({ text: roster.text, file: null })}
                    >
                      Read it
                    </Button>
                    <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-[13px]">
                      Or a picture
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) =>
                          e.target.files?.[0] &&
                          readRoster.mutate({ text: null, file: e.target.files[0] })
                        }
                      />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    {roster.rows.length
                      ? "Untick anyone who isn't in their class or division."
                      : "Nobody could be read from it."}
                  </p>
                  <ul className="space-y-1">
                    {roster.rows.map((r, i) => (
                      <li key={i}>
                        <label className="flex items-center gap-2 text-[14px]">
                          <input
                            type="checkbox"
                            checked={r.keep}
                            onChange={() =>
                              setRoster({
                                ...roster,
                                rows: roster.rows!.map((x, j) =>
                                  j === i ? { ...x, keep: !x.keep } : x,
                                ),
                              })
                            }
                          />
                          {r.name}{" "}
                          <span className="text-muted-foreground">
                            {[r.weightClass, r.federation].filter(Boolean).join(" · ")}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!roster.rows.some((r) => r.keep)}
                      loading={addRoster.isPending}
                      onClick={() => addRoster.mutate(roster.rows!)}
                    >
                      Add {roster.rows.filter((r) => r.keep).length}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRoster({ ...roster, rows: null })}
                    >
                      Back
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={!!post} onOpenChange={(o) => !o && setPost(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>Add a training post</SheetTitle>
            <SheetDescription>
              Paste the caption, add a screenshot, or note what you saw. Instagram isn't read by the
              app itself; only what you add here is used, and gym posts never count as meet results.
            </SheetDescription>
          </SheetHeader>
          {post ? (
            <div className="mt-4 space-y-3">
              {!post.lifts ? (
                <>
                  <Input
                    placeholder="Post link (optional)"
                    value={post.url}
                    onChange={(e) => setPost({ ...post, url: e.target.value })}
                  />
                  <Textarea
                    rows={6}
                    value={post.text}
                    onChange={(e) => setPost({ ...post, text: e.target.value })}
                    placeholder="Paste the caption"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!post.text.trim()}
                      loading={readPost.isPending}
                      onClick={() =>
                        readPost.mutate({
                          text: post.text,
                          file: null,
                          url: post.url.trim() || null,
                        })
                      }
                    >
                      Read it
                    </Button>
                    <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-[13px]">
                      Or a screenshot
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) =>
                          e.target.files?.[0] &&
                          readPost.mutate({
                            text: null,
                            file: e.target.files[0],
                            url: post.url.trim() || null,
                          })
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPost({
                          ...post,
                          lifts: [
                            {
                              date: new Date().toISOString().slice(0, 10),
                              lift: null,
                              exercise: "",
                              loadKg: 0,
                              reps: 1,
                              rpe: null,
                              standard: "unclear",
                              equipment: null,
                              source: "manual",
                              url: post.url.trim() || null,
                              confidence: "medium",
                              note: null,
                              keep: true,
                            },
                          ],
                        })
                      }
                    >
                      Enter by hand
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {!post.lifts.length ? (
                    <p className="text-[13px] text-muted-foreground">
                      No lift with a load and reps could be read from it.
                    </p>
                  ) : null}
                  <ul className="space-y-2">
                    {post.lifts.map((l, i) => {
                      const setL = (patch: Partial<Observation & { keep: boolean }>) =>
                        setPost({
                          ...post,
                          lifts: post.lifts!.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                        });
                      return (
                        <li key={i} className="space-y-1.5 rounded-xl border border-border p-2">
                          <label className="flex items-center gap-2 text-[13px]">
                            <input
                              type="checkbox"
                              checked={l.keep}
                              onChange={() => setL({ keep: !l.keep })}
                            />{" "}
                            Keep
                          </label>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Input
                              type="date"
                              value={l.date}
                              onChange={(e) => setL({ date: e.target.value })}
                              aria-label="Date"
                            />
                            <Input
                              value={l.exercise}
                              onChange={(e) => setL({ exercise: e.target.value })}
                              placeholder="Exercise"
                              aria-label="Exercise"
                            />
                            <Input
                              inputMode="decimal"
                              value={l.loadKg || ""}
                              onChange={(e) => setL({ loadKg: Number(e.target.value) || 0 })}
                              placeholder="kg"
                              aria-label="Load kg"
                            />
                            <Input
                              inputMode="numeric"
                              value={l.reps}
                              onChange={(e) => setL({ reps: Number(e.target.value) || 1 })}
                              placeholder="Reps"
                              aria-label="Reps"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2 text-[12px]">
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2"
                              value={l.lift ?? ""}
                              onChange={(e) =>
                                setL({ lift: (e.target.value || null) as Observation["lift"] })
                              }
                            >
                              <option value="">Not a comp lift</option>
                              {(["squat", "bench", "deadlift"] as const).map((x) => (
                                <option key={x} value={x}>
                                  {LIFT_LABEL[x]}
                                </option>
                              ))}
                            </select>
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2"
                              value={l.standard}
                              onChange={(e) =>
                                setL({ standard: e.target.value as Observation["standard"] })
                              }
                            >
                              <option value="competition">Competition standard</option>
                              <option value="variation">Variation</option>
                              <option value="unclear">Unclear</option>
                            </select>
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2"
                              value={l.confidence}
                              onChange={(e) =>
                                setL({ confidence: e.target.value as Observation["confidence"] })
                              }
                            >
                              <option value="high">High confidence</option>
                              <option value="medium">Medium</option>
                              <option value="low">Low</option>
                            </select>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !post.lifts.some((l) => l.keep && l.loadKg > 0 && l.exercise.trim())
                      }
                      loading={savePost.isPending}
                      onClick={() =>
                        savePost.mutate({
                          competitorId: post.competitorId,
                          lifts: post
                            .lifts!.filter((l) => l.keep && l.loadKg > 0 && l.exercise.trim())
                            .map(({ keep: _k, ...o }) => o),
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPost({ ...post, lifts: null })}
                    >
                      Back
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LinkProfile({ onLink }: { onLink: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <div className="mt-2 flex gap-2">
      <Input
        className="h-9 text-[13px]"
        placeholder="Paste their OpenPowerlifting link"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!/openpowerlifting\.org\/u\/|openipf\.org\/u\//i.test(url)}
        onClick={() => onLink(url.trim())}
      >
        Link
      </Button>
    </div>
  );
}
