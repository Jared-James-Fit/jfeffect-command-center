import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RESTORE_DAYS,
  adminDeleteCopy,
  daysLeft,
  deletedToast,
  deletesInLabel,
  purgeDateFrom,
  restoreGateCopy,
  selfDeleteCopy,
} from "@/lib/recently-deleted";

const NOW = new Date("2026-11-10T18:00:00Z");

describe("Recently deleted: 30 days, said plainly", () => {
  it("counts whole days left", () => {
    expect(RESTORE_DAYS).toBe(30);
    expect(daysLeft(purgeDateFrom(NOW), NOW)).toBe(30);
    expect(daysLeft("2026-11-11T17:00:00Z", NOW)).toBe(1);
    expect(daysLeft("2026-11-09T00:00:00Z", NOW)).toBe(0);
    expect(deletesInLabel("2026-11-20T18:00:00Z", NOW)).toBe("Deletes in 10 days");
    expect(deletesInLabel("2026-11-11T12:00:00Z", NOW)).toBe("Deletes tomorrow");
    expect(deletesInLabel("2026-11-10T19:00:00Z", NOW)).toBe("Deletes tomorrow");
    expect(deletesInLabel("2026-11-10T17:00:00Z", NOW)).toBe("Deletes today");
  });

  it("deleting your own account says the restore window and what comes back", () => {
    const c = selfDeleteCopy(NOW);
    expect(c.title).toBe("Delete your account?");
    expect(c.lines[0]).toMatch(
      /Recently deleted for 30 days\. Sign back in any time before Dec 10 and tap Restore/,
    );
    expect(c.lines[1]).toBe("After Dec 10 it's deleted for good and can't be brought back.");
  });

  it("an admin's delete is a move, never a permanent delete on the spot", () => {
    const c = adminDeleteCopy("Marc", NOW);
    expect(c.title).toBe("Delete Marc?");
    expect(c.action).toBe("Move to Recently deleted");
    expect(c.lines.join(" ")).toMatch(/Chats are never deleted/);
    expect(deletedToast("Marc", "2026-12-10T18:00:00Z")).toBe(
      "Marc is in Recently deleted. Restore it any time before Dec 10.",
    );
  });

  it("the sign-in screen says who deleted it and when it goes", () => {
    expect(restoreGateCopy({ purge_after: "2026-12-10T18:00:00Z", source: "self" }, NOW).body).toBe(
      "You deleted your account. It'll be gone for good on Dec 10. Restore it and everything comes back just as you left it.",
    );
    const byAdmin = restoreGateCopy({ purge_after: "2026-11-11T12:00:00Z", source: "admin" }, NOW);
    expect(byAdmin.title).toBe("Your account was deleted");
    expect(byAdmin.body).toMatch(
      /^JF Effect deleted your account\. It'll be gone for good tomorrow\. If you think this is a mistake, contact support/,
    );
  });
});

describe("no account is deleted on the spot", () => {
  const sql = readFileSync(
    "supabase/migrations/20270226090000_account_recently_deleted.sql",
    "utf8",
  );
  const clients = readFileSync("src/lib/clients.functions.ts", "utf8");
  const members = readFileSync("src/lib/members.functions.ts", "utf8");

  it("admin deletes move the account to the bin, and the app never deletes a login itself", () => {
    expect(clients).toContain('rpc("account_delete_by_admin", {');
    expect(members).toContain('rpc("account_delete_by_admin", {');
    expect(members).not.toContain("auth.admin.deleteUser");
    const deleteClient = clients.slice(clients.indexOf("export const deleteClient"));
    expect(deleteClient.slice(0, deleteClient.indexOf("});") + 3)).not.toMatch(
      /\.delete\(\)|deleteUser/,
    );
  });

  it("30 days, one waiting at a time, held, and restored exactly as it was", () => {
    expect(sql).toContain("purge_after timestamptz NOT NULL DEFAULT now() + interval '30 days'");
    expect(sql).toContain(
      "ON public.account_deletions (user_id) WHERE status = 'pending' AND user_id IS NOT NULL;",
    );
    expect(sql).toContain(
      "UPDATE public.clients SET archived = true, status = 'Deleted', portal_access_disabled = true",
    );
    expect(sql).toContain("status = r.prior #>> '{client,status}',");
  });

  it("the hold writes as the server and puts the person's claims back", () => {
    expect(sql).toContain("PERFORM set_config('request.jwt.claims', '', true);");
    expect(sql).toContain(
      "PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);",
    );
  });

  it("only day 30 deletes, keeping chats: a record with chat history is deactivated and its login closed", () => {
    const purge = readFileSync("src/lib/account-deletion.server.ts", "utf8");
    expect(purge).toContain('.lte("purge_after", new Date().toISOString())');
    expect(purge).toMatch(/updateUserById\(row\.user_id, \{\s*ban_duration: "876000h",?\s*\}\)/);
    expect(purge).toContain("if (keepChats) await deactivate();");
    expect(sql).toContain("'account-deletions-purge',");
  });

  it("an account in the bin is hidden from the Crew through the blocks set", () => {
    expect(sql).toContain("SELECT d.user_id FROM public.account_deletions d");
    expect(sql).toContain("WHERE d.status IN ('pending', 'deleted')");
  });

  it("a person restores only what they deleted themselves; an admin's delete is the admin's to undo", () => {
    expect(sql).toContain(
      "WHERE user_id = v_uid AND status = 'pending' AND source = 'self' LIMIT 1;",
    );
    const gate = readFileSync("src/components/account/delete-account.tsx", "utf8");
    expect(gate).toContain('{data.source === "self" ? (');
  });

  it("team logins are never binned from here", () => {
    expect(sql).toContain("ur.role::text <> 'client'");
    expect(sql).toContain("IF public._account_is_staff(v_uid) THEN");
  });
});
