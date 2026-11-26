/**
 * Writes the virtual account names migration and its SQL test cases from src/lib/virtual-accounts.
 *
 *   npx tsx scripts/virtual-names/write-migration.ts
 *
 * Generated, never hand-edited: src/test/virtual-account-names.test.ts fails when the files and
 * the definitions disagree.
 */
import { writeFileSync } from "node:fs";
import {
  VIRTUAL_NAMES_CASES,
  VIRTUAL_NAMES_MIGRATION,
  virtualNameCasesSql,
  virtualNamesSql,
} from "../../src/lib/virtual-accounts/names-sql";

writeFileSync(VIRTUAL_NAMES_MIGRATION, virtualNamesSql());
writeFileSync(VIRTUAL_NAMES_CASES, virtualNameCasesSql());
console.log(`wrote ${VIRTUAL_NAMES_MIGRATION} and ${VIRTUAL_NAMES_CASES}`);
