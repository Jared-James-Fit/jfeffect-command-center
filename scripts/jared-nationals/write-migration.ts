/**
 * Writes Jared McIntyre's 2027 Nationals prep migration from src/lib/jared-nationals.
 *
 *   npx tsx scripts/jared-nationals/write-migration.ts
 *
 * Generated, never hand-edited: src/test/jared-nationals-prep.test.ts fails when
 * the file and the definitions disagree. The migration runs once (a run marker)
 * and only rewrites workouts nothing has touched.
 */
import { writeFileSync } from "node:fs";
import { prepSql, PREP_MIGRATION } from "../../src/lib/jared-nationals/sql";

writeFileSync(PREP_MIGRATION, prepSql());
console.log(`wrote ${PREP_MIGRATION}`);
