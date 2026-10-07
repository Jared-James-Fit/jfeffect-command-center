# Clients directory: database tests

Plain Postgres (16+) tests for `20261006180000_clients_directory_contract_and_filters.sql`: the contract
status view, the `p_flags` filter (a client must match all of them), the per-filter counts, who can see
which clients, and the privileges. They build on the coaching-agreement stand-ins and migration, then add
stand-ins for the other tables the directory reads, and start from the previous directory function so the
upgrade path (dropping the old 8-argument overload) is exercised too.

```sh
createdb clients_directory_test
P="psql -d clients_directory_test -v ON_ERROR_STOP=1"
$P -f supabase/tests/coaching-agreement/schema.sql
$P -f supabase/migrations/20261006030000_coaching_agreement.sql
$P -f supabase/tests/clients-directory/schema.sql
$P -f supabase/migrations/20261006120000_clients_directory_accuracy.sql
$P -f supabase/migrations/20261006180000_clients_directory_contract_and_filters.sql
$P -f supabase/migrations/20261006180000_clients_directory_contract_and_filters.sql   # safe to run twice
$P -f supabase/tests/clients-directory/scenario.sql
```

Use a fresh database for the scenario (it inserts fixed fixtures). The contract situations it checks are the
same twelve that `src/test/clients-directory-filters.test.ts` checks against the TypeScript rules, and that
test reads the expected answers from `scenario.sql`, so the two cannot drift apart unnoticed.
