# Equipment & setups — database tests

Plain Postgres (16+) tests for `20270420090000_equipment_setups.sql`:
gym / equipment dedupe, settings cleaning, set stamping (only today's sets,
never an edit of an old one, a writer's choice wins), live switching and the
"you're at Gold's today" move, fixing a past workout, retire-vs-delete
(including a set waiting in an exercise's trash), restore, gym removal,
exercise merges, who may write, and RLS reads.

```sh
createdb eq_test
psql -d eq_test -f supabase/tests/equipment-setups/schema.sql
psql -d eq_test -f supabase/migrations/20270420090000_equipment_setups.sql
psql -d eq_test -v ON_ERROR_STOP=1 -f supabase/tests/equipment-setups/scenario.sql
```
