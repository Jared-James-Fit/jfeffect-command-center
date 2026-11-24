/**
 * OpenIPF for the coach's athletes (Nov 24 2026): the app's words and numbers
 * for what the database finds (supabase/tests/openipf has the database's own
 * tests), and the wiring the coach relies on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bestsLine, inboxPreview, kg, liftsLine, matchLine, maxWritesFromBests, meetBests, meetDay, nameKey, openIpfSummary,
  openipfFold, parseProfileUrl, plainLifterName, prLine, profileUrl, siteName, suggestionOrder,
  type OpenIpfSuggestion,
} from "@/lib/openipf";
import { batchTitle } from "@/lib/openipf.server";
import { CLEO_ACTION_RULES, routeFor } from "@/lib/cleo-actions";

const read = (p: string) => readFileSync(p, "utf8");
const MIGRATION = read("supabase/migrations/20270525090000_openipf_discovery.sql");

function sg(over: Partial<OpenIpfSuggestion>): OpenIpfSuggestion {
  return {
    id: "s1", kind: "match", client_id: "c1", athlete_id: null, subject_name: "Marc Asugui", subject_sex: "male",
    host: "https://www.openipf.org", slug: "marcasugui", lifter_name: "Marc Asugui", sex: "male", country: "Canada",
    federation: "CPU", equipment: "Classic", division: "Open", bodyweight_kg: 82.1, weight_class: "83",
    squat_kg: 200, bench_kg: 140, deadlift_kg: 240, total_kg: 580, points: 80.2, best_date: "2025-11-02",
    meet_count: 2, first_meet: "2024-11-02", last_meet: "2025-11-02", last_meet_name: "Manitoba Provincials",
    result_id: null, meet_name: null, meet_date: null, prs: [], confidence: "likely", reasons: ["Same name"],
    status: "pending", created_at: "2026-11-24T10:00:00Z", decided_at: null, ...over,
  };
}

describe("names, read the way the database reads them", () => {
  it("folds accents with the same table as public.openipf_fold", () => {
    const from = /'(áà[^']+)'/.exec(MIGRATION)?.[1];
    const to = /'(aaaaaaae[^']+)'/.exec(MIGRATION)?.[1];
    expect(from && to && [...from].length).toBe([...(to ?? "")].length);
    expect(openipfFold(from)).toBe(to);
  });
  it("compares by letters, a #2 left off", () => {
    expect(nameKey("Kaydon Laurin #2")).toBe("kaydonlaurin");
    expect(nameKey("Anton Nykänen")).toBe("antonnykanen");
    expect(nameKey("Shane O'Brien")).toBe(nameKey("shane obrien"));
    expect(nameKey("Jared McIntyre")).toBe(nameKey("jared mcintyre"));
    expect(plainLifterName("Kaydon Laurin #1")).toBe("Kaydon Laurin");
  });
  it("reads a profile link (and nothing else) the way the sync does", () => {
    expect(parseProfileUrl("https://www.openipf.org/u/marcasugui")).toEqual({ host: "https://www.openipf.org", slug: "marcasugui" });
    expect(parseProfileUrl("openpowerlifting.org/u/JaredMcIntyre?x=1")).toEqual({ host: "https://www.openpowerlifting.org", slug: "jaredmcintyre" });
    expect(parseProfileUrl("https://example.com/u/marc")).toBeNull();
    expect(parseProfileUrl("marc asugui")).toBeNull();
    expect(profileUrl("https://www.openpowerlifting.org", "x1")).toBe("https://www.openpowerlifting.org/u/x1");
    expect(siteName("https://www.openipf.org")).toBe("OpenIPF");
  });
});

describe("what a suggestion says", () => {
  it("a match: their meets, the best total and its lifts", () => {
    expect(matchLine(sg({}))).toBe("2 meets · last Nov 2, 2025 · CPU · Canada");
    expect(liftsLine(sg({}))).toBe("580 kg total · 200 / 140 / 240");
    expect(liftsLine(sg({ squat_kg: null, deadlift_kg: null, total_kg: null, bench_kg: 137.5 }))).toBe("137.5 kg bench");
  });
  it("a stored date is that calendar day", () => {
    expect(meetDay("2026-11-01")).toBe("Nov 1, 2026");
    expect(kg(137.5)).toBe("137.5");
    expect(kg(0)).toBeNull();
  });
  it("records in words", () => {
    expect(prLine(["squat", "total"])).toBe("Squat and total PRs");
    expect(prLine(["bench"])).toBe("Bench PR");
    expect(prLine(["squat", "bench", "total"])).toBe("Squat, bench and total PRs");
    expect(prLine([])).toBeNull();
  });
  it("the Messages row leads with what matters: a meet with records, then likely matches", () => {
    const meet = sg({ id: "m", kind: "new_meet", subject_name: "Dwayne Gordon", meet_name: "Westerns", prs: ["total"], created_at: "2026-11-20T00:00:00Z" });
    const possible = sg({ id: "p", confidence: "possible", created_at: "2026-11-24T12:00:00Z" });
    const likely = sg({ id: "l", subject_name: "Fionna Faye Gaburno", created_at: "2026-11-23T00:00:00Z" });
    const sorted = [possible, likely, meet].sort(suggestionOrder);
    expect(sorted.map((s) => s.id)).toEqual(["m", "l", "p"]);
    expect(inboxPreview(sorted)).toBe("Dwayne Gordon: new meet, Westerns · Total PR");
    expect(inboxPreview([likely])).toBe("Fionna Faye Gaburno may be on OpenIPF");
    expect(batchTitle(sorted)).toBe("OpenIPF: 1 new meet, 2 possible matches");
  });
  it("the Athlete setup row", () => {
    expect(openIpfSummary({ linked: true, meet_count: 18, last_meet: "2026-09-18", pending: 0 })).toBe("18 meets · last Sep 18, 2026");
    expect(openIpfSummary({ linked: false, meet_count: 0, last_meet: null, pending: 1 })).toBe("A possible match is waiting");
    expect(openIpfSummary({ linked: false, meet_count: 0, last_meet: null, pending: 0 })).toBeNull();
  });
});

describe("meet bests → maxes", () => {
  const rows = [
    { squat_kg: 235, bench_kg: 150, deadlift_kg: 272.5, meet_date: "2026-09-18", meet_name: "Commonwealth" },
    { squat_kg: 230, bench_kg: 152.5, deadlift_kg: 270, meet_date: "2026-05-02", meet_name: "Nationals" },
    { squat_kg: 0, bench_kg: 152.5, deadlift_kg: 0, meet_date: "2026-07-01", meet_name: "Bench only" },
    { squat_kg: 260, bench_kg: 170, deadlift_kg: 290, meet_date: "2022-03-10", meet_name: "Too old" },
  ];
  const today = "2026-11-24";
  it("each lift's best single in two years, a tie keeping the later meet", () => {
    const b = meetBests(rows, today);
    expect(b.squat).toEqual({ kg: 235, date: "2026-09-18", meet: "Commonwealth" });
    expect(b.bench).toEqual({ kg: 152.5, date: "2026-07-01", meet: "Bench only" });
    expect(b.deadlift?.kg).toBe(272.5);
    expect(bestsLine(b)).toBe("Squat 235 · Bench 152.5 · Deadlift 272.5 kg");
    expect(bestsLine(meetBests([rows[3]], today))).toBeNull();
  });
  it("writes 1RMs in the row's own unit, keeps the training max unless asked, and skips what already says so", () => {
    const b = meetBests(rows, today);
    const existing = [
      { lift: "Competition Bench Press", one_rm: 315, training_max: null, unit: "lb" as const, source: "manual", tested_at: null, block_id: null, active: true },
      { lift: "Competition Squat", one_rm: null, training_max: 500, unit: "lb" as const, source: "manual", tested_at: null, block_id: null, active: true },
      { lift: "Competition Deadlift", one_rm: 272.5, training_max: null, unit: "kg" as const, source: "tested", tested_at: "2026-09-18", block_id: null, active: true },
      // a block's own max is the program's, never touched
      { lift: "Competition Squat", one_rm: 200, training_max: null, unit: "kg" as const, source: "manual", tested_at: null, block_id: "b1", active: true },
    ];
    const w = maxWritesFromBests(b, existing, { unit: "kg" });
    expect(w.map((x) => x.lift)).toEqual(["Competition Squat", "Competition Bench Press"]);
    expect(w[0]).toMatchObject({ unit: "lb", one_rm: 518, training_max: 500, tested_at: "2026-09-18" });
    expect(w[0].before).toMatchObject({ one_rm: null, training_max: 500 });
    expect(w[1]).toMatchObject({ unit: "lb", one_rm: 336, training_max: null });
    const withTm = maxWritesFromBests(b, existing, { unit: "kg", trainingPct: 90 });
    expect(withTm.find((x) => x.lift === "Competition Deadlift")).toMatchObject({ one_rm: 272.5, training_max: 245 });
    const fresh = maxWritesFromBests(b, [], { unit: "kg" });
    expect(fresh).toHaveLength(3);
    expect(fresh.every((x) => x.before === null && x.unit === "kg")).toBe(true);
  });
});

describe("who and where", () => {
  it("only coaching clients and alumni are ever searched; free members never", () => {
    expect(MIGRATION).toContain("c.service_tier = 'coaching'");
    expect(MIGRATION).toContain("c.service_tier IS DISTINCT FROM 'self_serve'");
    expect(MIGRATION).toContain("IF tier = 'self_serve' THEN RETURN NEW; END IF;");
    expect(MIGRATION).toContain("'openipf-monthly-scan', '41 15 1 * *'");
  });
  it("the first import is history, never a flood of new meets", () => {
    expect(MIGRATION).toContain("IF NOT FOUND OR a.opl_synced_at IS NULL THEN RETURN NEW; END IF;");
  });
  it("Messages has the row, and a push opens it", () => {
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain("<OpenIpfInboxRow />");
    expect(read("src/lib/openipf.server.ts")).toContain('url: "/admin/messages?openipf=1"');
    expect(read("src/routes/_authenticated/admin/communication.tsx")).toContain('openipf: "1"');
  });
  it("a coaching client's Athlete setup has OpenIPF, and their maxes offer the meet bests", () => {
    const tab = read("src/components/clients/client-training-tab.tsx");
    expect(tab).toContain('title="OpenIPF"');
    expect(tab).toContain('const coaching = (client as any)?.service_tier === "coaching";');
    expect(read("src/components/client-maxes-panel.tsx")).toContain("<MeetBestsRow clientId={clientId} />");
  });
  it("Cleo looks them up and offers a link card that's the owner's to tap", () => {
    expect(read("src/lib/cleo-tools.server.ts")).toContain("openipf: tool({");
    expect(CLEO_ACTION_RULES.link_openipf).toEqual({ need: "owner", approvable: false });
    expect(routeFor("link_openipf", { isAdmin: true, permissions: [] })).toBe("run");
    expect(routeFor("link_openipf", { isAdmin: false, isCoach: true, permissions: [] })).toBe("not_allowed");
  });
});
