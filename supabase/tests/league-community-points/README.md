# Community post points — database tests

Plain Postgres (16+) tests for `20261012110000_league_community_post_points.sql`:
earning, the anti-spam limits (1 a day, 2 a week, finished + recent workouts,
community-visible only), take-backs on archive/delete, comment XP, badges and
league totals. Builds on the league-boost stand-ins.

```sh
createdb community_points_test
psql -d community_points_test -f supabase/tests/league-boost/schema.sql
psql -d community_points_test -f supabase/tests/league-community-points/schema.sql
for f in 20261003180000_performance_league_final_week_boost 20261004180000_league_record_points \
         20261004220500_league_records_include_weight 20261012110000_league_community_post_points; do
  psql -d community_points_test -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql
done
psql -d community_points_test -v ON_ERROR_STOP=1 -f supabase/tests/league-community-points/scenario.sql
```

The supabase roles (`anon`, `authenticated`, `service_role`) must exist in the
cluster. The league-boost scenario also still passes on top of this migration.
