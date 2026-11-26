import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FIRST_NAMES,
  NAME_ORIGINS,
  NAME_STYLES,
  ORIGIN_RULES,
  SURNAMES,
  SURNAME_ONLY_GENDER,
  WELL_KNOWN,
} from "@/lib/virtual-accounts/name-pool";
import {
  FOLD_FROM,
  FOLD_TO,
  PLACEHOLDER_CASES,
  PLACEHOLDER_FULL,
  PLACEHOLDER_WORDS,
  foldName,
  placeholderReason,
  usernameReadsAsPlaceholder,
} from "@/lib/virtual-accounts/names";
import {
  USERNAME_WORDS,
  VIRTUAL_NAMES_CASES,
  VIRTUAL_NAMES_MIGRATION,
  virtualNameCasesSql,
  virtualNamesSql,
} from "@/lib/virtual-accounts/names-sql";
import { STARTER_PERSONAS } from "@/lib/virtual-accounts/personas";

const allFirsts = NAME_STYLES.flatMap((s) =>
  (["f", "m", "u"] as const).flatMap((g) =>
    FIRST_NAMES[s][g].map((name) => ({ name, style: s, g })),
  ),
);
const allLasts = NAME_ORIGINS.flatMap((o) => SURNAMES[o].map((name) => ({ name, origin: o })));

describe("virtual account names: the placeholder rule", () => {
  it.each(PLACEHOLDER_CASES)("%s %s → placeholder: %s", (first, last, bad) => {
    expect(placeholderReason(first, last) !== null).toBe(bad);
  });
  it("says why in words an admin can act on", () => {
    expect(placeholderReason("Jon", "Doe")).toBe("That's a placeholder name");
    expect(placeholderReason("Emily", "Doe")).toBe('"Doe" reads as a placeholder');
    expect(placeholderReason("Lift", "Bot")).toBe(`"Bot" reads like a bot's name`);
    expect(placeholderReason("Coach", "Mike")).toBe(
      '"Coach" could be mistaken for JF Effect staff',
    );
    expect(placeholderReason("User", "4821")).toBe("Names with numbers read as placeholders");
    expect(placeholderReason("J.", "Mitchell")).toBe(
      "Use a full first and last name, not initials",
    );
    expect(placeholderReason("Jordan", "Jordan")).toBe("First and last name are the same");
  });
  it("folds accents, apostrophes and case the way the database does", () => {
    expect(foldName("Marie-Ève")).toBe("marie eve");
    expect(foldName("O'Brien")).toBe("obrien");
    expect(foldName("CÔTÉ")).toBe("cote");
    expect(foldName("Gonçalo")).toBe("goncalo");
    expect(foldName("Łukasz Wiśniewski")).toBe("lukasz wisniewski");
    expect(FOLD_FROM.length).toBe(FOLD_TO.length);
    expect(Array.from(FOLD_FROM).length).toBe(FOLD_FROM.length);
  });
  it("usernames: a placeholder or bot word reads as one; real ones don't", () => {
    for (const u of [
      "jon.doe",
      "testuser3",
      "user_4821",
      "lift.bot",
      "crew.member",
      "demo.lifts",
      "aaa.bbb",
    ])
      expect(usernameReadsAsPlaceholder(u)).toBe(true);
    for (const u of [
      "maya.lifts",
      "ethan.mitchell",
      "sofia_reyes",
      "nmenon",
      "sam.at.home",
      "kofi.benches",
    ])
      expect(usernameReadsAsPlaceholder(u)).toBe(false);
  });
});

describe("virtual account names: the pool", () => {
  it("is big enough to stay varied for hundreds of accounts", () => {
    expect(allFirsts.length).toBeGreaterThanOrEqual(400);
    expect(allLasts.length).toBeGreaterThanOrEqual(450);
    expect(NAME_ORIGINS.length).toBeGreaterThanOrEqual(20);
  });
  it("every style has women's and men's names, about as many of each", () => {
    for (const s of NAME_STYLES) {
      const { f, m } = FIRST_NAMES[s];
      expect(f.length, `${s} women`).toBeGreaterThanOrEqual(5);
      expect(m.length, `${s} men`).toBeGreaterThanOrEqual(5);
    }
    const f = allFirsts.filter((x) => x.g === "f").length;
    const m = allFirsts.filter((x) => x.g === "m").length;
    expect(Math.abs(f - m) / (f + m)).toBeLessThan(0.08);
  });
  it("no pool name reads as a placeholder, a bot or staff", () => {
    for (const { name } of allFirsts) expect(placeholderReason(name, "Bennett"), name).toBeNull();
    for (const { name } of allLasts) expect(placeholderReason("Natalie", name), name).toBeNull();
  });
  it("first names are one word (the Crew shows the first word), never repeated within a style or gender list", () => {
    for (const { name } of allFirsts) expect(name).not.toMatch(/\s/);
    for (const s of NAME_STYLES) {
      const names = [...FIRST_NAMES[s].f, ...FIRST_NAMES[s].m, ...FIRST_NAMES[s].u].map(foldName);
      expect(new Set(names).size, s).toBe(names.length);
    }
  });
  it("surnames are never repeated within an origin, and only Singh and Kaur follow a gender", () => {
    for (const o of NAME_ORIGINS) {
      const names = SURNAMES[o].map(foldName);
      expect(new Set(names).size, o).toBe(names.length);
    }
    expect(SURNAME_ONLY_GENDER).toEqual({ Singh: "m", Kaur: "f" });
  });
  it("every origin pairs only with styles that exist, its shares add up, and every style is reached", () => {
    const reached = new Set<string>();
    for (const o of NAME_ORIGINS) {
      const pairs = ORIGIN_RULES[o].pairs;
      const total = Object.values(pairs).reduce((a, b) => a + (b ?? 0), 0);
      expect(total, o).toBeCloseTo(1, 5);
      for (const k of Object.keys(pairs)) {
        expect(NAME_STYLES as readonly string[]).toContain(k);
        reached.add(k);
      }
      expect(ORIGIN_RULES[o].weight).toBeGreaterThan(0);
    }
    for (const s of NAME_STYLES) expect(reached.has(s), s).toBe(true);
  });
  it("can make the names the owner gave as examples", () => {
    const firsts = new Set(allFirsts.map((x) => x.name));
    const lasts = new Set(allLasts.map((x) => x.name));
    for (const n of [
      "Ethan Mitchell",
      "Ryan Bennett",
      "Marcus Reid",
      "Daniel Foster",
      "Noah Sullivan",
      "Alyssa Morgan",
      "Natalie Brooks",
      "Sophia Reyes",
      "Vanessa Cruz",
      "Emily Parker",
    ]) {
      const [f, l] = n.split(" ");
      expect(firsts.has(f), f).toBe(true);
      expect(lasts.has(l), l).toBe(true);
    }
  });
  it("the starters' names are in the pool, so their gender and origin can be read", () => {
    const firsts = new Set(allFirsts.map((x) => foldName(x.name)));
    const lasts = new Set(allLasts.map((x) => foldName(x.name)));
    for (const p of STARTER_PERSONAS) {
      expect(firsts.has(foldName(p.first)), p.first).toBe(true);
      expect(lasts.has(foldName(p.last)), p.last).toBe(true);
    }
  });
  it("never stocks the coach's own surname", () => {
    expect(allLasts.map((x) => foldName(x.name))).not.toContain("mcintyre");
  });
  it("placeholder words are lower case, single words, and each in one group", () => {
    const words = Object.values(PLACEHOLDER_WORDS).flat();
    expect(new Set(words).size).toBe(words.length);
    for (const w of words) expect(w).toMatch(/^[a-z]+$/);
    for (const n of PLACEHOLDER_FULL) expect(foldName(n)).toBe(n);
    for (const n of WELL_KNOWN) expect(foldName(n).split(" ").length).toBeGreaterThanOrEqual(2);
    for (const w of USERNAME_WORDS) expect(usernameReadsAsPlaceholder(`maya.${w}`)).toBe(false);
  });
});

describe("virtual account names: the migration is generated", () => {
  it("matches the definitions (run scripts/virtual-names/write-migration.ts after a change)", () => {
    expect(readFileSync(VIRTUAL_NAMES_MIGRATION, "utf8")).toBe(virtualNamesSql());
    expect(readFileSync(VIRTUAL_NAMES_CASES, "utf8")).toBe(virtualNameCasesSql());
  });
  const SQL = virtualNamesSql();
  it("one generator, refusing what the rules refuse, and the tables nobody else can read", () => {
    expect(SQL).toContain("CREATE OR REPLACE FUNCTION public.virtual_name_generate(");
    expect(SQL).toContain("v_ff = ANY(v_real_first)".replace("v_ff", "split_part(v_ff, ' ', 1)"));
    expect(SQL).toContain("left(v_ff, 1) = left(v_lf, 1)");
    expect(SQL).toContain("public.virtual_name_placeholder(v_first, v_last) IS NOT NULL");
    expect(SQL).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated");
  });
  it("renames keep the account: one update in place, never a delete or a new account", () => {
    const apply = SQL.slice(
      SQL.indexOf("FUNCTION public._virtual_apply_name("),
      SQL.indexOf("FUNCTION public.tg_virtual_accounts_name_guard("),
    );
    expect(apply).toContain("UPDATE public.virtual_accounts SET");
    expect(apply).not.toMatch(
      /DELETE FROM|INSERT INTO public\.virtual_accounts|community_reactions|community_follows/,
    );
    expect(apply).toContain("'renamed'");
    expect(apply).toContain("avatar_path = NULL");
  });
  it("placeholders are corrected automatically: in the migration and on every tick", () => {
    expect(SQL).toMatch(/SELECT public\.virtual_accounts_fix_placeholder_names\(\);\s*$/);
    const tick = SQL.slice(SQL.indexOf("FUNCTION public.virtual_accounts_tick()"));
    expect(tick.indexOf("virtual_accounts_fix_placeholder_names")).toBeLessThan(
      tick.indexOf("automation_enabled"),
    );
  });
  it("a placeholder can't be written by anything, and the admin functions check members' names", () => {
    expect(SQL).toContain(
      "BEFORE INSERT OR UPDATE OF first_name, last_name ON public.virtual_accounts",
    );
    for (const fn of ["admin_virtual_account_create(", "admin_virtual_account_rename("]) {
      const body = SQL.slice(SQL.indexOf(`FUNCTION public.${fn}`));
      expect(body.slice(0, body.indexOf("$$;")), fn).toContain("virtual_name_problem(");
    }
    expect(SQL).toContain("A member goes by ");
  });
  it("the admin functions are the admin's; the rest only the server's", () => {
    for (const f of [
      "admin_virtual_name_suggestions",
      "admin_virtual_name_check",
      "admin_virtual_account_rename",
    ]) {
      const body = SQL.slice(SQL.indexOf(`FUNCTION public.${f}(`));
      expect(body.slice(0, body.indexOf("$$;")), f).toContain("has_role(");
    }
    for (const f of [
      "virtual_name_generate(integer, text, uuid)",
      "virtual_name_problem(text, text, uuid)",
      "_virtual_apply_name(",
      "virtual_accounts_fix_placeholder_names()",
    ]) {
      expect(SQL, f).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${f.replace(/[()]/g, (c) => `\\${c}`)}[^;]*FROM PUBLIC, anon, authenticated;`,
        ),
      );
    }
  });
});
