# Challenges, leaderboard first — database tests

Plain Postgres (16+, with the pg_trgm, unaccent and fuzzystrmatch contrib extensions) tests
for `20270208090000_challenges_leaderboard_first.sql`: paging the ranked board,
whole-event search (capitals, accents, a typo, a bib, registered-but-unscored),
find-my-ranking (ties, the next place up), who's on the platform (only judges
set it; it goes stale), the organizer's summary, the registration window, and
that no email or bodyweight reaches a public read.

```sh
createdb challenges_lb
psql -d challenges_lb -f supabase/tests/challenges-leaderboard/schema.sql
psql -d challenges_lb -f supabase/migrations/20270206090000_live_challenges.sql
psql -d challenges_lb -f supabase/migrations/20270207090000_live_challenges_event_day_fixes.sql
psql -d challenges_lb -f supabase/migrations/20270208090000_challenges_leaderboard_first.sql
psql -d challenges_lb -v ON_ERROR_STOP=1 -f supabase/tests/challenges-leaderboard/scenario.sql
```
