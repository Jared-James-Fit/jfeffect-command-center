import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { PinTile } = await import("@/components/messages/inbox-parts");

const read = (p: string) => readFileSync(p, "utf8");
const migration = read("supabase/migrations/20261129090000_client_message_read_and_edit_guard.sql");
const migrationCode = migration.replace(/--.*$/gm, "");

describe("a client's read stamp on coach messages saves again", () => {
  it("the guards no longer name columns messages doesn't have", () => {
    // NEW.transcript_text / NEW.thread_id made every client UPDATE error, so
    // markRead's stamp was lost while the tab badge (conversation_state) cleared.
    expect(migrationCode).not.toMatch(/transcript_text|thread_id/);
    // what a client may change is a short allow-list, so a renamed or dropped
    // column can't break it again
    expect(migration).toContain("free text[] := ARRAY['read_by_client_at', 'updated_at'];");
    expect(migration).toContain("IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) THEN");
  });

  it("only the sender edits or deletes their own message; nobody else's, never undeleted", () => {
    expect(migration).toContain("own := OLD.sender_role = 'client' AND OLD.sender_id = uid AND OLD.deleted_at IS NULL;");
    expect(migration).toContain("free := free || ARRAY['body', 'edited_at', 'deleted_at', 'attachments'];");
    expect(migration).toContain("AND NOT (NEW.deleted_at IS NOT NULL AND (NEW.attachments IS NULL OR NEW.attachments = '[]'::jsonb))");
    expect(migration).toContain("AND NOT (OLD.sender_role = 'client' AND OLD.sender_id = auth.uid() AND OLD.deleted_at IS NULL))");
  });

  it("repairs stamps only for coach messages before the client's read marker", () => {
    expect(migration).toContain("SET read_by_client_at = cs.client_last_read_at");
    expect(migration).toContain("AND m.created_at <= cs.client_last_read_at;");
    expect(migration).toContain("AND m.is_internal_note = false");
  });

  it("the fillout guard compares its real column too", () => {
    const fillout = read("supabase/migrations/20261129100000_fillout_guard_real_column.sql").replace(/--.*$/gm, "");
    expect(fillout).toContain("NEW.fillout_submission_id IS DISTINCT FROM OLD.fillout_submission_id");
    expect(fillout).not.toMatch(/NEW\.submission_id/);
  });

  it("markRead no longer swallows a failed stamp", () => {
    const lib = read("src/lib/messages.ts");
    expect(lib).toContain("const { error: stampError } = await db.from(\"messages\").update({ [col]: now })");
    expect(lib).toContain('if (stampError) console.warn("[messages] read stamp failed", stampError);');
  });
});

describe("pinned chats show what's new (iMessage pins)", () => {
  const tile = (unread: boolean, preview?: string) =>
    renderToStaticMarkup(createElement(PinTile, { name: "Coach Jared", avatar: createElement("span"), unread, preview, onOpen: () => {} }));

  it("an unread pin shows the newest message in a bubble over the face", () => {
    const html = tile(true, "Quick 60-second weekly check-in 👇");
    expect(html).toContain("data-pin-preview");
    expect(html).toContain("Quick 60-second weekly check-in 👇");
    expect(html).toContain('aria-label="Coach Jared, unread: Quick 60-second weekly check-in 👇"');
  });

  it("no bubble once it's read, or with nothing to show", () => {
    expect(tile(false, "old news")).not.toContain("data-pin-preview");
    expect(tile(true, "  ")).not.toContain("data-pin-preview");
  });

  it("the coach pin gets the coach's own newest message, and pins line up at the bottom", () => {
    const page = read("src/routes/_authenticated/portal/messages.tsx");
    expect(page).toContain("unreadPreview: coachUnread ? coachLast?.coachText : null,");
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane).toContain("preview={pinned.unreadPreview}");
    expect(pane).toContain('<div className="flex flex-wrap items-end justify-center border-b border-border/60 px-2 py-2" aria-label="Pinned chats">');
  });
});
