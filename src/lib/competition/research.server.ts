/**
 * Automatic research (server only): the work the coach shouldn't have to do.
 *
 *  - discoverField: who's likely in the athlete's class at this meet, from
 *    OpenPowerlifting's public rankings for the meet's federation and class
 *    (this year and last, the athlete's country for a national meet), each
 *    added as a suggested entrant with their whole record synced, for the
 *    coach to confirm ("registered", "likely") or dismiss.
 *  - classOptions: when the athlete is well over their class limit, the
 *    adjacent class's field from the same rankings, so the class decision is
 *    argued from who they'd actually lift against.
 *  - readLink: any public page someone pastes (a nominations page, a start
 *    list, a Google Sheet, a meet's information page, a PDF), fetched by the
 *    server and copied into rows by the extraction model; nothing is saved
 *    until the coach confirms.
 *
 * Nothing private is read and nothing is invented: a page that needs a login,
 * blocks robots or isn't there says so; Instagram isn't read by the app.
 */
import {
  OPL_BASE,
  adjacentIpfClasses,
  classSummary,
  fetchableUrl,
  htmlToText,
  likelyField,
  oplFederation,
  oplIpfClass,
  parseRankings,
  rankingNote,
  rankingsPath,
  type RankingRow,
} from "./research";
import { todayWinnipeg } from "./load.server";

type Db = any;
const UA = "JF Effect competition research (https://jfeffect.com)";

export async function fetchRankings(path: string): Promise<RankingRow[] | { error: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${OPL_BASE}${path}`, {
      signal: ctl.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) return { error: `OpenPowerlifting answered ${res.status}` };
    return parseRankings(await res.json());
  } catch (e: any) {
    return {
      error: e?.name === "AbortError" ? "OpenPowerlifting didn't answer in time" : String(e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");

async function athleteFacts(sb: Db, comp: any) {
  const { data: client } = await sb
    .from("clients")
    .select("id, full_name, first_name, sex, user_id")
    .eq("id", comp.client_id)
    .maybeSingle();
  const { data: meets } = await sb
    .from("athlete_powerlifting_results")
    .select("source_key, meet_location")
    .eq("client_id", comp.client_id)
    .order("meet_date", { ascending: false })
    .limit(20);
  // their own OpenPowerlifting username, from the keys their record was synced under
  const slugs = new Set<string>();
  for (const m of meets ?? []) {
    for (const part of String(m.source_key ?? "").split(":"))
      if (/^[a-z]{4,}[a-z0-9]*$/.test(part) && !["audit", "opl", "sbd", "openpowerlifting"].includes(part) && part.length >= 6)
        slugs.add(part);
  }
  const country =
    (meets ?? [])
      .map((m: any) => String(m.meet_location ?? "").split("-")[0])
      .find((c: string) => c.length > 1) ?? null;
  const sex: "M" | "F" | null =
    client?.sex === "male" || client?.sex === "M" ? "M" : client?.sex === "female" || client?.sex === "F" ? "F" : null;
  return { name: client?.full_name ?? "", sex, slugs: [...slugs], country };
}

export type DiscoverReport = {
  status: "added" | "nothing_new" | "unsupported" | "error";
  added: number;
  considered: number;
  sources: string[];
  error?: string;
};

/** Suggested entrants from the rankings, each with their record synced. Never touches a confirmed or dismissed competitor. */
export async function discoverField(
  sb: Db,
  competitionId: string,
  opts: { limit?: number; budget?: { left: number }; actorId?: string | null } = {},
): Promise<DiscoverReport> {
  const { data: comp } = await sb.from("competitions").select("*").eq("id", competitionId).maybeSingle();
  if (!comp) return { status: "error", added: 0, considered: 0, sources: [], error: "Competition not found" };
  const me = await athleteFacts(sb, comp);
  const fed = oplFederation(comp.federation, String(comp.meet_date));
  const cls = oplIpfClass(me.sex, comp.weight_class);
  if (!fed || !cls || !me.sex)
    return {
      status: "unsupported",
      added: 0,
      considered: 0,
      sources: [],
      error: !cls
        ? "The weight class isn't an IPF class (or the athlete's sex isn't on file), so the rankings can't be read for it"
        : "The federation isn't one OpenPowerlifting ranks",
    };
  const year = Number(String(comp.meet_date).slice(0, 4));
  const years = [year, year - 1, year - 2].filter((y) => y <= Number(todayWinnipeg().slice(0, 4)));
  const lists: RankingRow[][] = [];
  const sources: string[] = [];
  for (const y of years.slice(0, 2)) {
    const path = rankingsPath({ federation: fed, ipfClass: cls, sex: me.sex, year: y, count: 40 });
    const r = await fetchRankings(path);
    if ("error" in r) return { status: "error", added: 0, considered: 0, sources, error: r.error };
    lists.push(r);
    sources.push(`${OPL_BASE}${path.replace("/api/rankings", "/rankings").replace(/\?.*$/, "")}`);
  }
  const { data: existing } = await sb
    .from("competition_competitors")
    .select("id, name, opl_slug, archived")
    .eq("competition_id", competitionId);
  const national = /^(national|provincial|regional|local)$/.test(String(comp.level ?? "national"));
  const field = likelyField(lists, {
    excludeSlugs: [...me.slugs, ...((existing ?? []).map((c: any) => c.opl_slug).filter(Boolean) as string[])],
    excludeNames: [me.name, ...((existing ?? []).map((c: any) => c.name) as string[])],
    country: national ? me.country ?? (fed === "canpl" || fed === "cpu" ? "Canada" : null) : null,
    limit: opts.limit ?? 10,
  });
  let added = 0;
  const budget = opts.budget ?? { left: 14 };
  const { syncCompetitor } = await import("./opl.server");
  for (const r of field) {
    const { data: row, error } = await sb
      .from("competition_competitors")
      .insert({
        competition_id: competitionId,
        client_id: comp.client_id,
        name: r.name.slice(0, 120),
        sex: r.sex,
        weight_class: comp.weight_class,
        federation: r.federation,
        country: r.country,
        opl_slug: r.slug,
        instagram: r.instagram,
        identity: "matched",
        field_status: "suggested",
        source: "opl",
        bodyweight_kg: r.bodyweight && r.bodyweight >= 25 && r.bodyweight <= 300 ? r.bodyweight : null,
        notes: rankingNote(r),
        created_by: opts.actorId ?? null,
      })
      .select("id")
      .single();
    if (error) continue; // a name already on file (the unique index)
    added++;
    if (budget.left > 0) await syncCompetitor(sb, row.id, { today: todayWinnipeg(), budget });
  }
  const research = { ...(comp.research ?? {}) };
  research.field = {
    fetched_at: new Date().toISOString(),
    federation: fed,
    ipf_class: cls,
    sources,
    considered: lists.reduce((s, l) => s + l.length, 0),
    added,
  };
  await sb.from("competitions").update({ research }).eq("id", competitionId);
  const { logEvent } = await import("./release.server");
  await logEvent(sb, {
    competitionId,
    clientId: comp.client_id,
    actorId: opts.actorId ?? null,
    actor: opts.actorId ? "coach" : "system",
    action: "field_researched",
    detail: { added, sources },
  });
  return {
    status: added ? "added" : "nothing_new",
    added,
    considered: research.field.considered,
    sources,
  };
}

/** The adjacent classes' fields when the athlete is well over their class (or well under it). */
export async function classOptions(
  sb: Db,
  competitionId: string,
  input: { bodyweightAvg: number | null; classLimit: number | null; expectedTotal: number | null },
) {
  const { data: comp } = await sb.from("competitions").select("*").eq("id", competitionId).maybeSingle();
  if (!comp) return null;
  const mark = async (alternatives: unknown[]) =>
    sb
      .from("competitions")
      .update({
        research: {
          ...(comp.research ?? {}),
          alternatives,
          alternatives_checked_at: new Date().toISOString(),
        },
      })
      .eq("id", competitionId);
  if (!input.bodyweightAvg || !input.classLimit || input.bodyweightAvg <= input.classLimit * 1.03) {
    await mark([]);
    return null;
  }
  const me = await athleteFacts(sb, comp);
  const fed = oplFederation(comp.federation, String(comp.meet_date));
  if (!fed || !me.sex || !comp.weight_class) return null;
  const over = input.bodyweightAvg / input.classLimit - 1;
  const adj = adjacentIpfClasses(me.sex, String(comp.weight_class));
  const target = over > 0.03 ? adj.up : null;
  if (!target) return null;
  const cls = oplIpfClass(me.sex, target);
  if (!cls) return null;
  const year = Number(String(comp.meet_date).slice(0, 4));
  const lists: RankingRow[][] = [];
  for (const y of [year, year - 1]) {
    if (y > Number(todayWinnipeg().slice(0, 4))) continue;
    const r = await fetchRankings(rankingsPath({ federation: fed, ipfClass: cls, sex: me.sex, year: y, count: 30 }));
    if (!("error" in r)) lists.push(r);
  }
  if (!lists.length) return null;
  const national = /^(national|provincial|regional|local)$/.test(String(comp.level ?? "national"));
  const rows = likelyField(lists, {
    excludeSlugs: me.slugs,
    excludeNames: [me.name],
    country: national ? me.country ?? "Canada" : null,
    limit: 8,
    floorShare: 0.8,
  });
  const summary = {
    ...classSummary(target, rows, input.expectedTotal),
    reason: `${Math.round(over * 1000) / 10}% over the ${comp.weight_class} kg limit`,
    fetched_at: new Date().toISOString(),
  };
  await mark([summary]);
  return summary;
}

/* ------------------------------------------------------------------ */
/* A link                                                             */

export type LinkContent =
  | { ok: true; kind: "text"; text: string; url: string; title: string | null }
  | { ok: true; kind: "pdf"; base64: string; url: string; title: string | null }
  | { ok: false; error: string };

/** Fetches a public page the coach pasted: text (HTML, CSV, a Google Sheet or Doc) or a PDF for the model to read. */
export async function readLink(raw: string): Promise<LinkContent> {
  const f = fetchableUrl(raw);
  if (!f) return { ok: false, error: "Use a public https link" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(f.url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,text/csv,text/plain,application/pdf;q=0.9,*/*;q=0.5" },
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, error: "That page needs a login or blocks automated reading: paste its text or a screenshot instead" };
    if (!res.ok) return { ok: false, error: `The page answered ${res.status}` };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 8_000_000) return { ok: false, error: "That file is over 8 MB" };
    if (type.includes("application/pdf") || /\.pdf($|\?)/i.test(f.url)) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > 8_000_000) return { ok: false, error: "That file is over 8 MB" };
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { ok: true, kind: "pdf", base64: btoa(bin), url: f.url, title: null };
    }
    const body = await res.text();
    if (body.length > 4_000_000) return { ok: false, error: "That page is too large to read" };
    const html = type.includes("html") || /^\s*<(!doctype|html)/i.test(body);
    const title = html ? (body.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null) : null;
    const text = html ? htmlToText(body) : body.trim();
    if (text.length < 40)
      return {
        ok: false,
        error: "The page has almost no text without a browser (it's built by scripts): paste its text or a screenshot instead",
      };
    return { ok: true, kind: "text", text: text.slice(0, 60_000), url: f.url, title };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "The page didn't answer in time" : String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}
