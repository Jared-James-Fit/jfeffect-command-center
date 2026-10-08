import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIRECTORY_FILTER_KEYS,
  emptyCounts,
  filtersFromSearch,
  parseFilterKeys,
  serializeFilterKeys,
  toggleFilterKey,
} from "@/lib/clients-directory-filters";
import { FILTER_GROUPS, STATUS_META } from "@/components/clients/clients-status";
import { buildRoster } from "@/lib/coaching-agreement/roster";
import { RESIGN_REQUIRED_BELOW_VERSION } from "@/lib/coaching-agreement/version";

const read = (path: string) => readFileSync(path, "utf8");
const MIGRATION = "supabase/migrations/20261006180000_clients_directory_contract_and_filters.sql";

describe("filter keys in the URL", () => {
  it("reads a comma list, dropping unknown keys, repeats and the old status=all", () => {
    expect(parseFilterKeys("no_contract,no_payment")).toEqual(["no_contract", "no_payment"]);
    expect(parseFilterKeys("no_contract,bogus,no_contract")).toEqual(["no_contract"]);
    expect(parseFilterKeys("all")).toEqual([]);
    expect(parseFilterKeys("")).toEqual([]);
    expect(parseFilterKeys(undefined)).toEqual([]);
    expect(parseFilterKeys(" no_cardio , no_program ")).toEqual(["no_program", "no_cardio"]);
  });

  it("always comes back in the list's own order, so one selection is one query", () => {
    expect(parseFilterKeys("no_cardio,no_contract")).toEqual(["no_contract", "no_cardio"]);
    expect(serializeFilterKeys(["no_cardio", "no_contract"])).toBe("no_contract,no_cardio");
  });

  it("serializes nothing as undefined, so the URL stays clean", () => {
    expect(serializeFilterKeys([])).toBeUndefined();
  });

  it("toggles one filter on and off without touching the others", () => {
    expect(toggleFilterKey(["no_contract"], "no_payment")).toEqual(["no_contract", "no_payment"]);
    expect(toggleFilterKey(["no_contract", "no_payment"], "no_contract")).toEqual(["no_payment"]);
  });

  it("still understands the older single status link", () => {
    expect(filtersFromSearch({ status: "needs_review", flags: "" })).toEqual(["needs_review"]);
    expect(filtersFromSearch({ status: "all", flags: "no_contract" })).toEqual(["no_contract"]);
    expect(filtersFromSearch({ status: "needs_review", flags: "no_contract" })).toEqual([
      "no_contract",
      "needs_review",
    ]);
  });
});

describe("one definition of every filter", () => {
  it("gives every filter a label, an icon and a plain sentence", () => {
    for (const key of DIRECTORY_FILTER_KEYS) {
      const meta = STATUS_META[key];
      expect(meta.label.length, key).toBeGreaterThan(2);
      expect(meta.icon, key).toBeTruthy();
      expect(meta.hint?.length ?? 0, key).toBeGreaterThan(15);
    }
  });

  it("shows each filter exactly once in the groups", () => {
    const grouped = FILTER_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...DIRECTORY_FILTER_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("starts every count at zero", () => {
    const counts = emptyCounts();
    expect(Object.keys(counts).sort()).toEqual(["all", ...DIRECTORY_FILTER_KEYS].sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe("the database and the app agree", () => {
  const sql = read(MIGRATION);

  it("defines exactly the filters the app lists", () => {
    const block = sql.slice(sql.indexOf("-- flags:begin"), sql.indexOf("-- flags:end"));
    const keys = [...block.matchAll(/then '([a-z_]+)' end/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...DIRECTORY_FILTER_KEYS].sort());
  });

  it("counts exactly the filters the app lists", () => {
    const keys = [...sql.matchAll(/'([a-z_]+)', count\(\*\) filter \(where '\1' = any\(flags\)\)/g)].map(
      (m) => m[1],
    );
    expect([...keys].sort()).toEqual([...DIRECTORY_FILTER_KEYS].sort());
  });

  it("asks clients to sign again below the same version as the app does", () => {
    const fn = sql.slice(sql.indexOf("function public.coaching_agreement_resign_below_version"));
    expect(fn).toContain(`select '${RESIGN_REQUIRED_BELOW_VERSION}'::text`);
  });

  it("replaces the old 8-argument directory rather than adding an ambiguous second overload", () => {
    expect(sql).toContain(
      "drop function if exists public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text);",
    );
    expect(sql).toMatch(/p_flags text\[\] default null/);
    // Same access as before: signed-in users and the server, never anonymous callers.
    expect(sql).toContain("from public, anon;");
    expect(sql).toMatch(/to authenticated, service_role;/);
  });

  it("keeps the contract status view away from signed-in users", () => {
    expect(sql).toContain("revoke all on public.coaching_agreement_client_status from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant [^;]*coaching_agreement_client_status to [^;]*authenticated/i);
  });
});

/**
 * The SQL view and the roster page must reach the same answer for the same facts. These are the
 * same twelve situations the SQL scenario inserts, and the expected answers are read straight
 * from that file, so changing either side without the other fails here.
 */
describe("contract status: the TypeScript rules give the SQL scenario's answers", () => {
  const sqlScenario = read("supabase/tests/clients-directory/scenario.sql");
  const expected = new Map<number, string>(
    [...sqlScenario.matchAll(/\((\d+), '(signed|never_signed|admin_request|new_version|exempt|no_account)'\)/g)].map(
      (m) => [Number(m[1]), m[2]],
    ),
  );

  const NOW = Date.parse("2026-10-06T12:00:00Z");
  const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
  const id = (n: number) => `client-${n}`;
  const names: Record<number, string> = {
    1: "Signed Sam", 2: "Never Nora", 3: "Resign Rae", 4: "Old Olly", 5: "Paper Pat", 6: "NoApp Nick",
    7: "Signed NoApp", 8: "Exempt NoApp", 9: "Resign Done Dee", 10: "Draft Dan", 11: "Exempt Resign Ed",
    12: "Latest Wins Lou",
  };
  const withoutApp = new Set([6, 7, 8]);

  const clients = Object.keys(names).map(Number).map((n) => ({
    id: id(n),
    full_name: names[n],
    email: null,
    user_id: withoutApp.has(n) ? null : `user-${n}`,
    assigned_coach_id: null,
    agreement_signed: null,
    agreement_signed_date: null,
    agreement_version: null,
    last_signed_in_at: null,
  }));

  const sig = (n: number, version: string, days: number, key: string) => ({
    id: `sig-${n}-${key}`,
    client_id: id(n),
    signed_at: ago(days),
    typed_name: "Typed Name",
    signature_method: "typed" as const,
    has_guardian: false,
    version,
  });
  const signatures = [
    sig(1, "2.0", 10, "a"),
    sig(3, "2.0", 10, "a"),
    sig(4, "1.0", 10, "a"),
    sig(7, "2.0", 10, "a"),
    sig(9, "2.0", 5, "a"),
    sig(12, "1.0", 20, "old"),
    sig(12, "2.0", 2, "new"),
  ];

  const state = (n: number, over: Record<string, unknown>) => ({
    client_id: id(n),
    resign_requested_at: null,
    resign_note: null,
    exempt_kind: null,
    exempt_note: null,
    exempt_set_at: null,
    last_reminded_at: null,
    reminder_count: 0,
    ...over,
  });
  const states = [
    state(3, { resign_requested_at: ago(1) }),
    state(5, { exempt_kind: "offline_signed" }),
    state(8, { exempt_kind: "not_required" }),
    state(9, { resign_requested_at: ago(8) }),
    state(11, { resign_requested_at: ago(1), exempt_kind: "not_required" }),
  ] as Parameters<typeof buildRoster>[2];

  const roster = buildRoster(clients, signatures, states);
  const statusOf = (n: number) => roster.find((row) => row.clientId === id(n))?.status;

  it("reads all twelve expected answers from the SQL scenario", () => {
    expect(expected.size).toBe(12);
  });

  // Case 10 is a deliberately malformed version string ("2.0-draft"). The database treats an
  // unreadable version as older (the safe side for a legal record); the app never writes one, so
  // that case is checked only in SQL.
  it.each([...expected.entries()].filter(([n]) => n !== 10))("situation %i: %s", (n, answer) => {
    expect(statusOf(n)).toBe(answer);
  });

  it("counts the same people as owing a signature (everything except signed and exempt)", () => {
    // Draft Dan has no signature in this fixture; in SQL his version is unreadable. Either way
    // he still owes one, which is all the filter cares about.
    const owing = ["Draft Dan", "Never Nora", "NoApp Nick", "Old Olly", "Resign Rae"];
    const fromRules = roster
      .filter((row) => row.status !== "signed" && row.status !== "exempt")
      .map((row) => row.name)
      .sort();
    expect(fromRules).toEqual(owing);
    expect(sqlScenario).toContain(
      `array[${owing.map((name) => `'${name}'`).join(", ")}], 'no_contract lists exactly those five'`,
    );
  });
});
