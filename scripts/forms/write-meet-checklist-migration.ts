/**
 * Writes the Meet Day checklist seed migration from src/lib/meet-checklist-template.ts.
 *
 *   npx tsx scripts/forms/write-meet-checklist-migration.ts
 *
 * Generated, never hand-edited: src/test/meet-checklist.test.ts fails when
 * the file and the template disagree.
 */
import { writeFileSync } from "node:fs";
import { meetChecklistSql, MEET_CHECKLIST_MIGRATION } from "../../src/lib/meet-checklist-sql";

writeFileSync(MEET_CHECKLIST_MIGRATION, meetChecklistSql());
console.log(`wrote ${MEET_CHECKLIST_MIGRATION}`);
