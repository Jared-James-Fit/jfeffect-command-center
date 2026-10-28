import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldPersistQueryKey } from "@/lib/query-persister";

const read = (p: string) => readFileSync(p, "utf8");
const sql = read("supabase/migrations/20270106090000_keep_deleted_and_edited_messages.sql");
const lib = read("src/lib/messages.ts");
const thread = read("src/components/message-thread.tsx");

describe("the database keeps what a deleted or edited coach-chat message said", () => {
  it("copies the replaced version on delete for everyone and on every edit, whoever made it", () => {
    expect(sql).toContain("AFTER UPDATE OF body, deleted_at ON public.messages");
    expect(sql).toMatch(/INSERT INTO public\.message_deletions[\s\S]*'unsent', OLD\.client_id[\s\S]*OLD\.body, OLD\.attachments/);
    expect(sql).toMatch(/INSERT INTO public\.message_edits[\s\S]*OLD\.body/);
    // runs as the owner, so a client's own delete can write the copy they can never read
    expect(sql).toMatch(/keep_message_history\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER/);
  });
  it("admins only: no coach, client or anon policy, read-only from the app", () => {
    for (const t of ["message_deletions", "message_edits"]) {
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT SELECT ON public.${t} TO authenticated;`);
    }
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      expect(p).toContain("FOR SELECT TO authenticated");
      expect(p).toContain("(SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))");
      expect(p).not.toMatch(/coach|coached_client_ids|clients/);
    }
  });
  it("and the older coach rule on message_deletions is gone, so admins are the only readers", () => {
    const drop = read("supabase/migrations/20270106091000_message_deletions_admin_only.sql");
    expect(drop).toContain('DROP POLICY IF EXISTS "Staff read message deletions" ON public.message_deletions;');
  });
  it("member-made chats are never copied", () => {
    expect(sql).not.toMatch(/ON public\.group_messages/);
  });
  it("Remove on a placeholder keeps its words as the removed copy instead of a second, empty one", () => {
    expect(sql).toContain("SET kind = 'removed'");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM public.message_deletions d WHERE d.message_id = m.id AND d.chat = 'dm')");
  });
});

describe("the admin's chat", () => {
  it("the 'N deleted' log lists only messages taken out; ones deleted for everyone open where they were", () => {
    expect(lib).toContain('.from("message_deletions").select("*").eq("kind", "removed")');
    expect(lib).toContain('.eq("client_id", clientId).eq("chat", "dm").eq("kind", "unsent")');
    expect(lib).toContain('.from("message_edits")');
  });
  it("only a real admin on the coach side asks (never a coach, a client or View as client)", () => {
    expect(thread).toContain('const isAdmin = role === "admin" && appRole === "admin";');
    expect(thread).toContain('enabled: isAdmin && !!clientId && historyKey !== "",');
    expect(thread).toContain("const kept = isAdmin && isDeleted ? history?.deleted[m.id] : undefined;");
    expect(thread).toContain("const priorVersions = isAdmin && !isDeleted && m.edited_at ? history?.edits[m.id] : undefined;");
  });
  it("is never saved on the phone", () => {
    expect(thread).toContain('queryKey: ["messages-history", clientId, historyKey]');
    expect(shouldPersistQueryKey(["messages-history", "c1", "x"])).toBe(false);
  });
  it("the toggles never like the message or open its menu", () => {
    for (const attr of ["data-show-deleted", "data-show-edits"]) {
      const at = thread.indexOf(attr);
      expect(at).toBeGreaterThan(0);
      expect(thread.slice(at - 120, at)).toContain("data-no-doubletap");
    }
    expect(thread.match(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); toggleHistory\(/g)).toHaveLength(2);
  });
  it("whoever deletes a message is told a copy is kept, and the admin's own Remove says only admins see it", () => {
    expect(thread).toContain("and a copy is kept in JF Effect's message records.");
    expect(thread).toContain("Only admins can see it under “deleted”.");
    expect(thread).not.toContain("Only coaches and admins can see it");
  });
  it("a deleted message's photos are signed once the admin opens it", () => {
    expect(thread).toContain('for (const a of history?.deleted[key.slice(0, -":deleted".length)]?.attachments ?? []) {');
  });
});
