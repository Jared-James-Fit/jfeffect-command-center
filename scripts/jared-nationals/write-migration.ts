/**
 * Writes Jared McIntyre's 2027 Nationals prep migrations from src/lib/jared-nationals:
 * the Nov 16 2026 prep (sql.ts) and the Nov 17 corrections on top of it (corrective.ts).
 *
 *   npx tsx scripts/jared-nationals/write-migration.ts
 *
 * Generated, never hand-edited: src/test/jared-nationals-prep.test.ts and
 * src/test/jared-nationals-corrections.test.ts fail when a file and the definitions
 * disagree. Each migration's data part runs once (a run marker) and only changes what
 * nothing has touched.
 */
import { writeFileSync } from "node:fs";
import { prepSql, PREP_MIGRATION } from "../../src/lib/jared-nationals/sql";
import { correctiveSql, CORRECTIVE_MIGRATION } from "../../src/lib/jared-nationals/corrective";

writeFileSync(PREP_MIGRATION, prepSql());
console.log(`wrote ${PREP_MIGRATION}`);
writeFileSync(CORRECTIVE_MIGRATION, correctiveSql());
console.log(`wrote ${CORRECTIVE_MIGRATION}`);
