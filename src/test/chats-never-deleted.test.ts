import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const sql = read("supabase/migrations/20270107090000_chats_never_deleted.sql");

describe("the database never deletes a chat with an account", () => {
  it("guards every delete that cascaded into chats", () => {
    expect(sql).toContain("BEFORE DELETE ON public.clients");
    expect(sql).toContain("BEFORE DELETE ON public.app_members");
    expect(sql).toContain("BEFORE DELETE ON public.chat_groups");
    expect(sql).toContain("BEFORE DELETE ON auth.users");
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.messages WHERE client_id = OLD\.id\)/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.member_support_messages WHERE member_id = OLD\.id\)/);
    for (const t of ["messages WHERE sender_id", "group_messages WHERE sender_id", "member_support_messages WHERE sender_user_id", "message_reactions WHERE user_id", "group_message_reactions WHERE user_id"]) {
      expect(sql).toContain(`public.${t} = OLD.id`);
    }
  });
  it("keeps the same admin-only purge escape as logged training, and leaves members' own crews alone", () => {
    expect(sql).toContain("current_setting('jf.allow_history_delete', true), '') = 'on'");
    expect(sql).toContain("OR OLD.kind = 'crew' THEN RETURN OLD;");
  });
});

describe("the app's delete buttons keep chats", () => {
  // Delete client / Delete member wait 30 days in Recently deleted first
  // (recently-deleted.test.ts); the purge on day 30 keeps chats the same way.
  it("day 30 deactivates a client with chat history (portal off) and closes the login", () => {
    const fn = read("src/lib/account-deletion.server.ts");
    expect(fn).toContain('deactivation_reason: "Account deleted (chat history kept)"');
    expect(fn).toContain('admin.from("messages").select("id").eq("client_id", ids.clientId).limit(1)');
    expect(fn).toMatch(/updateUserById\(row\.user_id, \{\s*ban_duration: "876000h",?\s*\}\)/);
  });
  it("day 30 deactivates a member with any chat history (access off, chats kept)", () => {
    const fn = read("src/lib/account-deletion.server.ts");
    for (const t of ['from("group_messages")', 'from("member_support_messages")', 'from("message_reactions")', 'from("group_message_reactions")']) {
      expect(fn).toContain(t);
    }
    expect(fn).toContain('.update({ status: "Deactivated", manual_access_disabled: true })');
    expect(fn).toContain('await admin.from("member_access").update({ active: false }).eq("member_id", row.member_id);');
  });
  it("Delete group archives a group with messages and only deletes an empty one", () => {
    const fn = read("src/lib/group-chats.functions.ts");
    expect(fn).toContain('.update({ archived: true, updated_at: new Date().toISOString() }).in("id", keep);');
    expect(fn).toContain('await supabase.from("chat_groups").delete().in("id", empty);');
    expect(fn).not.toContain('await supabase.from("chat_groups").delete().in("id", data.group_ids);');
  });
});
