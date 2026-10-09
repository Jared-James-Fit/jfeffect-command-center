# Splitting staff and personal accounts: dry-run plan

Status: **plan only. Nothing here has been run against the live database.**

The rule: anyone with a staff role (admin, coach, media_manager, finance) uses a staff-only login with its own email. A personal client or member login never holds a staff role. A staff login never has a `clients` or `app_members` row. One person's staff roles share one staff login.

Migration `20261019100000_staff_personal_split.sql` enforces this for **new** grants and links. Accounts that already mix both keep working as they are. The dual-account switcher (`use-dual-account.ts`) stays in place for them until they're split.

## 1. List the mixed accounts (read-only)

```sql
SELECT u.id                                   AS user_id,
       u.email,
       array_agg(DISTINCT r.role::text)       AS staff_roles,
       array_agg(DISTINCT c.id)  FILTER (WHERE c.id IS NOT NULL) AS client_ids,
       array_agg(DISTINCT m.id)  FILTER (WHERE m.id IS NOT NULL) AS member_ids
  FROM auth.users u
  JOIN public.user_roles r
    ON r.user_id = u.id AND r.role IN ('admin', 'coach', 'media_manager', 'finance')
  LEFT JOIN public.clients c     ON c.user_id = u.id
  LEFT JOIN public.app_members m ON m.user_id = u.id AND NOT m.is_admin_sandbox
 GROUP BY u.id, u.email
HAVING count(c.id) > 0 OR count(m.id) > 0
 ORDER BY u.email;
```

(`is_admin_sandbox` member rows are the admin's member-POV sandbox, not a personal account.)

## 2. Dry run: what each split would move (read-only)

For one mixed account, this counts every row that points at the login, using every foreign key to `auth.users(id)`. It also counts the common unconstrained id columns, which many tables carry without a foreign key. It only reads.

```sql
DO $$
DECLARE
  _uid uuid := '<user_id from step 1>';
  rec record;
  n bigint;
BEGIN
  FOR rec IN
    SELECT DISTINCT ns.nspname AS sch, cl.relname AS tbl, a.attname AS col
      FROM pg_constraint k
      JOIN pg_class cl      ON cl.oid = k.conrelid
      JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
      JOIN pg_attribute a   ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
     WHERE k.contype = 'f' AND k.confrelid = 'auth.users'::regclass AND ns.nspname = 'public'
    UNION
    SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.data_type = 'uuid'
       AND c.column_name IN ('user_id', 'author_user_id', 'sender_user_id', 'actor_user_id',
                             'created_by', 'uploaded_by', 'redeemed_user_id', 'owner_user_id')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', rec.sch, rec.tbl, rec.col) INTO n USING _uid;
    IF n > 0 THEN RAISE NOTICE '%.% (%): % rows', rec.sch, rec.tbl, rec.col, n; END IF;
  END LOOP;
END $$;
```

Sort the output into the two sides:

- **Personal side:** rows the person created as an athlete. This covers their `clients` / `app_members` link, workout logs keyed by `client_id` (these move with the `clients` row and need no change), and athlete-authored rows keyed by login: community posts, reactions and comments, messages they sent as a client, exercise favourites, push subscriptions, notification reads.
- **Staff side:** roles, the `coaches.user_id` link, MFA enrollment, and everything stamped by them as staff (`created_by`, `uploaded_by`, `actor_user_id`, coach-sent messages, audit rows).

## 3. Proposed split (for you to approve per account)

**Default:** the existing login stays the **staff** login, and a new **personal** login is created for the athlete side.

Why this way round:
- The staff side carries the most history keyed to the login: `created_by` across admin tables, audit trails, coach-sent messages, and the MFA enrollment.
- The athlete side's data is mostly keyed by `clients.id`, so most of it moves by changing one column.

Steps, per account, in one transaction, after a backup:

1. **Create the personal login.** Use the person's personal email through the normal client invite (`inviteClient`), so `handle_new_user` gives it the `client` role.
2. **Move the client record:** `UPDATE clients SET user_id = <new personal uid> WHERE id = <client_id>`. Do the same for `app_members` if there is a member row.
3. **Re-point athlete-authored rows** listed by the dry run, table by table, from the old login to the new personal one: community authorship, client-sent messages, favourites, push subscriptions.
4. **Remove the `client` role** from the staff login.
5. **Re-run the dry run for both logins.** The staff login should show no `clients` / `app_members` rows, and the personal login no staff roles.

For the owner account (admin + coach + own training): admin and coach stay together on the staff login, and the training moves to a personal login. Whether to do this, and when, is your call. Until then the switcher keeps working.

**Nothing in steps 1–5 has been run.** Each is a stop-and-ask change to existing client data.
