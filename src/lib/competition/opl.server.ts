/**
 * Competitors' records from OpenPowerlifting (server only): the lifter CSV the
 * athletes' own careers already sync from (`/api/liftercsv/<slug>`), fetched by
 * the worker, never by a phone. A competitor with a known profile (a link the
 * coach gave, or one matched before) is refreshed; one with only a name is
 * matched carefully (opl.ts: candidates from the name, kept only when their
 * meets agree with what we know), and two plausible lifters stay "ambiguous"
 * for the coach to pick. Nothing here invents a record: a profile that can't
 * be read says so (`fetch_error`) and the competitor stays on file as entered.
 */
import {
  identityFit,
  meetsFromOplCsv,
  resolveIdentity,
  sexFromOplCsv,
  slugCandidates,
  slugFromUrl,
} from "./opl";

type Db = any;
const HOST = "https://www.openpowerlifting.org";

export async function fetchLifterCsv(
  slug: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  if (!/^[a-z0-9]{2,80}$/.test(slug))
    return { ok: false, status: 400, error: "Not an OpenPowerlifting username" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${HOST}/api/liftercsv/${slug}`, {
      signal: ctl.signal,
      headers: { Accept: "text/csv" },
    });
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        error: res.status === 404 ? "No such profile" : `OpenPowerlifting answered ${res.status}`,
      };
    const text = await res.text();
    if (!/^Name,/.test(text.trim()))
      return { ok: false, status: 502, error: "OpenPowerlifting didn't send a lifter record" };
    return { ok: true, text };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      error:
        e?.name === "AbortError"
          ? "OpenPowerlifting didn't answer in time"
          : String(e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Refresh or match one competitor. Returns what changed (for the record).
 * `budget` caps the requests made (a name tries at most 5 usernames).
 */
export async function syncCompetitor(
  sb: Db,
  id: string,
  opts: { today: string; budget?: { left: number } } = {
    today: new Date().toISOString().slice(0, 10),
  },
): Promise<{ status: string; meets: number }> {
  const { data: c } = await sb
    .from("competition_competitors")
    .select("id, name, sex, weight_class, federation, country, opl_slug, identity")
    .eq("id", id)
    .maybeSingle();
  if (!c) return { status: "missing", meets: 0 };
  const budget = opts.budget ?? { left: 6 };
  const hints = {
    sex: (c.sex as "M" | "F" | null) ?? null,
    federation: c.federation,
    weightClass: c.weight_class,
    country: c.country,
  };

  if (c.opl_slug && (c.identity === "matched" || c.identity === "manual")) {
    if (budget.left <= 0) return { status: "deferred", meets: 0 };
    budget.left--;
    const r = await fetchLifterCsv(c.opl_slug);
    if (!r.ok) {
      await sb
        .from("competition_competitors")
        .update({ fetch_error: r.error, meets_fetched_at: new Date().toISOString() })
        .eq("id", id);
      return { status: "error", meets: 0 };
    }
    const meets = meetsFromOplCsv(r.text);
    await sb
      .from("competition_competitors")
      .update({
        meets,
        meets_fetched_at: new Date().toISOString(),
        fetch_error: null,
        sex: c.sex ?? sexFromOplCsv(r.text),
      })
      .eq("id", id);
    return { status: "refreshed", meets: meets.length };
  }

  // match by name: each candidate's record read and scored against what we know
  const candidates: Array<{
    slug: string;
    score: number;
    why: string[];
    meets: number;
    csv: string;
  }> = [];
  for (const slug of slugCandidates(c.name)) {
    if (budget.left <= 0) break;
    budget.left--;
    const r = await fetchLifterCsv(slug);
    if (!r.ok) {
      if (r.status === 404) break; // usernames are numbered in order: no "janedoe2" without "janedoe1"
      continue;
    }
    const meets = meetsFromOplCsv(r.text);
    const fit = identityFit(meets, sexFromOplCsv(r.text), hints, opts.today);
    candidates.push({ slug, score: fit.score, why: fit.why, meets: meets.length, csv: r.text });
  }
  const res = resolveIdentity(candidates.map(({ csv: _csv, ...x }) => x));
  const contenders = res.contenders.map((x) => ({
    slug: x.slug,
    score: x.score,
    why: x.why,
    meets: x.meets,
    url: `${HOST}/u/${x.slug}`,
  }));
  if (res.status === "matched") {
    const csv = candidates.find((x) => x.slug === res.slug)!.csv;
    const meets = meetsFromOplCsv(csv);
    await sb
      .from("competition_competitors")
      .update({
        identity: "matched",
        opl_slug: res.slug,
        contenders,
        meets,
        meets_fetched_at: new Date().toISOString(),
        fetch_error: null,
        sex: c.sex ?? sexFromOplCsv(csv),
      })
      .eq("id", id);
    return { status: "matched", meets: meets.length };
  }
  await sb
    .from("competition_competitors")
    .update({
      identity: res.status,
      contenders,
      meets_fetched_at: new Date().toISOString(),
      fetch_error: null,
    })
    .eq("id", id);
  return { status: res.status, meets: 0 };
}

/** The coach picked (or pasted) the right profile. */
export async function linkCompetitorProfile(
  sb: Db,
  id: string,
  urlOrSlug: string,
): Promise<{ meets: number; error?: string }> {
  const slug =
    slugFromUrl(urlOrSlug) ??
    (/^[a-z0-9]{2,80}$/i.test(urlOrSlug.trim()) ? urlOrSlug.trim().toLowerCase() : null);
  if (!slug) return { meets: 0, error: "That isn't an OpenPowerlifting profile link" };
  const r = await fetchLifterCsv(slug);
  if (!r.ok) return { meets: 0, error: r.error };
  const meets = meetsFromOplCsv(r.text);
  await sb
    .from("competition_competitors")
    .update({
      identity: "manual",
      opl_slug: slug,
      meets,
      meets_fetched_at: new Date().toISOString(),
      fetch_error: null,
      sex: sexFromOplCsv(r.text),
    })
    .eq("id", id);
  return { meets: meets.length };
}
