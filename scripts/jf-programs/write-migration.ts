/**
 * Writes the JF Effect program library migration from src/lib/jf-programs.
 *
 *   npx tsx scripts/jf-programs/write-migration.ts
 *
 * The SQL is generated, never hand-edited: src/test/jf-programs.test.ts fails
 * when the file and the definitions disagree. Running the migration twice adds
 * nothing (fixed ids, ON CONFLICT DO NOTHING), and an exercise is only created
 * when no exercise of that name exists.
 */
import { writeFileSync } from "node:fs";
import { librarySql, LIBRARY_MIGRATION } from "../../src/lib/jf-programs/sql";

writeFileSync(LIBRARY_MIGRATION, librarySql());
console.log(`wrote ${LIBRARY_MIGRATION}`);
