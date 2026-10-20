import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Postgres checks the privileges of every table and column a policy reads
// before it runs a query, for all of a table's policies at once. A policy on
// storage.objects that reads a table signed-in users can't fully SELECT
// doesn't just deny that bucket: every read, signed URL and upload in every
// bucket fails ("permission denied for table ..."). That's what
// 20261019090000_community_comment_threads did with community_comments.
// Policies that need such a table call a SECURITY DEFINER function instead.
//
// This replays the migrations: GRANT/REVOKE on public tables to authenticated,
// and CREATE/DROP POLICY on storage.objects, then checks what's live.

const DIR = join(process.cwd(), "supabase/migrations");
const IDENT = String.raw`(?:"[^"]+"|[\w.]+)`;
const unq = (s: string) => s.replace(/"/g, "").replace(/^public\./, "");

function statements(sql: string): string[] {
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  const out: string[] = [];
  let buf = "";
  let tag: string | null = null;
  for (const part of clean.split(/(\$[A-Za-z_]*\$)/)) {
    if (/^\$[A-Za-z_]*\$$/.test(part)) {
      if (tag === null) tag = part;
      else if (part === tag) tag = null;
      buf += part;
      continue;
    }
    if (tag !== null) { buf += part; continue; }
    const segs = part.split(";");
    segs.forEach((seg, i) => {
      buf += seg;
      if (i < segs.length - 1) { out.push(buf.replace(/\s+/g, " ").trim()); buf = ""; }
    });
  }
  out.push(buf.replace(/\s+/g, " ").trim());
  return out;
}

type Replay = { storagePolicies: Map<string, string>; noFullSelect: Set<string> };

function replay(files: string[]): Replay {
  const storagePolicies = new Map<string, string>();
  // Tables authenticated can't SELECT whole: revoked, or granted column by column.
  // Anything never revoked keeps Supabase's default grant.
  const noFullSelect = new Set<string>();
  for (const f of files) {
    for (const st of statements(readFileSync(join(DIR, f), "utf8"))) {
      let m = new RegExp(`^create policy (${IDENT}) on storage\\.objects\\b`, "i").exec(st);
      if (m) { storagePolicies.set(unq(m[1]), st); continue; }
      m = new RegExp(`^drop policy (?:if exists )?(${IDENT}) on storage\\.objects\\b`, "i").exec(st);
      if (m) { storagePolicies.delete(unq(m[1])); continue; }
      m = /^(grant|revoke) (.+?) on (?:table )?((?:"?[\w.]+"?\s*,\s*)*"?[\w.]+"?) (?:to|from) (.+)$/i.exec(st);
      if (!m || /^(function|sequence|schema|all tables)\b/i.test(m[3]) || !/\bauthenticated\b/i.test(m[4])) continue;
      const privs = m[2].toLowerCase();
      const tables = m[3].split(",").map((t) => unq(t.trim()));
      const fullSelect = !privs.includes("(") && /\b(all|select)\b/.test(privs);
      for (const t of tables) {
        if (m[1].toLowerCase() === "grant" && fullSelect) noFullSelect.delete(t);
        if (m[1].toLowerCase() === "revoke" && fullSelect) noFullSelect.add(t);
      }
    }
  }
  return { storagePolicies, noFullSelect };
}

function tablesRead(policySql: string): string[] {
  const out = new Set<string>();
  for (const m of policySql.matchAll(/\b(?:from|join)\s+("?[\w.]+"?)(?!\s*\()/gi)) out.add(unq(m[1]));
  return [...out];
}

function blocked({ storagePolicies, noFullSelect }: Replay): string[] {
  return [...storagePolicies.entries()].flatMap(([name, sql]) =>
    tablesRead(sql).filter((t) => noFullSelect.has(t)).map((t) => `${name} reads ${t}`));
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

describe("storage.objects policies", () => {
  it("finds the policy set", () => {
    expect(replay(files).storagePolicies.size).toBeGreaterThan(30);
  });

  it("only read tables signed-in users can SELECT whole", () => {
    expect(blocked(replay(files))).toEqual([]);
  });

  it("would have caught the community comments policy", () => {
    const before = files.filter((f) => f <= "20261019090000_community_comment_threads.sql");
    expect(blocked(replay(before))).toEqual(["community media read reads community_comments"]);
  });
});
