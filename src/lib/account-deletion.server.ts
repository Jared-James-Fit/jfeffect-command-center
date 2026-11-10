/**
 * Recently deleted, day 30: the account is deleted for good
 * (20270226090000_account_recently_deleted.sql moved it to the bin and held
 * it; account-deletions-purge calls this once a day while anything is due).
 *
 * The same rules an admin delete always followed: chats are never deleted, so
 * a client or member with chat history stays as a deactivated record (portal
 * and access off) and their login is closed (banned) instead of deleted; one
 * with none is deleted, login included. Whatever happens is written on the
 * row (`result`), and a row that fails is retried the next day.
 */

type Admin = any;

/** Any coach-chat message for the client, or any support / group message or reaction from their login. */
export async function hasChatHistory(
  admin: Admin,
  ids: { clientId?: string | null; memberId?: string | null; userId?: string | null },
): Promise<boolean> {
  const checks: Array<PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>> =
    [];
  if (ids.clientId)
    checks.push(admin.from("messages").select("id").eq("client_id", ids.clientId).limit(1));
  if (ids.memberId)
    checks.push(
      admin.from("member_support_messages").select("id").eq("member_id", ids.memberId).limit(1),
    );
  if (ids.userId) {
    checks.push(
      admin.from("messages").select("id").eq("sender_id", ids.userId).limit(1),
      admin.from("group_messages").select("id").eq("sender_id", ids.userId).limit(1),
      admin.from("member_support_messages").select("id").eq("sender_user_id", ids.userId).limit(1),
      admin.from("message_reactions").select("id").eq("user_id", ids.userId).limit(1),
      admin.from("group_message_reactions").select("id").eq("user_id", ids.userId).limit(1),
    );
  }
  const results = await Promise.all(checks);
  for (const r of results) {
    if (r.error) throw new Error(r.error.message);
    if (r.data?.length) return true;
  }
  return false;
}

type DueRow = {
  id: string;
  user_id: string | null;
  client_id: string | null;
  member_id: string | null;
  attempts: number;
};

export type PurgeOutcome = {
  client?: "deleted" | "kept";
  member?: "deleted" | "kept";
  login?: "deleted" | "closed";
};

/** Delete one account from the bin for good. */
export async function purgeAccount(admin: Admin, row: DueRow): Promise<PurgeOutcome> {
  const out: PurgeOutcome = {};
  const keepChats = await hasChatHistory(admin, {
    clientId: row.client_id,
    memberId: row.member_id,
    userId: row.user_id,
  });

  if (row.client_id) {
    const deactivate = async () => {
      const { error } = await admin
        .from("clients")
        .update({
          status: "Deactivated",
          archived: true,
          portal_access_disabled: true,
          deactivated_at: new Date().toISOString(),
          deactivation_reason: "Account deleted (chat history kept)",
        })
        .eq("id", row.client_id);
      if (error) throw new Error(error.message);
      out.client = "kept";
    };
    if (keepChats) await deactivate();
    else {
      const { error } = await admin.from("clients").delete().eq("id", row.client_id);
      if (error) await deactivate();
      else out.client = "deleted";
    }
  }

  if (row.member_id) {
    const deactivate = async () => {
      const { error } = await admin
        .from("app_members")
        .update({ status: "Deactivated", manual_access_disabled: true })
        .eq("id", row.member_id);
      if (error) throw new Error(error.message);
      await admin.from("member_access").update({ active: false }).eq("member_id", row.member_id);
      out.member = "kept";
    };
    if (keepChats) await deactivate();
    else {
      const { error } = await admin.from("app_members").delete().eq("id", row.member_id);
      if (error) await deactivate();
      else out.member = "deleted";
    }
  }

  if (row.user_id) {
    // a login with chats is refused by the database (users_guard_chat_delete): it's closed instead
    const { error } = keepChats
      ? { error: { message: "chat history" } }
      : await admin.auth.admin.deleteUser(row.user_id);
    if (!error || /not[_ ]found/i.test(String(error.message))) out.login = "deleted";
    else {
      const { error: banErr } = await admin.auth.admin.updateUserById(row.user_id, {
        ban_duration: "876000h",
      });
      if (banErr) throw new Error(banErr.message);
      out.login = "closed";
    }
  }
  return out;
}

/** Every account whose 30 days are up (at most `limit` a run). */
export async function purgeDueAccounts(admin: Admin, limit = 25) {
  const { data, error } = await admin
    .from("account_deletions")
    .select("id, user_id, client_id, member_id, attempts")
    .eq("status", "pending")
    .lte("purge_after", new Date().toISOString())
    .order("purge_after", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  let deleted = 0;
  let failed = 0;
  for (const row of (data ?? []) as DueRow[]) {
    try {
      const result = await purgeAccount(admin, row);
      await admin
        .from("account_deletions")
        .update({
          status: "deleted",
          deleted_at: new Date().toISOString(),
          result,
          attempts: row.attempts + 1,
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", "pending");
      deleted += 1;
    } catch (e: any) {
      failed += 1;
      await admin
        .from("account_deletions")
        .update({ attempts: row.attempts + 1, last_error: String(e?.message ?? e).slice(0, 500) })
        .eq("id", row.id);
    }
  }
  return { checked: (data ?? []).length, deleted, failed };
}
