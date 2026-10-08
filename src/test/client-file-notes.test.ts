import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isFresh, sortActive, sortArchived, suggestClients } from "@/lib/client-file-notes";
import { syncSignature } from "@/components/tasks/quick-notes";

const clients = [
  { id: "colten", full_name: "Colten Hart" },
  { id: "shaina", full_name: "Shaina Brooks" },
  { id: "jared", full_name: "Jared McIntyre" },
  { id: "al", full_name: "Al Kim" },
];

describe("suggest the client a note is about", () => {
  it("matches first names, tolerating one typo", () => {
    expect(suggestClients("Colton Moving Date\nLooks like they might be moving", clients).map((c) => c.id)).toEqual(["colten"]);
    expect(suggestClients("Shaina sister bachelor", clients).map((c) => c.id)).toEqual(["shaina"]);
  });
  it("ranks a full-name mention above a first-name mention and ignores short names", () => {
    expect(suggestClients("jared mcintyre and colten", clients).map((c) => c.id)).toEqual(["jared", "colten"]);
    expect(suggestClients("al said hi", clients)).toEqual([]);
    expect(suggestClients("", clients)).toEqual([]);
  });
});

describe("client file ordering", () => {
  it("pinned first, then newest change on top", () => {
    const rows = [
      { id: "a", pinned: false, updated_at: "2026-10-01T00:00:00Z" },
      { id: "b", pinned: true, updated_at: "2026-09-01T00:00:00Z" },
      { id: "c", pinned: false, updated_at: "2026-10-05T00:00:00Z" },
    ];
    expect(sortActive(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("archive shows the most recently archived first", () => {
    const rows = [
      { id: "a", archived_at: "2026-10-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      { id: "b", archived_at: "2026-10-07T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" },
    ];
    expect(sortArchived(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("marks notes New for 48h", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(isFresh("2026-10-07T12:00:00Z", now)).toBe(true);
    expect(isFresh("2026-10-05T12:00:00Z", now)).toBe(false);
  });
});

describe("Quick Note ↔ client file sync", () => {
  it("re-syncs on text, client or deleted changes only", () => {
    const n = { clientId: "c1", title: "T", body: "B" };
    const base = syncSignature(n);
    expect(syncSignature({ ...n })).toBe(base);
    expect(syncSignature({ ...n, body: "B2" })).not.toBe(base);
    expect(syncSignature({ ...n, clientId: "c2" })).not.toBe(base);
    expect(syncSignature({ ...n, deletedAt: 1 })).not.toBe(base);
  });

  it("deleting a linked note archives the client copy instead of deleting it", () => {
    const src = readFileSync("src/components/tasks/quick-notes.tsx", "utf8");
    expect(src).toMatch(/if \(n\.deletedAt\) \{\s*await setQuickNoteRemoved\(n\.id, true\)/);
    expect(src).toMatch(/Save to client file/);
    const lib = readFileSync("src/lib/client-file-notes.ts", "utf8");
    expect(lib).toMatch(/archive_reason: "quick_note_removed"/);
    expect(lib).not.toMatch(/\.delete\(\)/);
  });

  it("the client profile shows the file with its archive; staff-only access", () => {
    expect(readFileSync("src/route-pages/_authenticated/admin/clients.$id.tsx", "utf8")).toMatch(/<ClientFileNotes clientId=\{id\}/);
    const sql = readFileSync("supabase/migrations/20261011100000_client_file_notes.sql", "utf8");
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/is_assigned_coach\(client_id\)/);
    expect(sql).not.toMatch(/auth\.uid\(\) = .*user_id/); // clients never read these
  });
});
