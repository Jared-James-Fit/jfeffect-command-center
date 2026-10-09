# Photos on posts — database tests

Plain Postgres (16+) tests for `20261027100000_community_post_photos.sql`:
the shared media check (10 items, 3 videos, your own uploads), the coach's
"+ Post" with photos, swapping the photos on a post later (author only; staff
on a coach note), birthday drafts keeping their photos through new wording
and unschedule and posting with them, staff-only previews of draft photos,
and a daily post's photos going out once.

`schema.sql` stands in for the app tables and helpers; `auth.uid()` reads the
`test.uid` setting and staff are rows in `test_staff`.

```sh
createdb photos_test
psql -d photos_test -f supabase/tests/community-post-photos/schema.sql
psql -d photos_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261027100000_community_post_photos.sql
psql -d photos_test -v ON_ERROR_STOP=1 -f supabase/tests/community-post-photos/scenario.sql
```

Run on a fresh database; the last line prints `ALL OK`.
