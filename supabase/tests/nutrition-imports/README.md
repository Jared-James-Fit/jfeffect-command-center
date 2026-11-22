# Meal plan imports and Cleo drafts — database tests

Plain Postgres (16+) tests for `20270508091000_nutrition_imports.sql`: what the
`nutrition_imports` table refuses (an import with no rights confirmation, a
Cleo draft that isn't a member's or has no answers, answers as an import's
source, more than 8 photos, a status the app doesn't know), who reads what
(a member and a coach their own rows only, signed out nothing, and nobody
inserts, changes or deletes a row but the server, so a free "ready" read can't
be faked and a rights record can't be removed), the queue trigger never
failing a write without pg_net and never callable by a login, the AI credit
costs (5 for a full read, 10 for a draft, the others unchanged) and the
credit state listing them, the private `nutrition-imports` bucket (uploads,
reads and deletes in your own folder only), and a saved import keeping its
rights record when its plan is deleted.

```sh
createdb nimport_test
psql -d nimport_test -f supabase/tests/nutrition-imports/schema.sql
psql -d nimport_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270508091000_nutrition_imports.sql
psql -d nimport_test -f supabase/tests/nutrition-imports/scenario.sql
```

`schema.sql` stands in for Supabase (auth.uid(), the roles with Supabase's
default table grants, storage.buckets / storage.objects with RLS on, the AI
credit helpers `ai_credit_state` reads). pg_net, vault and pg_cron are left out
on purpose. The last line printed is `nutrition-imports: all assertions
passed` (25 checks). The migration can be applied twice.
