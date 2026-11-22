# Documents library — database tests

Plain Postgres (16+) tests for `20270507095000_documents_library.sql`: the
private `documents` bucket (25 MB, the document types only), uploads only into
your own folder, filing a file (the rights confirmation required and stamped
with the server's clock, the file uploaded first, size and type read from
storage, the path inside the owner's folder, never on another client's record,
imports and links only from the server), the uploader removing a file nothing
points at but never a filed one, a coach filing for an assigned client and
never another coach's, a staff member's own documents staying private, who
reads what (RLS and storage: a member sees only their own; a client sees their
own and what their coach shared; a coach sees their own and their client's
coach-visible ones, never the client's private ones, another coach's client or
a member; an admin sees what a coach could; a login with nothing sees
nothing), edits (the owner only, only the name, category, tags and who sees
it), the 30-day Recently deleted (no hard delete, the server's clock, restore,
nothing back after 30 days, a deleted share gone for the client and its file
too), and the server filing an import with its link (`recordDocument`). The
tag cleaning shares its cases with `src/lib/documents/documents.test.ts`.

```sh
createdb doc_test
psql -d doc_test -f supabase/tests/documents/schema.sql
psql -d doc_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270507095000_documents_library.sql
psql -d doc_test -f supabase/tests/documents/scenario.sql
```

`schema.sql` stands in for Supabase (auth.uid(), the roles, clients, coaches,
coached_client_ids(), storage.buckets / storage.objects with RLS on and the
metadata storage writes, and the real rls_evaluate_once). The migration runs
twice cleanly. The last line printed is `documents: all assertions passed`.
