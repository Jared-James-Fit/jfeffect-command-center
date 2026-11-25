/**
 * Recently deleted, day 30: the account is deleted for good
 * (20270226090000_account_recently_deleted.sql moved it to the bin and held
 * it; account-deletions-purge calls this once a day while anything is due).
 *
 * The person's own data always goes. Chats are never deleted and money,
 * session and legal records are kept (tax and contract records), so a client
 * with any of them stays as an anonymized record and their login is closed
 * (banned, email released) instead of deleted; one with none is deleted,
 * login included. Whatever happens is written on the row (`result`), and a
 * row that fails is retried the next day.
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
  /** What the person's own data came to: rows by table, and files. */
  removed?: Record<string, number>;
  files?: number;
  /** Tables that wouldn't clear (retried the next day, at most 3 tries). */
  failed?: Record<string, string>;
};

/** Money, session or legal records: the business keeps them (tax and contract records), so the record stays, anonymized. */
export async function hasBusinessRecords(admin: Admin, clientId: string | null): Promise<boolean> {
  if (!clientId) return false;
  const tables = ["payment_ledger", "session_ledger_events", "purchase_records", "client_account_credits", "na_packages", "service_conversions"];
  const results = await Promise.all(tables.map((t) => admin.from(t).select("id").eq("client_id", clientId).limit(1)));
  return results.some((r: any) => !r.error && (r.data?.length ?? 0) > 0);
}

/** The person's own files: photo, progress photos and videos, lift videos, Crew media, plan PDFs. Chat attachments and signed agreements stay. */
const PERSONAL_BUCKETS = ["avatars", "progress-media", "lift-videos", "community-media", "nutrition-plans", "nutrition-submissions", "form-uploads", "documents"];

async function removeFolder(admin: Admin, bucket: string, folder: string): Promise<number> {
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error || !data?.length) break;
    const files = data.filter((f: any) => f.id).map((f: any) => `${folder}/${f.name}`);
    const dirs = data.filter((f: any) => !f.id).map((f: any) => `${folder}/${f.name}`);
    for (const d of dirs) removed += await removeFolder(admin, bucket, d);
    if (!files.length) break;
    const { error: rmErr } = await admin.storage.from(bucket).remove(files);
    if (rmErr) break;
    removed += files.length;
    if (data.length < 100) break;
  }
  return removed;
}

/**
 * Delete one account from the bin for good. The person's own data always
 * goes (_account_purge_personal: training, nutrition, health, progress,
 * forms, Crew, preferences; their files too). The record itself goes as well
 * unless the business must keep it: money or session records (tax and
 * contract records) or a chat with the coach (kept as a record, the coach's
 * rule). A kept record keeps only the name the money is under, and a kept
 * login is closed with its email released, so they can sign up again.
 */
export async function purgeAccount(admin: Admin, row: DueRow): Promise<PurgeOutcome> {
  const out: PurgeOutcome = {};
  const keepChats = await hasChatHistory(admin, {
    clientId: row.client_id,
    memberId: row.member_id,
    userId: row.user_id,
  });
  const keepRecord = keepChats || (await hasBusinessRecords(admin, row.client_id));

  // The person's own data, whatever happens to the record.
  if (row.client_id || row.user_id) {
    const { data: res, error } = await admin.rpc("_account_purge_personal", {
      _client: row.client_id,
      _user: row.user_id,
    });
    if (error) throw new Error(error.message);
    out.removed = (res as any)?.deleted ?? {};
    const failed = (res as any)?.failed ?? {};
    if (Object.keys(failed).length) {
      out.failed = failed;
      // try again tomorrow; after 3 tries it completes with what wouldn't clear on the row
      if (row.attempts < 2) throw new Error(`Couldn't clear: ${Object.keys(failed).join(", ")}`);
    }
  }
  // their analytics: visits, events, and the browsers they signed in on (bi_forget_user)
  if (row.user_id) {
    try {
      const { data: gone } = await admin.rpc("bi_forget_user", { _user: row.user_id });
      if (gone) out.removed = { ...(out.removed ?? {}), analytics_visits: Number(gone) };
    } catch {
      /* analytics are kept 400 days at most anyway */
    }
  }
  let files = 0;
  // their documents (filed by them or for them, a coach's for them too): files, then rows;
  // their own folder is also cleared below as a fallback
  try {
    const { purgeDocumentsForAccount } = await import("@/lib/documents/documents.server");
    files += (await purgeDocumentsForAccount(admin, { userId: row.user_id, clientId: row.client_id })).files;
  } catch {
    /* the rows go with the client record and the login */
  }
  for (const id of [row.user_id, row.client_id].filter(Boolean) as string[]) {
    for (const b of PERSONAL_BUCKETS) files += await removeFolder(admin, b, id);
  }
  out.files = files;

  if (row.client_id) {
    const keep = async () => {
      const { error } = await admin
        .from("clients")
        .update({
          status: "Deleted",
          archived: true,
          portal_access_disabled: true,
          deactivation_reason: "Account deleted (business records kept)",
        })
        .eq("id", row.client_id);
      if (error) throw new Error(error.message);
      out.client = "kept";
    };
    if (keepRecord) await keep();
    else {
      const { error } = await admin.from("clients").delete().eq("id", row.client_id);
      if (error) await keep();
      else out.client = "deleted";
    }
  }

  if (row.member_id) {
    const keep = async () => {
      const { error } = await admin
        .from("app_members")
        .update({ status: "Deactivated", manual_access_disabled: true })
        .eq("id", row.member_id);
      if (error) throw new Error(error.message);
      await admin.from("member_access").update({ active: false }).eq("member_id", row.member_id);
      out.member = "kept";
    };
    if (keepChats) await keep();
    else {
      const { error } = await admin.from("app_members").delete().eq("id", row.member_id);
      if (error) await keep();
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
      // closed for good, and the email freed so the person can join again one day
      const { error: banErr } = await admin.auth.admin.updateUserById(row.user_id, {
        ban_duration: "876000h",
        email: `deleted-${row.user_id}@deleted.invalid`,
        email_confirm: true,
        user_metadata: {},
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
