/**
 * Writes the cookbook migration from src/lib/cookbook.
 *
 *   npx tsx scripts/cookbook/write-migration.ts
 *
 * The SQL is generated, never hand-edited: src/test/cookbook-library.test.ts
 * fails when the file and the definitions disagree.
 */
import { writeFileSync } from "node:fs";
import { COOKBOOK_MIGRATION, cookbookSql } from "../../src/lib/cookbook/sql";

writeFileSync(COOKBOOK_MIGRATION, cookbookSql());
console.log(`wrote ${COOKBOOK_MIGRATION}`);
